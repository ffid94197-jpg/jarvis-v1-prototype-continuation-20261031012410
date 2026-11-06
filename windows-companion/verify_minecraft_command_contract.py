"""Offline tests for Core-to-Mineflayer typed command forwarding."""
from __future__ import annotations

import unittest
import re
from pathlib import Path

from minecraft_command_contract import MINECRAFT_COMMAND_FIELDS, build_minecraft_message


class MinecraftCommandForwardingTests(unittest.TestCase):
    def test_trade_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "operation": "minecraft_command", "taskId": "task_12345678", "command": "trade_villager", "entityId": 7,
            "tradeIndex": 2, "times": 3,
        }, "0123456789abcdef")
        self.assertEqual(message["tradeIndex"], 2)
        self.assertEqual(message["times"], 3)
        self.assertEqual(message["entityId"], 7)
        self.assertEqual(message["id"], "0123456789abcdef")

    def test_enchant_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "operation": "minecraft_command", "command": "enchant_item", "position": {"x": 1, "y": 64, "z": 2},
            "item": "diamond_sword", "choice": 1,
        }, "0123456789abcdef")
        self.assertEqual(message["choice"], 1)
        self.assertEqual(message["position"], {"x": 1, "y": 64, "z": 2})

    def test_transfer_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "operation": "minecraft_command", "command": "transfer_container", "position": {"x": 1, "y": 64, "z": 2},
            "item": "iron_ingot", "count": 12, "operationDirection": "deposit",
        }, "0123456789abcdef")
        self.assertEqual(message["operation"], "deposit")
        self.assertEqual(message["count"], 12)

    def test_crop_and_volume_fields_survive_forwarding(self):
        crop = build_minecraft_message({
            "operation": "minecraft_command", "command": "auto_goal", "goal": "farm_crop", "crop": "carrots",
            "position": {"x": 1, "y": 64, "z": 2}, "width": 2, "depth": 3,
            "targetCount": 6,
        }, "0123456789abcdef")
        self.assertEqual(crop["crop"], "carrots")
        volume = build_minecraft_message({
            "operation": "minecraft_command", "command": "auto_goal", "goal": "build_volume",
            "position": {"x": 1, "y": 64, "z": 2}, "block": "cobblestone",
            "width": 3, "depth": 3, "height": 2, "shape": "walls",
        }, "0123456789abcdef")
        self.assertEqual(volume["height"], 2)
        self.assertEqual(volume["shape"], "walls")

    def test_hostile_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "operation": "minecraft_command", "command": "attack_hostile", "entityId": 42, "maxSwings": 4,
        }, "0123456789abcdef")
        self.assertEqual(message["maxSwings"], 4)

    def test_unknown_or_reserved_fields_fail_closed(self):
        for body in (
            {"operation": "minecraft_command", "command": "trade_villager", "tradeIndex": 1, "times": 1, "shell": "bad"},
            {"operation": "minecraft_command", "command": "status", "id": "caller-supplied"},
            {"operation": "minecraft_command", "tradeIndex": 1},
        ):
            with self.assertRaises(ValueError):
                build_minecraft_message(body, "0123456789abcdef")

    def test_forwarding_allowlist_covers_child_protocol(self):
        protocol = Path(__file__).with_name("minecraft-bot").joinpath("friend_protocol.cjs").read_text()
        primitive = protocol.split("const primitiveFields={", 1)[1].split("};", 1)[0]
        allowed = protocol.split("const allowedKeys=new Set([", 1)[1].split("]);", 1)[0]
        child_fields = set(re.findall(r"'([A-Za-z][A-Za-z0-9]*)'", primitive))
        child_fields.update(re.findall(r"'([A-Za-z][A-Za-z0-9]*)'", allowed))
        child_fields.add("command")
        self.assertLessEqual(child_fields, MINECRAFT_COMMAND_FIELDS)
        self.assertNotIn("id", MINECRAFT_COMMAND_FIELDS)

    def test_transport_envelope_is_removed_and_transfer_direction_is_mapped(self):
        message = build_minecraft_message({
            "operation": "minecraft_command", "taskId": "task_12345678",
            "command": "transfer_container", "position": {"x": 1, "y": 64, "z": 2},
            "item": "iron_ingot", "count": 12, "operationDirection": "withdraw",
        }, "0123456789abcdef")
        self.assertEqual(message["operation"], "withdraw")
        self.assertNotIn("taskId", message)
        self.assertEqual(message["id"], "0123456789abcdef")

    def test_transfer_direction_rejected_for_unrelated_commands(self):
        with self.assertRaises(ValueError):
            build_minecraft_message({
                "operation": "minecraft_command", "command": "status",
                "operationDirection": "deposit",
            }, "0123456789abcdef")

    def test_invalid_transport_ids_fail_closed(self):
        with self.assertRaises(ValueError):
            build_minecraft_message({"operation": "minecraft_command", "command": "status"}, "not-a-correlation-id")


if __name__ == "__main__":
    unittest.main()
