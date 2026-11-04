# JARVIS native Minecraft recipe-graph adaptation — 2026-11-04

## Selected upstream work
- Mindcraft: https://github.com/mindcraft-bots/mindcraft
- Source file: `src/agent/npc/item_goal.js`
- Inspected upstream source blob: `9055f54a097c48d50282f94955a622c6e230f8af`
- Original author and copyright: Kolby Nottingham, 2024
- Upstream license: MIT

The existing JARVIS Minecraft companion already uses Mineflayer, has its own bounded
owner-language route, Guardian authorization, durable mission controller, inventory
and equipment receipts. Copying the whole Mindcraft runner or Voyager dynamic-code
sandbox would launch a competing agent and risk executing untrusted generated code.

Instead `windows-companion/minecraft-bot/mindcraft_recipe_graph.cjs` adapts
Mindcraft's recipe dependency-graph idea (ingredient nodes, best available recipe,
recursive prerequisite selection, and inventory-based completion), using the current
Minecraft version's local registry and JARVIS's existing typed actions. The
implementation is rewritten, bounded (five dependency levels, 64 nodes), and
contains no dynamically generated code, external model, new process, HTTP calls or
new npm dependency. It is not an independent agent.

## Validation and limitations
This adaptation recognizes more crafting recipes from the installed
Minecraft version. It does NOT certify that all ingredients can be acquired
autonomously; lacking a permitted material source must result in BLOCKED.
The existing server-observed inventory count is the sole goal completion proof.
All actual game effects still flow through the existing owner/Guardian-gated
Minecraft companion. The live Windows Java playthrough and complete package
build remain mandatory and are not replaced by isolated tests.

## Upstream MIT license notice
MIT License

Copyright (c) 2024 Kolby Nottingham

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
