"""Copilot Prep Phase prompts."""

JD_ANALYST_PROMPT = """你是一个 JD（岗位描述）分析师。拆解以下 JD，提取考察维度和技术栈权重。

JD 原文:
{jd_text}

输出严格 JSON:
{{
  "role_title": "岗位名称",
  "seniority": "junior|mid|senior|lead",
  "required_skills": [
    {{"skill": "技术名", "weight": "core|preferred|bonus", "jd_evidence": "JD 中对应原文"}}
  ],
  "likely_question_dimensions": [
    {{"dimension": "考察维度名", "skills": ["相关技术"], "estimated_proportion": 0.3}}
  ],
  "key_phrases": ["JD 中的关键短语"]
}}
只输出 JSON，不要其他内容。"""

FIT_ANALYZER_PROMPT = """你是一个简历-岗位匹配分析师。分析候选人与目标岗位的匹配度。

JD 原文:
{jd_text}

候选人简历摘要:
{resume_context}

候选人画像摘要:
{profile_summary}

输出严格 JSON:
{{
  "overall_fit": 0.72,
  "coach_brief": "2-3句话，像一个教练在面试前跟候选人说的话：最该注意什么、优势在哪能主动引导、最大的风险点是什么。语气直接，不要废话。",
  "highlights": [
    {{"point": "匹配亮点描述", "jd_link": "对应的 JD 要求"}}
  ],
  "gaps": [
    {{"point": "差距描述", "risk": "high|medium|low", "mitigation": "建议应对策略"}}
  ],
  "talking_points": ["面试中主动提及的要点"]
}}
只输出 JSON，不要其他内容。"""

HR_STRATEGY_PROMPT = """你是一位资深技术面试官，正在为 {role_title} 岗位准备面试策略。

## 输入信息

### 公司面试风格
{company_report}

### 岗位要求分析
{jd_analysis}

### 候选人匹配度
{fit_report}

### 候选人画像（弱点 + 掌握度）
{profile_summary}

## 任务

生成一棵 **提问策略树**，模拟 HR 视角的提问路径：

1. 按面试阶段组织（greeting → self_intro → technical → project_deep_dive → behavioral → reverse_qa）
2. 每个节点包含考察维度、3-5 个典型问题、追问方向
3. 根据候选人弱点标注 risk_level: "safe"（候选人强项）| "caution"（一般）| "danger"（弱点区域）
4. trigger_condition 要具体：什么样的回答会引发这个追问
5. recommended_points 给出建议回答要点
6. 树深度最多 3 层（入口 depth=0 → 追问 depth=1 → 深追 depth=2）
7. technical 方向的入口节点数量与 JD 权重成正比
8. 每个考察维度至少包含 2-3 个追问分支

输出严格 JSON:
{{
  "root_nodes": ["节点ID列表，面试入口方向"],
  "nodes": {{
    "节点ID": {{
      "id": "唯一标识，如 tech_01_python_gc",
      "topic": "考察维度",
      "sample_questions": ["典型问题1", "典型问题2", "典型问题3"],
      "intent": "technical|behavioral|project|pressure|greeting",
      "depth": 0,
      "risk_level": "safe|caution|danger",
      "children": ["子节点ID"],
      "trigger_condition": "什么回答会触发这个追问",
      "recommended_points": ["建议回答要点1", "要点2"]
    }}
  }},
  "phase_order": ["greeting", "self_intro", "technical", "project_deep_dive", "behavioral", "reverse_qa"]
}}
只输出 JSON，不要其他内容。节点总数控制在 15-30 个。"""

RISK_ASSESSOR_PROMPT = """你是面试风险评估师。基于候选人画像和提问策略树，标注高危路径并给出应对建议。

### 候选人弱点
{weak_points}

### 候选人 gap（与 JD 的差距）
{gaps}

### 提问策略树中 risk_level 为 danger 或 caution 的节点
{risk_nodes}

为每个高危节点输出应对建议。

输出严格 JSON:
{{
  "risk_summary": "2-3句话总结：面试最危险的1-2个区域是什么，面试官在那里会怎么下手，候选人应该有什么心理预期。直接说重点，不要客套。",
  "risk_map": [
    {{
      "node_id": "节点ID",
      "risk_level": "danger|caution",
      "reason": "为什么这是高危节点",
      "avoidance_strategy": "如何避免或引导话题"
    }}
  ],
  "prep_hints": [
    {{
      "node_id": "节点ID",
      "must_know": ["必须掌握的知识点"],
      "safe_talking_points": ["安全的回答方向"],
      "redirect_suggestion": "答不好时的引导话术"
    }}
  ]
}}
只输出 JSON，不要其他内容。"""
