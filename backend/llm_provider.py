from langchain_openai import ChatOpenAI
from llama_index.llms.openai_like import OpenAILike

from backend.config import settings

_embedding_instance = None
_llama_llm_instance = None


def get_langchain_llm():
    """LangChain ChatModel for LangGraph nodes (via OpenAI-compatible proxy)."""
    return ChatOpenAI(
        model=settings.model,
        api_key=settings.api_key,
        base_url=settings.api_base,
        temperature=settings.temperature,
        streaming=True,
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
    """Embedding model (singleton)."""
    global _embedding_instance
    if _embedding_instance is None:
        if settings.embedding_backend_mode() == "api":
            from llama_index.embeddings.openai import OpenAIEmbedding

            model_name = settings.embedding_api_model_name()
            if not model_name:
                raise RuntimeError("EMBEDDING_API_MODEL is required when EMBEDDING_BACKEND=api")

            kwargs = {
                "model_name": model_name,
                "api_key": settings.embedding_api_key,
            }
            if settings.embedding_api_base:
                kwargs["api_base"] = settings.embedding_api_base

            _embedding_instance = OpenAIEmbedding(**kwargs)
        else:
            try:
                from llama_index.embeddings.huggingface import HuggingFaceEmbedding
            except ImportError as exc:
                raise RuntimeError(
                    "Local embeddings require optional dependencies. "
                    "Install `pip install -r requirements.local-embedding.txt` "
                    "and a torch build that matches your environment."
                ) from exc

            model_path = settings.local_embedding_model_path()
            model_name = settings.local_embedding_model_name()

            if model_path is not None:
                _embedding_instance = HuggingFaceEmbedding(model_name=str(model_path))
            elif model_name:
                _embedding_instance = HuggingFaceEmbedding(model_name=model_name)
            else:
                raise RuntimeError(
                    "LOCAL_EMBEDDING_MODEL or LOCAL_EMBEDDING_PATH is required "
                    "when EMBEDDING_BACKEND=local"
                )
    return _embedding_instance
