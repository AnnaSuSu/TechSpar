"""模式2: 专项强化训练 — 批量出题 + 自适应分批评估（不再使用 LangGraph）."""
import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from backend.config import settings
from backend.llm_provider import get_question_generation_llm, get_evaluation_llm
from backend.indexer import retrieve_topic_context, load_topics
from backend.memory import get_profile_summary, get_profile_summary_for_drill, get_topic_context_for_drill
from backend.prompts.interviewer import (
    DRILL_QUESTION_GEN_PROMPT,
    DRILL_SCORE_EVAL_PROMPT,
    DRILL_OVERALL_SYNTHESIS_PROMPT,
)

logger = logging.getLogger("uvicorn")


def _get_topic_display(user_id: str) -> dict[str, str]:
    """Dynamic {key: display_name} from topics.json."""
    return {k: v["name"] for k, v in load_topics(user_id).items()}


def _parse_json_response(content: str) -> dict | list:
    """Extract JSON from LLM response, handling various formats."""
    import re
    content = content.strip()

    # Try direct parse first
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Extract from markdown code block
    m = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?```", content)
    if m:
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Find first [ or { and parse from there
    for i, c in enumerate(content):
        if c in ("[", "{"):
            try:
                return json.loads(content[i:])
            except json.JSONDecodeError:
                pass
            break

    raise json.JSONDecodeError("No valid JSON found", content, 0)


def _load_high_freq(topic: str, user_id: str) -> str:
    """Load high-frequency question bank for a topic."""
    filepath = settings.user_high_freq_path(user_id) / f"{topic}.md"
    if filepath.exists():
        return filepath.read_text(encoding="utf-8").strip()
    return ""


def _truncate_text(text: str, max_chars: int) -> str:
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "…"


def _chunked(items: list, size: int):
    size = max(1, size)
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _safe_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_string_list(items) -> list[str]:
    if not isinstance(items, list):
        return []
    result = []
    seen = set()
    for item in items:
        text = str(item).strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _normalize_point_list(items, default_topic: str) -> list[dict]:
    if not isinstance(items, list):
        return []
    result = []
    seen = set()
    for item in items:
        if isinstance(item, dict):
            point = str(item.get("point", "")).strip()
            topic = str(item.get("topic", default_topic) or default_topic).strip()
        else:
            point = str(item).strip()
            topic = default_topic
        if not point:
            continue
        key = (point.casefold(), topic.casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append({"point": point, "topic": topic})
    return result


def _empty_score(question_id: int, reason: str) -> dict:
    return {
        "question_id": question_id,
        "score": None,
        "assessment": reason,
        "improvement": "请稍后重试，或缩短单题回答后再次评估。",
        "understanding": "评估未完成",
        "weak_point": None,
        "key_missing": [],
    }


def _normalize_chunk_scores(raw_scores, chunk_questions: list[dict]) -> list[dict]:
    if not isinstance(raw_scores, list):
        raw_scores = []

    question_ids = {q["id"] for q in chunk_questions}
    normalized_map = {}

    for idx, item in enumerate(raw_scores):
        if not isinstance(item, dict):
            continue
        question_id = _safe_int(item.get("question_id"))
        if question_id not in question_ids and idx < len(chunk_questions):
            question_id = chunk_questions[idx]["id"]
        if question_id not in question_ids:
            continue

        normalized_map[question_id] = {
            "question_id": question_id,
            "score": item.get("score"),
            "assessment": str(item.get("assessment", "")).strip(),
            "improvement": str(item.get("improvement", "")).strip(),
            "understanding": str(item.get("understanding", "")).strip(),
            "weak_point": item.get("weak_point"),
            "key_missing": _normalize_string_list(item.get("key_missing", [])),
        }

    result = []
    for question in chunk_questions:
        result.append(
            normalized_map.get(
                question["id"],
                _empty_score(question["id"], "该题评估结果缺失，请重试。"),
            )
        )
    return result


def _build_eval_payload(topic: str, chunk_questions: list[dict], answer_map: dict, user_id: str) -> tuple[str, str]:
    qa_lines = []
    ref_lines = []
    ref_top_k = max(1, settings.drill_eval_reference_top_k)
    ref_max_chars = max(200, settings.drill_eval_reference_max_chars)
    answer_max_chars = max(200, settings.drill_eval_answer_max_chars)

    for q in chunk_questions:
        qid = q["id"]
        answer = _truncate_text(answer_map.get(qid, ""), answer_max_chars)
        qa_lines.append(
            f"### Q{qid} (难度 {q.get('difficulty', '?')}/5)\n"
            f"**题目**: {q['question']}\n"
            f"**回答**: {answer}"
        )

        refs = retrieve_topic_context(topic, q["question"], user_id, top_k=ref_top_k)
        if refs:
            reference_text = "\n".join(refs)
            ref_lines.append(f"### Q{qid} 参考\n{_truncate_text(reference_text, ref_max_chars)}")

    return "\n\n".join(qa_lines), "\n\n".join(ref_lines)


def _evaluate_chunk(topic_name: str, topic: str, chunk_questions: list[dict],
                    answer_map: dict, user_id: str) -> dict:
    qa_pairs, references = _build_eval_payload(topic, chunk_questions, answer_map, user_id)
    prompt = DRILL_SCORE_EVAL_PROMPT.format(
        topic_name=topic_name,
        qa_pairs=qa_pairs,
        references=references or "暂无参考材料",
    )

    llm = get_evaluation_llm()
    response = llm.invoke([
        SystemMessage(content="你是训练评估引擎。只返回 JSON，不要其他内容。"),
        HumanMessage(content=prompt),
    ])

    result = _parse_json_response(response.content)
    if not isinstance(result, dict):
        raise ValueError(f"Expected dict, got {type(result)}")

    return {
        "scores": _normalize_chunk_scores(result.get("scores", []), chunk_questions),
        "overall": {},
    }


def _evaluate_chunk_adaptive(topic_name: str, topic: str, chunk_questions: list[dict],
                             answer_map: dict, user_id: str) -> dict:
    try:
        logger.info(
            "Evaluating drill chunk: size=%s, qids=%s",
            len(chunk_questions),
            [q["id"] for q in chunk_questions],
        )
        return _evaluate_chunk(topic_name, topic, chunk_questions, answer_map, user_id)
    except Exception as e:
        if len(chunk_questions) > 1:
            logger.warning(
                "Chunk evaluation failed; splitting chunk. size=%s, qids=%s, error=%s",
                len(chunk_questions),
                [q["id"] for q in chunk_questions],
                e,
            )
            split_at = max(1, len(chunk_questions) // 2)
            left = _evaluate_chunk_adaptive(topic_name, topic, chunk_questions[:split_at], answer_map, user_id)
            right = _evaluate_chunk_adaptive(topic_name, topic, chunk_questions[split_at:], answer_map, user_id)
            return {
                "scores": left["scores"] + right["scores"],
                "overall": {},
                "batch_overalls": left.get("batch_overalls", []) + right.get("batch_overalls", []),
            }

        question = chunk_questions[0]
        logger.error("Single-question evaluation failed for Q%s: %s", question["id"], e)
        return {
            "scores": [_empty_score(question["id"], f"该题评估超时或失败：{e}")],
            "overall": {},
            "batch_overalls": [],
        }


def _extract_batch_overalls(chunk_result: dict) -> list[dict]:
    overalls = list(chunk_result.get("batch_overalls", []))
    overall = chunk_result.get("overall")
    if isinstance(overall, dict) and overall:
        overalls.append(overall)
    return overalls


def _compute_avg_score(scores: list[dict]) -> float | None:
    valid_scores = []
    for score in scores:
        try:
            valid_scores.append(float(score["score"]))
        except (TypeError, ValueError, KeyError):
            pass
    if not valid_scores:
        return None
    return round(sum(valid_scores) / len(valid_scores), 1)


def _merge_batch_findings(batch_overalls: list[dict], topic: str) -> dict:
    weak_points = []
    strong_points = []
    style_update = ""
    habits = []
    suggestions = []
    strengths = []
    gaps = []
    mastery_note = ""

    for overall in batch_overalls:
        weak_points.extend(_normalize_point_list(overall.get("new_weak_points", []), topic))
        strong_points.extend(_normalize_point_list(overall.get("new_strong_points", []), topic))

        communication = overall.get("communication_observations", {}) or {}
        if not style_update and communication.get("style_update"):
            style_update = str(communication["style_update"]).strip()
        habits.extend(_normalize_string_list(communication.get("new_habits", [])))
        suggestions.extend(_normalize_string_list(communication.get("new_suggestions", [])))

        patterns = overall.get("thinking_patterns", {}) or {}
        strengths.extend(_normalize_string_list(patterns.get("new_strengths", [])))
        gaps.extend(_normalize_string_list(patterns.get("new_gaps", [])))

        mastery = overall.get("topic_mastery", {}) or {}
        if not mastery_note and mastery.get("notes"):
            mastery_note = str(mastery["notes"]).strip()

    return {
        "new_weak_points": _normalize_point_list(weak_points, topic)[:5],
        "new_strong_points": _normalize_point_list(strong_points, topic)[:5],
        "communication_observations": {
            "style_update": style_update,
            "new_habits": _normalize_string_list(habits)[:5],
            "new_suggestions": _normalize_string_list(suggestions)[:5],
        },
        "thinking_patterns": {
            "new_strengths": _normalize_string_list(strengths)[:5],
            "new_gaps": _normalize_string_list(gaps)[:5],
        },
        "topic_mastery": {"notes": mastery_note} if mastery_note else {},
    }


def _fallback_overall(topic: str, topic_name: str, answered_questions: list[dict], scores: list[dict],
                      batch_overalls: list[dict]) -> dict:
    avg_score = _compute_avg_score(scores)
    merged = _merge_batch_findings(batch_overalls, topic)

    if not merged["new_weak_points"]:
        weak_points = [
            {"point": str(score.get("weak_point")).strip(), "topic": topic}
            for score in scores
            if score.get("weak_point")
        ]
        merged["new_weak_points"] = _normalize_point_list(weak_points, topic)[:5]

    answered_count = len(answered_questions)
    valid_count = sum(1 for score in scores if isinstance(score.get("score"), (int, float)))
    failed_count = max(0, answered_count - valid_count)

    summary_parts = []
    if avg_score is None:
        summary_parts.append(f"本次 {topic_name} 训练未得到可用评分结果。")
    else:
        level = "整体表现较强" if avg_score >= 8 else "整体表现中等偏上" if avg_score >= 6 else "整体基础仍需加强"
        summary_parts.append(f"本次共评估 {answered_count} 道题，平均分 {avg_score}/10，{level}。")
    if merged["new_weak_points"]:
        weak_text = "；".join(point["point"] for point in merged["new_weak_points"][:3])
        summary_parts.append(f"主要短板集中在：{weak_text}。")
    if merged["new_strong_points"]:
        strong_text = "；".join(point["point"] for point in merged["new_strong_points"][:2])
        summary_parts.append(f"相对较好的方面包括：{strong_text}。")
    if failed_count:
        summary_parts.append(f"另有 {failed_count} 道题未能在时限内完成评估，可稍后重试。")
    if not merged["topic_mastery"]:
        if avg_score is None:
            mastery_note = f"{topic_name} 本次暂无足够数据判断掌握度。"
        elif avg_score >= 8:
            mastery_note = f"{topic_name} 核心概念掌握较稳，已具备进一步深挖原理和边界条件的基础。"
        elif avg_score >= 6:
            mastery_note = f"{topic_name} 具备基础理解，但在原理展开、边界条件和表达完整性上仍有提升空间。"
        else:
            mastery_note = f"{topic_name} 当前仍以基础概念记忆为主，对关键原理和细节展开不够稳定。"
        merged["topic_mastery"] = {"notes": mastery_note}

    return {
        "avg_score": avg_score,
        "summary": " ".join(summary_parts).strip(),
        **merged,
    }


def _synthesize_overall(topic: str, topic_name: str, answered_questions: list[dict], answer_map: dict,
                        scores: list[dict], batch_overalls: list[dict]) -> dict:
    avg_score = _compute_avg_score(scores)
    if not settings.drill_eval_use_llm_synthesis:
        return _fallback_overall(topic, topic_name, answered_questions, scores, batch_overalls)

    score_map = {score["question_id"]: score for score in scores}

    qa_briefs = []
    score_cards = []
    for question in answered_questions:
        qid = question["id"]
        score = score_map.get(qid, {})
        answer = _truncate_text(answer_map.get(qid, ""), 160)
        qa_briefs.append(
            f"- Q{qid}（{question.get('focus_area', '')}）题目: {question['question']}\n"
            f"  回答摘要: {answer}"
        )

        missing = "；".join(score.get("key_missing", [])[:3]) or "无"
        weak_point = score.get("weak_point") or "无"
        score_cards.append(
            f"- Q{qid}: {score.get('score', '-')}/10 | 理解: {score.get('understanding', '') or '无'} | "
            f"薄弱点: {weak_point} | 遗漏: {missing} | 点评: {_truncate_text(score.get('assessment', ''), 120)}"
        )

    batch_observations = []
    for idx, overall in enumerate(batch_overalls, start=1):
        if not isinstance(overall, dict):
            continue
        summary = str(overall.get("summary", "")).strip()
        weak_points = _normalize_point_list(overall.get("new_weak_points", []), topic)
        strong_points = _normalize_point_list(overall.get("new_strong_points", []), topic)
        batch_observations.append(
            f"### 批次 {idx}\n"
            f"- summary: {summary or '无'}\n"
            f"- weak: {', '.join(p['point'] for p in weak_points[:3]) or '无'}\n"
            f"- strong: {', '.join(p['point'] for p in strong_points[:3]) or '无'}"
        )

    prompt = DRILL_OVERALL_SYNTHESIS_PROMPT.format(
        topic_name=topic_name,
        topic_key=topic,
        qa_briefs="\n".join(qa_briefs) or "暂无",
        score_cards="\n".join(score_cards) or "暂无",
        batch_observations="\n\n".join(batch_observations) or "暂无",
    )

    try:
        llm = get_evaluation_llm()
        response = llm.invoke([
            SystemMessage(content="你是训练评估整合引擎。只返回 JSON，不要其他内容。"),
            HumanMessage(content=prompt),
        ])
        overall = _parse_json_response(response.content)
        if not isinstance(overall, dict):
            raise ValueError(f"Expected dict, got {type(overall)}")
        merged = _merge_batch_findings(batch_overalls, topic)
        overall["avg_score"] = avg_score
        overall["new_weak_points"] = _normalize_point_list(
            _normalize_point_list(overall.get("new_weak_points", []), topic) + merged["new_weak_points"],
            topic,
        )[:5]
        overall["new_strong_points"] = _normalize_point_list(
            _normalize_point_list(overall.get("new_strong_points", []), topic) + merged["new_strong_points"],
            topic,
        )[:5]

        communication = overall.get("communication_observations", {}) or {}
        merged_comm = merged["communication_observations"]
        overall["communication_observations"] = {
            "style_update": str(
                communication.get("style_update") or merged_comm.get("style_update") or ""
            ).strip(),
            "new_habits": _normalize_string_list(
                _normalize_string_list(communication.get("new_habits", [])) + merged_comm.get("new_habits", [])
            )[:5],
            "new_suggestions": _normalize_string_list(
                _normalize_string_list(communication.get("new_suggestions", [])) + merged_comm.get("new_suggestions", [])
            )[:5],
        }

        patterns = overall.get("thinking_patterns", {}) or {}
        merged_patterns = merged["thinking_patterns"]
        overall["thinking_patterns"] = {
            "new_strengths": _normalize_string_list(
                _normalize_string_list(patterns.get("new_strengths", [])) + merged_patterns.get("new_strengths", [])
            )[:5],
            "new_gaps": _normalize_string_list(
                _normalize_string_list(patterns.get("new_gaps", [])) + merged_patterns.get("new_gaps", [])
            )[:5],
        }

        mastery_notes = str(
            (overall.get("topic_mastery", {}) or {}).get("notes")
            or (merged.get("topic_mastery", {}) or {}).get("notes")
            or ""
        ).strip()
        overall["topic_mastery"] = {"notes": mastery_notes} if mastery_notes else {}
        return overall
    except Exception as e:
        logger.warning("Overall synthesis failed, using fallback: %s", e)
        return _fallback_overall(topic, topic_name, answered_questions, scores, batch_overalls)


def generate_drill_questions(topic: str, user_id: str) -> list[dict]:
    """Generate 10 personalized questions for a topic. 1 LLM call."""
    from backend.spaced_repetition import get_due_reviews, init_sr_for_existing_points

    # Ensure existing weak points have SR state
    init_sr_for_existing_points(user_id)

    topic_display = _get_topic_display(user_id)
    topic_name = topic_display.get(topic, topic)
    drill_ctx = get_topic_context_for_drill(topic, user_id)

    # Spaced repetition: prioritize due reviews
    due_reviews = get_due_reviews(user_id, topic)
    due_points = [wp["point"] for wp in due_reviews[:5]]

    all_weak = list(drill_ctx["weak_points"])
    for dp in due_points:
        if dp not in all_weak:
            all_weak.insert(0, dp)

    # Retrieve knowledge — prioritize weak areas
    queries = []
    if all_weak:
        queries.append(" ".join(all_weak[:5]))
    queries.append(f"{topic_name} 核心知识点 面试常见问题")

    all_chunks = []
    for q in queries:
        all_chunks.extend(retrieve_topic_context(topic, q, user_id, top_k=5))
    # Deduplicate and limit
    seen = set()
    unique_chunks = []
    for c in all_chunks:
        key = c[:100]
        if key not in seen:
            seen.add(key)
            unique_chunks.append(c)
    knowledge_ctx = "\n\n---\n\n".join(unique_chunks)[:5000]

    # Format past insights from vector retrieval
    past_insights_text = "\n".join(
        f"- {ins[:200]}" for ins in drill_ctx.get("past_insights", [])
    ) or "暂无历史数据"

    # Load high-frequency questions
    high_freq = _load_high_freq(topic, user_id) or "暂无"

    # Format weak points, marking due reviews
    weak_lines = []
    for w in all_weak[:10]:
        prefix = "[到期复习] " if w in due_points else ""
        weak_lines.append(f"- {prefix}{w}")

    # Difficulty range and question strategy based on mastery
    mastery_score = drill_ctx["mastery_score"]
    if mastery_score <= 30:
        diff_min, diff_max = 1, 3
        question_strategy = (
            "当前为新手阶段（掌握度 0-30），题目策略：\n"
            "- 70% 基础概念题 + 对比辨析题，30% 简单应用题\n"
            "- 基础概念题考的是「是什么」和「为什么」：核心定义、基本原理、常见术语的含义\n"
            "- 不要考底层实现细节、内核机制、源码级原理等深度概念\n"
            "- 不要出复杂场景设计题或系统架构题，先确认基础概念是否扎实\n"
            "- 概念题要考理解而非背诵——问「为什么这样设计」而非「请背诵定义」"
        )
    elif mastery_score <= 60:
        diff_min, diff_max = 2, 4
        question_strategy = (
            "当前有基础（掌握度 30-60），题目策略：\n"
            "- 40% 深度概念题（底层原理、实现机制、边界行为），40% 场景应用题，20% 设计权衡题\n"
            "- 可以考底层原理和内部机制，但场景题控制在单组件/单服务范围，不需要大规模系统设计"
        )
    else:
        diff_min, diff_max = 3, 5
        question_strategy = (
            "当前已熟练（掌握度 60-100），题目策略：\n"
            "- 20% 概念题（考边界 case 和底层原理），80% 场景设计 + 系统权衡题"
        )

    prompt = DRILL_QUESTION_GEN_PROMPT.format(
        topic_name=topic_name,
        knowledge_context=knowledge_ctx,
        user_profile=get_profile_summary_for_drill(user_id),
        mastery_info=drill_ctx["mastery_info"],
        weak_points="\n".join(weak_lines) or "暂无",
        high_freq_questions=high_freq,
        recent_questions="\n".join(f"- {q}" for q in drill_ctx["recent_questions"][-10:]) or "暂无",
        past_insights=past_insights_text,
        question_strategy=question_strategy,
        diff_min=diff_min,
        diff_max=diff_max,
    )

    llm = get_question_generation_llm()
    response = llm.invoke([
        SystemMessage(content="你是专项训练出题引擎。只返回 JSON 数组，不要其他内容。"),
        HumanMessage(content=prompt),
    ])

    try:
        questions = _parse_json_response(response.content)
        if not isinstance(questions, list):
            raise ValueError(f"Expected a list, got {type(questions)}")
        # Ensure each question has an id
        for i, q in enumerate(questions):
            if "id" not in q:
                q["id"] = i + 1
        return questions[:10]
    except (json.JSONDecodeError, ValueError, IndexError) as e:
        logger.error(f"Drill question generation failed: {e}")
        logger.error(f"LLM raw response: {response.content[:500]}")
        raise RuntimeError(f"出题失败，LLM 返回格式异常: {e}")


def evaluate_drill_answers(topic: str, questions: list[dict], answers: list[dict],
                           user_id: str) -> dict:
    """Evaluate all answered questions with adaptive chunking + overall synthesis."""
    topic_display = _get_topic_display(user_id)
    topic_name = topic_display.get(topic, topic)
    answer_map = {a["question_id"]: a["answer"] for a in answers}

    # Only evaluate answered questions
    answered_questions = [q for q in questions if answer_map.get(q["id"])]
    if not answered_questions:
        return {
            "scores": [],
            "overall": {
                "avg_score": None,
                "summary": "本次未检测到有效作答，暂无法生成评估结果。",
                "new_weak_points": [],
                "new_strong_points": [],
                "communication_observations": {
                    "style_update": "",
                    "new_habits": [],
                    "new_suggestions": [],
                },
                "thinking_patterns": {"new_strengths": [], "new_gaps": []},
                "topic_mastery": {"notes": "暂无有效作答，无法评估掌握度。"},
            },
        }

    try:
        batch_size = max(1, settings.drill_eval_batch_size)
        all_scores = []
        batch_overalls = []

        for chunk in _chunked(answered_questions, batch_size):
            chunk_result = _evaluate_chunk_adaptive(topic_name, topic, chunk, answer_map, user_id)
            all_scores.extend(chunk_result.get("scores", []))
            batch_overalls.extend(_extract_batch_overalls(chunk_result))

        all_scores.sort(key=lambda item: _safe_int(item.get("question_id"), 10**9))
        overall = _synthesize_overall(topic, topic_name, answered_questions, answer_map, all_scores, batch_overalls)
        return {"scores": all_scores, "overall": overall}
    except Exception as e:
        logger.error(f"Drill evaluation failed: {e}")
        return {
            "scores": [{"question_id": q["id"], "score": None, "assessment": "评估解析失败，请重试"} for q in answered_questions],
            "overall": {
                "avg_score": None,
                "summary": "评估结果生成失败，请重试。",
                "new_weak_points": [],
                "new_strong_points": [],
                "communication_observations": {
                    "style_update": "",
                    "new_habits": [],
                    "new_suggestions": [],
                },
                "thinking_patterns": {"new_strengths": [], "new_gaps": []},
                "topic_mastery": {},
            },
        }
