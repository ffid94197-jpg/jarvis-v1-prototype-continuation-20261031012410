"""Offline tests for Core-to-Mineflayer typed command forwarding."""
from __future__ import annotations

import unittest

from minecraft_command_contract import build_minecraft_message


class MinecraftCommandForwardingTests(unittest.TestCase):
    def test_trade_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "command": "trade_villager", "entityId": 7,
            "tradeIndex": 2, "times": 3,
        }, "0123456789abcdef")
        self.assertEqual(message["tradeIndex"], 2)
        self.assertEqual(message["times"], 3)
        self.assertEqual(message["entityId"], 7)
        self.assertEqual(message["id"], "0123456789abcdef")

    def test_enchant_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "command": "enchant_item", "position": {"x": 1, "y": 64, "z": 2},
            "item": "diamond_sword", "choice": 1,
        }, "0123456789abcdef")
        self.assertEqual(message["choice"], 1)
        self.assertEqual(message["position"], {"x": 1, "y": 64, "z": 2})

    def test_transfer_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "command": "transfer_container", "position": {"x": 1, "y": 64, "z": 2},
            "item": "iron_ingot", "count": 12, "operation": "deposit",
        }, "0123456789abcdef")
        self.assertEqual(message["operation"], "deposit")
        self.assertEqual(message["count"], 12)

    def test_crop_and_volume_fields_survive_forwarding(self):
        crop = build_minecraft_message({
            "command": "auto_goal", "goal": "farm_crop", "crop": "carrots",
            "position": {"x": 1, "y": 64, "z": 2}, "width": 2, "depth": 3,
            "targetCount": 6,
        }, "0123456789abcdef")
        self.assertEqual(crop["crop"], "carrots")
        volume = build_minecraft_message({
            "command": "auto_goal", "goal": "build_volume",
            "position": {"x": 1, "y": 64, "z": 2}, "block": "cobblestone",
            "width": 3, "depth": 3, "height": 2, "shape": "walls",
        }, "0123456789abcdef")
        self.assertEqual(volume["height"], 2)
        self.assertEqual(volume["shape"], "walls")

    def test_hostile_fields_survive_forwarding(self):
        message = build_minecraft_message({
            "command": "attack_hostile", "entityId": 42, "maxSwings": 4,
        }, "0123456789abcdef")
        self.assertEqual(message["maxSwings"], 4)

    def test_unknown_or_reserved_fields_fail_closed(self):
        for body in (
            {"command": "trade_villager", "tradeIndex": 1, "times": 1, "shell": "bad"},
            {"command": "status", "id": "caller-supplied"},
            {"tradeIndex": 1},
        ):
            with self.assertRaises(ValueError):
                build_minecraft_message(body, "0123456789abcdef")

    def test_invalid_transport_ids_fail_closed(self):
        with self.assertRaises(ValueError):
            build_minecraft_message({"command": "status"}, "not-a-correlation-id")


if __name__ == "__main__":
    unittest.main()
