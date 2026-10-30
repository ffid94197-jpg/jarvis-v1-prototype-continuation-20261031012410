# JARVIS V1 — Autonomous Capability Discovery (experimental)

This edition adds `windows_find_capability` to the existing Core → Guardian → Windows companion tool path. Requests about editing or producing a document/image/video/audio/code/3D model/diagram/presentation/spreadsheet/archive, or working with a game, trigger read-only local discovery before the model chooses a follow-up action. Existing LAYA routing, model selection, MCP, native desktop, routines, voice and face logic are unchanged.

## What happens when you say "Jarvis, I need to edit a video"

1. The Core emits `windows_find_capability` as its first action. The Guardian validates and audits the call.
2. The Windows companion checks the **installed-program registry**, **Start Menu shortcuts**, and **operator-approved app aliases**. It does **not** search or read all personal files or scan arbitrary executable folders.
3. Matches are ranked by task category. Only a checked alias or Start Menu shortcut receives an approved launch tool and appId. Merely having an uninstall-registry entry does not prove an app can launch.
4. If no local match is launchable, a short curated list of official web editors may be suggested, **not automatically opened or given your files**. When the goal indicates private/offline data, online alternatives are withheld.
5. The planner can launch the suggested app through `windows_open_app` or `windows_launch_installed`, then observe the actual GUI and verify the operation. The first discovery step itself does not perform any editing.

For an unspecified request like "I need to edit it", the system asks what type of content you mean. If a mixed request names multiple target types equally, it asks a question rather than arbitrarily choosing the wrong editor.

## Useful acceptance tasks

- `Jarvis, I need to edit a family video. Find the best installed editor on this computer; open it and verify the window is visible. If none is available, suggest official online options and explain what would need to be uploaded.`
- `Jarvis, I need to edit an image. Discover local image editors. Do not use an online editor without my approval.`
- `Jarvis, I need to annotate a confidential PDF. Prefer a local editor; do not upload my document.`
- `Jarvis, fix my Python bug. Discover installed code editors, open one that is available, inspect the screen, and tell me what access is still needed to work on the file.`
- `Jarvis, I need to edit.` — should request the target type rather than invent an editor.

## Repeat offline simulation

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_CAPABILITY_STRESS.ps1 -Rounds 12 -Cases 2500
```

Also run the normal application acceptance checks in this new folder (the Linux test environment cannot verify them):

```powershell
bun install --frozen-lockfile
bunx prisma generate
bunx tsc --noEmit
bun run lint
bun run build
bun run dev:windows
```

The broad installed-program scan and GUI controls require the existing Windows Companion and its operator configuration. The list of online alternative sites is a curated directory, not a real-time search of every available web application; availability, sign-in, privacy and pricing may vary. The user must still grant access to personal files. The tool is read-only. Do not equate discovery, launching, or a sent input with successful task completion; verify postconditions on Windows.

There is no unrestricted system-wide filesystem access or automatic application installation in this change. The Guardian, audit and Ctrl+Shift+F12 stop capability remain as before.
