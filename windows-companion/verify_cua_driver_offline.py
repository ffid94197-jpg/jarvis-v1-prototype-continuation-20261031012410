"""Offline contract tests; these do not require Windows or the Cua SDK."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cua_driver_backend import (
    CuaDriverBackend,
    _action_record,
    _element_record,
    _valid_element_target,
    _window_record,
)
from desktop_control import check_input


class CuaDriverOfflineTests(unittest.TestCase):
    def test_window_record_preserves_native_identity(self):
        window = SimpleNamespace(
            pid=4242, window_id=987654321, title="Editor",
            app_name="Editor.exe",
            bounds=SimpleNamespace(x=1, y=2, width=800, height=600),
            is_on_screen=True, minimized=False, z_index=1,
        )
        row = _window_record(window)
        self.assertEqual(row["pid"], 4242)
        self.assertEqual(row["cuaWindowId"], "987654321")
        self.assertEqual(row["bounds"]["width"], 800.0)

    def test_tokens_are_only_returned_for_complete_healthy_snapshots(self):
        element = SimpleNamespace(
            role="button", label="Save", value="", enabled=True, selected=False,
            frame=SimpleNamespace(x=10, y=20, width=30, height=18),
            actions=["press"], element_token="s00000001:2",
        )
        healthy = _element_record(element, 42, 9001, True)
        degraded = _element_record(element, 42, 9001, False)
        self.assertEqual(healthy["elementToken"], "s00000001:2")
        self.assertNotIn("elementToken", degraded)

    def test_element_target_requires_matching_typed_fields(self):
        valid = {
            "pid": 42, "cuaWindowId": "9001",
            "elementToken": "s00000001:2", "button": "left",
        }
        self.assertTrue(_valid_element_target(valid))
        for key, value in (
            ("pid", True), ("pid", -1), ("pid", 2**32), ("cuaWindowId", "../9001"),
            ("cuaWindowId", "18446744073709551616"),
            ("elementToken", "stale token"), ("elementToken", "x" * 129),
        ):
            bad = dict(valid)
            bad[key] = value
            self.assertFalse(_valid_element_target(bad), (key, value))

    def test_action_receipt_does_not_upgrade_unverifiable_to_verified(self):
        result = SimpleNamespace(
            effect=SimpleNamespace(name="UNVERIFIABLE"),
            error=None, route=SimpleNamespace(name="ACCESSIBILITY"),
            delivery=SimpleNamespace(name="BACKGROUND"),
            summary="input delivered; result not proven", evidence=[], hint="observe",
        )
        receipt = _action_record(result)
        self.assertTrue(receipt["ok"])
        self.assertFalse(receipt["verified"])
        self.assertEqual(receipt["effect"], "unverifiable")

    def test_refused_action_is_not_success(self):
        result = SimpleNamespace(
            effect=SimpleNamespace(name="REFUSED"),
            error=None, route=SimpleNamespace(name="ACCESSIBILITY"),
            delivery=SimpleNamespace(name="BACKGROUND"),
            summary="refused", evidence=[], hint=None,
        )
        self.assertFalse(_action_record(result)["ok"])

    def test_suspected_noop_is_not_success(self):
        result = SimpleNamespace(
            effect=SimpleNamespace(name="SUSPECTED_NOOP"),
            error=None, route=SimpleNamespace(name="ACCESSIBILITY"),
            delivery=SimpleNamespace(name="BACKGROUND"),
            summary="no effect observed", evidence=[], hint="observe",
        )
        self.assertFalse(_action_record(result)["ok"])

    def test_guardian_companion_accepts_only_fresh_target_shape(self):
        old = os.environ.get("JARVIS_CUA_DRIVER_ENABLED")
        try:
            os.environ["JARVIS_CUA_DRIVER_ENABLED"] = "1"
            valid = {
                "operation": "desktop_click", "pid": 42,
                "cuaWindowId": "9001", "elementToken": "s00000001:2",
                "button": "left",
            }
            self.assertIsNone(check_input(valid))
            for key, value in (
                ("pid", True), ("pid", -1), ("cuaWindowId", "../9001"),
                ("elementToken", "stale token"),
            ):
                invalid = dict(valid)
                invalid[key] = value
                self.assertIsNotNone(check_input(invalid), (key, value))
            os.environ["JARVIS_CUA_DRIVER_ENABLED"] = "0"
            self.assertIsNotNone(check_input(valid))
        finally:
            if old is None:
                os.environ.pop("JARVIS_CUA_DRIVER_ENABLED", None)
            else:
                os.environ["JARVIS_CUA_DRIVER_ENABLED"] = old

    def test_exact_window_type_and_keys_require_complete_cua_target(self):
        old = os.environ.get("JARVIS_CUA_DRIVER_ENABLED")
        try:
            os.environ["JARVIS_CUA_DRIVER_ENABLED"] = "1"
            target = {"pid": 42, "cuaWindowId": "9001"}
            self.assertIsNone(check_input({
                "operation": "desktop_type", "text": "hello", **target
            }))
            self.assertIsNone(check_input({
                "operation": "desktop_keys", "keys": ["ctrl", "s"], **target
            }))
            self.assertIsNotNone(check_input({
                "operation": "desktop_type", "text": "hello", "pid": 42
            }))
            self.assertIsNotNone(check_input({
                "operation": "desktop_keys", "keys": ["ctrl", "s"],
                "cuaWindowId": "9001"
            }))
            os.environ["JARVIS_CUA_DRIVER_ENABLED"] = "0"
            self.assertIsNotNone(check_input({
                "operation": "desktop_type", "text": "hello", **target
            }))
        finally:
            if old is None:
                os.environ.pop("JARVIS_CUA_DRIVER_ENABLED", None)
            else:
                os.environ["JARVIS_CUA_DRIVER_ENABLED"] = old

    def test_backend_requires_both_explicit_opt_ins(self):
        backend = CuaDriverBackend()
        old_a = os.environ.get("JARVIS_EXPERIMENTAL_DESKTOP_CONTROL")
        old_b = os.environ.get("JARVIS_CUA_DRIVER_ENABLED")
        try:
            os.environ["JARVIS_EXPERIMENTAL_DESKTOP_CONTROL"] = "0"
            os.environ["JARVIS_CUA_DRIVER_ENABLED"] = "1"
            self.assertFalse(backend.enabled())
            os.environ["JARVIS_EXPERIMENTAL_DESKTOP_CONTROL"] = "1"
            self.assertTrue(backend.enabled() if os.name == "nt" else not backend.enabled())
        finally:
            if old_a is None:
                os.environ.pop("JARVIS_EXPERIMENTAL_DESKTOP_CONTROL", None)
            else:
                os.environ["JARVIS_EXPERIMENTAL_DESKTOP_CONTROL"] = old_a
            if old_b is None:
                os.environ.pop("JARVIS_CUA_DRIVER_ENABLED", None)
            else:
                os.environ["JARVIS_CUA_DRIVER_ENABLED"] = old_b


if __name__ == "__main__":
    unittest.main(verbosity=2)
