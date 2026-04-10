from pathlib import Path
from pydantic_settings import BaseSettings


DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3"


class Settings(BaseSettings):
    # LLM (OpenAI-compatible proxy)
    api_base: str = ""
    api_key: str = ""
    model: str = ""
    temperature: float = 0.7

    # Embedding — explicit backend + separate config for API/local modes
    embedding_backend: str = ""  # api | local; empty keeps legacy inference
    embedding_api_base: str = ""
    embedding_api_key: str = ""
    embedding_api_model: str = ""
    local_embedding_model: str = ""
    local_embedding_path: str = ""
    embedding_model: str = ""  # deprecated fallback for EMBEDDING_MODEL

    # DashScope ASR (speech-to-text, batch transcription)
    dashscope_api_key: str = ""

    # Copilot — 独立 LLM 配置（可选，不填则 fallback 到主 LLM）
    copilot_api_base: str = ""
    copilot_api_key: str = ""
    copilot_model: str = ""
    copilot_temperature: float = 0.3  # Copilot 场景偏确定性

    # Copilot — 阿里云 NLS 实时语音识别
    nls_url: str = "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1"
    nls_appkey: str = ""
    nls_access_key_id: str = ""
    nls_access_key_secret: str = ""

    # Copilot — 腾讯云 VPR 声纹识别（可选，未配置时自动回退手动按钮模式）
    # 允许在用户 settings.json 中覆盖，此处为全局兜底
    tencent_secret_id: str = ""
    tencent_secret_key: str = ""
    tencent_vpr_app_id: str = ""

    # Copilot — Tavily Web Search
    tavily_api_key: str = ""

    # Qiniu OSS (for uploading audio to get public URL)
    qiniu_access_key: str = ""
    qiniu_secret_key: str = ""
    qiniu_bucket: str = ""
    qiniu_domain: str = ""

    # Paths
    base_dir: Path = Path(__file__).resolve().parent.parent
    resume_path: Path = Path(__file__).resolve().parent.parent / "data" / "resume"
    knowledge_path: Path = Path(__file__).resolve().parent.parent / "data" / "knowledge"
    high_freq_path: Path = Path(__file__).resolve().parent.parent / "data" / "high_freq"
    db_path: Path = Path(__file__).resolve().parent.parent / "data" / "interviews.db"

    # Auth
    jwt_secret: str = "change-me-in-production"
    default_email: str = "admin@techspar.local"
    default_password: str = "admin123"
    default_name: str = "Admin"
    allow_registration: bool = False

    # Interview settings
    max_questions_per_phase: int = 5
    max_drill_questions: int = 15

    def user_data_dir(self, user_id: str) -> Path:
        return self.base_dir / "data" / "users" / user_id

    def user_profile_dir(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "profile"

    def user_resume_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "resume"

    def user_knowledge_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "knowledge"

    def user_high_freq_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "high_freq"

    def user_topics_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "topics.json"

    def user_index_cache_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / ".index_cache"

    def user_settings_path(self, user_id: str) -> Path:
        return self.user_data_dir(user_id) / "settings.json"

    def embedding_backend_mode(self) -> str:
        if self.embedding_backend:
            backend = self.embedding_backend.strip().lower()
            if backend in {"api", "local"}:
                return backend
            raise ValueError("EMBEDDING_BACKEND must be 'api' or 'local'")
        if self.embedding_api_base or self.embedding_api_key:
            return "api"
        return "local"

    def embedding_api_model_name(self) -> str:
        return self.embedding_api_model or self.embedding_model or DEFAULT_EMBEDDING_MODEL

    def local_embedding_model_name(self) -> str:
        return self.local_embedding_model or self.embedding_model or DEFAULT_EMBEDDING_MODEL

    def local_embedding_model_path(self) -> Path | None:
        if self.local_embedding_path:
            return Path(self.local_embedding_path).expanduser()

        bundled_path = self.base_dir / "data" / "models" / "bge-m3"
        if self.local_embedding_model_name() == DEFAULT_EMBEDDING_MODEL and bundled_path.exists():
            return bundled_path
        return None

    def active_embedding_target(self) -> str:
        if self.embedding_backend_mode() == "api":
            return self.embedding_api_model_name()

        model_path = self.local_embedding_model_path()
        if model_path is not None:
            return str(model_path)
        return self.local_embedding_model_name()

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
