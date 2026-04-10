"""FastAPI 入口 — 面试模拟系统 API."""
import asyncio
import json
import logging
import re
import uuid
from datetime import datetime

from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage

from backend.models import (
    StartInterviewRequest, ChatRequest, EndDrillRequest,
    JobPrepPreviewRequest, JobPrepStartRequest,
    RecordingAnalyzeRequest, RegisterRequest, LoginRequest,
    InterviewMode, InterviewPhase,
    UserSettings, LLMSettings, SettingsResponse,
    VoiceprintCredentials,
)
from backend.graphs.job_prep import (
    generate_job_prep_preview,
    generate_job_prep_questions,
    evaluate_job_prep_answers,
)
from backend.graphs.resume_interview import compile_resume_interview
from backend.graphs.topic_drill import (
    generate_drill_questions, evaluate_drill_answers,
)
from backend.graphs.review import generate_review
from backend.config import settings
from backend.indexer import load_topics, save_topics, _index_cache
from backend.memory import get_profile, update_profile_after_interview, llm_update_profile
from backend.storage.sessions import (
    create_session, append_message, save_review, save_drill_answers,
    get_session, list_sessions, list_sessions_by_topic,
    delete_session, list_distinct_topics,
)
from backend.graph import build_graph
from backend.auth import (
    init_users_table, ensure_default_user,
    create_user, authenticate_user, create_token, get_current_user,
)

app = FastAPI(title="TechSpar", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/api")

# In-memory graph instances keyed by session_id (resume mode only)
_graphs: dict[str, dict] = {}
# Drill session data (questions stored for evaluation at end)
_drill_sessions: dict[str, dict] = {}
# JD prep session data (questions + preview stored for evaluation at end)
_job_prep_sessions: dict[str, dict] = {}
# Review generation status: "pending" | "done" | "error"
_task_status: dict[str, dict] = {}  # {task_id: {"status", "type", "result"}}


def _load_user_settings(user_id: str) -> UserSettings:
    path = settings.user_settings_path(user_id)
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return UserSettings(**data)
    return UserSettings()


def _save_user_settings(user_settings: UserSettings, user_id: str):
    path = settings.user_settings_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(user_settings.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@app.on_event("startup")
def preload_models():
    """Initialize embedding backend and vector memory on startup."""
    from backend.llm_provider import get_embedding
    from backend.indexer import _init_llama_settings
    from backend.vector_memory import init_memory_table
    import logging
    logger = logging.getLogger("uvicorn")
    logger.info(
        "Initializing embedding backend=%s target=%s",
        settings.embedding_backend_mode(),
        settings.active_embedding_target(),
    )
    get_embedding()
    _init_llama_settings()
    logger.info("Embedding backend ready.")

    # Init tables + default user
    init_memory_table()
    init_users_table()
    ensure_default_user()
    logger.info("Database tables initialized.")


# ── Auth endpoints (no authentication required) ──

@router.get("/auth/config")
def auth_config():
    """Public endpoint — tells the frontend whether registration is enabled."""
    return {"allow_registration": settings.allow_registration}


@router.post("/auth/register")
def register(req: RegisterRequest):
    user = create_user(req.email, req.password, req.name)
    token = create_token(user["id"])
    return {"token": token, "user": user}


@router.post("/auth/login")
def login(req: LoginRequest):
    user = authenticate_user(req.email, req.password)
    if not user:
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user["id"])
    return {"token": token, "user": user}


@router.get("/")
def root():
    return {"service": "TechSpar", "version": "0.2.0"}


# ── Resume ──

@router.get("/resume/status")
def resume_status(user_id: str = Depends(get_current_user)):
    """Check if a resume file exists."""
    resume_dir = settings.user_resume_path(user_id)
    if not resume_dir.exists():
        return {"has_resume": False}
    files = [f for f in resume_dir.iterdir() if f.suffix.lower() == ".pdf"]
    if not files:
        return {"has_resume": False}
    f = files[0]
    return {"has_resume": True, "filename": f.name, "size": f.stat().st_size}


@router.post("/resume/upload")
async def upload_resume(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    """Upload a resume PDF. Replaces any existing resume."""
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")

    resume_dir = settings.user_resume_path(user_id)
    resume_dir.mkdir(parents=True, exist_ok=True)

    # Remove old resumes
    for old in resume_dir.iterdir():
        if old.is_file():
            old.unlink()

    # Save new file
    dest = resume_dir / file.filename
    content = await file.read()
    dest.write_bytes(content)

    # Clear index cache so next query rebuilds from new resume
    _index_cache.pop((user_id, "resume"), None)
    cache_dir = settings.user_index_cache_path(user_id) / "resume"
    if cache_dir.exists():
        import shutil
        shutil.rmtree(cache_dir)

    return {"ok": True, "filename": file.filename, "size": len(content)}


# ── Speech-to-text ──

@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), user_id: str = Depends(get_current_user)):
    """Transcribe short audio clip to text via DashScope ASR."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file.")

    try:
        from backend.transcribe import transcribe_audio
        suffix = "." + (file.filename or "audio.webm").rsplit(".", 1)[-1]
        text = transcribe_audio(audio_bytes, suffix=suffix)
        return {"text": text}
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")


# ── Recording review endpoints ──

@router.post("/recording/transcribe")
async def recording_transcribe(
    file: UploadFile = File(...),
    mode: str = Form("dual"),
    user_id: str = Depends(get_current_user),
):
    """Transcribe recording audio via DashScope ASR."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file.")

    suffix = "." + (file.filename or "audio.webm").rsplit(".", 1)[-1]

    try:
        from backend.transcribe import transcribe_audio
        text = transcribe_audio(audio_bytes, suffix=suffix)
        return {"transcript": text, "segments": []}
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")


def _analyze_recording_background(session_id: str, req_transcript: str, req_recording_mode: str,
                                   req_company: str | None, req_position: str | None, user_id: str):
    """Background task: analyze recording transcript."""
    try:
        from backend.graphs.topic_drill import _parse_json_response
        from backend.llm_provider import get_langchain_llm
        from backend.prompts.recording import (
            RECORDING_STRUCTURE_PROMPT, RECORDING_DUAL_EVAL_PROMPT, RECORDING_SOLO_EVAL_PROMPT,
        )
        from langchain_core.messages import SystemMessage
        from backend.memory import get_profile_summary

        llm = get_langchain_llm()
        profile_summary = get_profile_summary(user_id)

        if req_recording_mode == "dual":
            # Structure transcript into Q&A
            structure_prompt = RECORDING_STRUCTURE_PROMPT.format(transcript=req_transcript)
            response = llm.invoke([
                SystemMessage(content="你是面试记录分析引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=structure_prompt),
            ])
            structured = _parse_json_response(response.content)
            qa_pairs = structured.get("qa_pairs", [])

            questions, answers = [], []
            for pair in qa_pairs:
                qid = pair.get("id", len(questions) + 1)
                questions.append({"id": qid, "question": pair["question"], "difficulty": 3,
                                  "focus_area": pair.get("focus_area", "")})
                answers.append({"question_id": qid, "answer": pair.get("answer", "")})

            # Evaluate
            qa_lines = [f"### Q{q['id']} ({q.get('focus_area', '')})\n**题目**: {q['question']}\n**回答**: {a['answer']}"
                        for q, a in zip(questions, answers)]
            eval_prompt = RECORDING_DUAL_EVAL_PROMPT.format(
                qa_pairs="\n\n".join(qa_lines), profile_summary=profile_summary,
            )
            eval_response = llm.invoke([
                SystemMessage(content="你是面试评估引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=eval_prompt),
            ])
            eval_result = _parse_json_response(eval_response.content)
            scores = eval_result.get("scores", [])
            overall = eval_result.get("overall", {})
            for s in scores:
                s.setdefault("difficulty", 3)

            review = _format_drill_review(questions, answers, scores, overall)
            save_drill_answers(session_id, answers, user_id=user_id)
            save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)
        else:
            # Solo mode
            eval_prompt = RECORDING_SOLO_EVAL_PROMPT.format(
                transcript=req_transcript, profile_summary=profile_summary,
            )
            response = llm.invoke([
                SystemMessage(content="你是录音评估引擎。只返回 JSON，不要其他内容。"),
                HumanMessage(content=eval_prompt),
            ])
            eval_result = _parse_json_response(response.content)
            topics_covered = eval_result.get("topics_covered", [])
            overall = eval_result.get("overall", {})
            overall["topics_covered"] = topics_covered
            scores = [{"question_id": t.get("id", i + 1), "score": t.get("score"), "difficulty": 3}
                      for i, t in enumerate(topics_covered)]

            review = _format_solo_review(topics_covered, overall)
            save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)

        asyncio.run(_update_recording_profile(overall, scores, max(len(scores), 1), user_id))

        _task_status[session_id] = {"status": "done", "type": "recording"}
        logger.info(f"Recording analysis done for session {session_id}")
    except Exception as e:
        _task_status[session_id] = {"status": "error", "type": "recording"}
        logger.error(f"Recording analysis failed for session {session_id}: {e}")


@router.post("/recording/analyze")
async def recording_analyze(req: RecordingAnalyzeRequest, background_tasks: BackgroundTasks,
                            user_id: str = Depends(get_current_user)):
    """Analyze a recording transcript — async background processing."""
    session_id = str(uuid.uuid4())
    create_session(session_id, mode="recording", user_id=user_id)

    _task_status[session_id] = {"status": "pending", "type": "recording"}
    background_tasks.add_task(
        _analyze_recording_background, session_id, req.transcript, req.recording_mode,
        req.company, req.position, user_id,
    )

    return {"session_id": session_id, "status": "pending"}




async def _update_recording_profile(overall: dict, scores: list, total_items: int, user_id: str):
    """Update profile from recording analysis — no single topic, points carry their own topic."""
    valid = []
    for s in scores:
        try:
            valid.append(float(s["score"]))
        except (TypeError, ValueError, KeyError):
            pass

    await llm_update_profile(
        mode="recording",
        topic=None,
        new_weak_points=overall.get("new_weak_points", []),
        new_strong_points=overall.get("new_strong_points", []),
        topic_mastery={},
        communication=overall.get("communication_observations", {}),
        user_id=user_id,
        thinking_patterns=overall.get("thinking_patterns"),
        session_summary=overall.get("summary", ""),
        avg_score=overall.get("avg_score"),
        answer_count=len(valid),
    )


async def _update_copilot_profile(fit_report: dict, position: str, user_id: str):
    """Write high-risk gaps from copilot fit analysis back to profile as predicted weak points."""
    if not isinstance(fit_report, dict):
        return
    gaps = fit_report.get("gaps", [])
    high_risk_gaps = [g for g in gaps if isinstance(g, dict) and g.get("risk") == "high"]
    if not high_risk_gaps:
        return

    new_weak_points = [
        {"point": g["point"], "topic": position or "综合", "source": "predicted"}
        for g in high_risk_gaps if g.get("point")
    ]

    await llm_update_profile(
        mode="copilot",
        topic=position or None,
        new_weak_points=new_weak_points,
        new_strong_points=[],
        topic_mastery={},
        communication={},
        user_id=user_id,
        session_summary=f"Copilot JD分析: {position}",
    )


def _format_solo_review(topics_covered: list, overall: dict) -> str:
    """Format solo mode evaluation into a readable review."""
    lines = [f"## 整体评价\n\n{overall.get('summary', '')}\n\n**平均分: {overall.get('avg_score', '-')}/10**\n"]

    if topics_covered:
        lines.append("---\n\n## 涉及知识点\n")
        for t in topics_covered:
            score = t.get("score", "-")
            lines.append(f"### {t.get('topic', '未知')} — {score}/10")
            if t.get("assessment"):
                lines.append(f"**评价**: {t['assessment']}")
            if t.get("understanding"):
                lines.append(f"**理解程度**: {t['understanding']}")
            if t.get("errors"):
                lines.append(f"**错误**: {', '.join(t['errors'])}")
            if t.get("missing"):
                lines.append(f"**遗漏**: {', '.join(t['missing'])}")
            lines.append("")

    if overall.get("new_weak_points"):
        lines.append("---\n\n## 薄弱点")
        for wp in overall["new_weak_points"]:
            lines.append(f"- {wp.get('point', wp) if isinstance(wp, dict) else wp}")

    if overall.get("new_strong_points"):
        lines.append("\n## 亮点")
        for sp in overall["new_strong_points"]:
            lines.append(f"- {sp.get('point', sp) if isinstance(sp, dict) else sp}")

    return "\n".join(lines)


# ── Topics ──

@router.get("/topics")
def get_topics(user_id: str = Depends(get_current_user)):
    """List available drill topics (with name and icon)."""
    return load_topics(user_id)


@router.post("/topics")
def create_topic(body: dict, user_id: str = Depends(get_current_user)):
    """Add a new topic."""
    name = body.get("name", "").strip()
    icon = body.get("icon", "📝").strip()
    if not name:
        raise HTTPException(400, "name is required")

    # Auto-generate a short URL-safe key
    key = body.get("key", "").strip()
    if not key:
        key = uuid.uuid4().hex[:8]
    # Sanitize: only keep alphanumeric, hyphens, underscores
    key = re.sub(r'[^a-zA-Z0-9_-]', '', key)
    if not key:
        key = uuid.uuid4().hex[:8]

    topics = load_topics(user_id)
    if key in topics:
        raise HTTPException(409, f"Topic '{key}' already exists")

    dir_name = key
    topics[key] = {"name": name, "icon": icon, "dir": dir_name}
    save_topics(topics, user_id)

    # Create knowledge directory with README
    topic_dir = settings.user_knowledge_path(user_id) / dir_name
    topic_dir.mkdir(parents=True, exist_ok=True)
    readme = topic_dir / "README.md"
    if not readme.exists():
        readme.write_text(f"# {name}\n", encoding="utf-8")

    return {"ok": True, "key": key}


@router.delete("/topics/{key}")
def delete_topic(key: str, user_id: str = Depends(get_current_user)):
    """Remove a topic."""
    topics = load_topics(user_id)
    if key not in topics:
        raise HTTPException(404, f"Topic '{key}' not found")

    del topics[key]
    save_topics(topics, user_id)

    # Clear index cache
    _index_cache.pop((user_id, key), None)

    return {"ok": True}


# ── Profile ──

@router.get("/profile")
def get_user_profile(user_id: str = Depends(get_current_user)):
    """Get the user's accumulated interview profile."""
    return get_profile(user_id)


@router.get("/profile/due-reviews")
def get_due_reviews_endpoint(topic: str = None, user_id: str = Depends(get_current_user)):
    """Get weak points due for spaced repetition review."""
    from backend.spaced_repetition import get_due_reviews as _get_due
    return _get_due(user_id, topic)


@router.get("/profile/topic/{topic}/history")
def get_topic_history(topic: str, user_id: str = Depends(get_current_user)):
    """Get session history for a specific topic."""
    sessions = list_sessions_by_topic(topic, user_id=user_id)
    return sessions


def _generate_retrospective_background(task_id: str, topic: str, user_id: str):
    """Background task: generate topic retrospective."""
    try:
        from backend.prompts.interviewer import TOPIC_RETROSPECTIVE_PROMPT
        from backend.memory import _load_profile, _save_profile
        from backend.llm_provider import get_langchain_llm
        from langchain_core.messages import SystemMessage

        sessions = list_sessions_by_topic(topic, user_id=user_id)
        profile = _load_profile(user_id)
        topic_display = {k: v["name"] for k, v in load_topics(user_id).items()}
        topic_name = topic_display.get(topic, topic)
        mastery = profile.get("topic_mastery", {}).get(topic, {})

        history_lines = []
        for s in sessions:
            date = s["created_at"][:10]
            scores = s.get("scores", [])
            valid_scores = [sc for sc in scores if isinstance(sc.get("score"), (int, float))]
            avg = round(sum(sc["score"] for sc in valid_scores) / len(valid_scores), 1) if valid_scores else None
            review = s.get("review") or ""
            summary_part = review.split("## 逐题复盘")[0].strip()
            score_lines = []
            for sc in valid_scores:
                line = f"- Q{sc.get('question_id', '?')}: {sc['score']}/10"
                if sc.get("assessment"):
                    line += f" — {sc['assessment']}"
                score_lines.append(line)
            history_lines.append(
                f"### {date} (答题 {len(valid_scores)}/10, 平均 {avg or '无'}/10)\n"
                f"{summary_part}\n"
                + ("\n".join(score_lines) + "\n" if score_lines else "")
            )

        mastery_score = mastery.get("score", mastery.get("level", 0) * 20)
        mastery_text = f"{mastery_score}/100 — {mastery.get('notes', '')}" if mastery_score > 0 else "暂无评估"

        prompt = TOPIC_RETROSPECTIVE_PROMPT.format(
            topic_name=topic_name,
            session_history="\n".join(history_lines),
            mastery_info=mastery_text,
        )

        llm = get_langchain_llm()
        response = llm.invoke([
            SystemMessage(content="你是面试教练。用 markdown 生成回顾报告。"),
            HumanMessage(content=prompt),
        ])

        retrospective = response.content.strip()
        generated_at = datetime.now().isoformat()
        profile.setdefault("topic_mastery", {}).setdefault(topic, {})["retrospective"] = retrospective
        profile["topic_mastery"][topic]["retrospective_at"] = generated_at
        _save_profile(profile, user_id)

        _task_status[task_id] = {
            "status": "done", "type": "retrospective",
            "result": {
                "topic": topic, "topic_name": topic_name,
                "retrospective": retrospective, "retrospective_at": generated_at,
                "session_count": len(sessions),
            },
        }
        logger.info(f"Retrospective generated for topic {topic}")
    except Exception as e:
        _task_status[task_id] = {"status": "error", "type": "retrospective"}
        logger.error(f"Retrospective failed for topic {topic}: {e}")


@router.post("/profile/topic/{topic}/retrospective")
async def generate_retrospective(topic: str, background_tasks: BackgroundTasks,
                                 user_id: str = Depends(get_current_user)):
    """Generate a comprehensive retrospective — async background processing."""
    sessions = list_sessions_by_topic(topic, user_id=user_id)
    if not sessions:
        raise HTTPException(400, "该领域暂无训练记录")

    task_id = f"retro_{topic}_{user_id[:8]}"
    existing = _task_status.get(task_id)
    if existing and existing.get("status") == "pending":
        return {"task_id": task_id, "status": "pending"}
    _task_status[task_id] = {"status": "pending", "type": "retrospective"}
    background_tasks.add_task(_generate_retrospective_background, task_id, topic, user_id)

    return {"task_id": task_id, "status": "pending"}


# ── Settings ──

@router.get("/settings")
def get_user_settings(user_id: str = Depends(get_current_user)):
    """Get combined LLM (global) and training (per-user) settings."""
    llm = LLMSettings(
        api_base=settings.api_base,
        api_key=settings.api_key,
        model=settings.model,
        temperature=settings.temperature,
    )
    training = _load_user_settings(user_id)
    return SettingsResponse(llm=llm, training=training)


@router.put("/settings")
def put_user_settings(payload: SettingsResponse, user_id: str = Depends(get_current_user)):
    """Update LLM (global, hot-reload) and training (per-user) settings."""
    from backend.llm_provider import _reset_llama_singleton

    llm = payload.llm
    settings.api_base = llm.api_base
    settings.api_key = llm.api_key
    settings.model = llm.model
    settings.temperature = llm.temperature
    _reset_llama_singleton()

    _save_user_settings(payload.training, user_id)
    return {"ok": True}


# ── Voiceprint (optional Tencent Cloud VPR) ──

@router.get("/voiceprint/status")
def voiceprint_status(user_id: str = Depends(get_current_user)):
    """返回用户声纹配置状态（未配置/已配置未注册/已注册）。"""
    from backend.copilot import voiceprint_store
    return voiceprint_store.status_summary(user_id)


@router.put("/voiceprint/credentials")
async def voiceprint_put_credentials(
    payload: VoiceprintCredentials,
    user_id: str = Depends(get_current_user),
):
    """保存腾讯云凭据。保存前先 ping 一下验证有效性。"""
    from backend.copilot import voiceprint_store
    from backend.copilot.voiceprint import VoiceprintClient

    client = VoiceprintClient(
        secret_id=payload.secret_id,
        secret_key=payload.secret_key,
        app_id=payload.app_id,
    )
    if not await client.ping():
        raise HTTPException(400, "腾讯云凭据无效或网络不通，请检查 SecretId / SecretKey")

    data = voiceprint_store.load(user_id)
    data["credentials"] = payload.model_dump()
    voiceprint_store.save(user_id, data)
    return {"ok": True}


@router.post("/voiceprint/enroll")
async def voiceprint_enroll(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    """上传 WAV 文件注册候选人声纹。前端应录制 ≥6 秒 16kHz mono WAV。"""
    from backend.copilot import voiceprint_store
    from backend.copilot.voiceprint import extract_pcm_from_wav

    client = voiceprint_store.get_client(user_id)
    if client is None:
        raise HTTPException(400, "请先在设置页配置腾讯云凭据")

    wav_bytes = await file.read()
    if not wav_bytes:
        raise HTTPException(400, "上传文件为空")
    try:
        pcm_bytes = extract_pcm_from_wav(wav_bytes)
    except ValueError as e:
        raise HTTPException(400, f"WAV 解析失败：{e}")

    # 至少 2 秒（16000 samples/s * 2 bytes/sample * 2 s = 64000 bytes）
    if len(pcm_bytes) < 64000:
        raise HTTPException(400, "录音太短，至少 2 秒")

    speaker_nick = f"techspar_{user_id}"
    voice_print_id = await client.enroll(speaker_nick, pcm_bytes)
    if not voice_print_id:
        raise HTTPException(500, "腾讯云声纹注册失败，请检查日志")

    data = voiceprint_store.load(user_id)
    data["enrollment"] = {
        "voice_print_id": voice_print_id,
        "speaker_nick": speaker_nick,
        "enrolled_at": datetime.now().isoformat(),
    }
    voiceprint_store.save(user_id, data)
    return {"ok": True, "enrolled_at": data["enrollment"]["enrolled_at"]}


@router.delete("/voiceprint/enroll")
async def voiceprint_unenroll(user_id: str = Depends(get_current_user)):
    """删除已注册声纹（本地 + 腾讯云端）。保留凭据。"""
    from backend.copilot import voiceprint_store

    voice_print_id = voiceprint_store.get_voice_print_id(user_id)
    if voice_print_id:
        client = voiceprint_store.get_client(user_id)
        if client is not None:
            await client.delete(voice_print_id)

    data = voiceprint_store.load(user_id)
    data.pop("enrollment", None)
    voiceprint_store.save(user_id, data)
    return {"ok": True}


# ── Interview ──

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
        # ── Drill mode: generate questions upfront ──
        topics = load_topics(user_id)
        if not req.topic or req.topic not in topics:
            raise HTTPException(400, f"Invalid topic. Available: {list(topics.keys())}")

        user_prefs = _load_user_settings(user_id)
        num_questions = req.num_questions or user_prefs.num_questions
        divergence = req.divergence or user_prefs.divergence

        try:
            questions = generate_drill_questions(
                req.topic, user_id,
                num_questions=num_questions,
                divergence=divergence,
            )
        except RuntimeError as e:
            raise HTTPException(500, str(e))
        create_session(session_id, req.mode.value, req.topic, questions=questions, user_id=user_id)
        _drill_sessions[session_id] = {"topic": req.topic, "questions": questions, "user_id": user_id}

        return {
            "session_id": session_id,
            "mode": req.mode.value,
            "topic": req.topic,
            "questions": questions,
        }
    if req.mode == InterviewMode.RESUME:
        # ── Resume mode: LangGraph interactive interview ──
        graph = compile_resume_interview(user_id)
        initial_state = {}
        config = {"configurable": {"thread_id": session_id}}

        result = graph.invoke(initial_state, config)

        ai_message = ""
        for msg in reversed(result["messages"]):
            if isinstance(msg, AIMessage):
                ai_message = msg.content
                break

        create_session(session_id, req.mode.value, req.topic, user_id=user_id)
        append_message(session_id, "assistant", ai_message, user_id=user_id)
        _graphs[session_id] = {
            "graph": graph, "config": config,
            "mode": req.mode, "topic": req.topic,
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
    if req.session_id not in _graphs:
        raise HTTPException(404, "Session not found. It may have expired (in-memory only).")

    entry = _graphs[req.session_id]
    if entry.get("user_id") != user_id:
        raise HTTPException(403, "Access denied.")

    graph = entry["graph"]
    config = entry["config"]

    # Guard: if graph already completed, reject further messages
    state = graph.get_state(config)
    if not state.next:
        return {"session_id": req.session_id, "message": "", "is_finished": True}

    # Inject user message into checkpoint state, then resume from interrupt
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


_EVAL_TAG_PREFIX = "<!--EVAL:"
_EVAL_TAG_SUFFIX = "-->"


@router.post("/interview/chat/stream")
async def chat_stream(req: ChatRequest, user_id: str = Depends(get_current_user)):
    """SSE streaming version of /interview/chat."""
    if req.session_id not in _graphs:
        raise HTTPException(404, "Session not found.")

    entry = _graphs[req.session_id]
    if entry.get("user_id") != user_id:
        raise HTTPException(403, "Access denied.")

    graph = entry["graph"]
    config = entry["config"]

    state = graph.get_state(config)
    if not state.next:
        async def _finished_gen():
            yield f"data: {json.dumps({'done': True, 'is_finished': True})}\n\n"
        return StreamingResponse(_finished_gen(), media_type="text/event-stream")

    graph.update_state(config, {"messages": [HumanMessage(content=req.message)]})
    append_message(req.session_id, "user", req.message, user_id=user_id)

    async def event_generator():
        full_text = ""
        # Buffer for detecting <!--EVAL:...--> at the end of response
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

                # Check if pending might contain the start of an eval tag
                # Only hold back when we see a potential <!--EVAL: prefix
                if _EVAL_TAG_PREFIX in pending:
                    # Full eval tag found — strip it and stop buffering
                    if _EVAL_TAG_SUFFIX in pending[pending.index(_EVAL_TAG_PREFIX):]:
                        before = pending[:pending.index(_EVAL_TAG_PREFIX)]
                        if before:
                            full_text += before
                            yield f"data: {json.dumps({'token': before})}\n\n"
                        pending = ""
                    # Else: partial eval tag, keep buffering
                elif pending.endswith(("<", "<!", "<!-", "<!--", "<!--E", "<!--EV", "<!--EVA", "<!--EVAL", "<!--EVAL:")):
                    # Could be start of eval tag — keep buffering
                    pass
                else:
                    # Safe to flush
                    full_text += pending
                    yield f"data: {json.dumps({'token': pending})}\n\n"
                    pending = ""

            # Flush any remaining buffer (not part of eval tag)
            if pending and _EVAL_TAG_PREFIX not in pending:
                full_text += pending
                yield f"data: {json.dumps({'token': pending})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            return

        # Read final state for is_finished
        final_state = graph.get_state(config)
        is_finished = False
        if isinstance(final_state.values, dict):
            is_finished = final_state.values.get("is_finished", False)
            phase = final_state.values.get("phase", "")
            if phase in (InterviewPhase.END.value, "end"):
                is_finished = True

        append_message(req.session_id, "assistant", full_text, user_id=user_id)
        yield f"data: {json.dumps({'done': True, 'is_finished': is_finished})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


logger = logging.getLogger("uvicorn")


def _generate_review_background(
    session_id: str, mode, topic, messages, scores, weak_points,
    eval_history, topic_name, user_id: str,
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
        logger.info(f"Review generated for session {session_id}")
    except Exception as e:
        _task_status[session_id] = {"status": "error", "type": "resume_review"}
        logger.error(f"Review generation failed for session {session_id}: {e}")


def _end_drill_background(session_id, topic, questions, answers, user_id):
    """Background task: evaluate drill answers + update profile."""
    try:
        eval_result = evaluate_drill_answers(topic, questions, answers, user_id)
        scores = eval_result.get("scores", [])
        overall = eval_result.get("overall", {})

        q_diff = {q["id"]: q.get("difficulty", 3) for q in questions}
        for s in scores:
            s.setdefault("difficulty", q_diff.get(s.get("question_id"), 3))

        review = _format_drill_review(questions, answers, scores, overall)
        save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)

        from backend.spaced_repetition import update_weak_point_sr
        for s in scores:
            wp = s.get("weak_point")
            sc = s.get("score")
            if wp and isinstance(sc, (int, float)):
                update_weak_point_sr(topic, wp, sc, user_id)

        asyncio.run(_update_drill_profile(topic, overall, scores, len(questions), user_id))

        _task_status[session_id] = {"status": "done", "type": "drill_review"}
        logger.info(f"Drill review generated for session {session_id}")
    except Exception as e:
        _task_status[session_id] = {"status": "error", "type": "drill_review"}
        logger.error(f"Drill review failed for session {session_id}: {e}")


def _end_jd_prep_background(session_id, questions, answers, preview, meta, user_id):
    """Background task: evaluate JD prep answers + update profile."""
    try:
        eval_result = evaluate_job_prep_answers(questions, answers, preview, user_id)
        scores = eval_result.get("scores", [])
        overall = eval_result.get("overall", {})

        q_diff = {q["id"]: q.get("difficulty", 3) for q in questions}
        for s in scores:
            s.setdefault("difficulty", q_diff.get(s.get("question_id"), 3))

        review = _format_job_prep_review(questions, answers, scores, overall, meta)
        save_review(session_id, review, scores, overall.get("new_weak_points", []), overall, user_id=user_id)

        asyncio.run(_update_job_prep_profile(overall, scores, len(questions), meta, user_id))

        _task_status[session_id] = {"status": "done", "type": "jd_review"}
        logger.info(f"JD prep review generated for session {session_id}")
    except Exception as e:
        _task_status[session_id] = {"status": "error", "type": "jd_review"}
        logger.error(f"JD prep review failed for session {session_id}: {e}")


@router.post("/interview/end/{session_id}")
async def end_interview(session_id: str, background_tasks: BackgroundTasks,
                        body: EndDrillRequest = None,
                        user_id: str = Depends(get_current_user)):
    """End interview → start async evaluation + review generation."""

    # ── Drill mode ──
    if session_id in _drill_sessions:
        entry = _drill_sessions[session_id]
        if entry.get("user_id") != user_id:
            raise HTTPException(403, "Access denied.")

        topic = entry["topic"]
        questions = entry["questions"]
        answers = body.answers if body and body.answers else []

        save_drill_answers(session_id, answers, user_id=user_id)
        del _drill_sessions[session_id]

        _task_status[session_id] = {"status": "pending", "type": "drill_review"}
        background_tasks.add_task(_end_drill_background, session_id, topic, questions, answers, user_id)

        return {"session_id": session_id, "mode": "topic_drill", "status": "pending"}

    # ── JD prep mode ──
    if session_id in _job_prep_sessions:
        entry = _job_prep_sessions[session_id]
        if entry.get("user_id") != user_id:
            raise HTTPException(403, "Access denied.")

        questions = entry["questions"]
        preview = entry["preview"]
        meta = entry["meta"]
        answers = body.answers if body and body.answers else []

        save_drill_answers(session_id, answers, user_id=user_id)
        del _job_prep_sessions[session_id]

        _task_status[session_id] = {"status": "pending", "type": "jd_review"}
        background_tasks.add_task(_end_jd_prep_background, session_id, questions, answers, preview, meta, user_id)

        return {"session_id": session_id, "mode": InterviewMode.JD_PREP.value, "status": "pending"}

    # ── Already ended — idempotent response ──
    if session_id in _task_status:
        ts = _task_status[session_id]
        return {"session_id": session_id, "mode": ts.get("type", "unknown"), "status": ts.get("status", "pending")}

    # ── Resume mode: async review generation ──
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
        session_id, mode, topic, messages, scores, weak_points, eval_history, topic_name, user_id,
    )

    return {
        "session_id": session_id,
        "mode": "resume",
        "status": "pending",
    }


def _format_drill_review(questions, answers, scores, overall) -> str:
    """Format drill evaluation into a readable review string."""
    answer_map = {a["question_id"]: a["answer"] for a in answers}
    score_map = {s["question_id"]: s for s in scores}

    lines = [f"## 整体评价\n\n{overall.get('summary', '')}\n\n**平均分: {overall.get('avg_score', '-')}/10**\n"]

    lines.append("---\n\n## 逐题复盘\n")
    for q in questions:
        qid = q["id"]
        s = score_map.get(qid, {})
        answer = answer_map.get(qid, "")

        # Unanswered: one-line summary only
        if not answer:
            lines.append(f"### Q{qid} ({q.get('focus_area', '')}) — 未作答")
            lines.append(f"**题目**: {q['question']}\n")
            continue

        score = s.get("score", "-")
        assessment = s.get("assessment", "")
        understanding = s.get("understanding", "")
        missing = s.get("key_missing", [])

        lines.append(f"### Q{qid} ({q.get('focus_area', '')}) — {score}/10")
        lines.append(f"**题目**: {q['question']}")
        lines.append(f"**你的回答**: {answer}")
        if assessment:
            lines.append(f"**点评**: {assessment}")
        improvement = s.get("improvement", "")
        if improvement:
            lines.append(f"**改进建议**: {improvement}")
        if understanding:
            lines.append(f"**理解程度**: {understanding}")
        if missing:
            lines.append(f"**遗漏关键点**: {', '.join(missing)}")
        lines.append("")

    if overall.get("new_weak_points"):
        lines.append("---\n\n## 薄弱点")
        for wp in overall["new_weak_points"]:
            lines.append(f"- {wp.get('point', wp) if isinstance(wp, dict) else wp}")

    if overall.get("new_strong_points"):
        lines.append("\n## 亮点")
        for sp in overall["new_strong_points"]:
            lines.append(f"- {sp.get('point', sp) if isinstance(sp, dict) else sp}")

    return "\n".join(lines)


def _format_job_prep_review(questions, answers, scores, overall, meta) -> str:
    """Format JD prep evaluation into a readable review string."""
    answer_map = {a["question_id"]: a["answer"] for a in answers}
    score_map = {s["question_id"]: s for s in scores}

    title = meta.get("position") or "目标岗位"
    company = meta.get("company")
    heading = f"{company} / {title}" if company else title

    lines = [f"## 岗位画像\n\n**目标岗位**: {heading}\n"]

    if meta.get("preview", {}).get("role_summary"):
        lines.append(f"\n**岗位本质**: {meta['preview']['role_summary']}\n")

    lines.append(f"\n## 整体评价\n\n{overall.get('summary', '')}\n")
    lines.append(f"\n**平均分: {overall.get('avg_score', '-')}/10**")

    if overall.get("role_fit_summary"):
        lines.append(f"\n**岗位匹配度**: {overall['role_fit_summary']}")

    if overall.get("interviewer_hotspots"):
        lines.append("\n\n## 高风险追问点")
        for item in overall["interviewer_hotspots"]:
            lines.append(f"- {item}")

    if overall.get("prep_priorities"):
        lines.append("\n## 面试前优先补强")
        for item in overall["prep_priorities"]:
            lines.append(f"- {item}")

    lines.append("\n---\n\n## 逐题复盘\n")
    for q in questions:
        qid = q["id"]
        s = score_map.get(qid, {})
        answer = answer_map.get(qid, "")

        if not answer:
            lines.append(f"### Q{qid} ({q.get('category', '未分类')}) — 未作答")
            lines.append(f"**题目**: {q['question']}\n")
            continue

        lines.append(
            f"### Q{qid} ({q.get('category', '未分类')} / {q.get('focus_area', '')})"
            f" — {s.get('score', '-')}/10"
        )
        lines.append(f"**题目**: {q['question']}")
        lines.append(f"**你的回答**: {answer}")
        if s.get("role_expectation"):
            lines.append(f"**岗位在看什么**: {s['role_expectation']}")
        if s.get("assessment"):
            lines.append(f"**点评**: {s['assessment']}")
        if s.get("improvement"):
            lines.append(f"**改进建议**: {s['improvement']}")
        if s.get("understanding"):
            lines.append(f"**理解程度**: {s['understanding']}")
        if s.get("key_missing"):
            lines.append(f"**遗漏关键点**: {', '.join(s['key_missing'])}")
        lines.append("")

    if overall.get("new_weak_points"):
        lines.append("---\n\n## 薄弱点")
        for wp in overall["new_weak_points"]:
            lines.append(f"- {wp.get('point', wp) if isinstance(wp, dict) else wp}")

    if overall.get("new_strong_points"):
        lines.append("\n## 亮点")
        for sp in overall["new_strong_points"]:
            lines.append(f"- {sp.get('point', sp) if isinstance(sp, dict) else sp}")

    return "\n".join(lines)


async def _update_drill_profile(topic: str, overall: dict, scores: list,
                                total_questions: int, user_id: str):
    """Update profile from drill evaluation — Mem0-style LLM update."""
    # Compute mastery score (0-100) from per-question scores + difficulty
    valid = []
    for s in scores:
        try:
            valid.append((float(s["score"]), float(s.get("difficulty", 3))))
        except (TypeError, ValueError, KeyError):
            pass
    mastery = overall.get("topic_mastery", {})
    if not isinstance(mastery, dict):
        mastery = {"notes": str(mastery)} if mastery else {}
    coverage = len(valid) / total_questions if total_questions else 0
    if valid:
        # contribution = (difficulty/5) × (score/10), divide by answered count only
        contributions = [(d / 5) * (s / 10) for s, d in valid]
        mastery["score"] = round(sum(contributions) / len(valid) * 100, 1)
        mastery["coverage"] = round(coverage, 2)
    mastery.pop("level", None)  # migrate away from old Lv1-5

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


async def _update_job_prep_profile(overall: dict, scores: list, total_questions: int,
                                   meta: dict, user_id: str):
    """Update profile from JD prep evaluation."""
    valid = []
    for s in scores:
        try:
            valid.append(float(s["score"]))
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


# ── Knowledge management endpoints ──

@router.get("/knowledge/{topic}/core")
async def get_core_knowledge(topic: str, user_id: str = Depends(get_current_user)):
    """List core knowledge files for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    topic_dir = settings.user_knowledge_path(user_id) / topics[topic]["dir"]
    if not topic_dir.exists():
        return []
    files = []
    for f in sorted(topic_dir.glob("*.md")):
        files.append({"filename": f.name, "content": f.read_text(encoding="utf-8")})
    return files


@router.put("/knowledge/{topic}/core/{filename}")
async def update_core_knowledge(topic: str, filename: str, body: dict,
                                user_id: str = Depends(get_current_user)):
    """Update a core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    topic_dir = settings.user_knowledge_path(user_id) / topics[topic]["dir"]
    filepath = topic_dir / filename
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")
    filepath.write_text(body.get("content", ""), encoding="utf-8")
    # Clear index cache so next retrieval rebuilds
    _index_cache.pop((user_id, topic), None)
    return {"ok": True}


@router.delete("/knowledge/{topic}/core/{filename}")
async def delete_core_knowledge(topic: str, filename: str,
                                user_id: str = Depends(get_current_user)):
    """Delete a core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    topic_dir = settings.user_knowledge_path(user_id) / topics[topic]["dir"]
    filepath = topic_dir / filename
    if not filepath.exists():
        raise HTTPException(404, f"File not found: {filename}")
    filepath.unlink()
    _index_cache.pop((user_id, topic), None)
    return {"ok": True}


@router.post("/knowledge/{topic}/core")
async def create_core_knowledge(topic: str, body: dict,
                                user_id: str = Depends(get_current_user)):
    """Create a new core knowledge file."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    filename = body.get("filename", "").strip()
    if not filename or not filename.endswith(".md"):
        raise HTTPException(400, "Filename must end with .md")
    topic_dir = settings.user_knowledge_path(user_id) / topics[topic]["dir"]
    topic_dir.mkdir(parents=True, exist_ok=True)
    filepath = topic_dir / filename
    if filepath.exists():
        raise HTTPException(409, f"File already exists: {filename}")
    filepath.write_text(body.get("content", ""), encoding="utf-8")
    _index_cache.pop((user_id, topic), None)
    return {"ok": True, "filename": filename}


@router.post("/knowledge/{topic}/generate")
async def generate_core_knowledge(topic: str, user_id: str = Depends(get_current_user)):
    """Use LLM to generate foundational knowledge content for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    from backend.llm_provider import get_langchain_llm
    from langchain_core.messages import SystemMessage, HumanMessage

    topic_name = topics[topic].get("name", topic)

    llm = get_langchain_llm()
    resp = llm.invoke([
        SystemMessage(content="你是一位资深技术面试官，擅长梳理技术领域的核心知识体系。"),
        HumanMessage(content=(
            f"请为「{topic_name}」这个技术领域生成一份核心知识梳理，作为面试出题和评分的参考依据。\n\n"
            "要求：\n"
            "- 用 Markdown 格式\n"
            "- 以 `# {topic_name}` 作为标题\n"
            "- 列出该领域最核心的 8-12 个知识点，每个用二级标题\n"
            "- 每个知识点下用简洁的要点说明关键概念、原理、常见面试考点\n"
            "- 重点覆盖：核心概念、工作原理、最佳实践、常见陷阱\n"
            "- 保持简洁实用，面向面试准备场景\n"
            "- 直接输出 Markdown 内容，不要包裹在代码块中"
        )),
    ])
    content = resp.content.strip()

    topic_dir = settings.user_knowledge_path(user_id) / topics[topic]["dir"]
    topic_dir.mkdir(parents=True, exist_ok=True)
    readme = topic_dir / "README.md"
    readme.write_text(content, encoding="utf-8")
    _index_cache.pop((user_id, topic), None)

    return {"ok": True, "content": content}


@router.get("/knowledge/{topic}/high_freq")
async def get_high_freq(topic: str, user_id: str = Depends(get_current_user)):
    """Get high-frequency question bank for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    filepath = settings.user_high_freq_path(user_id) / f"{topic}.md"
    if not filepath.exists():
        return {"content": ""}
    return {"content": filepath.read_text(encoding="utf-8")}


@router.put("/knowledge/{topic}/high_freq")
async def update_high_freq(topic: str, body: dict, user_id: str = Depends(get_current_user)):
    """Update high-frequency question bank for a topic."""
    topics = load_topics(user_id)
    if topic not in topics:
        raise HTTPException(400, f"Unknown topic: {topic}")
    hf_dir = settings.user_high_freq_path(user_id)
    hf_dir.mkdir(parents=True, exist_ok=True)
    filepath = hf_dir / f"{topic}.md"
    filepath.write_text(body.get("content", ""), encoding="utf-8")
    return {"ok": True}


# ── Graph ──

@router.get("/graph/{topic}")
def get_topic_graph(topic: str, user_id: str = Depends(get_current_user)):
    """Build question relationship graph for a topic."""
    return build_graph(topic, user_id)


# ── Reference answer ──

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
    from langchain_core.messages import HumanMessage

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
    resp = llm.invoke([HumanMessage(content=prompt)])
    return {"reference_answer": resp.content.strip()}


# ── History ──

@router.get("/interview/review/{session_id}")
async def get_review(session_id: str, user_id: str = Depends(get_current_user)):
    """Get review for a completed session."""
    session = get_session(session_id, user_id=user_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if not session.get("review"):
        raise HTTPException(400, "Interview not yet reviewed.")
    return session


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str, user_id: str = Depends(get_current_user)):
    """Poll async task status."""
    task = _task_status.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found.")
    return {"task_id": task_id, **task}


@router.get("/interview/history")
async def get_history(
    limit: int = 20,
    offset: int = 0,
    mode: str = None,
    topic: str = None,
    user_id: str = Depends(get_current_user),
):
    """List past interview sessions with filtering and pagination."""
    return list_sessions(user_id=user_id, limit=limit, offset=offset, mode=mode, topic=topic)


@router.delete("/interview/session/{session_id}")
async def delete_session_endpoint(session_id: str, user_id: str = Depends(get_current_user)):
    """Delete a session record."""
    deleted = delete_session(session_id, user_id=user_id)
    if not deleted:
        raise HTTPException(404, "Session not found.")
    return {"ok": True}


@router.get("/interview/topics")
async def get_interview_topics(user_id: str = Depends(get_current_user)):
    """List distinct topics from completed sessions (for filter dropdown)."""
    return list_distinct_topics(user_id=user_id)


# ══════════════════════════════════════════════════════════════════
# Copilot — 多 Agent 实时面试辅助
# ══════════════════════════════════════════════════════════════════

from fastapi import WebSocket, WebSocketDisconnect

from backend.storage import copilot_preps as prep_store

# Copilot realtime sessions: session_id → {asr, navigator, prep, conversation}
_copilot_sessions: dict[str, dict] = {}

# Reset any preps stuck in 'running' from a previous server run
prep_store.reset_stale_running()


@router.post("/copilot/prep")
async def start_copilot_prep(
    background_tasks: BackgroundTasks,
    jd_text: str = Form(...),
    company: str = Form(""),
    position: str = Form(""),
    user_id: str = Depends(get_current_user),
):
    """启动 Copilot Prep Phase（后台异步执行）。"""
    prep_id = uuid.uuid4().hex[:12]
    prep_store.create_prep(prep_id, user_id, company, position, jd_text)

    async def _run_prep():
        from backend.graphs.copilot_prep import run_copilot_prep
        try:
            async def on_progress(text):
                prep_store.update_progress(prep_id, text)

            result = await run_copilot_prep(
                jd_text=jd_text,
                user_id=user_id,
                company=company,
                position=position,
                on_progress=on_progress,
            )
            prep_store.set_done(prep_id, result)
            # Write high-risk gaps back to profile
            try:
                await _update_copilot_profile(result.get("fit_report", {}), position, user_id)
            except Exception as exc:
                logger.warning(f"Copilot profile write-back failed: {exc}")
        except Exception as e:
            logger.error(f"Copilot prep failed: {e}", exc_info=True)
            prep_store.set_error(prep_id, str(e))

    background_tasks.add_task(_run_prep)
    return {"prep_id": prep_id}


@router.get("/copilot/preps")
async def list_copilot_preps(user_id: str = Depends(get_current_user)):
    """列出当前用户的所有 Copilot Prep 会话。"""
    rows = prep_store.list_preps(user_id)
    return [
        {
            "prep_id": r["prep_id"],
            "company": r["company"],
            "position": r["position"],
            "jd_excerpt": r["jd_text"][:80],
            "status": r["status"],
            "progress": r["progress"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.delete("/copilot/prep/{prep_id}")
async def delete_copilot_prep(prep_id: str, user_id: str = Depends(get_current_user)):
    """删除一个 Copilot Prep 会话。"""
    if not prep_store.delete_prep(prep_id, user_id):
        raise HTTPException(404, "Prep session not found")
    return {"ok": True}


@router.get("/copilot/prep/{prep_id}")
async def get_copilot_prep_status(prep_id: str, user_id: str = Depends(get_current_user)):
    """查询 Copilot Prep 进度和结果。"""
    data = prep_store.get_prep(prep_id, user_id)
    if not data:
        raise HTTPException(404, "Prep session not found")
    resp = {
        "status": data["status"],
        "progress": data["progress"],
        "error": data.get("error", ""),
        "company": data.get("company", ""),
        "position": data.get("position", ""),
    }
    if data["status"] == "done" and data.get("result"):
        result = data["result"]
        resp["company_report"] = result.get("company_report", "")
        resp["jd_analysis"] = result.get("jd_analysis", {})
        resp["fit_report"] = result.get("fit_report", {})
        resp["risk_map"] = result.get("risk_map", [])
        resp["risk_summary"] = result.get("risk_summary", "")
        resp["prep_hints"] = result.get("prep_hints", [])
    return resp


@router.get("/copilot/prep/{prep_id}/tree")
async def get_copilot_strategy_tree(prep_id: str, user_id: str = Depends(get_current_user)):
    """获取策略树（前端可视化用）。"""
    data = prep_store.get_prep(prep_id, user_id)
    if not data or data["status"] != "done" or not data.get("result"):
        raise HTTPException(404, "Prep not ready")
    return data["result"].get("question_strategy_tree", {})


@app.websocket("/ws/copilot/{session_id}")
async def copilot_realtime_ws(ws: WebSocket, session_id: str, token: str = ""):
    """Copilot 实时面试辅助 WebSocket。

    客户端发送:
      - JSON {"type": "start", "prep_id": "..."} 开始会话
      - Binary PCM 音频帧
      - JSON {"type": "manual", "text": "..."} 手动输入 HR 发言
      - JSON {"type": "stop"} 结束
    服务端发送:
      - JSON {"type": "asr_interim", "text": "..."} 中间结果
      - JSON {"type": "asr_final", "text": "..."} 句末结果
      - JSON {"type": "copilot_update", ...} 分析结果
      - JSON {"type": "risk_alert", ...} 风险警告
      - JSON {"type": "error", "message": "..."} 错误

    查询参数 `token` 可选：传入 JWT 以启用 per-user 声纹识别；未传则走默认 HR 模式。
    """
    from backend.auth import decode_token

    await ws.accept()
    session = None
    user_id = decode_token(token) if token else None

    try:
        while True:
            data = await ws.receive()

            # Binary frame → PCM audio
            if data.get("type") == "websocket.receive" and data.get("bytes"):
                if session and session.get("asr"):
                    session["asr"].send_audio(data["bytes"])
                continue

            # Text frame → JSON control message
            raw = data.get("text", "")
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type", "")

            if msg_type == "start":
                try:
                    session = await _init_copilot_session(
                        ws, msg.get("prep_id", ""), session_id, user_id=user_id,
                    )
                    _copilot_sessions[session_id] = session
                    await ws.send_json({"type": "started", "session_id": session_id})
                    # Warmup: 测一次 LLM 速度
                    asyncio.create_task(_run_warmup(ws))
                except Exception as init_err:
                    logger.error(f"Copilot session init failed: {init_err}", exc_info=True)
                    await ws.send_json({"type": "error", "message": f"初始化失败: {init_err}"})

            elif msg_type == "manual" and session:
                # 手动输入 HR 发言
                text = msg.get("text", "").strip()
                if text:
                    await _process_utterance(ws, session, text, role="hr")

            elif msg_type == "candidate_response" and session:
                # 候选人手动输入自己的回答（仅存入对话历史，不触发 Answer Coach）
                text = msg.get("text", "").strip()
                if text:
                    await _process_utterance(ws, session, text, role="candidate")

            elif msg_type == "stop":
                if session and session.get("asr"):
                    await session["asr"].stop()
                await ws.send_json({"type": "stopped"})
                break

    except WebSocketDisconnect:
        logger.info(f"Copilot WS disconnected: {session_id}")
    except RuntimeError as e:
        if "disconnect" in str(e).lower():
            logger.info(f"Copilot WS disconnected: {session_id}")
        else:
            logger.error(f"Copilot WS runtime error: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Copilot WS error: {e}", exc_info=True)
        try:
            await ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if session and session.get("asr"):
            try:
                await session["asr"].shutdown()
            except Exception:
                pass
        _copilot_sessions.pop(session_id, None)


async def _init_copilot_session(
    ws: WebSocket, prep_id: str, session_id: str, *, user_id: str | None = None,
) -> dict:
    """初始化 Copilot 实时会话。

    user_id 可选：传入后，会加载该用户的声纹配置（如已注册则启用自动 role 识别）。
    """
    from backend.copilot.strategy_tree import StrategyTreeNavigator
    from backend.copilot import voiceprint_store

    prep_data = prep_store.get_prep_by_id(prep_id)
    if not prep_data or prep_data["status"] != "done" or not prep_data.get("result"):
        raise ValueError("Prep session not ready")

    prep_result = prep_data["result"]
    tree = prep_result.get("question_strategy_tree", {})

    navigator = StrategyTreeNavigator(tree)
    await ws.send_json({"type": "progress", "message": "正在预计算策略树 embedding..."})
    await navigator.precompute_embeddings()

    # 加载该用户的声纹配置（可选）
    vp_client = None
    vp_id = None
    vp_enabled = False
    if user_id:
        vp_client = voiceprint_store.get_client(user_id)
        vp_id = voiceprint_store.get_voice_print_id(user_id)
        vp_enabled = bool(vp_client and vp_id)

    # 尝试启动 ASR（可选，失败不阻塞）
    asr = None
    if settings.dashscope_api_key:
        try:
            from backend.copilot.asr_stream import CopilotASR
            loop = asyncio.get_event_loop()
            asr = CopilotASR(
                loop,
                voiceprint_client=vp_client if vp_enabled else None,
                voice_print_id=vp_id if vp_enabled else None,
            )

            async def on_interim(text):
                try:
                    await ws.send_json({"type": "asr_interim", "text": text})
                except Exception:
                    pass

            async def on_sentence_end(text):
                try:
                    # 声纹可用时按实时结果分发；否则默认 hr（保持现有行为）
                    current_session = _copilot_sessions.get(session_id, {})
                    role = "hr"
                    if asr is not None:
                        detected = asr.lookup_role_now()
                        if detected:
                            role = detected
                    await ws.send_json({"type": "asr_final", "text": text, "role": role})
                    await _process_utterance(ws, current_session, text, role=role)
                except Exception as e:
                    logger.error(f"ASR sentence processing failed: {e}")

            async def on_error(message):
                try:
                    await ws.send_json({"type": "error", "message": f"ASR: {message}"})
                except Exception:
                    pass

            asr.on_interim = on_interim
            asr.on_sentence_end = on_sentence_end
            asr.on_error = on_error
            await asr.start()
            ready_msg = "语音识别 + 声纹自动识别已就绪" if vp_enabled else "语音识别已就绪"
            await ws.send_json({"type": "progress", "message": ready_msg})
        except Exception as e:
            logger.warning(f"ASR init failed (will use manual input): {e}")
            asr = None
            await ws.send_json({"type": "progress", "message": "语音识别不可用，请使用手动输入"})
    else:
        await ws.send_json({"type": "progress", "message": "未配置 DashScope API Key，请使用手动输入"})

    return {
        "asr": asr,
        "navigator": navigator,
        "prep": prep_result,
        "conversation": [],
        "last_node_id": None,
        "turn_count": 0,
        "voiceprint_enabled": vp_enabled,
    }



async def _process_utterance(
    ws: WebSocket, session: dict, text: str, *, role: str = "hr"
):
    """处理一句话（HR 提问或候选人自述）。

    role="hr"：触发完整的 Intent Router + 3 个 Agent 管线
    role="candidate"：只写入对话历史 + 触发 Interview Monitor（对话连贯性假设）
    """
    if not session:
        return

    conversation = session.get("conversation", [])

    # 候选人路径：轻量处理
    if role == "candidate":
        conversation.append({"role": "candidate", "text": text})
        asyncio.create_task(_run_interview_monitor(ws, session))
        return

    # HR 路径（下面是原 _process_hr_utterance 的逻辑）
    from backend.copilot.intent_classifier import classify_intent
    from backend.copilot.answer_advisor import prepare_advice_context, stream_advice
    from backend.copilot import hr_profiler

    navigator = session.get("navigator")
    prep = session.get("prep", {})

    conversation.append({"role": "hr", "text": text})
    session["turn_count"] = session.get("turn_count", 0) + 1

    # ── Step 1: Intent Router (同步, <200ms, 不调 LLM) ──
    intent_result = await classify_intent(text, navigator, last_node_id=session.get("last_node_id"))
    node_id = intent_result.get("node_id")
    intent = intent_result.get("intent", "unknown")

    if node_id:
        session["last_node_id"] = node_id

    # ── Step 2: 策略树查表 (瞬间) ──
    node = navigator.get_node(node_id) if node_id else None
    children_list = []
    recommended_points = []
    prep_hint = None
    if node:
        children = navigator.get_children(node_id)
        children_list = [
            {"topic": c.get("topic", ""), "question": (c.get("sample_questions") or [""])[0]}
            for c in children
        ]
        recommended_points = node.get("recommended_points", [])
        for hint in prep.get("prep_hints", []):
            if hint.get("node_id") == node_id:
                prep_hint = hint
                break

    # ── Step 3: 立即推送策略树结果 ──
    ctx = prepare_advice_context(text, node_id, navigator, prep, conversation=conversation)

    await ws.send_json({
        "type": "copilot_update",
        "intent": intent,
        "tree_position": node_id,
        "topic": node.get("topic", "") if node else "",
        "confidence": intent_result.get("confidence", 0),
        "recommended_points": recommended_points,
        "children": children_list,
        "prep_hint": {
            "safe_talking_points": prep_hint.get("safe_talking_points", []),
            "redirect_suggestion": prep_hint.get("redirect_suggestion", ""),
        } if prep_hint else None,
    })

    if ctx["risk_alert"]:
        await ws.send_json({
            "type": "risk_alert",
            "message": ctx["risk_alert"],
            "node_id": node_id,
        })

    # ── Step 4: 并发启动 Agent ──

    # Agent 1: Answer Coach (流式, 必须 await 因为要逐 chunk 推送)
    async def run_answer_coach():
        async for item in stream_advice(ctx["prompt"]):
            if item["type"] == "chunk":
                await ws.send_json({"type": "answer_chunk", "text": item["text"]})
            elif item["type"] == "meta":
                await ws.send_json({"type": "answer_meta", "first_token_ms": item["first_token_ms"]})
            elif item["type"] == "done":
                await ws.send_json({"type": "answer_done", "total_ms": item.get("total_ms"), "chunk_count": item.get("chunk_count")})

    # Agent 2: HR Profiler (后台, 每 3 轮触发)
    # Agent 3: Interview Monitor (后台, 每轮触发)
    # 后台 agent 用 create_task 并发，不阻塞 Answer Coach
    if hr_profiler.should_run(session["turn_count"]):
        asyncio.create_task(_run_hr_profiler(ws, session))
    asyncio.create_task(_run_interview_monitor(ws, session))

    # Answer Coach 流式推送（主流程等待）
    await run_answer_coach()


async def _run_warmup(ws: WebSocket):
    """连接后自动测一次 LLM 速度。"""
    import time
    from backend.llm_provider import get_copilot_llm
    from langchain_core.messages import HumanMessage
    try:
        llm = get_copilot_llm(streaming=True)
        t0 = time.monotonic()
        chunk_count = 0
        first_token_ms = None
        async for chunk in llm.astream([HumanMessage(content="说一个字：好")]):
            if chunk.content:
                chunk_count += 1
                if chunk_count == 1:
                    first_token_ms = round((time.monotonic() - t0) * 1000)
        total_ms = round((time.monotonic() - t0) * 1000)
        await ws.send_json({
            "type": "answer_meta",
            "first_token_ms": first_token_ms or total_ms,
        })
        await ws.send_json({
            "type": "answer_done",
            "total_ms": total_ms,
            "chunk_count": chunk_count,
        })
        logger.info(f"Warmup: first_token={first_token_ms}ms total={total_ms}ms")
    except Exception as e:
        logger.warning(f"Warmup failed: {e}")


async def _run_hr_profiler(ws: WebSocket, session: dict):
    """后台运行 HR Profiler，完成后推送结果。"""
    from backend.copilot.hr_profiler import analyze_hr
    try:
        result = await analyze_hr(session.get("conversation", []))
        if result:
            await ws.send_json({"type": "hr_profile_update", **result})
    except Exception as e:
        logger.error(f"HR Profiler task error: {e}")


async def _run_interview_monitor(ws: WebSocket, session: dict):
    """后台运行 Interview Monitor，完成后推送结果。"""
    from backend.copilot.interview_monitor import analyze_interview
    try:
        result = await analyze_interview(
            session.get("conversation", []),
            session.get("prep", {}),
        )
        if result:
            await ws.send_json({"type": "monitor_update", **result})
    except Exception as e:
        logger.error(f"Interview Monitor task error: {e}")


app.include_router(router)
