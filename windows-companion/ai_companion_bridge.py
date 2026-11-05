"""Authenticated loopback client for the pinned AI Companion / PlayerEngine runtime.

JARVIS remains the planner and Guardian. This module only transports typed,
Guardian-approved game goals to the mod's server-side task engine.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


def _config():
    configured = os.environ.get("JARVIS_MINECRAFT_AI_COMPANION_CONFIG", "").strip()
    if configured:
        path = Path(configured).expanduser()
    else:
        appdata = os.environ.get("APPDATA", "")
        if not appdata:
            raise RuntimeError("Set JARVIS_MINECRAFT_AI_COMPANION_CONFIG to the Fabric instance config/jarvis-bridge.json path.")
        path = Path(appdata) / ".minecraft" / "config" / "jarvis-bridge.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise RuntimeError("AI Companion bridge config is missing. Start the Fabric 1.21.11 world with the JARVIS overlay once, then point JARVIS_MINECRAFT_AI_COMPANION_CONFIG at config/jarvis-bridge.json.")
    except Exception as exc:
        raise RuntimeError("AI Companion bridge config could not be read (" + type(exc).__name__ + ").")
    if not isinstance(data, dict) or data.get("enabled") is False:
        raise RuntimeError("AI Companion bridge is disabled in its local config.")
    host = data.get("host", "127.0.0.1")
    port = data.get("port", 38765)
    token = data.get("token", "")
    if host != "127.0.0.1":
        raise RuntimeError("AI Companion bridge must bind to 127.0.0.1 only.")
    if type(port) is not int or port < 1024 or port > 65535:
        raise RuntimeError("AI Companion bridge port is invalid.")
    if not isinstance(token, str) or re.fullmatch(r"[0-9a-f]{64}", token) is None:
        raise RuntimeError("AI Companion bridge token is missing or malformed.")
    return {"url": "http://127.0.0.1:" + str(port), "token": token}


def _owner():
    name = os.environ.get("JARVIS_MINECRAFT_PLAYER", "").strip()
    if re.fullmatch(r"[A-Za-z0-9_]{1,16}", name) is None:
        raise RuntimeError("JARVIS_MINECRAFT_PLAYER must name the real human Java owner, not JarvisBuddy.")
    return name


def _companion_name():
    name = os.environ.get("JARVIS_MINECRAFT_AI_COMPANION_NAME", "").strip()
    if name and (len(name) > 32 or any(ord(c) < 32 for c in name)):
        raise RuntimeError("JARVIS_MINECRAFT_AI_COMPANION_NAME is invalid.")
    return name


def _request(path, method="GET", payload=None, timeout=5):
    cfg = _config()
    data = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        cfg["url"] + path,
        data=data,
        method=method,
        headers={
            "Authorization": "Bearer " + cfg["token"],
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(20001)
            if len(raw) > 20000:
                raise RuntimeError("AI Companion response exceeded the 20 KiB limit.")
            result = json.loads(raw.decode("utf-8"))
            if not isinstance(result, dict):
                raise RuntimeError("AI Companion returned a malformed response.")
            return result
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read(20000).decode("utf-8"))
            message = body.get("error", "HTTP " + str(exc.code))
        except Exception:
            message = "HTTP " + str(exc.code)
        raise RuntimeError("AI Companion bridge rejected the request: " + str(message)[:240])
    except urllib.error.URLError as exc:
        raise RuntimeError("AI Companion loopback endpoint is unavailable (" + type(exc.reason).__name__ + ").")


def _select_companion(records):
    if not isinstance(records, list):
        raise RuntimeError("AI Companion did not return a companion list.")
    wanted = _companion_name()
    candidates = [r for r in records if isinstance(r, dict) and r.get("joined") is True
                  and isinstance(r.get("companionId"), str)]
    if wanted:
        candidates = [r for r in candidates if str(r.get("name", "")).casefold() == wanted.casefold()]
    if len(candidates) != 1:
        if not candidates:
            raise RuntimeError("No active owner-bound AI Companion found. Use /companion spawn in the Fabric world and check the owner/companion name.")
        raise RuntimeError("More than one owned AI Companion is available. Set JARVIS_MINECRAFT_AI_COMPANION_NAME to select exactly one.")
    return candidates[0]


def join():
    try:
        result = _request("/v1/join", "POST", {"ownerName": _owner()}, timeout=8)
        records = result.get("companions", [])
        selected = _select_companion(records)
        return {"ok": result.get("joinedVerified") is True,
                "evidence": {"joinedVerified": result.get("joinedVerified") is True,
                             "engine": "ai-companion-playerengine",
                             "companionId": selected["companionId"],
                             "companionName": selected.get("name"),
                             "ownerName": _owner(),
                             "scope": "Existing owner-bound Fabric companion entity; no Mineflayer player launched."},
                "error": None if result.get("joinedVerified") is True else "Owner-bound PlayerEngine companion was not confirmed."}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}


def stop():
    try:
        result = _request("/v1/stop", "POST",
                          {"ownerName": _owner(), "companionName": _companion_name()}, timeout=4)
        return {"ok": result.get("ok") is True,
                "evidence": {"stopRequested": result.get("stopRequested") is True,
                             "physicallyStoppedVerified": result.get("physicallyStoppedVerified") is True,
                             "engine": "ai-companion-playerengine"},
                "error": result.get("error")}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}


def _observe():
    query = urllib.parse.urlencode({"ownerName": _owner(), "companionName": _companion_name()})
    result = _request("/v1/observe?" + query, "GET", timeout=4)
    if result.get("ok") is not True or result.get("joined") is not True:
        raise RuntimeError("Live PlayerEngine companion observation was not confirmed.")
    return result


def _status():
    query = urllib.parse.urlencode({"ownerName": _owner(), "companionName": _companion_name()})
    return _request("/v1/status?" + query, "GET", timeout=4)


def _evidence(command, status, extra=None):
    detail = {
        "engine": "ai-companion-playerengine",
        "command": command,
        "botAcknowledged": True,
        "status": json.dumps(status, separators=(",", ":"))[:1900],
        "inGameOutcomeVerified": False,
    }
    if isinstance(extra, dict):
        detail.update(extra)
    return {"ok": True, "evidence": detail}


def command(body):
    if not isinstance(body, dict):
        return {"ok": False, "error": "Malformed Minecraft command."}
    name = str(body.get("command", ""))
    try:
        if name in ("observe", "status", "inventory", "inspect_block"):
            snapshot = _observe()
            return _evidence("observe", snapshot, {"readOnly": True})
        if name == "auto_status":
            snapshot = _status()
            task = snapshot.get("task") if isinstance(snapshot.get("task"), dict) else {}
            state = str(task.get("state", "idle"))
            status = {
                "status": "complete" if state == "completed" else state,
                "goal": str(task.get("goal", ""))[:64],
                "taskId": str(task.get("taskId", ""))[:64],
                "steps": 1 if state != "idle" else 0,
                "successes": 1 if state == "completed" else 0,
                "verified": False,
                "snapshot": snapshot,
            }
            return _evidence("auto_status", status, {"inGameOutcomeVerified": False})
        if name in ("stop", "auto_stop", "stay"):
            result = stop()
            if not result.get("ok"):
                return result
            return _evidence(name, {"status": "stop_requested", "verified": False}, result.get("evidence"))
        if name in ("natural_goal", "auto_resume", "auto_checkpoint", "jump", "move", "look", "say",
                    "dig_block", "interact_block", "interact_entity", "use_item"):
            return {"ok": False, "error": "This action is not exposed by the reviewed PlayerEngine bridge. JARVIS must choose a supported typed task or report the limitation."}
        if name not in ("auto_goal", "follow", "come", "guard", "collect_wood", "craft_item",
                        "equip_item", "navigate", "place_block"):
            return {"ok": False, "error": "Unsupported AI Companion action."}

        snapshot = _observe()
        selected = _select_companion([snapshot])
        allowed = {
            "command", "goal", "resource", "targetCount", "destination", "arrivalRange",
            "steps", "position", "block", "axis", "length", "width", "depth",
            "item", "destinationSlot", "count", "reference", "face",
        }
        payload = {key: value for key, value in body.items() if key in allowed}
        payload.update({
            "requestId": str(uuid.uuid4()),
            "ownerName": _owner(),
            "companionId": selected["companionId"],
        })
        result = _request("/v1/tasks", "POST", payload, timeout=5)
        if result.get("ok") is not True:
            return {"ok": False, "error": str(result.get("error", "PlayerEngine rejected the task."))[:300]}
        task_status = {
            "status": str(result.get("state", "queued")),
            "goal": str(result.get("goal", body.get("goal", name)))[:64],
            "taskId": str(result.get("taskId", ""))[:64],
            "completed": False,
            "verified": False,
        }
        return _evidence(name, task_status, {
            "taskId": result.get("taskId"),
            "accepted": result.get("accepted") is True,
            "completed": False,
            "inGameOutcomeVerified": False,
        })
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:400]}
