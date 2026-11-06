"""Offline contract tests for bounded Minecraft reconnect policy."""
from __future__ import annotations

import unittest

from minecraft_supervisor import ReconnectBudget, auto_reconnect_enabled


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class ReconnectPolicyTests(unittest.TestCase):
    def test_requires_explicit_opt_in_and_native_engine(self) -> None:
        self.assertFalse(auto_reconnect_enabled("jarvis", {}))
        self.assertFalse(auto_reconnect_enabled("mine-ai-mcp", {
            "JARVIS_MINECRAFT_AUTO_RECONNECT": "1"}))
        self.assertFalse(auto_reconnect_enabled("jarvis", {
            "JARVIS_MINECRAFT_AUTO_RECONNECT": "true"}))
        self.assertTrue(auto_reconnect_enabled("jarvis", {
            "JARVIS_MINECRAFT_AUTO_RECONNECT": "1"}))

    def test_backoff_is_bounded_and_attempt_count_capped(self) -> None:
        clock = FakeClock()
        budget = ReconnectBudget(clock)
        self.assertEqual([budget.reserve() for _ in range(5)], [2, 4, 8, 16, 30])
        self.assertIsNone(budget.reserve())
        self.assertEqual(budget.attempts_in_window, 5)

    def test_old_attempts_expire_from_rolling_window(self) -> None:
        clock = FakeClock()
        budget = ReconnectBudget(clock)
        self.assertEqual(budget.reserve(), 2)
        clock.advance(600)
        self.assertEqual(budget.attempts_in_window, 0)
        self.assertEqual(budget.reserve(), 2)

    def test_budget_does_not_reset_after_successful_join(self) -> None:
        clock = FakeClock()
        budget = ReconnectBudget(clock)
        for expected in (2, 4, 8, 16, 30):
            self.assertEqual(budget.reserve(), expected)
            clock.advance(1)
        self.assertIsNone(budget.reserve())

    def test_invalid_clock_fails_closed(self) -> None:
        budget = ReconnectBudget(lambda: float("nan"))
        self.assertIsNone(budget.reserve())


if __name__ == "__main__":
    unittest.main()
