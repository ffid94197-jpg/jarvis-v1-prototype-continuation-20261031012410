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
    """Project the Windows transport envelope into a child-protocol message."""
    if not isinstance(body, Mapping) or isinstance(body, (str, bytes)):
        raise ValueError("Minecraft command must be a mapping")
    if body.get("operation") != "minecraft_command":
        raise ValueError("Unexpected Windows companion operation")
    if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{16}", request_id):
        raise ValueError("Invalid Minecraft transport correlation ID")

    # bridge.ts sends DesktopPrepared plus taskId. The outer operation and
    # task ID are transport metadata, not Mineflayer command arguments.
    envelope_fields = {"operation", "operationDirection", "taskId"}
    if any(not isinstance(key, str) or
           (key not in MINECRAFT_COMMAND_FIELDS and key not in envelope_fields)
           for key in body):
        raise ValueError("Unexpected Minecraft command field")
    if "taskId" in body and body["taskId"] is not None and (
        not isinstance(body["taskId"], str) or not 1 <= len(body["taskId"]) <= 128
    ):
        raise ValueError("Invalid Core task correlation ID")
    command = body.get("command")
    if not isinstance(command, str) or not command:
        raise ValueError("Minecraft command name required")

    message = {key: value for key, value in body.items()
               if key in MINECRAFT_COMMAND_FIELDS and key != "operation"}
    if "operationDirection" in body:
        direction = body["operationDirection"]
        is_transfer = command == "transfer_container" or (
            command == "auto_goal" and body.get("goal") == "transfer"
        )
        if not is_transfer or direction not in ("deposit", "withdraw"):
            raise ValueError("Transfer direction is valid only for a transfer goal")
        message["operation"] = direction
    message["id"] = request_id
    return message

# Commands that may legitimately await local-model interpretation or a real
# inventory/window transaction. Keep bounded; STOP is independently responsive.
_SLOW_ACK_COMMANDS = frozenset({
    "natural_goal", "craft_item", "inspect_villager", "trade_villager",
    "transfer_container", "enchant_item", "attack_hostile",
})


def minecraft_ack_timeout_seconds(command: Any) -> int:
    """Return a bounded child ACK deadline aligned to the command's work."""
    return 30 if command in _SLOW_ACK_COMMANDS else 8

