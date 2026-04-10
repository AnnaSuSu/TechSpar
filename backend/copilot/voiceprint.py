"""腾讯云 VPR (Voice Print Recognition) 客户端封装。

通过 tencentcloud-sdk-python-common 的 CommonClient 调用，避免引入 asr 专用 SDK。
接口文档：https://cloud.tencent.com/document/api/1093

设计约束：
- 异步对外；底层 Tencent SDK 是同步的，用 asyncio.to_thread 包装
- 未配置凭据时所有方法直接返回失败，由调用方决定是否降级
- PCM 16kHz mono 输入会被包成 WAV 再发送，减少与 Tencent 格式枚举的耦合
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import struct
from dataclasses import dataclass

logger = logging.getLogger("uvicorn")

# Tencent VPR 通用参数
_PRODUCT = "asr"
_API_VERSION = "2019-06-14"
_REGION = "ap-shanghai"
_ENDPOINT = "asr.tencentcloudapi.com"

# 音频格式枚举（腾讯云 VPR）：0=wav, 1=mp3, 2=m4a（我们统一走 wav）
_VOICE_FORMAT_WAV = 0
_SAMPLE_RATE_16K = 16000


@dataclass
class VerifyResult:
    matched: bool
    score: float  # 0.0 - 100.0
    raw: dict


def extract_pcm_from_wav(wav_bytes: bytes) -> bytes:
    """从 WAV 字节流里提取 raw PCM 数据。容忍前端生成的标准 16bit mono WAV。"""
    if len(wav_bytes) < 44 or wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("不是合法的 WAV 文件")

    # 查找 "data" 块位置（跳过可能的 LIST/INFO 等辅助块）
    offset = 12
    while offset + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[offset:offset + 4]
        chunk_size = struct.unpack("<I", wav_bytes[offset + 4:offset + 8])[0]
        if chunk_id == b"data":
            return wav_bytes[offset + 8:offset + 8 + chunk_size]
        offset += 8 + chunk_size
    raise ValueError("WAV 文件中未找到 data 块")


def _wrap_pcm_to_wav(pcm: bytes, sample_rate: int = 16000) -> bytes:
    """把 16-bit mono PCM 打包成 WAV 字节流（44-byte 头 + PCM 数据）。"""
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm)

    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))           # PCM header size
    buf.write(struct.pack("<H", 1))            # PCM format
    buf.write(struct.pack("<H", num_channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", byte_rate))
    buf.write(struct.pack("<H", block_align))
    buf.write(struct.pack("<H", bits_per_sample))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm)
    return buf.getvalue()


class VoiceprintClient:
    """腾讯云 VPR 客户端。异步接口，同步底层。"""

    def __init__(self, secret_id: str, secret_key: str, app_id: str = ""):
        self._secret_id = secret_id
        self._secret_key = secret_key
        self._app_id = app_id
        self._client = None  # 懒初始化

    @property
    def is_configured(self) -> bool:
        return bool(self._secret_id and self._secret_key)

    def _get_client(self):
        """懒加载 Tencent CommonClient（避免启动时强依赖 SDK）。"""
        if self._client is not None:
            return self._client
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.common.common_client import CommonClient
        except ImportError as e:
            raise RuntimeError(
                "tencentcloud-sdk-python-common 未安装。"
                "运行：pip install tencentcloud-sdk-python-common"
            ) from e

        cred = credential.Credential(self._secret_id, self._secret_key)
        http_profile = HttpProfile(endpoint=_ENDPOINT, reqTimeout=30)
        client_profile = ClientProfile(httpProfile=http_profile)
        self._client = CommonClient(
            _PRODUCT, _API_VERSION, cred, _REGION, profile=client_profile
        )
        return self._client

    def _call_sync(self, action: str, params: dict) -> dict:
        """同步调用腾讯 CommonClient。"""
        client = self._get_client()
        return client.call_json(action, params)

    async def _call(self, action: str, params: dict) -> dict:
        return await asyncio.to_thread(self._call_sync, action, params)

    # ---------- 对外 API ----------

    async def ping(self) -> bool:
        """连通性 & 凭据有效性检查。调用轻量接口 VoicePrintCount。"""
        if not self.is_configured:
            return False
        try:
            await self._call("VoicePrintCount", {})
            return True
        except Exception as e:
            logger.warning(f"VPR ping failed: {e}")
            return False

    async def enroll(self, speaker_nick: str, pcm_bytes: bytes) -> str | None:
        """注册候选人声纹。返回腾讯分配的 VoicePrintId；失败返回 None。

        Args:
            speaker_nick: 用户侧命名（TechSpar 里用 techspar_<user_id>）
            pcm_bytes: 16kHz mono 16-bit PCM，建议 ≥6 秒（≤30 秒）
        """
        if not self.is_configured:
            return None
        wav_bytes = _wrap_pcm_to_wav(pcm_bytes, _SAMPLE_RATE_16K)
        data_b64 = base64.b64encode(wav_bytes).decode("ascii")
        params = {
            "VoiceFormat": _VOICE_FORMAT_WAV,
            "SampleRate": _SAMPLE_RATE_16K,
            "SpeakerNick": speaker_nick,
            "Data": data_b64,
            "DataLength": len(wav_bytes),
        }
        try:
            resp = await self._call("VoicePrintEnroll", params)
            # 响应结构：{"Response": {"Data": {"VoicePrintId": "...", ...}, "RequestId": "..."}}
            inner = resp.get("Response", resp)
            data = inner.get("Data") or {}
            vpid = data.get("VoicePrintId") or inner.get("VoicePrintId")
            if not vpid:
                logger.warning(f"VPR enroll missing VoicePrintId: {inner}")
                return None
            logger.info(f"VPR enrolled: nick={speaker_nick} id={vpid}")
            return vpid
        except Exception as e:
            logger.error(f"VPR enroll failed: {e}")
            return None

    async def verify(self, voice_print_id: str, pcm_bytes: bytes) -> VerifyResult | None:
        """1:1 验证。返回 None 表示调用失败。

        Args:
            voice_print_id: enroll 时拿到的 VoicePrintId
            pcm_bytes: 2-5 秒的 16kHz mono PCM
        """
        if not self.is_configured:
            return None
        wav_bytes = _wrap_pcm_to_wav(pcm_bytes, _SAMPLE_RATE_16K)
        data_b64 = base64.b64encode(wav_bytes).decode("ascii")
        params = {
            "VoicePrintId": voice_print_id,
            "VoiceFormat": _VOICE_FORMAT_WAV,
            "SampleRate": _SAMPLE_RATE_16K,
            "Data": data_b64,
            "DataLength": len(wav_bytes),
        }
        try:
            resp = await self._call("VoicePrintVerify", params)
            inner = resp.get("Response", resp)
            data = inner.get("Data") or inner
            # 腾讯返回：Decision (0/1) + Score (0-100)
            decision = data.get("Decision")
            score = float(data.get("Score", 0.0) or 0.0)
            matched = bool(decision) if decision is not None else score >= 60.0
            return VerifyResult(matched=matched, score=score, raw=inner)
        except Exception as e:
            logger.warning(f"VPR verify failed: {e}")
            return None

    async def delete(self, voice_print_id: str) -> bool:
        if not self.is_configured:
            return False
        try:
            await self._call("VoicePrintDelete", {"VoicePrintIdSet": [voice_print_id]})
            logger.info(f"VPR deleted: {voice_print_id}")
            return True
        except Exception as e:
            logger.warning(f"VPR delete failed: {e}")
            return False
