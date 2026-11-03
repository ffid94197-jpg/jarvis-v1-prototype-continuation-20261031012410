"""Read-only Windows acceptance preflight for the optional Cua Driver SDK.

This verifies that the SDK can discover real visible windows and return native
accessibility snapshots in the current interactive Windows session. It does
not click, type, launch applications, or certify JARVIS/Guardian integration.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys


async def main() -> int:
    if os.name != "nt":
        print("CUA_WINDOWS_PREFLIGHT_FAIL: Windows is required.")
        return 2
    if not (3, 10) <= sys.version_info[:2] <= (3, 13):
        print("CUA_WINDOWS_PREFLIGHT_FAIL: Python 3.10–3.13 is required.")
        return 2

    import cua_driver
    if getattr(cua_driver, "__version__", None) != "0.38.0":
        print("CUA_WINDOWS_PREFLIGHT_FAIL: expected cua-driver 0.38.0.")
        return 2

    from cua_driver import CuaDriver, EndSessionInput, GetWindowStateInput, ListWindowsInput

    driver = CuaDriver.create()
    try:
        listed = await driver.list_windows(ListWindowsInput(pid=None, on_screen_only=True))
        windows = list(getattr(listed, "windows", None) or [])[:5]
        if not windows:
            print("CUA_WINDOWS_PREFLIGHT_FAIL: no visible windows in this interactive session.")
            return 2

        rows = []
        healthy = 0
        for window in windows:
            pid = getattr(window, "pid", None)
            window_id = getattr(window, "window_id", None)
            if type(pid) is not int or type(window_id) is not int:
                continue
            try:
                state = await driver.get_window_state(
                    GetWindowStateInput(
                        pid=pid,
                        window_id=window_id,
                        session=None,
                        query=None,
                        include_accessibility_tree=True,
                        include_screenshot=False,
                        screenshot_out_file=None,
                        max_elements=20,
                        max_depth=6,
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
                element_count = int(getattr(state, "element_count", 0) or 0)
                if not degraded and not truncated and complete is True:
                    healthy += 1
                rows.append({
                    "pid": pid,
                    "title": str(getattr(window, "title", "") or "")[:120],
                    "degraded": degraded,
                    "truncated": truncated,
                    "elementsComplete": complete,
                    "elementCount": element_count,
                })
            except Exception as exc:
                rows.append({
                    "pid": pid,
                    "title": str(getattr(window, "title", "") or "")[:120],
                    "error": type(exc).__name__,
                })

        print(json.dumps({
            "sdkVersion": cua_driver.__version__,
            "visibleWindowsChecked": len(rows),
            "healthyAccessibilitySnapshots": healthy,
            "windows": rows,
            "actionsDispatched": 0,
            "scope": "read-only SDK preflight; not JARVIS end-to-end acceptance",
        }, indent=2))
        if healthy < 1:
            print("CUA_WINDOWS_PREFLIGHT_FAIL: no complete accessibility snapshot was returned.")
            return 2
        print("CUA_WINDOWS_READONLY_PREFLIGHT_PASS")
        return 0
    finally:
        try:
            await driver.end_session(EndSessionInput(session=None))
        finally:
            await driver.shutdown()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
