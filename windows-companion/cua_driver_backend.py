"""JARVIS-owned adapter for the Cua Driver Python SDK.

The driver is an execution backend only. It receives already Guardian-approved
desktop operations from desktop_control.run_action; it has no model, planner,
provider credentials, shell tool, browser tool, or independent task authority.
"""
from __future__ import annotations

import asyncio
import atexit
import concurrent.futures
import os
import re
import threading
import time
from typing import Any


class CuaDriverUnavailable(RuntimeError):
    pass


class CuaDriverOutcomeUnknown(RuntimeError):
    pass


def _name(value: Any) -> str:
    return str(getattr(value, "name", value)).split(".")[-1].lower()


def _bounds(value: Any) -> dict[str, float] | None:
    if value is None:
        return None
    return {
        "x": float(getattr(value, "x", 0) or 0),
        "y": float(getattr(value, "y", 0) or 0),
        "width": float(getattr(value, "width", 0) or 0),
        "height": float(getattr(value, "height", 0) or 0),
    }


def _configure_sdk_environment() -> None:
    # V1 does not send desktop telemetry. Do not inherit a parent-process
    # opt-in accidentally; this backend keeps telemetry disabled.
    os.environ["CUA_DRIVER_RS_TELEMETRY_ENABLED"] = "0"


def _valid_element_target(op: dict[str, Any]) -> bool:
    return (
        type(op.get("pid")) is int
        and 0 < op["pid"] < 2**32
        and isinstance(op.get("cuaWindowId"), str)
        and re.fullmatch(r"[1-9][0-9]{0,19}", op["cuaWindowId"]) is not None
        and 0 < int(op["cuaWindowId"]) < 2**64
        and isinstance(op.get("elementToken"), str)
        and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", op["elementToken"]) is not None
    )


def _window_record(window: Any) -> dict[str, Any]:
    return {
        "pid": getattr(window, "pid", None),
        "cuaWindowId": str(getattr(window, "window_id", "")),
        "title": str(getattr(window, "title", "") or "")[:160],
        "appName": str(getattr(window, "app_name", "") or "")[:100],
        "bounds": _bounds(getattr(window, "bounds", None)),
        "onScreen": bool(getattr(window, "is_on_screen", False)),
        "minimized": getattr(window, "minimized", None),
        "zIndex": getattr(window, "z_index", None),
    }


def _element_record(element: Any, pid: int, window_id: int, tokens_usable: bool) -> dict[str, Any]:
    frame = _bounds(getattr(element, "frame", None))
    row: dict[str, Any] = {
        "role": str(getattr(element, "role", "") or "")[:80],
        "name": str(getattr(element, "label", "") or "")[:180],
        "enabled": getattr(element, "enabled", None),
        "selected": getattr(element, "selected", None),
        "bounds": frame,
        "pid": pid,
        "cuaWindowId": str(window_id),
        "actions": list(getattr(element, "actions", None) or [])[:8],
    }
    token = getattr(element, "element_token", None)
    if (
        tokens_usable and isinstance(token, str)
        and re.fullmatch(r"[A-Za-z0-9:_-]{1,128}", token) is not None
    ):
        row["elementToken"] = token
    return row


def _action_record(result: Any) -> dict[str, Any]:
    effect = _name(getattr(result, "effect", "unknown"))
    error = getattr(result, "error", None)
    evidence = []
    for item in (getattr(result, "evidence", None) or [])[:8]:
        evidence.append({
            "kind": _name(getattr(item, "kind", "unknown")),
            "detail": str(getattr(item, "detail", "") or "")[:240],
        })
    return {
        "ok": error is None and effect in ("confirmed", "partial", "unverifiable"),
        "verified": effect == "confirmed",
        "effect": effect,
        "route": _name(getattr(result, "route", "unknown")),
        "delivery": _name(getattr(result, "delivery", "unknown")),
        "summary": str(getattr(result, "summary", "") or "")[:500],
        "evidence": evidence,
        "error": str(error)[:400] if error is not None else None,
        "hint": str(getattr(result, "hint", "") or "")[:240],
    }


class CuaDriverBackend:
    """One persistent in-process SDK instance with serialized, bounded calls."""

    def __init__(self) -> None:
        self._init_lock = threading.RLock()
        self._call_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._driver: Any = None
        self._sdk: Any = None
        self._pending: concurrent.futures.Future | None = None
        self._outcome_unknown = False
        self._tokens: dict[str, tuple[int, int, float]] = {}

    def enabled(self) -> bool:
        return (
            os.name == "nt"
            and os.environ.get("JARVIS_EXPERIMENTAL_DESKTOP_CONTROL") == "1"
            and os.environ.get("JARVIS_CUA_DRIVER_ENABLED") == "1"
        )

    def _loop_main(self) -> None:
        assert self._loop is not None
        asyncio.set_event_loop(self._loop)
        self._ready.set()
        self._loop.run_forever()
        pending = asyncio.all_tasks(self._loop)
        for task in pending:
            task.cancel()
        if pending:
            self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        self._loop.close()

    async def _initialize(self) -> None:
        _configure_sdk_environment()
        import cua_driver
        from importlib.metadata import version as package_version
        if package_version("cua-driver") != "0.38.0":
            raise CuaDriverUnavailable("Expected pinned cua-driver 0.38.0.")
        self._sdk = cua_driver
        self._driver = cua_driver.CuaDriver.create()

    def _ensure(self) -> None:
        if not self.enabled():
            raise CuaDriverUnavailable(
                "Cua Driver requires Windows plus both explicit desktop-control and CUA opt-ins."
            )
        with self._init_lock:
            if self._driver is not None:
                return
            if self._loop is None:
                self._loop = asyncio.new_event_loop()
                self._thread = threading.Thread(
                    target=self._loop_main,
                    name="jarvis-cua-driver",
                    daemon=True,
                )
                self._thread.start()
                if not self._ready.wait(5):
                    raise CuaDriverUnavailable("Cua Driver event loop did not start.")
            assert self._loop is not None
            future = asyncio.run_coroutine_threadsafe(self._initialize(), self._loop)
            try:
                future.result(timeout=30)
            except Exception as exc:
                raise CuaDriverUnavailable(
                    "Cua Driver SDK initialization failed: " + type(exc).__name__
                ) from exc

    def _run(self, factory, timeout: float = 12.0, observation: bool = False) -> Any:
        self._ensure()
        with self._call_lock:
            if self._pending is not None:
                if not self._pending.done():
                    try:
                        self._pending.result(timeout=20 if observation else 0.05)
                    except concurrent.futures.TimeoutError as exc:
                        raise CuaDriverOutcomeUnknown(
                            "A previous CUA operation is still unsettled. Observe before retrying."
                        ) from exc
                    except Exception:
                        pass
                else:
                    try:
                        self._pending.result()
                    except Exception:
                        pass
                self._pending = None
                if self._outcome_unknown and not observation:
                    raise CuaDriverOutcomeUnknown(
                        "The prior action outcome is unknown. Run desktop_observe before another action."
                    )
            if self._outcome_unknown and not observation:
                raise CuaDriverOutcomeUnknown(
                    "The prior action outcome is unknown. Run desktop_observe before another action."
                )
            # Keep an unknown prior effect latched until a fresh, healthy
            # observation actually completes. A failed observation must not
            # authorize another mutation.
            assert self._loop is not None
            future = asyncio.run_coroutine_threadsafe(factory(), self._loop)
            try:
                result = future.result(timeout=timeout)
                if observation:
                    self._outcome_unknown = False
                return result
            except concurrent.futures.TimeoutError as exc:
                self._pending = future
                self._outcome_unknown = True
                raise CuaDriverOutcomeUnknown(
                    "CUA operation timed out after dispatch. Its effect may have landed; observe before retrying."
                ) from exc

    async def _observe(self, op: dict[str, Any]) -> dict[str, Any]:
        from cua_driver import GetWindowStateInput, ListWindowsInput

        listed = await self._driver.list_windows(
            ListWindowsInput(pid=None, on_screen_only=True)
        )
        # Keep enough candidates to locate the actual foreground window, but
        # bound the amount of native window metadata returned to the model.
        windows = list(getattr(listed, "windows", None) or [])[:40]
        valid_windows = [
            window for window in windows
            if type(getattr(window, "pid", None)) is int
            and type(getattr(window, "window_id", None)) is int
        ]
        records = [_window_record(window) for window in valid_windows]
        if not records:
            raise ValueError("No visible Windows targets were found in the interactive session.")

        target_window = None
        if "pid" in op or "cuaWindowId" in op:
            selection_reason = "explicit-window"
            pid = op.get("pid")
            raw_window_id = op.get("cuaWindowId")
            if type(pid) is not int or not isinstance(raw_window_id, str):
                raise ValueError("Exact-window observation requires PID and CUA window ID.")
            target_window = next(
                (
                    window for window in valid_windows
                    if getattr(window, "pid", None) == pid
                    and str(getattr(window, "window_id", "")) == raw_window_id
                ),
                None,
            )
            if target_window is None:
                raise ValueError("The requested CUA window is no longer visible.")
        else:
            foreground_title = str(op.get("_foregroundTitle", "") or "").strip().casefold()
            if not foreground_title:
                raise ValueError(
                    "Foreground window could not be identified; select an exact visible window."
                )
            target_window = next(
                (
                    window for window in valid_windows
                    if str(getattr(window, "title", "") or "")[:100].strip().casefold()
                    == foreground_title
                ),
                None,
            )
            if target_window is None:
                raise ValueError(
                    "The current foreground window is not in the visible CUA window list; "
                    "select an exact visible window."
                )
            selection_reason = "foreground-title"

        pid = getattr(target_window, "pid", None)
        window_id = getattr(target_window, "window_id", None)
        if type(pid) is not int or type(window_id) is not int:
            raise ValueError("Selected CUA window has no valid process/window identity.")

        # Keep exactly one native snapshot per observation call. CUA element
        # tokens are snapshot-scoped; taking multiple snapshots in one call
        # could invalidate tokens from earlier windows before the model sees them.
        self._tokens.clear()
        record = _window_record(target_window)
        record["selectionReason"] = selection_reason
        controls: list[dict[str, Any]] = []
        try:
            state = await self._driver.get_window_state(
                GetWindowStateInput(
                    pid=pid,
                    window_id=window_id,
                    session=None,
                    query=None,
                    include_accessibility_tree=True,
                    include_screenshot=False,
                    screenshot_out_file=None,
                    max_elements=24,
                    max_depth=8,
                    max_dimension=None,
                    max_image_dimension=None,
                    timeout_ms=5000,
                    tree_format="markdown",
                    since=None,
                    verbose=False,
                    full_output=False,
                )
            )
            degraded = bool(getattr(state, "degraded", False))
            truncated = bool(getattr(state, "truncated", False))
            complete = getattr(state, "elements_complete", None)
            tokens_usable = not degraded and not truncated and complete is True
            elements = list(getattr(state, "elements", None) or [])[:30]
            for element in elements:
                item = _element_record(element, pid, window_id, tokens_usable)
                controls.append(item)
                token = item.get("elementToken")
                if token:
                    self._tokens[token] = (pid, window_id, time.monotonic() + 25)
            record.update({
                "snapshotId": getattr(state, "snapshot_id", None),
                "elementCount": getattr(state, "element_count", None),
                "elementsComplete": complete,
                "degraded": degraded,
                "degradedReason": getattr(state, "degraded_reason", None),
                "truncated": truncated,
                "truncationReason": getattr(state, "truncation_reason", None),
                "controlCount": len(controls),
            })
        except Exception as exc:
            raise ValueError(
                "CUA accessibility snapshot failed; an unsettled action remains unverified."
            ) from exc

        if not tokens_usable:
            raise ValueError(
                "CUA accessibility snapshot is degraded, truncated or incomplete; "
                "an unsettled action remains unverified."
            )

        return {
            "source": "Cua Driver accessibility snapshot",
            "visibleWindows": records,
            "observedWindow": record,
            "foregroundControls": controls[:30],
            "windowCount": len(records),
            "controlCount": len(controls),
            "note": (
                "Only observedWindow has a current accessibility snapshot. Element tokens "
                "are bound to that exact PID/window and snapshot. Tokens are single-use, "
                "expire after 25 seconds, and any new observation invalidates them. "
                "A degraded or truncated tree does not expose clickable tokens."
            ),
        }

    async def _click(self, op: dict[str, Any]) -> dict[str, Any]:
        from cua_driver import (
            ActionTarget, ClickButton, ClickInput, ClickPosition, InputDeliveryMode,
        )

        button = {
            "left": ClickButton.LEFT,
            "right": ClickButton.RIGHT,
            "double": ClickButton.LEFT,
        }.get(op.get("button", "left"))
        if button is None:
            raise ValueError("Unsupported click button.")

        if "elementToken" in op:
            if not _valid_element_target(op):
                raise ValueError("Invalid CUA element target.")
            token = op["elementToken"]
            target_record = self._tokens.get(token)
            if (
                target_record is None
                or target_record[0] != op["pid"]
                or target_record[1] != int(op["cuaWindowId"])
                or time.monotonic() > target_record[2]
            ):
                raise ValueError("Element token is stale, expired or belongs to another window.")
            self._tokens.pop(token, None)
            target = ActionTarget.WINDOW(pid=target_record[0], window_id=target_record[1])
            position = ClickPosition.ELEMENT(element_token=token)
            delivery = InputDeliveryMode.BACKGROUND
        else:
            target = ActionTarget.DESKTOP(display_id="primary")
            position = ClickPosition.COORDINATES(x=float(op["x"]), y=float(op["y"]))
            delivery = InputDeliveryMode.FOREGROUND

        result = await self._driver.click(
            ClickInput(
                target=target,
                position=position,
                delivery_mode=delivery,
                session=None,
                button=button,
                count=2 if op.get("button") == "double" else 1,
            )
        )
        return _action_record(result)

    async def _move(self, op: dict[str, Any]) -> dict[str, Any]:
        from cua_driver import ActionTarget, MoveCursorInput
        result = await self._driver.move_cursor(
            MoveCursorInput(
                x=float(op["x"]), y=float(op["y"]),
                target=ActionTarget.DESKTOP(display_id="primary"),
                scope=None, session=None,
            )
        )
        return _action_record(result)

    def _action_target(self, op: dict[str, Any]):
        from cua_driver import ActionTarget
        if "pid" in op or "cuaWindowId" in op:
            if (
                type(op.get("pid")) is not int
                or not 0 < op["pid"] < 2**32
                or not isinstance(op.get("cuaWindowId"), str)
                or re.fullmatch(r"[1-9][0-9]{0,19}", op["cuaWindowId"]) is None
                or not 0 < int(op["cuaWindowId"]) < 2**64
            ):
                raise ValueError("Invalid exact-window CUA target.")
            return ActionTarget.WINDOW(pid=op["pid"], window_id=int(op["cuaWindowId"]))
        return ActionTarget.DESKTOP(display_id="primary")

    async def _type(self, op: dict[str, Any]) -> dict[str, Any]:
        from cua_driver import TypeTextInput
        result = await self._driver.type_text(
            TypeTextInput(
                text=op["text"],
                target=self._action_target(op),
                scope=None, session=None,
            )
        )
        return _action_record(result)

    async def _keys(self, op: dict[str, Any]) -> dict[str, Any]:
        from cua_driver import HotkeyInput, PressKeyInput
        aliases = {
            "enter": "ENTER", "esc": "ESC", "tab": "TAB", "space": "SPACE",
            "backspace": "BACKSPACE", "delete": "DELETE", "up": "UP",
            "down": "DOWN", "left": "LEFT", "right": "RIGHT", "home": "HOME",
            "end": "END", "ctrl": "CTRL", "alt": "ALT", "shift": "SHIFT",
            "win": "WIN", "f4": "F4",
        }
        keys = [aliases.get(key, key.upper()) for key in op["keys"]]
        target = self._action_target(op)
        if len(keys) == 1:
            result = await self._driver.press_key(
                PressKeyInput(
                    key=keys[0], target=target, scope=None,
                    session=None, modifiers=None,
                )
            )
        else:
            result = await self._driver.hotkey(
                HotkeyInput(keys=keys, target=target, scope=None, session=None)
            )
        return _action_record(result)

    def run_action(self, op: dict[str, Any]) -> dict[str, Any]:
        name = op.get("operation")
        if name == "desktop_observe":
            evidence = self._run(lambda: self._observe(op), timeout=38, observation=True)
            return {"ok": True, "evidence": evidence}
        if name == "desktop_click":
            result = self._run(lambda: self._click(op), timeout=15)
        elif name == "desktop_move":
            result = self._run(lambda: self._move(op), timeout=12)
        elif name == "desktop_type":
            result = self._run(lambda: self._type(op), timeout=15)
        elif name == "desktop_keys":
            result = self._run(lambda: self._keys(op), timeout=12)
        else:
            raise ValueError("Unsupported Cua Driver operation.")
        return {"ok": bool(result.get("ok")), "evidence": result,
                **({"error": result["error"]} if result.get("error") else {})}

    def emergency_stop(self) -> bool:
        loop, driver = self._loop, self._driver
        if driver is None or loop is None or not loop.is_running():
            return False
        try:
            from cua_driver import EndSessionInput
            future = asyncio.run_coroutine_threadsafe(
                driver.end_session(EndSessionInput(session=None)), loop
            )
            future.result(timeout=2)
            return True
        except Exception:
            return False

    def close(self) -> None:
        with self._init_lock:
            driver, loop, thread = self._driver, self._loop, self._thread
            self._driver = None
            if driver is not None and loop is not None and loop.is_running():
                try:
                    from cua_driver import EndSessionInput
                    end = asyncio.run_coroutine_threadsafe(
                        driver.end_session(EndSessionInput(session=None)), loop
                    )
                    end.result(timeout=3)
                except Exception:
                    pass
                try:
                    future = asyncio.run_coroutine_threadsafe(driver.shutdown(), loop)
                    future.result(timeout=8)
                except Exception:
                    pass
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(loop.stop)
            if thread is not None and thread.is_alive():
                thread.join(timeout=4)
            self._loop = None
            self._thread = None
            self._pending = None
            self._tokens.clear()


_BACKEND = CuaDriverBackend()
atexit.register(_BACKEND.close)


def emergency_stop() -> bool:
    return _BACKEND.emergency_stop()


def run_action(op: dict[str, Any]) -> dict[str, Any]:
    if not _BACKEND.enabled():
        return {"ok": False, "error": "Cua Driver is not explicitly enabled."}
    try:
        return _BACKEND.run_action(op)
    except CuaDriverOutcomeUnknown as exc:
        return {"ok": False, "error": str(exc), "evidence": {"outcomeUnknown": True}}
    except Exception as exc:
        return {"ok": False, "error": "Cua Driver operation failed safely: " + type(exc).__name__}
