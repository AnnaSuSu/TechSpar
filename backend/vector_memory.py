"""向量记忆系统 — 语义检索 + 时间衰减 + 薄弱点语义去重。

设计：
- SQLite BLOB 存 float32 embedding
- numpy cosine similarity 搜索（百级向量，sub-ms）
- profile.json 仍是真相源，向量索引是加速层
"""
import json
import logging
import sqlite3
from datetime import datetime

import numpy as np

from backend.config import settings
from backend.llm_provider import get_embedding

logger = logging.getLogger("uvicorn")

DB_PATH = settings.db_path
SIMILARITY_THRESHOLD = 0.75  # weak point dedup
TIME_DECAY_HALF_LIFE = 14.0  # days
TIME_DECAY_WEIGHT = 0.3      # max 30% score reduction from age


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_memory_table():
    """Create memory_vectors table. Called once at startup."""
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS memory_vectors (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_type  TEXT NOT NULL,
            content     TEXT NOT NULL,
            topic       TEXT,
            session_id  TEXT,
            metadata    TEXT DEFAULT '{}',
            embedding   BLOB NOT NULL,
            user_id     TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_type ON memory_vectors(chunk_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_topic ON memory_vectors(topic)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vectors(user_id)")
    # Migrate: add user_id if missing
    try:
        conn.execute("SELECT user_id FROM memory_vectors LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE memory_vectors ADD COLUMN user_id TEXT")
    conn.commit()
    conn.close()
    logger.info("memory_vectors table ready.")


# ── Embedding helpers ──

def _embed(text: str) -> np.ndarray:
    """Embed text and return a float32 vector."""
    embed_model = get_embedding()
    vec = embed_model.get_text_embedding(text)
    return np.array(vec, dtype=np.float32)


def _serialize(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()


def _deserialize(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def _cosine_similarity(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Vectorized cosine similarity. query_vec: (D,), matrix: (N, D) → (N,)."""
    query_norm = np.linalg.norm(query_vec)
    if query_norm < 1e-10:
        return np.zeros(matrix.shape[0])
    row_norms = np.linalg.norm(matrix, axis=1)
    row_norms = np.clip(row_norms, 1e-10, None)
    return (matrix @ query_vec) / (row_norms * query_norm)


def _time_decay(created_at: str) -> float:
    """Exponential time decay. Returns multiplier in [0.5, 1.0] range."""
    try:
        age = (datetime.now() - datetime.fromisoformat(created_at)).total_seconds() / 86400
    except (ValueError, TypeError):
        return 1.0
    decay = 0.5 ** (max(age, 0) / TIME_DECAY_HALF_LIFE)
    # Blend: score * (weight * decay + (1 - weight))
    return TIME_DECAY_WEIGHT * decay + (1 - TIME_DECAY_WEIGHT)


# ── Write ──

def index_session_memory(
    session_id: str | None,
    topic: str | None,
    summary: str,
    weak_points: list[dict],
    user_id: str,
    strong_points: list[dict] | None = None,
    insight_text: str = "",
):
    """Embed and store memory chunks for a completed session."""
    conn = _get_conn()
    chunks = []

    if summary:
        chunks.append(("session_summary", summary, topic, session_id, "{}"))

    for wp in weak_points:
        point = wp.get("point", wp) if isinstance(wp, dict) else str(wp)
        if point:
            meta = json.dumps({"topic": wp.get("topic", topic) if isinstance(wp, dict) else topic})
            chunks.append(("weak_point", point, wp.get("topic", topic) if isinstance(wp, dict) else topic, session_id, meta))

    if insight_text:
        chunks.append(("insight", insight_text[:2000], topic, session_id, "{}"))

    if not chunks:
        conn.close()
        return

    # Batch embed
    embed_model = get_embedding()
    texts = [c[1] for c in chunks]
    vectors = embed_model.get_text_embedding_batch(texts)

    now = datetime.now().isoformat()
    for (chunk_type, content, t, sid, meta), vec in zip(chunks, vectors):
        blob = _serialize(np.array(vec, dtype=np.float32))
        conn.execute(
            "INSERT INTO memory_vectors (chunk_type, content, topic, session_id, metadata, embedding, user_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (chunk_type, content, t, sid, meta, blob, user_id, now),
        )

    conn.commit()
    conn.close()
    logger.info(f"Indexed {len(chunks)} memory chunks for session {session_id or 'unknown'}.")


# ── Read ──

def search_memory(
    query: str,
    user_id: str,
    chunk_types: list[str] | None = None,
    topic: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    """Semantic search with time decay. Returns [{content, chunk_type, topic, score, created_at}]."""
    conn = _get_conn()

    # Build filter query
    where = ["user_id = ?"]
    params: list = [user_id]
    if chunk_types:
        placeholders = ",".join("?" for _ in chunk_types)
        where.append(f"chunk_type IN ({placeholders})")
        params.extend(chunk_types)
    if topic:
        where.append("topic = ?")
        params.append(topic)

    where_clause = " WHERE " + " AND ".join(where)
    rows = conn.execute(
        f"SELECT id, chunk_type, content, topic, session_id, embedding, created_at FROM memory_vectors{where_clause}",
        params,
    ).fetchall()
    conn.close()

    if not rows:
        return []

    # Embed query
    query_vec = _embed(query)

    # Build matrix and compute similarities
    embeddings = np.stack([_deserialize(r["embedding"]) for r in rows])
    similarities = _cosine_similarity(query_vec, embeddings)

    # Apply time decay
    results = []
    for i, row in enumerate(rows):
        decay = _time_decay(row["created_at"])
        score = float(similarities[i]) * decay
        results.append({
            "content": row["content"],
            "chunk_type": row["chunk_type"],
            "topic": row["topic"],
            "session_id": row["session_id"],
            "score": score,
            "created_at": row["created_at"],
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


def find_similar_weak_point(
    new_point: str,
    existing_points: list[dict],
    user_id: str,
    threshold: float = SIMILARITY_THRESHOLD,
) -> int | None:
    """Find index of most similar existing weak point via embedding similarity.
    Returns index into existing_points, or None if no match above threshold."""
    if not existing_points:
        return None

    conn = _get_conn()
    rows = conn.execute(
        "SELECT content, embedding FROM memory_vectors WHERE chunk_type = 'weak_point' AND user_id = ?",
        (user_id,),
    ).fetchall()
    conn.close()

    # Build lookup: content → embedding
    cached = {}
    for r in rows:
        cached[r["content"]] = _deserialize(r["embedding"])

    # Embed the new point
    new_vec = _embed(new_point)

    # Compare against each existing profile weak point
    best_idx = None
    best_score = -1.0

    points_to_embed = []
    points_indices = []

    for i, wp in enumerate(existing_points):
        point_text = wp.get("point", "") if isinstance(wp, dict) else str(wp)
        if not point_text:
            continue
        if point_text in cached:
            sim = float(_cosine_similarity(new_vec, cached[point_text].reshape(1, -1))[0])
            if sim > best_score:
                best_score = sim
                best_idx = i
        else:
            points_to_embed.append(point_text)
            points_indices.append(i)

    # Embed any uncached points
    if points_to_embed:
        embed_model = get_embedding()
        vecs = embed_model.get_text_embedding_batch(points_to_embed)
        for text, vec, idx in zip(points_to_embed, vecs, points_indices):
            vec_np = np.array(vec, dtype=np.float32)
            sim = float(_cosine_similarity(new_vec, vec_np.reshape(1, -1))[0])
            if sim > best_score:
                best_score = sim
                best_idx = idx

    if best_score >= threshold:
        return best_idx
    return None


# ── Maintenance ──

def rebuild_index_from_profile(user_id: str):
    """Rebuild weak_point vectors from current profile.json."""
    from backend.memory import _load_profile

    conn = _get_conn()
    conn.execute("DELETE FROM memory_vectors WHERE chunk_type = 'weak_point' AND user_id = ?", (user_id,))
    conn.commit()

    profile = _load_profile(user_id)
    weak_points = profile.get("weak_points", [])

    if not weak_points:
        conn.close()
        return

    embed_model = get_embedding()
    texts = [wp["point"] for wp in weak_points if wp.get("point")]
    if not texts:
        conn.close()
        return

    vectors = embed_model.get_text_embedding_batch(texts)
    now = datetime.now().isoformat()

    for text, vec, wp in zip(texts, vectors, weak_points):
        blob = _serialize(np.array(vec, dtype=np.float32))
        meta = json.dumps({"topic": wp.get("topic", ""), "times_seen": wp.get("times_seen", 1)})
        conn.execute(
            "INSERT INTO memory_vectors (chunk_type, content, topic, metadata, embedding, user_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("weak_point", text, wp.get("topic"), meta, blob, user_id, wp.get("first_seen", now)),
        )

    conn.commit()
    conn.close()
    logger.info(f"Rebuilt {len(texts)} weak_point vectors for user {user_id}.")
