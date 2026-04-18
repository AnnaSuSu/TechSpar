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
from backend.memory import llm_update_profile, update_profile_after_interview
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
    append_message,
    create_session,
    save_drill_answers,
    save_review,
)
from backend.storage.user_settings import load_user_settings

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/api")

_EVAL_TAG_PREFIX = "<!--EVAL:"
_EVAL_TAG_SUFFIX = "-->"

# Token chunk size for the simulated SSE stream in /interview/chat/stream.
# Real token streaming is blocked by the sync SqliteSaver checkpointer.
_STREAM_CHUNK_CHARS = 12


def _strip_eval_tags(text: str) -> str:
    result = []
    i = 0
    while i < len(text):
        start = text.find(_EVAL_TAG_PREFIX, i)
        if start == -1:
            result.append(text[i:])
            break
        result.append(text[i:start])
        end = text.find(_EVAL_TAG_SUFFIX, start)
        if end == -1:
            break
        i = end + len(_EVAL_TAG_SUFFIX)
    return "".join(result).rstrip()


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
def start_interview(req: StartInterviewRequest, user_id: str = Depends(get_current_user)):
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
            questions = generate_drill_questions(
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

        graph = compile_resume_interview(user_id)
        config = {"configurable": {"thread_id": session_id}}
        result = graph.invoke({}, config)

        ai_message = ""
        for msg in reversed(result["messages"]):
            if isinstance(msg, AIMessage):
                ai_message = msg.content
                break

        create_session(session_id, req.mode.value, req.topic, user_id=user_id)
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
            "message": ai_message,
        }

    raise HTTPException(400, f"Unsupported mode for this endpoint: {req.mode.value}")


@router.post("/interview/chat")
def chat(req: ChatRequest, user_id: str = Depends(get_current_user)):
    """Send user answer, get next interviewer response (resume mode only)."""
    entry = get_or_restore_resume_graph(req.session_id, user_id)
    if entry is None:
        raise HTTPException(404, "Session not found or no recoverable state.")

    graph = entry["graph"]
    config = entry["config"]
    state = graph.get_state(config)
    if not state.next:
        return {"session_id": req.session_id, "message": "", "is_finished": True}

    graph.update_state(config, {"messages": [HumanMessage(content=req.message)]})
    result = graph.invoke(None, config)
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
    """SSE streaming version of /interview/chat."""
    entry = get_or_restore_resume_graph(req.session_id, user_id)
    if entry is None:
        raise HTTPException(404, "Session not found or no recoverable state.")

    graph = entry["graph"]
    config = entry["config"]
    state = graph.get_state(config)
    if not state.next:
        async def finished_gen():
            yield f"data: {json.dumps({'done': True, 'is_finished': True})}\n\n"

        return StreamingResponse(finished_gen(), media_type="text/event-stream")

    graph.update_state(config, {"messages": [HumanMessage(content=req.message)]})
    append_message(req.session_id, "user", req.message, user_id=user_id)

    # The resume interview graph is compiled with a sync SqliteSaver, which
    # cannot back graph.astream_events(). Run graph.invoke() in a worker thread
    # and chunk the final AI message as SSE tokens.
    async def event_generator():
        try:
            result = await asyncio.to_thread(graph.invoke, None, config)
        except Exception as exc:
            logger.exception("chat/stream graph.invoke failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return

        ai_message = ""
        if isinstance(result, dict):
            for msg in reversed(result.get("messages", [])):
                if isinstance(msg, AIMessage):
                    ai_message = msg.content or ""
                    break

        clean_text = _strip_eval_tags(ai_message)

        for i in range(0, len(clean_text), _STREAM_CHUNK_CHARS):
            token = clean_text[i:i + _STREAM_CHUNK_CHARS]
            yield f"data: {json.dumps({'token': token})}\n\n"
            await asyncio.sleep(0)

        is_finished = False
        if isinstance(result, dict):
            is_finished = result.get("is_finished", False)
            phase = result.get("phase", "")
            if phase in (InterviewPhase.END.value, "end"):
                is_finished = True

        append_message(req.session_id, "assistant", clean_text, user_id=user_id)
        yield f"data: {json.dumps({'done': True, 'is_finished': is_finished})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def _generate_review_background(
    session_id: str,
    mode,
    topic,
    messages,
    scores,
    weak_points,
    eval_history,
    topic_name,
    user_id: str,
):
    """Background task: generate review + update profile."""
    try:
        review = generate_review(
            mode=mode,
            messages=messages,
            scores=scores,
            weak_points=weak_points,
            topic=topic_name,
            eval_history=eval_history,
        )

        extraction = asyncio.run(update_profile_after_interview(
            mode=mode.value,
            topic=topic,
            messages=messages,
            user_id=user_id,
            scores=scores,
        ))

        resume_overall = {}
        if extraction.get("dimension_scores"):
            resume_overall["dimension_scores"] = extraction["dimension_scores"]
        if extraction.get("avg_score"):
            resume_overall["avg_score"] = extraction["avg_score"]

        save_review(session_id, review, scores, weak_points, overall=resume_overall, user_id=user_id)
        _task_status[session_id] = {"status": "done", "type": "resume_review"}
        logger.info("Review generated for session %s", session_id)
    except Exception as exc:
        _task_status[session_id] = {"status": "error", "type": "resume_review"}
        logger.error("Review generation failed for session %s: %s", session_id, exc)


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
        _task_status[session_id] = {"status": "error", "type": "drill_review"}
        logger.error("Drill review failed for session %s: %s", session_id, exc)


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
        _task_status[session_id] = {"status": "error", "type": "jd_review"}
        logger.error("JD prep review failed for session %s: %s", session_id, exc)


@router.post("/interview/end/{session_id}")
async def end_interview(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: EndDrillRequest | None = None,
    user_id: str = Depends(get_current_user),
):
    """End interview → start async evaluation + review generation."""
    if session_id in _drill_sessions:
        entry = _drill_sessions[session_id]
        if entry.get("user_id") != user_id:
            raise HTTPException(403, "Access denied.")

        if _task_status.get(session_id, {}).get("status") == "pending":
            return {"session_id": session_id, "mode": "topic_drill", "status": "pending"}

        topic = entry["topic"]
        questions = entry["questions"]
        answers = body.answers if body and body.answers else []
        save_drill_answers(session_id, answers, user_id=user_id)

        _task_status[session_id] = {"status": "pending", "type": "drill_review"}
        background_tasks.add_task(_end_drill_background, session_id, topic, questions, answers, user_id)
        return {"session_id": session_id, "mode": "topic_drill", "status": "pending"}

    if session_id in _job_prep_sessions:
        entry = _job_prep_sessions[session_id]
        if entry.get("user_id") != user_id:
            raise HTTPException(403, "Access denied.")

        if _task_status.get(session_id, {}).get("status") == "pending":
            return {"session_id": session_id, "mode": InterviewMode.JD_PREP.value, "status": "pending"}

        questions = entry["questions"]
        preview = entry["preview"]
        meta = entry["meta"]
        answers = body.answers if body and body.answers else []
        save_drill_answers(session_id, answers, user_id=user_id)

        _task_status[session_id] = {"status": "pending", "type": "jd_review"}
        background_tasks.add_task(_end_jd_prep_background, session_id, questions, answers, preview, meta, user_id)
        return {"session_id": session_id, "mode": InterviewMode.JD_PREP.value, "status": "pending"}

    if session_id in _task_status:
        task_status = _task_status[session_id]
        return {
            "session_id": session_id,
            "mode": task_status.get("type", "unknown"),
            "status": task_status.get("status", "pending"),
        }

    if session_id not in _graphs:
        raise HTTPException(404, "Session not found.")

    entry = _graphs[session_id]
    if entry.get("user_id") != user_id:
        raise HTTPException(403, "Access denied.")

    graph = entry["graph"]
    config = entry["config"]
    state = graph.get_state(config)
    messages = list(state.values.get("messages", []))
    scores = state.values.get("scores", [])
    weak_points = state.values.get("weak_points", [])
    eval_history = state.values.get("eval_history", [])
    topic_name = state.values.get("topic_name", entry.get("topic"))
    mode = entry["mode"]
    topic = entry.get("topic")

    del _graphs[session_id]

    _task_status[session_id] = {"status": "pending", "type": "resume_review"}
    background_tasks.add_task(
        _generate_review_background,
        session_id,
        mode,
        topic,
        messages,
        scores,
        weak_points,
        eval_history,
        topic_name,
        user_id,
    )
    return {"session_id": session_id, "mode": "resume", "status": "pending"}


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
    """Generate a reference answer for a specific question using LLM + knowledge base."""
    topic = body.get("topic", "").strip()
    question = body.get("question", "").strip()
    if not topic or not question:
        raise HTTPException(400, "topic and question are required")

    from backend.indexer import retrieve_topic_context
    from backend.llm_provider import get_langchain_llm
    from backend.prompts.interviewer import REFERENCE_ANSWER_PROMPT

    topics = load_topics(user_id)
    topic_name = topics.get(topic, {}).get("name", topic)
    refs = retrieve_topic_context(topic, question, user_id, top_k=3)
    knowledge_context = "\n\n".join(refs) if refs else "（暂无参考材料）"

    prompt = REFERENCE_ANSWER_PROMPT.format(
        topic_name=topic_name,
        question=question,
        knowledge_context=knowledge_context,
    )

    llm = get_langchain_llm()
    response = llm.invoke([HumanMessage(content=prompt)])
    return {"reference_answer": response.content.strip()}
