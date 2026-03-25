from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # LLM (OpenAI-compatible proxy)
    api_base: str = ""
    api_key: str = ""
    model: str = ""
    question_model: str = ""
    evaluation_model: str = ""
    reference_answer_model: str = ""
    temperature: float = 0.7
    llm_timeout_seconds: int = 180
    llm_max_retries: int = 1
    evaluation_timeout_seconds: int = 180
    evaluation_max_retries: int = 0
    drill_eval_batch_size: int = 1
    drill_eval_reference_top_k: int = 1
    drill_eval_reference_max_chars: int = 300
    drill_eval_answer_max_chars: int = 800
    drill_eval_use_llm_synthesis: bool = False

    # Embedding — API mode (OpenAI-compatible, e.g. SiliconFlow) or local HuggingFace
    embedding_api_base: str = ""   # set to enable API mode, e.g. https://api.siliconflow.cn/v1
    embedding_api_key: str = ""
    embedding_model: str = "BAAI/bge-m3"

    # DashScope ASR (speech-to-text)
    dashscope_api_key: str = ""

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
    default_user_id: str = "907fa4ab"
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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
