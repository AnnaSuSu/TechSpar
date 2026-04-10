"""Data models — LangGraph states (TypedDict) + API models (Pydantic)."""
from __future__ import annotations

from enum import Enum
from typing import Annotated, TypedDict
from pydantic import BaseModel, Field
from langgraph.graph import add_messages


# ── Enums ──

class InterviewMode(str, Enum):
    RESUME = "resume"
    TOPIC_DRILL = "topic_drill"
    JD_PREP = "jd_prep"
    RECORDING = "recording"


class InterviewPhase(str, Enum):
    GREETING = "greeting"
    SELF_INTRO = "self_intro"
    TECHNICAL = "technical"
    PROJECT_DEEP_DIVE = "project_deep_dive"
    REVERSE_QA = "reverse_qa"
    END = "end"


# ── LangGraph States (TypedDict for max compatibility) ──

class ResumeInterviewState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    phase: str           # InterviewPhase value
    resume_context: str
    questions_asked: list[str]
    phase_question_count: int
    is_finished: bool
    last_eval: dict          # Latest inline eval from interviewer {score, should_advance, brief}
    eval_history: list       # All evals accumulated across the interview


class TopicDrillState(TypedDict, total=False):
    messages: Annotated[list, add_messages]
    topic: str
    topic_name: str
    knowledge_context: str
    difficulty: int
    questions_asked: list[str]
    scores: list[dict]
    weak_points: list[str]
    total_questions: int
    is_finished: bool


# ── API Models (Pydantic) ──

class StartInterviewRequest(BaseModel):
    mode: InterviewMode
    topic: str | None = None
    num_questions: int | None = None
    divergence: int | None = None


class JobPrepPreviewRequest(BaseModel):
    jd_text: str
    company: str | None = None
    position: str | None = None
    use_resume: bool = True


class JobPrepStartRequest(JobPrepPreviewRequest):
    preview_data: dict | None = None


class ChatRequest(BaseModel):
    session_id: str
    message: str


class EndDrillRequest(BaseModel):
    answers: list[dict] = Field(default_factory=list)  # [{question_id: int, answer: str}]


class RecordingAnalyzeRequest(BaseModel):
    transcript: str
    recording_mode: str = "dual"  # "dual" | "solo"
    company: str | None = None
    position: str | None = None


# ── Auth Models ──

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


# ── Copilot Models ──

class StrategyNode(TypedDict, total=False):
    id: str                     # "tech_01_python_gc"
    topic: str                  # 考察维度
    sample_questions: list[str] # 典型问题
    intent: str                 # "technical" | "behavioral" | "project" | "pressure"
    depth: int                  # 追问深度 0=入口, 1=追问, 2=深追
    risk_level: str             # "safe" | "caution" | "danger"
    children: list[str]         # 子节点 ID
    trigger_condition: str      # 触发追问的回答特征
    recommended_points: list[str]  # 建议回答要点


class StrategyTree(TypedDict, total=False):
    root_nodes: list[str]
    nodes: dict[str, StrategyNode]
    phase_order: list[str]


class CopilotPrepState(TypedDict, total=False):
    user_id: str
    jd_text: str
    resume_context: str
    profile: dict

    # Layer 0: 并行 Analyst 产出
    company_report: str
    jd_analysis: dict
    fit_report: dict

    # Layer 1: HR Strategy Simulator
    question_strategy_tree: StrategyTree

    # Layer 2: Risk Assessor
    risk_map: list[dict]
    prep_hints: list[dict]

    # Prep 状态追踪
    status: str              # "running" | "done" | "error"
    progress: str            # 当前进度描述
    error: str


class CopilotPrepRequest(BaseModel):
    jd_text: str
    company: str | None = None
    position: str | None = None


# ── Settings Models ──

class UserSettings(BaseModel):
    """Per-user training preferences."""
    num_questions: int = Field(default=10, ge=5, le=20)
    divergence: int = Field(default=3, ge=1, le=5)


class LLMSettings(BaseModel):
    """Global LLM provider configuration."""
    api_base: str = ""
    api_key: str = ""
    model: str = ""
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


class SettingsResponse(BaseModel):
    """Combined response for GET/PUT /settings."""
    llm: LLMSettings
    training: UserSettings


class VoiceprintCredentials(BaseModel):
    """腾讯云 VPR 凭据（per-user）。"""
    secret_id: str
    secret_key: str
    app_id: str = ""
