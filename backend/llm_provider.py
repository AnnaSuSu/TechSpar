from langchain_openai import ChatOpenAI
from llama_index.llms.openai_like import OpenAILike

from backend.config import settings

_embedding_instance = None
_llama_llm_instance = None


def _pick_model(*candidates: str | None) -> str:
    for candidate in candidates:
        if candidate and candidate.strip():
            return candidate.strip()
    return settings.model


def _pick_number(*candidates):
    for candidate in candidates:
        if candidate is None:
            continue
        return candidate
    return None


def get_langchain_llm(
    model: str | None = None,
    timeout: int | None = None,
    max_retries: int | None = None,
):
    """LangChain ChatModel for LangGraph nodes (via OpenAI-compatible proxy)."""
    return ChatOpenAI(
        model=_pick_model(model, settings.model),
        api_key=settings.api_key,
        base_url=settings.api_base,
        temperature=settings.temperature,
        timeout=_pick_number(timeout, settings.llm_timeout_seconds),
        max_retries=_pick_number(max_retries, settings.llm_max_retries),
    )


def get_question_generation_llm():
    """LLM used for drill question generation."""
    return get_langchain_llm(model=_pick_model(settings.question_model, settings.model))


def get_evaluation_llm():
    """LLM used for scoring / review generation."""
    return get_langchain_llm(
        model=_pick_model(settings.evaluation_model, settings.model),
        timeout=settings.evaluation_timeout_seconds,
        max_retries=settings.evaluation_max_retries,
    )


def get_reference_answer_llm():
    """LLM used for reference answer generation."""
    return get_langchain_llm(
        model=_pick_model(
            settings.reference_answer_model,
            settings.evaluation_model,
            settings.model,
        )
    )


def get_llama_llm():
    """LlamaIndex LLM (singleton)."""
    global _llama_llm_instance
    if _llama_llm_instance is None:
        _llama_llm_instance = OpenAILike(
            model=settings.model,
            api_key=settings.api_key,
            api_base=settings.api_base,
            temperature=settings.temperature,
            is_chat_model=True,
        )
    return _llama_llm_instance


def get_embedding():
    """Embedding model (singleton). API mode if embedding_api_base is set, else local HuggingFace."""
    global _embedding_instance
    if _embedding_instance is None:
        if settings.embedding_api_base:
            from llama_index.embeddings.openai import OpenAIEmbedding
            _embedding_instance = OpenAIEmbedding(
                model_name=settings.embedding_model,
                api_base=settings.embedding_api_base,
                api_key=settings.embedding_api_key,
            )
        else:
            from llama_index.embeddings.huggingface import HuggingFaceEmbedding
            local_path = settings.base_dir / "data" / "models" / "bge-m3"
            if local_path.exists():
                _embedding_instance = HuggingFaceEmbedding(model_name=str(local_path))
            else:
                _embedding_instance = HuggingFaceEmbedding(model_name=settings.embedding_model)
    return _embedding_instance
