# NEXUS Orb Home Restoration (2026-10-28)

## Owner-approved navigation

1. Start on **the original Three.js holographic orb** (`JarvisOrb.tsx` / `orbScene.ts`).
2. Centered **CONSOLE** button immediately beneath the orb enters the chat view.
3. The chat header contains **ORB** (returns home) and **SETTINGS** (opens Settings).
4. Settings remains accessible only from chat, and keeps existing provider key management, voice/face enrollment, memory, and device UI.
5. Closing Settings returns to chat; exiting chat returns to the orb. Chat tasks/messages are preserved in React state across navigation.
6. The existing authentication guards and localhost-only development session are unchanged.

## Verification limits

- Source contracts and seeded abstract navigation simulations run through `npm run test:nexus-settings`.
- Not a live Windows browser run. Actual WebGL rendering, click navigation, viewport positioning, Gemini API operations and persistence must be checked on the local installation.
- Orb is mounted when on the home screen and unmounted while in chat; its Three.js context is disposed on exit and recreated on return.
- No `node_modules`, original database, credentials, passphrases or locally generated keys are distributed in this source ZIP.
