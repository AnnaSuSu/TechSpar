"""个性化记忆系统 — 跨面试用户画像。

设计哲学：
- 文件即真相（OpenClaw）：profile.json 可人工编辑
- 两阶段提取（Mem0）：Extract → Update，不无脑追加
- 向量召回（embedding）：语义搜索历史洞察
"""
import json
import logging
import re
from datetime import datetime
from pathlib import Path

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from backend.config import settings
from backend.llm_provider import get_langchain_llm

logger = logging.getLogger("uvicorn")

# ── Profile Schema ──

DEFAULT_PROFILE = {
    "name": "",
    "target_role": "AI 应用开发实习生",
    "updated_at": "",

    # 技术掌握度 (topic → {level: 1-5, notes: str})
    "topic_mastery": {},

    # 薄弱点 (list of {point, topic, first_seen, last_seen, times_seen, improved})
    "weak_points": [],

    # 强项 (list of {point, topic, first_seen})
    "strong_points": [],

    # 表达与沟通特征
    "communication": {
        "style": "",        # e.g. "回答偏短，缺少具体例子"
        "habits": [],       # e.g. ["紧张时语速加快", "喜欢用类比解释"]
        "suggestions": [],  # e.g. ["多用 STAR 法描述项目"]
    },

    # 答题思维模式
    "thinking_patterns": {
        "strengths": [],    # e.g. ["能用类比解释抽象概念", "项目描述有数据支撑"]
        "gaps": [],         # e.g. ["对比类问题缺乏结构", "被追问 why 时容易卡住"]
    },

    # 面试统计
    "stats": {
        "total_sessions": 0,
        "resume_sessions": 0,
        "drill_sessions": 0,
        "job_prep_sessions": 0,
        "avg_score": 0,
        "score_history": [],  # [{date, mode, topic, avg_score}]
    },
}

EXTRACT_PROMPT = """你是一个面试教练的分析引擎。根据面试对话记录，提取关于候选人的结构化洞察。

## 候选人当前画像
{current_profile}

## 本次面试记录
模式: {mode}
领域: {topic}
{transcript}

## 评分记录（如有）
{scores}

## 任务
分析这次面试，提取以下信息，返回 JSON：

```json
{{
    "weak_points": [
        {{"point": "对 Python GIL 的理解停留在表面", "topic": "python"}}
    ],
    "strong_points": [
        {{"point": "RAG 架构描述清晰，有实战数据支撑", "topic": "rag"}}
    ],
    "topic_mastery": {{
        "python": {{"notes": "基础扎实但高级特性（元类、描述符）薄弱"}}
    }},
    "communication_observations": {{
        "style_update": "回答技术题时逻辑清晰，但项目描述缺少量化数据",
        "new_habits": ["遇到不会的题会坦诚说不确定"],
        "new_suggestions": ["项目经历多用数据指标（提升了XX%）来量化成果"]
    }},
    "thinking_patterns": {{
        "new_strengths": ["能用类比解释复杂概念"],
        "new_gaps": ["被追问'为什么这样设计'时缺乏推导过程", "对比类问题回答缺乏结构"]
    }},
    "session_summary": "本次 Python 专项训练，基础题表现好，但 GIL 和 GC 机制理解不够深入",
    "dimension_scores": {{
        "technical_depth": 6,
        "project_articulation": 7,
        "communication": 5,
        "problem_solving": 6
    }},
    "avg_score": 6.0
}}
```

## dimension_scores 评分说明（仅简历面试模式需要填写，专项训练留空即可）
- technical_depth (1-10): 技术理解的深度，是真懂还是在背？能否说出 why？
- project_articulation (1-10): 项目描述能力——设计思路、量化成果、技术权衡是否讲清楚
- communication (1-10): 表达的清晰度、结构化程度、简洁性
- problem_solving (1-10): 被追问时的分析推理能力，能否现场推导
- avg_score = 四个维度的均值，保留一位小数

规则：
- 只提取本次面试中明确暴露的信息，不要猜测
- 薄弱点要具体，不要泛泛说"XX不好"
- 如果候选人对某个之前的薄弱点表现出了进步，在 strong_points 里标注
- topic_mastery 只需提供 notes（一句话描述掌握情况），score 由算法计算，不需要你判断
- 专项训练模式下 dimension_scores 可省略，只需给 avg_score
"""


# ── Per-user path helpers ──

def _profile_path(user_id: str) -> Path:
    return settings.user_profile_dir(user_id) / "profile.json"


def _insights_dir(user_id: str) -> Path:
    return settings.user_profile_dir(user_id) / "insights"


def _load_profile(user_id: str) -> dict:
    path = _profile_path(user_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return DEFAULT_PROFILE.copy()


def _save_profile(profile: dict, user_id: str):
    path = _profile_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    profile["updated_at"] = datetime.now().isoformat()
    path.write_text(
        json.dumps(profile, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _save_insight(mode: str, topic: str, summary: str, raw_extraction: dict, user_id: str):
    """Append daily insight file (OpenClaw-style daily log)."""
    ins_dir = _insights_dir(user_id)
    ins_dir.mkdir(parents=True, exist_ok=True)
    today = datetime.now().strftime("%Y-%m-%d")
    path = ins_dir / f"{today}.md"

    time_str = datetime.now().strftime("%H:%M")
    entry = f"\n## {time_str} | {mode} | {topic or '综合'}\n\n{summary}\n"

    if raw_extraction.get("weak_points"):
        entry += "\n**薄弱点:**\n"
        for wp in raw_extraction["weak_points"]:
            entry += f"- {wp['point']} ({wp.get('topic', '')})\n"

    if raw_extraction.get("strong_points"):
        entry += "\n**亮点:**\n"
        for sp in raw_extraction["strong_points"]:
            entry += f"- {sp['point']} ({sp.get('topic', '')})\n"

    entry += "\n---\n"

    with open(path, "a", encoding="utf-8") as f:
        f.write(entry)


def get_profile(user_id: str) -> dict:
    return _load_profile(user_id)


def get_topic_context_for_drill(topic: str, user_id: str) -> dict:
    """Get personalized context for drill question generation."""
    profile = _load_profile(user_id)

    mastery = profile.get("topic_mastery", {}).get(topic, {})
    mastery_score = mastery.get("score", mastery.get("level", 0) * 20)
    mastery_notes = mastery.get("notes", "新领域，暂无历史数据" if mastery_score == 0 else "")
    mastery_info = f"{mastery_score}/100 — {mastery_notes}"

    # Weak points for this topic
    topic_weak = [
        w["point"] for w in profile.get("weak_points", [])
        if w.get("topic") == topic and not w.get("improved")
    ]

    # Recent questions from score_history for this topic
    recent_questions = [
        h.get("question", "")
        for h in profile.get("stats", {}).get("score_history", [])
        if h.get("topic") == topic and h.get("question")
    ][-20:]

    # Semantic retrieval of past insights for this topic
    past_insights = []
    try:
        from backend.vector_memory import search_memory
        results = search_memory(
            query=f"{topic} 面试薄弱点 常见错误",
            chunk_types=["session_summary", "insight"],
            topic=topic,
            user_id=user_id,
            top_k=3,
        )
        past_insights = [r["content"] for r in results if r["score"] > 0.3]
    except Exception:
        pass  # vector table may not exist yet

    return {
        "mastery_info": mastery_info,
        "mastery_score": mastery_score,
        "weak_points": topic_weak,
        "recent_questions": recent_questions,
        "past_insights": past_insights,
    }


def update_profile_realtime(
    mode: str,
    topic: str | None,
    user_id: str,
    score_entry: dict | None = None,
    weak_point: str | None = None,
):
    """Lightweight per-answer profile update — no LLM call, just save the data."""
    profile = _load_profile(user_id)
    now = datetime.now().isoformat()

    # Record score
    if score_entry and score_entry.get("score") is not None:
        history = profile.setdefault("stats", {}).setdefault("score_history", [])
        history.append({
            "date": now[:10],
            "mode": mode,
            "topic": topic,
            "avg_score": score_entry["score"],
            "question": score_entry.get("question", ""),
            "assessment": score_entry.get("assessment", ""),
        })
        # Rolling average
        recent = [h["avg_score"] for h in history[-30:] if h.get("avg_score")]
        if recent:
            profile["stats"]["avg_score"] = round(sum(recent) / len(recent), 1)

    # Record weak point (semantic matching)
    if weak_point:
        from backend.vector_memory import find_similar_weak_point
        match_idx = find_similar_weak_point(weak_point, profile.get("weak_points", []), user_id=user_id)
        if match_idx is not None:
            profile["weak_points"][match_idx]["times_seen"] = profile["weak_points"][match_idx].get("times_seen", 1) + 1
            profile["weak_points"][match_idx]["last_seen"] = now
        else:
            profile.setdefault("weak_points", []).append({
                "point": weak_point,
                "topic": topic or "",
                "first_seen": now,
                "last_seen": now,
                "times_seen": 1,
                "improved": False,
            })

    # Track that we have activity (for profile page display)
    profile.setdefault("stats", {}).setdefault("total_answers", 0)
    profile["stats"]["total_answers"] = profile["stats"].get("total_answers", 0) + 1

    _save_profile(profile, user_id)


def get_profile_summary(user_id: str) -> str:
    """Generate a concise summary for injection into interviewer prompts."""
    profile = _load_profile(user_id)

    parts = []
    if profile.get("weak_points"):
        active_weak = [w for w in profile["weak_points"] if not w.get("improved")]
        if active_weak:
            points = ", ".join(w["point"] for w in active_weak[:8])
            parts.append(f"已知薄弱点: {points}")

    if profile.get("strong_points"):
        points = ", ".join(s["point"] for s in profile["strong_points"][:5])
        parts.append(f"强项: {points}")

    if profile.get("communication", {}).get("style"):
        parts.append(f"沟通风格: {profile['communication']['style']}")

    tp = profile.get("thinking_patterns", {})
    if tp.get("gaps"):
        parts.append(f"思维短板: {', '.join(tp['gaps'][:5])}")
    if tp.get("strengths"):
        parts.append(f"思维优势: {', '.join(tp['strengths'][:5])}")

    if profile.get("stats", {}).get("total_sessions"):
        stats = profile["stats"]
        parts.append(f"已完成 {stats['total_sessions']} 次模拟面试")

    if profile.get("topic_mastery"):
        mastery = ", ".join(
            f"{t}: {v.get('score', v.get('level', 0) * 20)}/100"
            for t, v in profile["topic_mastery"].items()
        )
        parts.append(f"掌握度: {mastery}")

    return "\n".join(parts) if parts else "新用户，暂无历史数据"


def get_profile_summary_for_drill(user_id: str) -> str:
    """Concise summary for drill question generation — only cross-topic info."""
    profile = _load_profile(user_id)
    parts = []

    if profile.get("communication", {}).get("style"):
        parts.append(f"沟通风格: {profile['communication']['style']}")

    tp = profile.get("thinking_patterns", {})
    if tp.get("gaps"):
        parts.append(f"思维短板: {', '.join(tp['gaps'][:5])}")
    if tp.get("strengths"):
        parts.append(f"思维优势: {', '.join(tp['strengths'][:5])}")

    if profile.get("stats", {}).get("total_sessions"):
        parts.append(f"已完成 {profile['stats']['total_sessions']} 次模拟面试")

    return "\n".join(parts) if parts else "新用户，暂无历史数据"


# ── Mem0-style LLM profile update ──

def _parse_json_safe(content: str) -> dict | list:
    """Parse JSON from LLM response, handling markdown code blocks."""
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    m = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", content)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass
    for i, c in enumerate(content):
        if c in ("[", "{"):
            try:
                return json.loads(content[i:])
            except json.JSONDecodeError:
                pass
            break
    raise json.JSONDecodeError("No valid JSON found", content, 0)


def _apply_memory_ops(profile: dict, ops: dict, topic: str | None, now: str):
    """Execute LLM-decided ADD/UPDATE/NOOP/IMPROVE operations on profile."""
    weak_points = profile.setdefault("weak_points", [])

    for op in ops.get("weak_point_ops", []):
        action = op.get("action", "NOOP")
        if action == "ADD":
            weak_points.append({
                "point": op["point"],
                "topic": op.get("topic", topic or ""),
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })
        elif action == "UPDATE":
            idx = op.get("index")
            if idx is not None and 0 <= idx < len(weak_points):
                wp = weak_points[idx]
                if op.get("new_point") and op["new_point"] != wp.get("point"):
                    history = wp.setdefault("history", [])
                    history.append({"point": wp["point"], "date": wp.get("last_seen", now)})
                    wp["point"] = op["new_point"]
                wp["times_seen"] = wp.get("times_seen", 1) + 1
                wp["last_seen"] = now

    for imp in ops.get("improvements", []):
        idx = imp.get("weak_index")
        if idx is not None and 0 <= idx < len(weak_points):
            wp = weak_points[idx]
            history = wp.setdefault("history", [])
            history.append({"point": wp["point"], "date": now, "event": "improved"})
            wp["improved"] = True
            wp["improved_at"] = now

    existing_strong = {s["point"] for s in profile.get("strong_points", [])}
    for op in ops.get("strong_point_ops", []):
        if op.get("action") == "ADD" and op.get("point") and op["point"] not in existing_strong:
            profile.setdefault("strong_points", []).append({
                "point": op["point"],
                "topic": op.get("topic", topic or ""),
                "first_seen": now,
            })


def _deterministic_update(profile: dict, new_weak: list, new_strong: list,
                          topic: str | None, now: str, user_id: str):
    """Fallback: vector cosine dedup when LLM parse fails."""
    from backend.vector_memory import find_similar_weak_point

    for wp in new_weak:
        point = wp.get("point", wp) if isinstance(wp, dict) else str(wp)
        match_idx = find_similar_weak_point(point, profile.get("weak_points", []), user_id=user_id)
        if match_idx is not None:
            profile["weak_points"][match_idx]["times_seen"] = profile["weak_points"][match_idx].get("times_seen", 1) + 1
            profile["weak_points"][match_idx]["last_seen"] = now
        else:
            profile.setdefault("weak_points", []).append({
                "point": point,
                "topic": wp.get("topic", topic) if isinstance(wp, dict) else (topic or ""),
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })

    for sp in new_strong:
        sp_text = sp.get("point", sp) if isinstance(sp, dict) else str(sp)
        for w in profile.get("weak_points", []):
            if w.get("topic") == (sp.get("topic") if isinstance(sp, dict) else topic) and not w.get("improved"):
                w["improved"] = True
                w["improved_at"] = now
                break
        existing = {s["point"] for s in profile.get("strong_points", [])}
        if sp_text not in existing:
            profile.setdefault("strong_points", []).append({
                "point": sp_text,
                "topic": sp.get("topic") if isinstance(sp, dict) else (topic or ""),
                "first_seen": now,
            })


def _update_mastery(profile: dict, topic: str | None, mastery_data: dict, now: str,
                    min_weight: float = 0.15, user_id: str | None = None):
    """Update topic mastery (0-100 scale). Weight decreases with session count."""
    if not mastery_data:
        return
    # {score, notes} → single topic; {topic_key: {score, notes}} → multi-topic
    if "score" in mastery_data or "level" in mastery_data:
        if not topic:
            return
        entries = {topic: mastery_data}
    else:
        entries = mastery_data

    # Only allow canonical topics from topics.json
    if user_id:
        from backend.indexer import load_topics
        canonical = set(load_topics(user_id).keys())
        if canonical:
            entries = {t: d for t, d in entries.items() if t in canonical}

    for t, data in entries.items():
        if not isinstance(data, dict):
            continue
        existing = profile.setdefault("topic_mastery", {}).setdefault(t, {})
        new_score = data.get("score")
        if new_score is not None:
            old_score = existing.get("score", existing.get("level", 0) * 20)
            n = existing.get("session_count", 0)
            coverage = data.get("coverage", 1.0)
            # Dynamic weight: fast convergence early, stable later
            # Scale down by coverage so partial sessions have less impact
            weight = max(min_weight, 1.0 / (n + 1)) * coverage
            merged = round(old_score * (1 - weight) + new_score * weight, 1)
            existing["score"] = merged
            existing["session_count"] = n + 1
            existing.pop("level", None)
        if data.get("notes"):
            existing["notes"] = data["notes"]
        existing["last_assessed"] = now


_DEDUP_SIMILARITY_THRESHOLD = 0.80


def _is_semantically_duplicate(new_item: str, existing: list[str], threshold: float = _DEDUP_SIMILARITY_THRESHOLD) -> bool:
    """Check if new_item is semantically similar to any existing item via embedding."""
    if not existing:
        return False
    from backend.vector_memory import _embed, _cosine_similarity
    import numpy as np
    new_vec = _embed(new_item)
    matrix = np.stack([_embed(e) for e in existing])
    sims = _cosine_similarity(new_vec, matrix)
    return float(sims.max()) >= threshold


def _append_if_novel(items: list[str], new_item: str, limit: int = 8) -> None:
    """Append new_item only if semantically novel. Drop oldest if over limit."""
    if new_item in items:
        return
    if _is_semantically_duplicate(new_item, items):
        return
    items.append(new_item)
    if len(items) > limit:
        items.pop(0)


def _update_communication(profile: dict, comm: dict):
    """Accumulate communication observations, deduplicate via embedding similarity."""
    if not comm:
        return
    c = profile.setdefault("communication", {})
    if comm.get("style_update"):
        observations = c.setdefault("style_observations", [])
        _append_if_novel(observations, comm["style_update"], limit=5)
        c["style"] = observations[-1]
    for habit in comm.get("new_habits", []):
        _append_if_novel(c.setdefault("habits", []), habit)
    for sug in comm.get("new_suggestions", []):
        _append_if_novel(c.setdefault("suggestions", []), sug)


def _update_thinking_patterns(profile: dict, patterns: dict):
    """Accumulate thinking pattern observations, deduplicate via embedding similarity."""
    if not patterns:
        return
    tp = profile.setdefault("thinking_patterns", {"strengths": [], "gaps": []})
    for s in patterns.get("new_strengths", []):
        _append_if_novel(tp["strengths"], s)
    for g in patterns.get("new_gaps", []):
        _append_if_novel(tp["gaps"], g)


def _update_stats(
    profile: dict, mode: str, topic: str | None, avg_score: float | None,
    now: str, answer_count: int = 0, dimension_scores: dict | None = None,
):
    """Update session statistics with per-mode averages."""
    stats = profile.setdefault("stats", {})
    stats["total_sessions"] = stats.get("total_sessions", 0) + 1
    if mode == "resume":
        stats["resume_sessions"] = stats.get("resume_sessions", 0) + 1
    elif mode == "topic_drill":
        stats["drill_sessions"] = stats.get("drill_sessions", 0) + 1
    elif mode == "jd_prep":
        stats["job_prep_sessions"] = stats.get("job_prep_sessions", 0) + 1

    if answer_count:
        stats["total_answers"] = stats.get("total_answers", 0) + answer_count

    if avg_score:
        history = stats.setdefault("score_history", [])
        entry = {"date": now[:10], "mode": mode, "topic": topic, "avg_score": avg_score}
        if dimension_scores:
            entry["dimension_scores"] = dimension_scores
        history.append(entry)

        # Per-mode rolling averages
        drill_scores = [h["avg_score"] for h in history if h.get("mode") == "topic_drill" and h.get("avg_score")][-20:]
        resume_scores = [h["avg_score"] for h in history if h.get("mode") == "resume" and h.get("avg_score")][-10:]
        job_prep_scores = [h["avg_score"] for h in history if h.get("mode") == "jd_prep" and h.get("avg_score")][-10:]

        if drill_scores:
            stats["drill_avg_score"] = round(sum(drill_scores) / len(drill_scores), 1)
        if resume_scores:
            stats["resume_avg_score"] = round(sum(resume_scores) / len(resume_scores), 1)
        if job_prep_scores:
            stats["job_prep_avg_score"] = round(sum(job_prep_scores) / len(job_prep_scores), 1)

        all_recent = [h["avg_score"] for h in history if h.get("avg_score")][-30:]
        if all_recent:
            stats["avg_score"] = round(sum(all_recent) / len(all_recent), 1)


async def llm_update_profile(
    mode: str,
    topic: str | None,
    new_weak_points: list[dict],
    new_strong_points: list[dict],
    topic_mastery: dict,
    communication: dict,
    user_id: str,
    thinking_patterns: dict | None = None,
    session_summary: str = "",
    avg_score: float | None = None,
    answer_count: int = 0,
    dimension_scores: dict | None = None,
):
    """Mem0-style profile update: LLM decides ADD/UPDATE/NOOP for each fact."""
    from backend.prompts.interviewer import PROFILE_UPDATE_PROMPT

    profile = _load_profile(user_id)
    now = datetime.now().isoformat()

    # ── LLM-based update for weak/strong points ──
    has_new_facts = bool(new_weak_points or new_strong_points)

    if has_new_facts:
        # Format existing points with indices for LLM reference
        existing_weak_lines = []
        for i, wp in enumerate(profile.get("weak_points", [])):
            status = "已改善" if wp.get("improved") else f"出现{wp.get('times_seen', 1)}次"
            existing_weak_lines.append(
                f"[{i}] {wp['point']} (领域: {wp.get('topic', '?')}, {status})"
            )
        existing_strong_lines = []
        for i, sp in enumerate(profile.get("strong_points", [])):
            existing_strong_lines.append(f"[{i}] {sp['point']} (领域: {sp.get('topic', '?')})")

        new_weak_lines = []
        for wp in new_weak_points:
            point = wp.get("point", wp) if isinstance(wp, dict) else str(wp)
            t = wp.get("topic", topic) if isinstance(wp, dict) else topic
            new_weak_lines.append(f"- {point} (领域: {t})")
        new_strong_lines = []
        for sp in new_strong_points:
            point = sp.get("point", sp) if isinstance(sp, dict) else str(sp)
            t = sp.get("topic", topic) if isinstance(sp, dict) else topic
            new_strong_lines.append(f"- {point} (领域: {t})")

        prompt = PROFILE_UPDATE_PROMPT.format(
            existing_weak="\n".join(existing_weak_lines) or "暂无",
            existing_strong="\n".join(existing_strong_lines) or "暂无",
            new_weak="\n".join(new_weak_lines) or "暂无",
            new_strong="\n".join(new_strong_lines) or "暂无",
        )

        llm = get_langchain_llm()
        response = llm.invoke([
            SystemMessage(content="你是画像更新引擎。只返回 JSON。"),
            HumanMessage(content=prompt),
        ])

        try:
            ops = _parse_json_safe(response.content)
            if isinstance(ops, dict):
                _apply_memory_ops(profile, ops, topic, now)
            else:
                raise ValueError(f"Expected dict, got {type(ops)}")
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Profile update LLM parse failed ({e}), falling back to deterministic")
            _deterministic_update(profile, new_weak_points, new_strong_points, topic, now, user_id)

    # ── Deterministic updates for mastery / communication / thinking / stats ──
    _update_mastery(profile, topic, topic_mastery, now, user_id=user_id)
    _update_communication(profile, communication)
    _update_thinking_patterns(profile, thinking_patterns)
    _update_stats(profile, mode, topic, avg_score, now, answer_count, dimension_scores)

    _save_profile(profile, user_id)
    _save_insight(mode=mode, topic=topic, summary=session_summary, raw_extraction={
        "weak_points": new_weak_points,
        "strong_points": new_strong_points,
    }, user_id=user_id)

    # Index into vector memory for future semantic retrieval
    from backend.vector_memory import index_session_memory
    index_session_memory(
        session_id=None, topic=topic,
        summary=session_summary,
        weak_points=new_weak_points,
        strong_points=new_strong_points,
        insight_text=session_summary,
        user_id=user_id,
    )


async def update_profile_after_interview(
    mode: str,
    topic: str | None,
    messages: list,
    user_id: str,
    scores: list[dict] | None = None,
) -> dict:
    """Mem0-style two-stage pipeline: Extract → Update."""
    profile = _load_profile(user_id)
    llm = get_langchain_llm()

    # ── Stage 1: Extract insights ──
    transcript_lines = []
    for msg in messages:
        if hasattr(msg, "content"):
            if isinstance(msg, HumanMessage):
                transcript_lines.append(f"候选人: {msg.content}")
            elif hasattr(msg, "content") and not isinstance(msg, SystemMessage):
                transcript_lines.append(f"面试官: {msg.content}")

    score_text = ""
    if scores:
        score_text = "\n".join(
            f"- Q: {s.get('question', '?')} → {s.get('score', '?')}/10 ({s.get('assessment', '')})"
            for s in scores
        )

    extract_msg = EXTRACT_PROMPT.format(
        current_profile=json.dumps(profile, ensure_ascii=False),
        mode=mode,
        topic=topic or "综合",
        transcript="\n".join(transcript_lines),
        scores=score_text or "无",
    )

    response = llm.invoke([
        SystemMessage(content="你是面试分析引擎。只返回 JSON。"),
        HumanMessage(content=extract_msg),
    ])

    try:
        content = response.content.strip()
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()
        extraction = json.loads(content)
    except (json.JSONDecodeError, IndexError):
        extraction = {"session_summary": "提取失败", "weak_points": [], "strong_points": []}

    # ── Stage 2: LLM-based Update (Mem0 style) ──
    await llm_update_profile(
        mode=mode,
        topic=topic,
        new_weak_points=extraction.get("weak_points", []),
        new_strong_points=extraction.get("strong_points", []),
        topic_mastery=extraction.get("topic_mastery", {}),
        communication=extraction.get("communication_observations", {}),
        user_id=user_id,
        thinking_patterns=extraction.get("thinking_patterns"),
        session_summary=extraction.get("session_summary", ""),
        avg_score=extraction.get("avg_score"),
        dimension_scores=extraction.get("dimension_scores"),
    )

    return extraction
