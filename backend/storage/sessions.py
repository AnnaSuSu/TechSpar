"""面试记录持久化 (SQLite)."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from backend.config import settings

DB_PATH = settings.db_path

# Session lifecycle states — explicit replacement for the old
# "review IS NULL vs NOT NULL" binary.
STATUS_ONGOING = "ongoing"          # user still answering
STATUS_ENDED = "ended"              # user ended interview, review not started / pending
STATUS_REVIEWING = "reviewing"      # review generation in-flight
STATUS_REVIEWED = "reviewed"        # review persisted
STATUS_REVIEW_FAILED = "review_failed"  # review attempt failed; user may retry


def _get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            mode TEXT NOT NULL,
            topic TEXT,
            meta TEXT DEFAULT '{}',
            questions TEXT DEFAULT '[]',
            transcript TEXT DEFAULT '[]',
            scores TEXT DEFAULT '[]',
            weak_points TEXT DEFAULT '[]',
            overall TEXT DEFAULT '{}',
            reference_answers TEXT DEFAULT '{}',
            review TEXT,
            status TEXT DEFAULT 'ongoing',
            review_error TEXT,
            user_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Migrate: add columns if missing (existing DBs)
    for col, default in [
        ("questions", "'[]'"),
        ("overall", "'{}'"),
        ("user_id", "NULL"),
        ("meta", "'{}'"),
        ("reference_answers", "'{}'"),
        ("status", "'ongoing'"),
        ("review_error", "NULL"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} TEXT DEFAULT {default}")
            # Backfill status for legacy rows: existing review → reviewed, else ended.
            # Ongoing sessions from before this migration can't be distinguished from
            # abandoned-before-review ones; treating them as ended keeps them visible
            # in history and enables the retry-review path.
            if col == "status":
                conn.execute(
                    "UPDATE sessions SET status = CASE "
                    "WHEN review IS NOT NULL AND review != '' THEN 'reviewed' "
                    "ELSE 'ended' END"
                )
    conn.commit()
    return conn


def create_session(session_id: str, mode: str, topic: str | None = None,
                   questions: list | None = None, meta: dict | None = None, *, user_id: str):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO sessions (session_id, mode, topic, meta, questions, status, user_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            session_id,
            mode,
            topic,
            json.dumps(meta or {}, ensure_ascii=False),
            json.dumps(questions or [], ensure_ascii=False),
            STATUS_ONGOING,
            user_id,
        ),
    )
    conn.commit()
    conn.close()


def update_session_status(session_id: str, status: str, *, user_id: str,
                          review_error: str | None = None, clear_error: bool = False) -> bool:
    """Transition a session's lifecycle state. Returns False if not found."""
    conn = _get_conn()
    if clear_error:
        cursor = conn.execute(
            "UPDATE sessions SET status = ?, review_error = NULL, updated_at = CURRENT_TIMESTAMP "
            "WHERE session_id = ? AND user_id = ?",
            (status, session_id, user_id),
        )
    elif review_error is not None:
        cursor = conn.execute(
            "UPDATE sessions SET status = ?, review_error = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE session_id = ? AND user_id = ?",
            (status, review_error, session_id, user_id),
        )
    else:
        cursor = conn.execute(
            "UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP "
            "WHERE session_id = ? AND user_id = ?",
            (status, session_id, user_id),
        )
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def reset_stale_reviewing() -> int:
    """Flip any reviewing-state sessions to review_failed on startup. Returns count."""
    conn = _get_conn()
    cursor = conn.execute(
        "UPDATE sessions SET status = ?, review_error = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE status = ?",
        (STATUS_REVIEW_FAILED, "服务重启导致复盘中断，请重新生成", STATUS_REVIEWING),
    )
    conn.commit()
    conn.close()
    return cursor.rowcount


def append_message(session_id: str, role: str, content: str, *, user_id: str):
    conn = _get_conn()
    row = conn.execute(
        "SELECT transcript FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return
    transcript = json.loads(row["transcript"])
    transcript.append({"role": role, "content": content, "time": datetime.now().isoformat()})
    conn.execute(
        "UPDATE sessions SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ?",
        (json.dumps(transcript, ensure_ascii=False), session_id, user_id),
    )
    conn.commit()
    conn.close()


def save_drill_answers(session_id: str, answers: list[dict], *, user_id: str):
    """Save drill answers into transcript as Q&A pairs."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT questions FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return
    questions = json.loads(row["questions"])
    answer_map = {a["question_id"]: a["answer"] for a in answers}

    transcript = []
    for q in questions:
        transcript.append({"role": "assistant", "content": q["question"], "time": datetime.now().isoformat()})
        answer = answer_map.get(q["id"], "")
        if answer:
            transcript.append({"role": "user", "content": answer, "time": datetime.now().isoformat()})

    conn.execute(
        "UPDATE sessions SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND user_id = ?",
        (json.dumps(transcript, ensure_ascii=False), session_id, user_id),
    )
    conn.commit()
    conn.close()


def save_review(session_id: str, review: str, scores: list = None,
                weak_points: list = None, overall: dict = None, *, user_id: str):
    conn = _get_conn()
    conn.execute(
        "UPDATE sessions SET review = ?, scores = ?, weak_points = ?, overall = ?, "
        "status = ?, review_error = NULL, updated_at = CURRENT_TIMESTAMP "
        "WHERE session_id = ? AND user_id = ?",
        (review, json.dumps(scores or [], ensure_ascii=False),
         json.dumps(weak_points or [], ensure_ascii=False),
         json.dumps(overall or {}, ensure_ascii=False),
         STATUS_REVIEWED,
         session_id, user_id),
    )
    conn.commit()
    conn.close()


def get_session(session_id: str, *, user_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    conn.close()
    if not row:
        return None
    result = dict(row)
    result["transcript"] = json.loads(result["transcript"])
    result["meta"] = json.loads(result.get("meta", "{}") or "{}")
    result["questions"] = json.loads(result.get("questions", "[]"))
    result["scores"] = json.loads(result["scores"])
    result["weak_points"] = json.loads(result["weak_points"])
    result["overall"] = json.loads(result.get("overall", "{}") or "{}")
    result["reference_answers"] = json.loads(result.get("reference_answers", "{}") or "{}")
    result["status"] = result.get("status") or STATUS_ENDED
    return result


def save_reference_answer(session_id: str, question_id, answer: str, *, user_id: str) -> bool:
    """Persist a generated reference answer keyed by question_id. Returns False if session not found."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT reference_answers FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if not row:
        conn.close()
        return False
    refs = json.loads(row["reference_answers"] or "{}")
    refs[str(question_id)] = answer
    conn.execute(
        "UPDATE sessions SET reference_answers = ?, updated_at = CURRENT_TIMESTAMP "
        "WHERE session_id = ? AND user_id = ?",
        (json.dumps(refs, ensure_ascii=False), session_id, user_id),
    )
    conn.commit()
    conn.close()
    return True


def list_sessions_by_topic(topic: str, *, user_id: str, limit: int = 50) -> list[dict]:
    """Get reviewed sessions for a topic (used by profile/retrospective; only reviewed data is meaningful)."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT session_id, mode, topic, review, scores, weak_points, overall, created_at FROM sessions "
        "WHERE topic = ? AND user_id = ? AND status = ? ORDER BY created_at ASC LIMIT ?",
        (topic, user_id, STATUS_REVIEWED, limit),
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        results.append({
            "session_id": r["session_id"],
            "mode": r["mode"],
            "topic": r["topic"],
            "review": r["review"],
            "scores": json.loads(r["scores"]) if r["scores"] else [],
            "weak_points": json.loads(r["weak_points"]) if r["weak_points"] else [],
            "overall": json.loads(r["overall"] or "{}"),
            "created_at": r["created_at"],
        })
    return results


def list_sessions(
    *, user_id: str,
    limit: int = 20,
    offset: int = 0,
    mode: str | None = None,
    topic: str | None = None,
) -> dict:
    conn = _get_conn()

    # Hide brand-new ongoing sessions with no transcript — those are usually
    # abandoned entries from the start-interview flow. Keep ongoing ones with
    # content so users can resume them.
    where = [
        "user_id = ?",
        "(status != 'ongoing' OR transcript != '[]')",
    ]
    params: list = [user_id]
    if mode:
        where.append("mode = ?")
        params.append(mode)
    if topic:
        where.append("topic = ?")
        params.append(topic)
    where_sql = " AND ".join(where)

    total = conn.execute(
        f"SELECT COUNT(*) FROM sessions WHERE {where_sql}", params,
    ).fetchone()[0]

    rows = conn.execute(
        f"SELECT session_id, mode, topic, meta, created_at, overall, status, review_error "
        f"FROM sessions WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        params + [limit, offset],
    ).fetchall()
    conn.close()

    items = []
    for r in rows:
        overall = json.loads(r["overall"] or "{}")
        meta = json.loads(r["meta"] or "{}")
        items.append({
            "session_id": r["session_id"],
            "mode": r["mode"],
            "topic": r["topic"],
            "meta": meta,
            "created_at": r["created_at"],
            "avg_score": overall.get("avg_score"),
            "status": r["status"] or STATUS_ENDED,
            "review_error": r["review_error"],
        })
    return {"items": items, "total": total}


def delete_session(session_id: str, *, user_id: str) -> bool:
    conn = _get_conn()
    cursor = conn.execute(
        "DELETE FROM sessions WHERE session_id = ? AND user_id = ?",
        (session_id, user_id),
    )
    conn.commit()
    conn.close()
    return cursor.rowcount > 0


def list_distinct_topics(*, user_id: str) -> list[str]:
    """Topics that have at least one reviewed session — used to populate the filter dropdown."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT DISTINCT topic FROM sessions "
        "WHERE topic IS NOT NULL AND status = ? AND user_id = ? ORDER BY topic",
        (STATUS_REVIEWED, user_id),
    ).fetchall()
    conn.close()
    return [r["topic"] for r in rows]
