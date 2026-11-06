"""Strict transport projection for Core-approved Minecraft companion commands.

The companion forwards only typed fields understood by the Mineflayer command
protocol. The child remains the canonical validator; this module prevents the
Windows sidecar from silently dropping legitimate typed parameters.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

MINECRAFT_COMMAND_FIELDS = frozenset({
    "command", "directionInput", "durationMs", "text",
    "goal", "durationSeconds", "position", "range", "item", "destination",
    "count", "reference", "face", "entityId", "hand",
    "resource", "targetCount", "arrivalRange", "steps", "block", "axis",
    "length", "width", "depth", "height", "shape", "destinationSlot",
    "mob", "operation", "crop", "maxSwings", "tradeIndex", "times", "choice",
})


def build_minecraft_message(body: Mapping[str, Any], request_id: str) -> dict[str, Any]:
    """Preserve every supported field, reject unknowns, and add transport ID."""
    if not isinstance(body, Mapping) or isinstance(body, (str, bytes)):
        raise ValueError("Minecraft command must be a mapping")
    if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{16}", request_id):
        raise ValueError("Invalid Minecraft transport correlation ID")
    if "id" in body or any(not isinstance(key, str) or key not in MINECRAFT_COMMAND_FIELDS
                           for key in body):
        raise ValueError("Unexpected Minecraft command field")
    if not isinstance(body.get("command"), str) or not body["command"]:
        raise ValueError("Minecraft command name required")
    message = dict(body)
    message["id"] = request_id
    return message
