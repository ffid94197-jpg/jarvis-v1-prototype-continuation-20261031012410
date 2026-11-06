"""Fail-closed reconnect policy for the local JarvisBuddy LAN client.

Reconnection restores only the network session. It NEVER resumes a mission,
replays a gameplay action, or treats a new spawn as proof of prior progress.
The owner must issue a fresh Guardian-authorized auto_resume after observing
the current world.
"""
from __future__ import annotations

from collections import deque
from typing import Callable, Mapping
import math
import time

_WINDOW_SECONDS = 10 * 60
_MAX_ATTEMPTS = 5
_DELAYS_SECONDS = (2, 4, 8, 16, 30)


def auto_reconnect_enabled(engine: str, env: Mapping[str, str]) -> bool:
    """Only the native Jarvis Mineflayer client supports opt-in reconnection."""
    return (engine == "jarvis" and
            env.get("JARVIS_MINECRAFT_LAN_ENABLED") == "1" and
            env.get("JARVIS_MINECRAFT_AUTO_RECONNECT") == "1")


class ReconnectBudget:
    """At most five reconnect attempts in any rolling ten-minute window."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._attempts: deque[float] = deque()

    def reserve(self) -> int | None:
        now = self._clock()
        if not isinstance(now, (int, float)) or not math.isfinite(now):
            return None
        while self._attempts and now - self._attempts[0] >= _WINDOW_SECONDS:
            self._attempts.popleft()
        if len(self._attempts) >= _MAX_ATTEMPTS:
            return None
        delay = _DELAYS_SECONDS[min(len(self._attempts), len(_DELAYS_SECONDS) - 1)]
        self._attempts.append(now)
        return delay

    @property
    def attempts_in_window(self) -> int:
        now = self._clock()
        while self._attempts and now - self._attempts[0] >= _WINDOW_SECONDS:
            self._attempts.popleft()
        return len(self._attempts)
