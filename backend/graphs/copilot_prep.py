"""Copilot Prep Phase — LangGraph 多 Agent 预处理流水线。

拓扑: fan-out(Company Researcher, JD Analyst, Fit Analyzer) → fan-in
      → HR Strategy Simulator → Risk Assessor → END
"""
import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from backend.config import settings
from backend.indexer import query_resume
from backend.llm_provider import get_copilot_llm
from backend.memory import get_profile, get_profile_summary
from backend.copilot.company_search import search_company
from backend.copilot.prompts import (
    JD_ANALYST_PROMPT,
    FIT_ANALYZER_PROMPT,
    HR_STRATEGY_PROMPT,
    RISK_ASSESSOR_PROMPT,
)
from backend.copilot.strategy_tree import parse_strategy_tree

logger = logging.getLogger("uvicorn")


def _has_resume(user_id: str) -> bool:
    resume_dir = settings.user_resume_path(user_id)
    return resume_dir.exists() and any(
        f.suffix.lower() == ".pdf" for f in resume_dir.iterdir() if f.is_file()
    )


async def _run_company_researcher(company: str, position: str) -> str:
    """Agent 1: 搜索公司信息。"""
    return await search_company(company, position)


async def _run_jd_analyst(jd_text: str) -> dict:
    """Agent 2: 拆解 JD。"""
    llm = get_copilot_llm()
    prompt = JD_ANALYST_PROMPT.format(jd_text=jd_text[:6000])
    resp = await llm.ainvoke([
        SystemMessage(content="你是 JD 分析引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])
    try:
        return json.loads(_strip_markdown(resp.content))
    except json.JSONDecodeError:
        logger.error(f"JD analysis parse failed: {resp.content[:300]}")
        return {"role_title": "", "required_skills": [], "likely_question_dimensions": []}


async def _run_fit_analyzer(jd_text: str, user_id: str) -> dict:
    """Agent 3: 简历-JD 匹配分析。"""
    resume_context = "未上传简历"
    if _has_resume(user_id):
        try:
            resume_context = str(query_resume(
                "总结候选人的项目经历、技术栈、AI/后端/工程化相关实践",
                user_id, top_k=4,
            ))[:5000]
        except Exception as e:
            logger.warning(f"Resume query failed: {e}")
            resume_context = "简历检索失败"

    profile_summary = get_profile_summary(user_id)
    llm = get_copilot_llm()
    prompt = FIT_ANALYZER_PROMPT.format(
        jd_text=jd_text[:6000],
        resume_context=resume_context,
        profile_summary=profile_summary,
    )
    resp = await llm.ainvoke([
        SystemMessage(content="你是匹配分析引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])
    try:
        return json.loads(_strip_markdown(resp.content))
    except json.JSONDecodeError:
        logger.error(f"Fit analysis parse failed: {resp.content[:300]}")
        return {"overall_fit": 0, "highlights": [], "gaps": [], "talking_points": []}


async def _run_hr_strategy(
    company_report: str,
    jd_analysis: dict,
    fit_report: dict,
    user_id: str,
) -> dict:
    """Agent 4: 生成提问策略树。"""
    jd_analysis_str = json.dumps(jd_analysis, ensure_ascii=False, indent=2)
    fit_report_str = json.dumps(fit_report, ensure_ascii=False, indent=2)
    profile_summary = get_profile_summary(user_id)

    role_title = jd_analysis.get("role_title", "技术岗位")

    llm = get_copilot_llm()
    prompt = HR_STRATEGY_PROMPT.format(
        role_title=role_title,
        company_report=company_report[:3000],
        jd_analysis=jd_analysis_str[:3000],
        fit_report=fit_report_str[:3000],
        profile_summary=profile_summary[:3000],
    )
    resp = await llm.ainvoke([
        SystemMessage(content="你是面试策略引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])
    return parse_strategy_tree(resp.content)


async def _run_risk_assessor(
    strategy_tree: dict,
    profile: dict,
    fit_report: dict,
) -> tuple[list[dict], list[dict]]:
    """Agent 5: 风险评估。"""
    nodes = strategy_tree.get("nodes", {})
    risk_nodes = [
        {"node_id": nid, "topic": n.get("topic", ""), "risk_level": n.get("risk_level", "safe")}
        for nid, n in nodes.items()
        if n.get("risk_level") in ("danger", "caution")
    ]

    if not risk_nodes:
        return [], []

    weak_points = profile.get("weak_points", [])
    weak_text = json.dumps(weak_points[:10], ensure_ascii=False)
    gaps = fit_report.get("gaps", []) if isinstance(fit_report, dict) else []
    gaps_text = json.dumps(gaps[:10], ensure_ascii=False)
    risk_text = json.dumps(risk_nodes, ensure_ascii=False)

    llm = get_copilot_llm()
    prompt = RISK_ASSESSOR_PROMPT.format(
        weak_points=weak_text,
        gaps=gaps_text,
        risk_nodes=risk_text,
    )
    resp = await llm.ainvoke([
        SystemMessage(content="你是风险评估引擎。只返回 JSON。"),
        HumanMessage(content=prompt),
    ])
    try:
        result = json.loads(_strip_markdown(resp.content))
        return result.get("risk_map", []), result.get("prep_hints", []), result.get("risk_summary", "")
    except json.JSONDecodeError:
        logger.error(f"Risk assessment parse failed: {resp.content[:300]}")
        return [], [], ""


async def run_copilot_prep(
    jd_text: str,
    user_id: str,
    company: str = "",
    position: str = "",
    on_progress=None,
) -> dict:
    """执行完整的 Copilot Prep Pipeline。

    Args:
        on_progress: async callback(progress_text) for status updates
    Returns:
        CopilotPrepState dict
    """
    import asyncio

    profile = get_profile(user_id)

    # Layer 0: 三个 Analyst 并行
    if on_progress:
        await on_progress("正在并行分析公司信息、岗位要求和简历匹配度...")

    company_task = asyncio.create_task(_run_company_researcher(company, position))
    jd_task = asyncio.create_task(_run_jd_analyst(jd_text))
    fit_task = asyncio.create_task(_run_fit_analyzer(jd_text, user_id))

    company_report, jd_analysis, fit_report = await asyncio.gather(
        company_task, jd_task, fit_task,
    )

    # Layer 1: HR Strategy Simulator
    if on_progress:
        await on_progress("正在生成 HR 提问策略树...")

    strategy_tree = await _run_hr_strategy(
        company_report, jd_analysis, fit_report, user_id,
    )

    # Layer 2: Risk Assessor
    if on_progress:
        await on_progress("正在评估风险路径...")

    risk_map, prep_hints, risk_summary = await _run_risk_assessor(strategy_tree, profile, fit_report)

    # 获取简历上下文用于存储
    resume_context = ""
    if _has_resume(user_id):
        try:
            resume_context = str(query_resume(
                "候选人基本信息和核心经历", user_id, top_k=2,
            ))[:2000]
        except Exception:
            pass

    return {
        "user_id": user_id,
        "jd_text": jd_text,
        "resume_context": resume_context,
        "profile": profile,
        "company_report": company_report,
        "jd_analysis": jd_analysis,
        "fit_report": fit_report,
        "question_strategy_tree": strategy_tree,
        "risk_map": risk_map,
        "risk_summary": risk_summary,
        "prep_hints": prep_hints,
        "status": "done",
        "progress": "准备完成",
        "error": "",
    }


def _strip_markdown(text: str) -> str:
    """Strip markdown code fences from LLM output."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[:-3]
    return t.strip()
