"""个性化记忆系统 — 跨面试用户画像。

设计哲学：
- 文件即真相（OpenClaw）：profile.json 可人工编辑
- 两阶段提取（Mem0）：Extract → Update，不无脑追加
- 向量召回（embedding）：语义搜索历史洞察
"""
import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from backend.config import settings
from backend.llm_provider import get_langchain_llm

logger = logging.getLogger("uvicorn")

# Per-user locks to prevent concurrent read-modify-write on profile.json
_profile_locks: dict[str, asyncio.Lock] = {}


def _get_profile_lock(user_id: str) -> asyncio.Lock:
    if user_id not in _profile_locks:
        _profile_locks[user_id] = asyncio.Lock()
    return _profile_locks[user_id]

# ── Profile Schema ──

DEFAULT_PROFILE = {
    "name": "",
    "target_role": "AI 应用开发实习生",
    "updated_at": "",

    # 上次 consolidation 运行时间 (用于节流,避免每次 session 都跑 Stage 3)
    "last_consolidation_at": "",

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
        if w.get("topic") == topic and not w.get("improved") and not w.get("archived")
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


async def update_profile_realtime(
    mode: str,
    topic: str | None,
    user_id: str,
    score_entry: dict | None = None,
    weak_point: str | None = None,
):
    """Lightweight per-answer profile update — no LLM call, just save the data."""
    async with _get_profile_lock(user_id):
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
                matched = profile["weak_points"][match_idx]
                matched["times_seen"] = matched.get("times_seen", 1) + 1
                matched["last_seen"] = now
                if matched.get("archived"):
                    matched["archived"] = False
                    matched.pop("archived_at", None)
                    matched.setdefault("history", []).append({"date": now, "event": "unarchived"})
            else:
                profile.setdefault("weak_points", []).append({
                    "point": weak_point,
                    "topic": topic or "",
                    "source": "observed",
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
        active_weak = [w for w in profile["weak_points"] if not w.get("improved") and not w.get("archived")]
        if active_weak:
            observed = [w["point"] for w in active_weak if w.get("source", "observed") == "observed"][:6]
            predicted = [w["point"] for w in active_weak if w.get("source") == "predicted"][:4]
            if observed:
                parts.append(f"已知薄弱点（训练中暴露）: {', '.join(observed)}")
            if predicted:
                parts.append(f"潜在薄弱点（JD分析预测）: {', '.join(predicted)}")

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

from backend.utils import parse_json_response as _parse_json_safe  # noqa: E402


def _apply_memory_ops(profile: dict, ops: dict, topic: str | None, now: str, user_id: str = ""):
    """Execute LLM-decided ADD/UPDATE/NOOP/IMPROVE operations on profile."""
    from backend.vector_memory import upsert_weak_point_vector

    weak_points = profile.setdefault("weak_points", [])

    for op in ops.get("weak_point_ops", []):
        action = op.get("action", "NOOP")
        if action == "ADD":
            weak_points.append({
                "point": op["point"],
                "topic": op.get("topic", topic or ""),
                "source": op.get("source", "observed"),
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })
        elif action == "UPDATE":
            idx = op.get("index")
            if idx is not None and 0 <= idx < len(weak_points):
                wp = weak_points[idx]
                if op.get("new_point") and op["new_point"] != wp.get("point"):
                    old_text = wp["point"]
                    history = wp.setdefault("history", [])
                    history.append({"point": old_text, "date": wp.get("last_seen", now)})
                    wp["point"] = op["new_point"]
                    # Sync vector index with updated text
                    if user_id:
                        try:
                            upsert_weak_point_vector(old_text, op["new_point"], wp.get("topic", topic), user_id)
                        except Exception as e:
                            logger.warning(f"Failed to sync vector for updated weak point: {e}")
                wp["times_seen"] = wp.get("times_seen", 1) + 1
                wp["last_seen"] = now
                if wp.get("archived"):
                    wp["archived"] = False
                    wp.pop("archived_at", None)
                    wp.setdefault("history", []).append({"date": now, "event": "unarchived"})

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
            matched = profile["weak_points"][match_idx]
            matched["times_seen"] = matched.get("times_seen", 1) + 1
            matched["last_seen"] = now
            if matched.get("archived"):
                matched["archived"] = False
                matched.pop("archived_at", None)
                matched.setdefault("history", []).append({"date": now, "event": "unarchived"})
        else:
            profile.setdefault("weak_points", []).append({
                "point": point,
                "topic": wp.get("topic", topic) if isinstance(wp, dict) else (topic or ""),
                "source": wp.get("source", "observed") if isinstance(wp, dict) else "observed",
                "first_seen": now, "last_seen": now,
                "times_seen": 1, "improved": False,
            })

    for sp in new_strong:
        sp_text = sp.get("point", sp) if isinstance(sp, dict) else str(sp)
        sp_topic = sp.get("topic") if isinstance(sp, dict) else topic
        # Use embedding similarity to find the weak point this strong point overcomes
        active_weak = [
            (i, w) for i, w in enumerate(profile.get("weak_points", []))
            if w.get("topic") == sp_topic and not w.get("improved") and not w.get("archived")
        ]
        if active_weak:
            from backend.vector_memory import _embed, _cosine_similarity
            sp_vec = _embed(sp_text)
            weak_texts = [w["point"] for _, w in active_weak]
            weak_vecs = np.stack([_embed(t) for t in weak_texts])
            sims = _cosine_similarity(sp_vec, weak_vecs)
            best_local = int(np.argmax(sims))
            if float(sims[best_local]) >= 0.5:
                _, matched_wp = active_weak[best_local]
                matched_wp["improved"] = True
                matched_wp["improved_at"] = now

        existing = {s["point"] for s in profile.get("strong_points", [])}
        if sp_text not in existing:
            profile.setdefault("strong_points", []).append({
                "point": sp_text,
                "topic": sp_topic or "",
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


def _append_if_novel(items: list[str], new_item: str, chunk_type: str, user_id: str, limit: int = 8) -> None:
    """Append new_item only if semantically novel. Uses persistent embedding cache."""
    if new_item in items:
        return
    from backend.vector_memory import find_similar_cached, cache_embedding, remove_cached_embedding
    if find_similar_cached(new_item, items, chunk_type, user_id, threshold=_DEDUP_SIMILARITY_THRESHOLD):
        return
    # Evict oldest before adding if at limit
    if len(items) >= limit:
        evicted = items.pop(0)
        remove_cached_embedding(evicted, chunk_type, user_id)
    items.append(new_item)
    # Cache the new item's embedding
    cache_embedding(new_item, chunk_type, user_id)


def _update_communication(profile: dict, comm: dict, user_id: str):
    """Accumulate communication observations, deduplicate via embedding similarity."""
    if not comm:
        return
    c = profile.setdefault("communication", {})
    if comm.get("style_update"):
        observations = c.setdefault("style_observations", [])
        _append_if_novel(observations, comm["style_update"], "comm_style", user_id, limit=5)
        c["style"] = observations[-1]
    for habit in comm.get("new_habits", []):
        _append_if_novel(c.setdefault("habits", []), habit, "comm_habit", user_id)
    for sug in comm.get("new_suggestions", []):
        _append_if_novel(c.setdefault("suggestions", []), sug, "comm_suggestion", user_id)


def _update_thinking_patterns(profile: dict, patterns: dict, user_id: str):
    """Accumulate thinking pattern observations, deduplicate via embedding similarity."""
    if not patterns:
        return
    tp = profile.setdefault("thinking_patterns", {"strengths": [], "gaps": []})
    for s in patterns.get("new_strengths", []):
        _append_if_novel(tp["strengths"], s, "thinking_strength", user_id)
    for g in patterns.get("new_gaps", []):
        _append_if_novel(tp["gaps"], g, "thinking_gap", user_id)


def _archive_stale_weak_points(profile: dict):
    """Archive weak points not seen recently — keeps them in profile but out of active prompts.

    Rules:
    - last_seen > 60 days → archive regardless
    - last_seen > 30 days AND times_seen <= 2 → archive
    - Already improved/archived → skip
    - source == "consolidated" → skip (refreshed by re-running consolidation, not by time)
    """
    now = datetime.now()
    for wp in profile.get("weak_points", []):
        if wp.get("improved") or wp.get("archived"):
            continue
        if wp.get("source") == "consolidated":
            continue
        last_seen_str = wp.get("last_seen", "")
        if not last_seen_str:
            continue
        try:
            last_seen = datetime.fromisoformat(last_seen_str)
        except (ValueError, TypeError):
            continue
        days_since = (now - last_seen).days
        times_seen = wp.get("times_seen", 1)
        if days_since > 60 or (days_since > 30 and times_seen <= 2):
            wp["archived"] = True
            wp["archived_at"] = now.isoformat()
            wp.setdefault("history", []).append({
                "date": now.isoformat(),
                "event": "archived",
                "reason": f"stale: {days_since}d since last seen, seen {times_seen}x",
            })


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
    elif mode == "recording":
        stats["recording_sessions"] = stats.get("recording_sessions", 0) + 1
    elif mode == "copilot":
        stats["copilot_sessions"] = stats.get("copilot_sessions", 0) + 1

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

    # LLM calls happen outside the lock (they're slow and don't touch profile)
    profile = _load_profile(user_id)
    has_new_facts = bool(new_weak_points or new_strong_points)
    ops = None
    llm_failed = False

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
            if not isinstance(ops, dict):
                raise ValueError(f"Expected dict, got {type(ops)}")
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Profile update LLM parse failed ({e}), falling back to deterministic")
            llm_failed = True

    # All profile mutations happen under the lock
    async with _get_profile_lock(user_id):
        # Re-load fresh profile inside the lock
        profile = _load_profile(user_id)
        now = datetime.now().isoformat()

        if has_new_facts:
            if ops and not llm_failed:
                _apply_memory_ops(profile, ops, topic, now, user_id=user_id)
            else:
                _deterministic_update(profile, new_weak_points, new_strong_points, topic, now, user_id)

        # ── Deterministic updates for mastery / communication / thinking / stats ──
        _update_mastery(profile, topic, topic_mastery, now, user_id=user_id)
        _update_communication(profile, communication, user_id)
        _update_thinking_patterns(profile, thinking_patterns, user_id)
        _update_stats(profile, mode, topic, avg_score, now, answer_count, dimension_scores)
        _archive_stale_weak_points(profile)

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

    # ── Stage 3: Consolidation (带节流, 失败不阻塞) ──
    # 从 active observed weak_points 里识别跨领域规律, 输出 source="consolidated" 的条目.
    # 内部节流: 24h cooldown + 至少 3 条新 wp + 至少 5 条 active wp 才真的跑 LLM.
    await consolidate_patterns(user_id)


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


# ── Stage 3: Consolidation ──────────────────────────────────────────────────
# 从扁平的 weak_points 里识别跨领域规律,产出 source="consolidated" 的高层条目。
# 被整合的原始 wp 会被 archive,reason="superseded_by_consolidation"。
# 设计要点:
# - 跨至少 2 个不同 topic 才算合格 pattern (挡住同领域换粒度的假整合)
# - 失败不影响 Stage 1/2 (整个函数 try/except 包裹)
# - 节流: 24h + 至少 3 条新 observed wp 才跑一次

CONSOLIDATE_MIN_ACTIVE_WPS = 5       # 活跃 observed wp 少于这个不跑
CONSOLIDATE_MIN_NEW_WPS = 3          # 距上次 consolidation 新增少于这个不跑
CONSOLIDATE_COOLDOWN_HOURS = 24      # 两次 consolidation 之间的最小间隔
CONSOLIDATE_MIN_SUPPORTING = 2       # 一条 pattern 至少需要引用的 wp 数
CONSOLIDATE_MIN_SPANNING_TOPICS = 2  # 必须跨多少个不同 topic
CONSOLIDATE_MAX_STATEMENT_LEN = 80   # pattern 描述的字符上限

CONSOLIDATE_PROMPT = """你是面试教练的模式识别引擎。你的任务是从用户的薄弱点观察列表里,
识别**用户自己可能没意识到的跨领域规律** (pattern)。

## 合格 pattern 的 4 个必要条件

一条 pattern 必须同时满足以下 4 条, 否则视为不合格:

1. **跨至少 2 个不同的领域 (topic)**
   例: [GIL (python)] + [Transformer 注意力 (llm)] + [B+ 树 (database)]
       → 跨 3 个领域, 可能是一个真规律
   反例: [GIL (python)] + [async (python)] + [描述符 (python)]
       → 全在 python 内, 这只是一个领域的弱点, 不是跨领域规律

2. **比原始观察抽象层次更高**
   例: 5 条"底层机制讲不清"的具体观察 → 1 条"对底层原理偏表面" (思考方式的倾向)
   反例: "GIL 不懂" + "async 不懂" → "Python 并发不懂"
       (这只是换了个粒度, 没有真正抽象, 不合格)

3. **是用户自己不容易察觉的规律**
   例: "被追问 'why' 时倾向跳过推导过程" (思维模式,用户自己难以看到)
   反例: "Python 的很多东西不熟" (用户自己都知道, 没价值)

4. **可证伪**
   pattern 必须是将来能被新观察验证或推翻的具体假设。
   "你可能有点紧张"这种虚话不算。

## 什么时候不要产出

以下任何一种情况, 请返回 {{"patterns": []}}:

- 观察列表里看不到跨领域的规律
- 所有观察都集中在 1-2 个具体技术点
- 你没有高度把握某条 pattern 真的成立
- 观察之间的联系只是表面相似, 不是结构性共性

**宁可产出 0 个 pattern, 不要产出 1 个错的**。
编造的 pattern 会被用户标记为不准, 损害系统可信度。
返回空数组完全不会被惩罚, 乱产出才会被惩罚。

## 输入: 用户当前的活跃薄弱点

{weak_points_formatted}

## 输出格式 (严格 JSON)

{{
  "patterns": [
    {{
      "statement": "一句话规律描述, 不超过 40 字",
      "supporting_wp_indices": [0, 3, 7],
      "topic": "cross_cutting 或 meta",
      "confidence": 0.85,
      "reasoning": "内部用, 为什么这几条指向同一规律 (不展示给用户)"
    }}
  ]
}}

只输出 JSON, 不要任何其他内容。
"""


def _filter_active_observed_wps(profile: dict) -> list[tuple[int, dict]]:
    """返回 (原 index, wp) 对的列表, 只包含活跃的 observed 条目.

    原 index 用于 consolidation 写回时精确定位 profile["weak_points"] 里的原条目.
    """
    out = []
    for i, wp in enumerate(profile.get("weak_points", [])):
        if wp.get("improved") or wp.get("archived"):
            continue
        # 只对 observed 的条目做 consolidation, 不整合已整合过的或 JD 预测的
        if wp.get("source", "observed") != "observed":
            continue
        out.append((i, wp))
    return out


def _validate_consolidation_pattern(pattern: dict, active: list[tuple[int, dict]]) -> str | None:
    """验证一条 LLM 产出的 pattern. 返回 None 表示通过, 否则返回拒绝原因."""
    idxs = pattern.get("supporting_wp_indices")
    if not isinstance(idxs, list) or len(idxs) < CONSOLIDATE_MIN_SUPPORTING:
        return "too_few_supporting"

    # idxs 是"输入给 LLM 时的局部 index",引用的是 active 列表的位置
    if any(not isinstance(i, int) or i < 0 or i >= len(active) for i in idxs):
        return "invalid_index"

    # 必须跨至少 2 个 topic
    topics = {active[i][1].get("topic", "") for i in idxs}
    topics.discard("")
    if len(topics) < CONSOLIDATE_MIN_SPANNING_TOPICS:
        return "not_cross_cutting"

    statement = (pattern.get("statement") or "").strip()
    if not statement:
        return "empty_statement"
    if len(statement) > CONSOLIDATE_MAX_STATEMENT_LEN:
        return "statement_too_long"

    return None


def _apply_consolidation_pattern(profile: dict, pattern: dict, active: list[tuple[int, dict]], now: str):
    """把一条 pattern 写入 profile: 追加新 consolidated wp + archive 被 supersede 的原条目."""
    idxs = pattern["supporting_wp_indices"]
    supporting_pairs = [active[i] for i in idxs]
    supporting_wps = [wp for _, wp in supporting_pairs]

    new_wp = {
        "point": pattern["statement"].strip(),
        "topic": pattern.get("topic") or "cross_cutting",
        "source": "consolidated",
        "first_seen": now,
        "last_seen": now,
        "times_seen": sum(w.get("times_seen", 1) for w in supporting_wps),
        "improved": False,
        "archived": False,
        "consolidates": [w.get("point", "") for w in supporting_wps],
        "confidence": float(pattern.get("confidence", 0.7)),
        "user_acknowledged": False,
    }
    profile.setdefault("weak_points", []).append(new_wp)

    # Archive 被 supersede 的原条目 (用原 profile index 精确定位, 防止锁外并发写)
    all_wps = profile.get("weak_points", [])
    for orig_idx, wp in supporting_pairs:
        if orig_idx >= len(all_wps):
            continue
        target = all_wps[orig_idx]
        # 再次确认这条就是我们要改的 (防止锁外并发写把 list 改了)
        if target.get("point") != wp.get("point"):
            continue
        target["archived"] = True
        target["archived_at"] = now
        target["archived_reason"] = "superseded_by_consolidation"
        target.setdefault("history", []).append({
            "date": now,
            "event": "archived",
            "reason": f"superseded by consolidation: {new_wp['point'][:40]}",
        })


def _should_run_consolidation(profile: dict) -> tuple[bool, str]:
    """检查节流条件. 返回 (是否应该跑, 原因)."""
    active = _filter_active_observed_wps(profile)
    if len(active) < CONSOLIDATE_MIN_ACTIVE_WPS:
        return False, f"too_few_active_wps ({len(active)} < {CONSOLIDATE_MIN_ACTIVE_WPS})"

    last_str = profile.get("last_consolidation_at", "")
    if last_str:
        try:
            last_time = datetime.fromisoformat(last_str)
            hours_since = (datetime.now() - last_time).total_seconds() / 3600
            if hours_since < CONSOLIDATE_COOLDOWN_HOURS:
                return False, f"cooldown (last run {hours_since:.1f}h ago)"
        except (ValueError, TypeError):
            pass  # 解析失败就当没跑过

        # 至少 N 条新 observed wp 才值得重跑
        new_count = 0
        for _, wp in active:
            first_seen = wp.get("first_seen", "")
            try:
                if datetime.fromisoformat(first_seen) > last_time:
                    new_count += 1
            except (ValueError, TypeError):
                continue
        if new_count < CONSOLIDATE_MIN_NEW_WPS:
            return False, f"too_few_new_wps ({new_count} < {CONSOLIDATE_MIN_NEW_WPS})"

    return True, "ok"


async def consolidate_patterns(user_id: str) -> dict:
    """Stage 3: 从 active observed weak_points 里识别跨领域规律.

    带节流: 满足 cooldown + 新观察数量 + 活跃数量三个条件才真的跑 LLM.
    失败不影响上游 (所有异常在这里被吞).

    Returns:
        {"ran": bool, "applied": int, "skipped": list, "reason": str}
    """
    try:
        profile = _load_profile(user_id)

        should_run, reason = _should_run_consolidation(profile)
        if not should_run:
            return {"ran": False, "applied": 0, "skipped": [], "reason": reason}

        active = _filter_active_observed_wps(profile)
        formatted = "\n".join(
            f"[{i}] {wp['point']} (领域: {wp.get('topic', '?')}, 观察 {wp.get('times_seen', 1)} 次)"
            for i, (_, wp) in enumerate(active)
        )

        llm = get_langchain_llm()
        response = llm.invoke([
            SystemMessage(content="你是面试教练的模式识别引擎。只返回 JSON。宁可不产出,不要编造。"),
            HumanMessage(content=CONSOLIDATE_PROMPT.format(weak_points_formatted=formatted)),
        ])

        try:
            parsed = _parse_json_safe(response.content)
            if not isinstance(parsed, dict):
                raise ValueError(f"Expected dict, got {type(parsed)}")
            raw_patterns = parsed.get("patterns", []) or []
            if not isinstance(raw_patterns, list):
                raise ValueError("patterns is not a list")
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.warning(f"Consolidation parse failed: {e}. Raw: {response.content[:200]}")
            # 解析失败不更新 last_consolidation_at, 下次 session 会重试
            return {"ran": False, "applied": 0, "skipped": [], "reason": "llm_parse_failed"}

        # 验证
        valid_patterns = []
        skipped = []
        for p in raw_patterns:
            if not isinstance(p, dict):
                skipped.append({"reason": "not_a_dict"})
                continue
            rej = _validate_consolidation_pattern(p, active)
            if rej is None:
                valid_patterns.append(p)
            else:
                skipped.append({"statement": p.get("statement", "?"), "reason": rej})

        # 写入 (在锁内)
        applied = 0
        async with _get_profile_lock(user_id):
            profile = _load_profile(user_id)
            # 锁内重新过滤 active, 因为 profile 在 LLM 期间可能被并发写
            active_inside = _filter_active_observed_wps(profile)

            # 重新验证 index 还有效 (active 可能变短了)
            now = datetime.now().isoformat()
            for p in valid_patterns:
                idxs = p["supporting_wp_indices"]
                if any(i >= len(active_inside) for i in idxs):
                    skipped.append({"statement": p.get("statement", "?"), "reason": "stale_index_after_reload"})
                    continue
                # 还要确认 active 列表的顺序没变 (通过比对 point 文本)
                ok = True
                for local_i in idxs:
                    orig_idx_outside = active[local_i][0]
                    if orig_idx_outside >= len(profile.get("weak_points", [])):
                        ok = False
                        break
                    if profile["weak_points"][orig_idx_outside].get("point") != active[local_i][1].get("point"):
                        ok = False
                        break
                if not ok:
                    skipped.append({"statement": p.get("statement", "?"), "reason": "profile_changed_during_llm"})
                    continue

                _apply_consolidation_pattern(profile, p, active, now)
                applied += 1

            profile["last_consolidation_at"] = now
            _save_profile(profile, user_id)

        logger.info(
            f"Consolidation for user {user_id}: applied={applied}, skipped={len(skipped)}, "
            f"candidates={len(raw_patterns)}"
        )
        return {"ran": True, "applied": applied, "skipped": skipped, "reason": "ok"}

    except Exception as e:
        logger.warning(f"Consolidation failed for user {user_id}: {type(e).__name__}: {e}")
        return {"ran": False, "applied": 0, "skipped": [], "reason": f"error: {type(e).__name__}"}
