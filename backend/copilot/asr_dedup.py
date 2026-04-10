"""ASR final 结果去重：防止短窗口内同一句话重复触发下游 Agent。

参考 VoiceWings backend/app/services/asr.py:69-94 的 1.2 秒窗口策略。
"""
import time
from collections import deque


class TranscriptDeduper:
    """滑动时间窗口内的重复文本抑制。

    用于 DashScope qwen3-asr-flash-realtime interim→final 偶发重复、网络抖动导致的同句多次 final。
    """

    def __init__(self, window_seconds: float = 1.2, max_entries: int = 16):
        self._window = window_seconds
        self._recent: deque[tuple[float, str]] = deque(maxlen=max_entries)

    def should_emit(self, text: str) -> bool:
        """返回 True 表示这段文本应推送给下游；False 表示重复，丢弃。"""
        text = (text or "").strip()
        if not text:
            return False

        now = time.monotonic()
        # 清理过期条目
        while self._recent and now - self._recent[0][0] > self._window:
            self._recent.popleft()

        # 窗口内是否出现过相同文本（或一方是另一方的前缀/后缀）
        for _, prev in self._recent:
            if prev == text or prev.endswith(text) or text.endswith(prev):
                return False

        self._recent.append((now, text))
        return True

    def reset(self) -> None:
        self._recent.clear()
