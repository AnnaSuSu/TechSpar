"""Company Researcher — Tavily 联网搜索公司面试信息。"""
import json
import logging

from langchain_core.messages import SystemMessage, HumanMessage

from backend.config import settings
from backend.llm_provider import get_copilot_llm

logger = logging.getLogger("uvicorn")


async def search_company(company: str, position: str = "") -> str:
    """搜索公司信息并结构化整理。返回 JSON 字符串格式的 company_report。"""
    if not settings.tavily_api_key:
        logger.warning("TAVILY_API_KEY not configured, skipping company search")
        return json.dumps({
            "company_name": company or "未知",
            "tech_stack": [],
            "interview_style": "无法获取（未配置搜索 API）",
            "culture_notes": "",
            "common_focus_areas": [],
            "sources": [],
        }, ensure_ascii=False)

    from tavily import TavilyClient
    client = TavilyClient(api_key=settings.tavily_api_key)

    queries = [
        f"{company} 技术栈 工程文化 技术架构",
        f"{company} {position} 面试经验 面试流程 考察重点",
    ]

    all_results = []
    for q in queries:
        try:
            resp = client.search(query=q, max_results=3, search_depth="basic")
            for r in resp.get("results", []):
                all_results.append({
                    "title": r.get("title", ""),
                    "content": r.get("content", "")[:500],
                    "url": r.get("url", ""),
                })
        except Exception as e:
            logger.warning(f"Tavily search failed for '{q}': {e}")

    if not all_results:
        return json.dumps({
            "company_name": company or "未知",
            "tech_stack": [],
            "interview_style": "搜索未返回结果",
            "culture_notes": "",
            "common_focus_areas": [],
            "sources": [],
        }, ensure_ascii=False)

    llm = get_copilot_llm()
    messages = [
        SystemMessage(content="""你是一个面试情报分析师。根据搜索结果，为候选人整理目标公司的面试情报。
输出严格 JSON 格式：
{
  "company_name": "公司名",
  "main_business": "2-3句话描述公司主营业务和核心产品，要具体，不要泛泛而谈",
  "interviewer_mindset": "基于公司业务和技术方向，面试官最关心什么、倾向于往哪个方向深挖，写成一段话",
  "how_to_reference": "面试中如何主动引用公司业务场景来回答技术问题、让答案更有针对性，给出1-2个具体方向",
  "tech_stack": ["技术1", "技术2"],
  "interview_style": "面试风格描述（轮数、侧重点、难度）",
  "culture_notes": "工程文化特点",
  "common_focus_areas": ["重点考察方向1", "方向2"],
  "sources": ["url1", "url2"]
}
只输出 JSON，不要其他内容。"""),
        HumanMessage(content=f"公司: {company}\n岗位: {position}\n\n搜索结果:\n{json.dumps(all_results, ensure_ascii=False)}"),
    ]
    resp = await llm.ainvoke(messages)
    text = resp.content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()
