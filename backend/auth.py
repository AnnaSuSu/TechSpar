"""Authentication — users table, password hashing, JWT, FastAPI dependency."""
import uuid
import sqlite3
import logging
from datetime import datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from backend.config import settings
from backend.preset_topics import ensure_preset_topics

logger = logging.getLogger("uvicorn")

bearer_scheme = HTTPBearer()

JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def _get_conn() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_users_table():
    conn = _get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         TEXT PRIMARY KEY,
            email      TEXT UNIQUE NOT NULL,
            password   TEXT NOT NULL,
            name       TEXT DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def ensure_default_user():
    """Create default user from .env config if not exists."""
    email = settings.default_email.lower().strip()
    conn = _get_conn()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        ensure_preset_topics(existing["id"])
        conn.close()
        return
    uid = uuid.uuid4().hex[:8]
    hashed = _hash_password(settings.default_password)
    conn.execute(
        "INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)",
        (uid, email, hashed, settings.default_name),
    )
    conn.commit()
    conn.close()
    ensure_preset_topics(uid)
    logger.info(f"Default user created: {email}")


def create_user(email: str, password: str, name: str = "") -> dict:
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is disabled")
    uid = uuid.uuid4().hex[:8]
    hashed = _hash_password(password)
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)",
            (uid, email.lower().strip(), hashed, name),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(409, "Email already registered")
    conn.close()
    ensure_preset_topics(uid)
    return {"id": uid, "email": email.lower().strip(), "name": name}


def authenticate_user(email: str, password: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
    ).fetchone()
    conn.close()
    if not row or not _verify_password(password, row["password"]):
        return None
    return {"id": row["id"], "email": row["email"], "name": row["name"]}


def create_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )


def decode_token(token: str) -> str | None:
    """独立的 JWT 解码。返回 user_id 或 None。用于 WebSocket 等非 Depends 场景。"""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        return payload.get("sub") or None
    except JWTError:
        return None


def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — returns user_id string."""
    try:
        payload = jwt.decode(
            cred.credentials, settings.jwt_secret, algorithms=[JWT_ALGORITHM]
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(401, "Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")
