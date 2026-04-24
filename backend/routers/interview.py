"""Interview, review generation, and reference answer routes."""

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage

from backend.auth import get_current_user
from backend.graphs.job_prep import (
    evaluate_job_prep_answers,
    generate_job_prep_preview,
    generate_job_prep_questions,
)
from backend.graphs.review import generate_review
from backend.graphs.topic_drill import evaluate_drill_answers, generate_drill_questions
from backend.indexer import load_topics
from backend.memory import get_profile, llm_update_profile, update_profile_after_interview, update_target_role
from backend.models import (
    ChatRequest,
    EndDrillRequest,
    InterviewMode,
    InterviewPhase,
    JobPrepPreviewRequest,
    JobPrepStartRequest,
    StartInterviewRequest,
)
from backend.review_formatters import format_drill_review, format_job_prep_review
from backend.runtime import (
    _drill_sessions,
    _graphs,
    _job_prep_sessions,
    _task_status,
    get_or_restore_resume_graph,
)
from backend.storage.sessions import (
    STATUS_ENDED,
    STATUS_ONGOING,
    STATUS_REVIEW_FAILED,
    STATUS_REVIEWED,
    STATUS_REVIEWING,
    append_message,
    create_session,
    get_session,
    save_drill_answers,
    save_reference_answer,
    save_review,
    update_session_status,
)
from backend.storage.user_settings import load_user_settings

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api")

_EVAL_TAG_PREFIX = "<!--EVAL:"
_EVAL_TAG_SUFFIX = "-->"


@router.post("/job-prep/preview")
def job_prep_preview(req: JobPrepPreviewRequest, user_id: str = Depends(get_current_user)):
    """Analyze a JD and candidate fit before starting targeted practice."""
    jd_text = req.jd_text.strip()
    if len(jd_text) < 50:
        raise HTTPException(400, "JD 内容太短，无法分析。")

    try:
        preview = generate_job_prep_preview(
            jd_text,
            user_id,
            company=req.company,
            position=req.position,
            use_resume=req.use_resume,
        )
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    return {"preview": preview}


@router.post("/job-prep/start")
def job_prep_start(req: JobPrepStartRequest, user_id: str = Depends(get_current_user)):
    """Start a JD-targeted mock interview session."""
    jd_text = req.jd_text.strip()
    if len(jd_text) < 50:
        raise HTTPException(400, "JD 内容太短，无法生成训练。")

    preview = req.preview_data if isinstance(req.preview_data, dict) else None
    if not preview:
        try:
            preview = generate_job_prep_preview(
                jd_text,
                user_id,
                company=req.company,
                position=req.position,
                use_resume=req.use_resume,
            )
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

    try:
        questions = generate_job_prep_questions(
            jd_text,
            preview,
            user_id,
            use_resume=req.use_resume,
        )
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))

    session_id = str(uuid.uuid4())[:8]
    meta = {
        "company": preview.get("company") or (req.company or "").strip(),
        "position": preview.get("position") or (req.position or "").strip() or "JD 备面",
        "jd_excerpt": jd_text[:1500],
        "use_resume": req.use_resume,
        "preview": preview,
    }

    create_session(
        session_id,
        InterviewMode.JD_PREP.value,
        questions=questions,
        meta=meta,
        user_id=user_id,
    )
    _job_prep_sessions[session_id] = {
        "questions": questions,
        "preview": preview,
        "meta": meta,
        "user_id": user_id,
    }

    return {
        "session_id": session_id,
        "mode": InterviewMode.JD_PREP.value,
        "questions": questions,
        "preview": preview,
        "company": meta["company"],
        "position": meta["position"],
        "meta": meta,
    }


@router.post("/interview/start")
async def start_interview(req: StartInterviewRequest, user_id: str = Depends(get_current_user)):
    """Start a new interview session."""
    session_id = str(uuid.uuid4())[:8]

    if req.mode == InterviewMode.TOPIC_DRILL:
        topics = load_topics(user_id)
        if not req.topic or req.topic not in topics:
            raise HTTPException(400, f"Invalid topic. Available: {list(topics.keys())}")

        user_prefs = load_user_settings(user_id)
        num_questions = req.num_questions or user_prefs.num_questions
        divergence = req.divergence or user_prefs.divergence

        try:
            # generate_drill_questions is sync + LLM-bound; offload to thread
            # to avoid blocking the event loop.
            questions = await asyncio.to_thread(
                generate_drill_questions,
                req.topic,
                user_id,
                num_questions=num_questions,
                divergence=divergence,
            )
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        create_session(session_id, req.mode.value, req.topic, questions=questions, user_id=user_id)
        _drill_sessions[session_id] = {"topic": req.topic, "questions": questions, "user_id": user_id}
        return {
            "session_id": session_id,
            "mode": req.mode.value,
            "topic": req.topic,
            "questions": questions,
        }

    if req.mode == InterviewMode.RESUME:
        from backend.graphs.resume_interview import compile_resume_interview

        target_role = (req.target_role or "").strip()
        if not target_role:
            target_role = (get_profile(user_id).get("target_role") or "").strip()
        if not target_role:
            raise HTTPException(400, "请先填写目标岗位")

        await update_target_role(user_id, target_role)

        graph = compile_resume_interview(user_id)
        config = {"configurable": {"thread_id": session_id}}
        result = await graph.ainvoke({"target_role": target_role}, config)

        ai_message = ""
        for msg in reversed(result["messages"]):
            if isinstance(msg, AIMessage):
                ai_message = msg.content
                break

        create_session(
            session_id, req.mode.value, req.topic,
            meta={"target_role": target_role}, user_id=user_id,
        )
        append_message(session_id, "assistant", ai_message, user_id=user_id)
        _graphs[session_id] = {
            "graph": graph,
            "config": config,
            "mode": req.mode,
            "topic": req.topic,
            "user_id": user_id,
        }
        return {
            "session_id": session_id,
            "mode": req.mode.value,
            "topic": req.topic,
            "target_role": target_role,
            "message": ai_message,
        }

    raise HTTPException(400, f"Unsupported mode for this endpoint: {req.mode.value}")


@router.post("/interview/chat")
async def chat(req: ChatRequest, user_id: str = Depends(get_current_user)):
    """Send user answer, get next interviewer response (resume mode only)."""
    entry = await get_or_restore_resume_graph(req.session_id, user_id)
    if entry is None:
        raise HTTPException(404, "Session not found or no recoverable state.")

    graph = entry["graph"]
    config = entry["config"]
    state = await graph.aget_state(config)
    if not state.next:
        return {"session_id": req.session_id, "message": "", "is_finished": True}

    await graph.aupdate_state(config, {"messages": [HumanMessage(content=req.message)]})
    result = await graph.ainvoke(None, config)
    append_message(req.session_id, "user", req.message, user_id=user_id)

    is_finished = False
    if isinstance(result, dict):
        is_finished = result.get("is_finished", False)
        phase = result.get("phase", "")
        if phase in (InterviewPhase.END.value, "end"):
            is_finished = True

    ai_message = ""
    for msg in reversed(result["messages"]):
        if isinstance(msg, AIMessage):
            ai_message = msg.content
            break

    append_message(req.session_id, "assistant", ai_message, user_id=user_id)
    return {
        "session_id": req.session_id,
        "message": ai_message,
        "is_finished": is_finished,
    }


@router.post("/interview/chat/stream")
async def chat_stream(req: ChatRequest, user_id: str = Depends(get_current_user)):
    """SSE streaming version of /interview/chat with real token streaming."""
    entry = await get_or_restore_resume_graph(req.session_id, user_id)
    if entry is None:
        raise HTTPException(404, "Session not found or no recoverable state.")

    graph = entry["graph"]
    config = entry["config"]
    state = await graph.aget_state(config)
    if not state.next:
        async def finished_gen():
            yield f"data: {json.dumps({'done': True, 'is_finished': True})}\n\n"

        return StreamingResponse(finished_gen(), media_type="text/event-stream")

    await graph.aupdate_state(config, {"messages": [HumanMessage(content=req.message)]})
    append_message(req.session_id, "user", req.message, user_id=user_id)

    async def event_generator():
        full_text = ""
        pending = ""

        try:
            async for event in graph.astream_events(None, config, version="v2"):
                if event["event"] != "on_chat_model_stream":
                    continue
                chunk = event["data"].get("chunk")
                if not chunk or not hasattr(chunk, "content") or not chunk.content:
                    continue

                token = chunk.content
                pending += token

                # Hide inline <!--EVAL:...--> tags from the client while still
                # letting the graph persist them in state for scoring.
                if _EVAL_TAG_PREFIX in pending:
                    start = pending.index(_EVAL_TAG_PREFIX)
                    if _EVAL_TAG_SUFFIX in pending[start:]:
                        before = pending[:start]
                        if before:
                            full_text += before
                            yield f"data: {json.dumps({'token': before})}\n\n"
                        pending = ""
                elif pending.endswith(("<", "<!", "<!-", "<!--", "<!--E", "<!--EV", "<!--EVA", "<!--EVAL", "<!--EVAL:")):
                    # Partial EVAL prefix — hold until we can decide.
                    pass
                else:
                    full_text += pending
                    yield f"data: {json.dumps({'token': pending})}\n\n"
                    pending = ""

            if pending and _EVAL_TAG_PREFIX not in pending:
                full_text += pending
                yield f"data: {json.dumps({'token': pending})}\n\n"
        except Exception as exc:
            logger.exception("chat/stream astream_events failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return

        final_state = await graph.aget_state(config)
        is_finished = False
        if isinstance(final_state.values, dict):
            is_finished = final_state.values.get("is_finished", False)
            phase = final_state.values.get("phase", "")
            if phase in (InterviewPhase.END.value, "end"):
                is_finished = True

        append_message(req.session_id, "assistant", full_text, user_id=user_id)
        yield f"data: {json.dumps({'done': True, 'is_finished': is_finished})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


async def _run_resume_review(session_id: str, user_id: str):
    """Background: restore graph state from checkpoint, run review, persist.

    Self-contained — reads everything it needs from SQLite, so it survives
    process restarts and can be retried via /interview/review/{id}/generate.
    """
    try:
        entry = await get_or_restore_resume_graph(session_id, user_id)
        if entry is None:
            raise RuntimeError("会话状态已失效，无法恢复")

        graph = entry["graph"]
        config = entry["config"]
        state = await graph.aget_state(config)
        values = state.values or {}
        messages = list(values.get("messages", []))
        scores = values.get("scores", [])
        weak_points = values.get("weak_points", [])
        eval_history = values.get("eval_history", [])
        topic_name = values.get("topic_name", entry.get("topic"))
        mode = entry["mode"]
        topic = entry.get("topic")

        review = await asyncio.to_thread(
            generate_review,
            mode=mode,
            messages=messages,
            scores=scores,
            weak_points=weak_points,
            topic=topic_name,
            eval_history=eval_history,
        )

        extraction = await update_profile_after_interview(
            mode=mode.value,
            topic=topic,
            messages=messages,
            user_id=user_id,
            scores=scores,
        )

        resume_overall = {}
        if extraction.get("dimension_scores"):
            resume_overall["dimension_scores"] = extraction["dimension_scores"]
        if extraction.get("avg_score"):
            resume_overall["avg_score"] = extraction["avg_score"]

        save_review(session_id, review, scores, weak_points,
                    overall=resume_overall, user_id=user_id)
        _task_status[session_id] = {"status": "done", "type": "resume_review"}
        _graphs.pop(session_id, None)
        logger.info("Review generated for session %s", session_id)
    except Exception as exc:
        logger.exception("Review generation failed for session %s", session_id)
        update_session_status(
            session_id, STATUS_REVIEW_FAILED,
            user_id=user_id, review_error=str(exc)[:500] or "未知错误",
        )
        _task_status[session_id] = {"status": "error", "type": "resume_review"}


def _end_drill_background(session_id, topic, questions, answers, user_id):
    """Background task: evaluate drill answers + update profile."""
    try:
        eval_result = evaluate_drill_answers(topic, questions, answers, user_id)
        scores = eval_result.get("scores", [])
        overall = eval_result.get("overall", {})

        q_diff = {question["id"]: question.get("difficulty", 3) for question in questions}
        for score in scores:
            score.setdefault("difficulty", q_diff.get(score.get("question_id"), 3))

        review = format_drill_review(questions, answers, scores, overall)
        save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)

        from backend.spaced_repetition import update_weak_point_sr

        for score in scores:
            weak_point = score.get("weak_point")
            score_value = score.get("score")
            if weak_point and isinstance(score_value, (int, float)):
                update_weak_point_sr(topic, weak_point, score_value, user_id)

        asyncio.run(_update_drill_profile(topic, overall, scores, len(questions), user_id))

        _task_status[session_id] = {"status": "done", "type": "drill_review"}
        _drill_sessions.pop(session_id, None)
        logger.info("Drill review generated for session %s", session_id)
    except Exception as exc:
        logger.exception("Drill review failed for session %s", session_id)
        update_session_status(
            session_id, STATUS_REVIEW_FAILED,
            user_id=user_id, review_error=str(exc)[:500] or "未知错误",
        )
        _task_status[session_id] = {"status": "error", "type": "drill_review"}


def _end_jd_prep_background(session_id, questions, answers, preview, meta, user_id):
    """Background task: evaluate JD prep answers + update profile."""
    try:
        eval_result = evaluate_job_prep_answers(questions, answers, preview, user_id)
        scores = eval_result.get("scores", [])
        overall = eval_result.get("overall", {})

        q_diff = {question["id"]: question.get("difficulty", 3) for question in questions}
        for score in scores:
            score.setdefault("difficulty", q_diff.get(score.get("question_id"), 3))

        review = format_job_prep_review(questions, answers, scores, overall, meta)
        save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)

        asyncio.run(_update_job_prep_profile(overall, scores, len(questions), meta, user_id))

        _task_status[session_id] = {"status": "done", "type": "jd_review"}
        _job_prep_sessions.pop(session_id, None)
        logger.info("JD prep review generated for session %s", session_id)
    except Exception as exc:
        logger.exception("JD prep review failed for session %s", session_id)
        update_session_status(
            session_id, STATUS_REVIEW_FAILED,
            user_id=user_id, review_error=str(exc)[:500] or "未知错误",
        )
        _task_status[session_id] = {"status": "error", "type": "jd_review"}


def _extract_answers_from_transcript(transcript: list, questions: list) -> list[dict]:
    """Reconstruct [{question_id, answer}] from the Q/A transcript pattern.

    save_drill_answers lays out transcript as [assistant Q, user A, assistant Q, ...].
    We walk each question in order and take the next user turn as its answer.
    """
    answers: list[dict] = []
    cursor = 0
    for q in questions:
        q_text = q.get("question", "")
        # advance cursor past the question's own assistant entry
        while cursor < len(transcript) and not (
            transcript[cursor].get("role") == "assistant"
            and transcript[cursor].get("content") == q_text
        ):
            cursor += 1
        if cursor >= len(transcript):
            break
        cursor += 1
        if cursor < len(transcript) and transcript[cursor].get("role") == "user":
            answers.append({"question_id": q["id"], "answer": transcript[cursor].get("content", "")})
            cursor += 1
    return answers


def _dispatch_review(
    session_id: str,
    session: dict,
    user_id: str,
    background_tasks: BackgroundTasks,
    answers_override: list | None = None,
) -> dict:
    """Kick off background review generation for any mode. Updates status → reviewing.

    Called by both /interview/end (first attempt) and /interview/review/{id}/generate (retry).
    """
    mode = session["mode"]

    if mode == InterviewMode.RESUME.value:
        update_session_status(session_id, STATUS_REVIEWING, user_id=user_id, clear_error=True)
        _task_status[session_id] = {"status": "pending", "type": "resume_review"}
        background_tasks.add_task(_run_resume_review, session_id, user_id)
        return {"session_id": session_id, "mode": mode, "status": "pending"}

    if mode == InterviewMode.TOPIC_DRILL.value:
        cached = _drill_sessions.get(session_id)
        topic = (cached or {}).get("topic") or session.get("topic")
        questions = (cached or {}).get("questions") or session.get("questions") or []
        if not topic or not questions:
            raise HTTPException(400, "会话缺少必要的题目信息，无法生成复盘。")
        answers = answers_override if answers_override is not None else _extract_answers_from_transcript(
            session.get("transcript", []), questions,
        )

        update_session_status(session_id, STATUS_REVIEWING, user_id=user_id, clear_error=True)
        _task_status[session_id] = {"status": "pending", "type": "drill_review"}
        background_tasks.add_task(_end_drill_background, session_id, topic, questions, answers, user_id)
        return {"session_id": session_id, "mode": mode, "status": "pending"}

    if mode == InterviewMode.JD_PREP.value:
        cached = _job_prep_sessions.get(session_id)
        questions = (cached or {}).get("questions") or session.get("questions") or []
        preview = (cached or {}).get("preview") or (session.get("meta") or {}).get("preview") or {}
        meta = (cached or {}).get("meta") or session.get("meta") or {}
        if not questions:
            raise HTTPException(400, "会话缺少必要的题目信息，无法生成复盘。")
        answers = answers_override if answers_override is not None else _extract_answers_from_transcript(
            session.get("transcript", []), questions,
        )

        update_session_status(session_id, STATUS_REVIEWING, user_id=user_id, clear_error=True)
        _task_status[session_id] = {"status": "pending", "type": "jd_review"}
        background_tasks.add_task(_end_jd_prep_background, session_id, questions, answers, preview, meta, user_id)
        return {"session_id": session_id, "mode": mode, "status": "pending"}

    raise HTTPException(400, f"Unsupported mode for review: {mode}")


@router.post("/interview/end/{session_id}")
async def end_interview(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: EndDrillRequest | None = None,
    user_id: str = Depends(get_current_user),
):
    """End interview → transition status and kick off review generation.

    Idempotent: safe to call again on a session whose review is already done,
    pending, or previously failed. For batch modes, fresh answers in the body
    override anything already persisted (preserves the old "resubmit" flow).
    """
    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")

    status = session["status"]
    mode = session["mode"]

    if status == STATUS_REVIEWED:
        _task_status[session_id] = {"status": "done", "type": _mode_task_type(mode)}
        return {"session_id": session_id, "mode": mode, "status": "done"}

    if status == STATUS_REVIEWING:
        return {"session_id": session_id, "mode": mode, "status": "pending"}

    # Batch modes expect fresh answer payload on /end — persist it even if we're
    # retrying after a prior failure.
    answers_override: list | None = None
    if mode in (InterviewMode.TOPIC_DRILL.value, InterviewMode.JD_PREP.value):
        answers_override = body.answers if body and body.answers else []
        save_drill_answers(session_id, answers_override, user_id=user_id)

    # Flip ongoing → ended before dispatching review so the session is always
    # visible in history even if review generation later crashes.
    if status == STATUS_ONGOING:
        update_session_status(session_id, STATUS_ENDED, user_id=user_id)
        session["status"] = STATUS_ENDED

    return _dispatch_review(session_id, session, user_id, background_tasks, answers_override=answers_override)


def _mode_task_type(mode: str) -> str:
    return {
        InterviewMode.RESUME.value: "resume_review",
        InterviewMode.TOPIC_DRILL.value: "drill_review",
        InterviewMode.JD_PREP.value: "jd_review",
    }.get(mode, "review")


@router.post("/interview/review/{session_id}/generate")
async def generate_session_review(
    session_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
):
    """Re-run review generation for a session. Idempotent; works after restart.

    Accepts sessions in ended / review_failed states. Refuses ongoing sessions
    (user should call /interview/end first) and no-ops on already reviewed ones.
    """
    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")

    status = session["status"]
    mode = session["mode"]

    if status == STATUS_REVIEWED:
        _task_status[session_id] = {"status": "done", "type": _mode_task_type(mode)}
        return {"session_id": session_id, "mode": mode, "status": "done"}
    if status == STATUS_REVIEWING:
        return {"session_id": session_id, "mode": mode, "status": "pending"}
    if status == STATUS_ONGOING:
        raise HTTPException(400, "面试尚未结束，请先结束面试再生成复盘。")
    if status not in (STATUS_ENDED, STATUS_REVIEW_FAILED):
        raise HTTPException(400, f"当前状态 {status} 不支持重新生成复盘。")

    return _dispatch_review(session_id, session, user_id, background_tasks)


@router.get("/interview/session/{session_id}/resume")
async def get_session_for_resume(
    session_id: str,
    user_id: str = Depends(get_current_user),
):
    """Return everything needed to reopen a session in the UI.

    For resume-mode chats, also checks whether the LangGraph checkpoint can
    still drive another turn (can_continue=True ⇒ user can keep answering).
    """
    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")

    can_continue = False
    is_finished = False

    if session["mode"] == InterviewMode.RESUME.value:
        entry = await get_or_restore_resume_graph(session_id, user_id)
        if entry is not None:
            state = await entry["graph"].aget_state(entry["config"])
            values = state.values or {}
            is_finished = bool(values.get("is_finished"))
            can_continue = bool(state.next) and not is_finished

    meta = session.get("meta") or {}
    return {
        "session_id": session_id,
        "mode": session["mode"],
        "topic": session.get("topic"),
        "status": session["status"],
        "review_error": session.get("review_error"),
        "transcript": session.get("transcript", []),
        "questions": session.get("questions", []),
        "target_role": meta.get("target_role", ""),
        "meta": meta,
        "can_continue": can_continue,
        "is_finished": is_finished,
        "has_review": bool(session.get("review")),
    }


async def _update_drill_profile(topic: str, overall: dict, scores: list, total_questions: int, user_id: str):
    """Update profile from drill evaluation — Mem0-style LLM update."""
    valid = []
    for score in scores:
        try:
            valid.append((float(score["score"]), float(score.get("difficulty", 3))))
        except (TypeError, ValueError, KeyError):
            pass

    mastery = overall.get("topic_mastery", {})
    if not isinstance(mastery, dict):
        mastery = {"notes": str(mastery)} if mastery else {}

    coverage = len(valid) / total_questions if total_questions else 0
    if valid:
        contributions = [(difficulty / 5) * (value / 10) for value, difficulty in valid]
        mastery["score"] = round(sum(contributions) / len(valid) * 100, 1)
        mastery["coverage"] = round(coverage, 2)
    mastery.pop("level", None)

    await llm_update_profile(
        mode="topic_drill",
        topic=topic,
        new_weak_points=overall.get("new_weak_points", []),
        new_strong_points=overall.get("new_strong_points", []),
        topic_mastery=mastery,
        communication=overall.get("communication_observations", {}),
        user_id=user_id,
        thinking_patterns=overall.get("thinking_patterns"),
        session_summary=overall.get("summary", ""),
        avg_score=overall.get("avg_score"),
        answer_count=len(scores),
    )


async def _update_job_prep_profile(overall: dict, scores: list, total_questions: int, meta: dict, user_id: str):
    """Update profile from JD prep evaluation."""
    valid = []
    for score in scores:
        try:
            valid.append(float(score["score"]))
        except (TypeError, ValueError, KeyError):
            pass

    topic = meta.get("position") or "JD 备面"
    summary = overall.get("summary", "")
    role_fit = overall.get("role_fit_summary", "")
    if role_fit:
        summary = f"{summary}\n\n岗位匹配度判断: {role_fit}".strip()

    await llm_update_profile(
        mode="jd_prep",
        topic=topic,
        new_weak_points=overall.get("new_weak_points", []),
        new_strong_points=overall.get("new_strong_points", []),
        topic_mastery={},
        communication=overall.get("communication_observations", {}),
        user_id=user_id,
        thinking_patterns=overall.get("thinking_patterns"),
        session_summary=summary,
        avg_score=overall.get("avg_score"),
        answer_count=len(valid),
        dimension_scores=overall.get("dimension_scores"),
    )


@router.post("/interview/reference-answer")
async def generate_reference_answer(body: dict, user_id: str = Depends(get_current_user)):
    """Get a reference answer for a question in a session. Cached per (session_id, question_id)."""
    session_id = (body.get("session_id") or "").strip()
    question_id = body.get("question_id")
    if not session_id or question_id is None:
        raise HTTPException(400, "session_id and question_id are required")

    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")

    qid = str(question_id)
    cached = (session.get("reference_answers") or {}).get(qid)
    if cached:
        return {"reference_answer": cached, "cached": True}

    question = next(
        (q for q in session.get("questions", []) if str(q.get("id")) == qid),
        None,
    )
    if not question:
        raise HTTPException(404, "Question not found in session.")
    topic = session.get("topic") or ""
    question_text = question.get("question", "").strip()
    if not topic or not question_text:
        raise HTTPException(400, "Session missing topic or question text.")

    from backend.indexer import retrieve_topic_context
    from backend.llm_provider import get_langchain_llm
    from backend.prompts.interviewer import REFERENCE_ANSWER_PROMPT

    topics = load_topics(user_id)
    topic_name = topics.get(topic, {}).get("name", topic)
    refs = retrieve_topic_context(topic, question_text, user_id, top_k=3)
    knowledge_context = "\n\n".join(refs) if refs else "（暂无参考材料）"

    prompt = REFERENCE_ANSWER_PROMPT.format(
        topic_name=topic_name,
        question=question_text,
        knowledge_context=knowledge_context,
    )

    llm = get_langchain_llm()
    response = llm.invoke([HumanMessage(content=prompt)])
    answer = response.content.strip()
    save_reference_answer(session_id, qid, answer, user_id=user_id)
    return {"reference_answer": answer, "cached": False}
