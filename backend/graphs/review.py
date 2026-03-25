"""复盘系统：面试结束后生成复盘报告。"""
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from backend.llm_provider import get_evaluation_llm
from backend.prompts.reviewer import REVIEW_SYSTEM
from backend.models import InterviewMode


def generate_review(
    mode: InterviewMode,
    messages: list,
    scores: list[dict] | None = None,
    weak_points: list[str] | None = None,
    topic: str | None = None,
    eval_history: list[dict] | None = None,
) -> str:
    """Generate a structured review report from interview transcript."""

    # Build transcript from messages
    transcript_lines = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            transcript_lines.append(f"**候选人**: {msg.content}")
        elif isinstance(msg, AIMessage):
            transcript_lines.append(f"**面试官**: {msg.content}")
    transcript = "\n\n".join(transcript_lines)

    # Build extra context
    extra = ""
    if mode == InterviewMode.TOPIC_DRILL:
        if scores:
            score_summary = "\n".join(
                f"- Q: {s.get('question', '?')} → {s.get('score', '?')}/10 ({s.get('assessment', '')})"
                for s in scores
            )
            extra += f"\n## 各题评分记录\n{score_summary}\n"
        if weak_points:
            extra += f"\n## 已识别的薄弱点\n{', '.join(weak_points)}\n"
        if topic:
            extra += f"\n## 训练领域: {topic}\n"

    # Resume mode: use inline eval history if available
    if mode == InterviewMode.RESUME and eval_history:
        eval_lines = []
        for e in eval_history:
            score = e.get("score", "?")
            brief = e.get("brief", "")
            phase = e.get("phase", "")
            eval_lines.append(f"- [{phase}] {score}/10 — {brief}")
        scored = [e["score"] for e in eval_history if isinstance(e.get("score"), (int, float))]
        avg = round(sum(scored) / len(scored), 1) if scored else None
        extra += f"\n## 面试过程评分记录\n" + "\n".join(eval_lines) + "\n"
        if avg:
            extra += f"\n平均分: {avg}/10\n"

    prompt = REVIEW_SYSTEM.format(
        mode=mode.value,
        transcript=transcript,
        extra_context=extra,
    )

    llm = get_evaluation_llm()
    response = llm.invoke([
        SystemMessage(content=prompt),
        HumanMessage(content="请生成复盘报告。"),
    ])

    return response.content
