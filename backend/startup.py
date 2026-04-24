"""Application startup hooks."""

import logging

from backend.auth import ensure_default_user, init_users_table
from backend.config import settings
from backend.indexer import _init_llama_settings
from backend.llm_provider import get_embedding
from backend.storage import copilot_preps as prep_store
from backend.storage.sessions import reset_stale_reviewing
from backend.vector_memory import init_memory_table

logger = logging.getLogger("uvicorn")


def preload_models():
    """Initialize shared backends and tables on startup."""
    logger.info(
        "Initializing embedding backend=%s target=%s",
        settings.embedding_backend_mode(),
        settings.active_embedding_target(),
    )
    get_embedding()
    _init_llama_settings()
    logger.info("Embedding backend ready.")

    init_memory_table()
    init_users_table()
    ensure_default_user()
    prep_store.reset_stale_running()
    recovered = reset_stale_reviewing()
    if recovered:
        logger.info("Recovered %s stuck reviewing sessions to review_failed.", recovered)
    logger.info("Database tables initialized.")
