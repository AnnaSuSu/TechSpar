"""用户声纹配置的 per-user JSON 持久化。

文件路径：data/users/{user_id}/voiceprint.json

结构：
{
  "credentials": { "secret_id": "...", "secret_key": "...", "app_id": "" },
  "enrollment":  { "voice_print_id": "...", "speaker_nick": "...", "enrolled_at": "..." }
}

两部分都是可选的：
- 没有 credentials → 声纹功能未启用，UI 回退到手动按钮
- 有 credentials 但没有 enrollment → 用户已配好凭据，但还没录声纹
- 两个都有 → 完全启用，实时管线自动识别 role
"""
from __future__ import annotations

import json
from typing import Any

from backend.config import settings
from backend.copilot.voiceprint import VoiceprintClient


def _voiceprint_file(user_id: str):
    return settings.user_data_dir(user_id) / "voiceprint.json"


def load(user_id: str) -> dict[str, Any]:
    path = _voiceprint_file(user_id)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except (json.JSONDecodeError, OSError):
        return {}


def save(user_id: str, data: dict[str, Any]) -> None:
    path = _voiceprint_file(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def delete(user_id: str) -> None:
    path = _voiceprint_file(user_id)
    if path.exists():
        path.unlink()


def get_client(user_id: str) -> VoiceprintClient | None:
    """从用户配置构造 VoiceprintClient。未配置或凭据不全返回 None。"""
    data = load(user_id)
    creds = (data or {}).get("credentials") or {}
    secret_id = creds.get("secret_id") or ""
    secret_key = creds.get("secret_key") or ""
    if not secret_id or not secret_key:
        return None
    return VoiceprintClient(
        secret_id=secret_id,
        secret_key=secret_key,
        app_id=creds.get("app_id") or "",
    )


def get_voice_print_id(user_id: str) -> str | None:
    """读取用户已注册的 VoicePrintId（未注册返回 None）。"""
    data = load(user_id)
    enrollment = (data or {}).get("enrollment") or {}
    return enrollment.get("voice_print_id") or None


def status_summary(user_id: str) -> dict[str, Any]:
    """给 GET /api/voiceprint/status 用的状态摘要。"""
    data = load(user_id)
    creds = (data or {}).get("credentials") or {}
    enrollment = (data or {}).get("enrollment") or {}
    return {
        "configured": bool(creds.get("secret_id") and creds.get("secret_key")),
        "enrolled": bool(enrollment.get("voice_print_id")),
        "enrolled_at": enrollment.get("enrolled_at"),
        "speaker_nick": enrollment.get("speaker_nick"),
    }
