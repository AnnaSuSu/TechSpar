"""基于 webrtcvad 的语音段切分器。

职责：从持续的 16kHz PCM 流里切出"至少 min_speech_ms 的纯语音段"，
用于异步送入声纹识别（不是给 ASR）。

不是神经网络——webrtcvad 是 WebRTC 项目的纯 C VAD，<100KB，CPU 开销极低。

切段策略：
- 每 30ms 一个 frame（webrtcvad 只接受 10/20/30ms 帧）
- 连续检测到 speech frames，累计 ≥ min_speech_ms 且后续出现 trailing 静音 → yield
- 硬上限 max_speech_ms → 强制 yield（防止长句永不切）
- 短于 min_speech_ms 的语音段（如"嗯""好的"）直接丢弃
"""
from __future__ import annotations

import logging
from typing import Iterator

logger = logging.getLogger("uvicorn")

_FRAME_MS = 30
_SAMPLE_RATE = 16000
_BYTES_PER_SAMPLE = 2  # 16-bit
_FRAME_BYTES = _SAMPLE_RATE * _FRAME_MS // 1000 * _BYTES_PER_SAMPLE  # 960 bytes


class VADSegmenter:
    """增量切段器。feed() 返回已切好的语音段列表。"""

    def __init__(
        self,
        sample_rate: int = _SAMPLE_RATE,
        min_speech_ms: int = 1500,
        max_speech_ms: int = 3000,
        trailing_silence_ms: int = 400,
        aggressiveness: int = 2,
    ):
        if sample_rate != _SAMPLE_RATE:
            raise ValueError("VADSegmenter 目前只支持 16kHz")
        try:
            import webrtcvad
        except ImportError as e:
            raise RuntimeError(
                "webrtcvad 未安装。运行：pip install webrtcvad"
            ) from e

        self._vad = webrtcvad.Vad(aggressiveness)
        self._sample_rate = sample_rate
        self._min_speech_frames = min_speech_ms // _FRAME_MS
        self._max_speech_frames = max_speech_ms // _FRAME_MS
        self._trailing_silence_frames = trailing_silence_ms // _FRAME_MS

        self._residual = b""                    # 上次 feed 剩下不足一帧的字节
        self._speech_buf: list[bytes] = []      # 累积的语音帧
        self._silence_tail = 0                  # 当前累积结尾的静音帧数

    def feed(self, pcm_chunk: bytes) -> list[bytes]:
        """喂一段 PCM，返回已切好的语音段（可能 0、1 或多段）。"""
        segments: list[bytes] = []
        data = self._residual + pcm_chunk

        offset = 0
        while offset + _FRAME_BYTES <= len(data):
            frame = data[offset:offset + _FRAME_BYTES]
            offset += _FRAME_BYTES

            try:
                is_speech = self._vad.is_speech(frame, self._sample_rate)
            except Exception:
                is_speech = False

            if is_speech:
                self._speech_buf.append(frame)
                self._silence_tail = 0

                # 硬上限触发
                if len(self._speech_buf) >= self._max_speech_frames:
                    segments.append(b"".join(self._speech_buf))
                    self._speech_buf.clear()
                    self._silence_tail = 0
            else:
                if self._speech_buf:
                    self._silence_tail += 1
                    # 结尾静音足够久，判断段落结束
                    if self._silence_tail >= self._trailing_silence_frames:
                        if len(self._speech_buf) >= self._min_speech_frames:
                            segments.append(b"".join(self._speech_buf))
                        # 否则丢弃（太短）
                        self._speech_buf.clear()
                        self._silence_tail = 0
                # 静音且 buf 为空 → 什么都不做

        self._residual = data[offset:]
        return segments

    def flush(self) -> bytes | None:
        """流结束时调用，把 buf 里的残余作为一段 yield（如果够长）。"""
        if self._speech_buf and len(self._speech_buf) >= self._min_speech_frames:
            segment = b"".join(self._speech_buf)
            self._speech_buf.clear()
            self._silence_tail = 0
            self._residual = b""
            return segment
        self._speech_buf.clear()
        self._silence_tail = 0
        self._residual = b""
        return None

    def reset(self) -> None:
        self._residual = b""
        self._speech_buf.clear()
        self._silence_tail = 0
