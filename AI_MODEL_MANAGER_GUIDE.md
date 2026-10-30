# JARVIS V1 — AI Models UI (Cloud APIs + Local LLMs)

This version adds **AI MODELS** beside **MEMORY** inside the NEXUS Assistant Console (Text Mode). It does not add a third NEXUS mode.

## Setup on Windows

1. Extract this full source into a **new isolated directory**. Preserve the previous working build.
2. Run `bun install --frozen-lockfile` and `bunx prisma generate`. The existing Playwright/Python companion remains separately installed per `NATIVE_WINDOWS_AGENT_SETUP.md`.
3. Copy your *private* `.env` from the previous installation into this project (do not send it to ChatGPT). Keep `DATABASE_URL`, `JARVIS_PUBLIC_ORIGIN`, the local no-login settings, and Windows-companion token as appropriate. Do not copy passwords into any public archive.
4. Use a **new test database** by changing `DATABASE_URL`, then run `bunx prisma db push`. No new Prisma tables were added for the model manager.
5. Run the new model-manager tests (`bun run test:model-manager-offline`) and the project's existing static checks, then start with `bun run dev:windows` on the isolated PC.
6. Open `http://127.0.0.1:3000`, open Assistant Console (Text Mode), and select **AI MODELS**.

## Cloud API

Choose Cloud API and one of these protocols:

- **OpenAI-compatible Chat Completions:** OpenAI, Gemini AI Studio compatibility mode, OpenRouter, Z.ai's compatible endpoints, and other services with the same request/response format. Supply provider API *base URL*, exact model ID and private key. Example Gemini base URL: `https://generativelanguage.googleapis.com/v1beta/openai/`.
- **Anthropic native Messages:** provider base URL `https://api.anthropic.com/v1`, an exact Claude model ID, and a valid Anthropic API key. Replies are currently delivered as one complete update, not token-streamed.

Custom public HTTPS hostnames are accepted only when they fit one of these implemented protocols. APIs with proprietary authentication or message formats need their own adapter. **“Universal” refers to configurable endpoints and these protocol families, not an unsupported claim that literally every API format works.** Some OpenAI-compatible providers require additional fields/headers, so a successful connection test is necessary.

## Local LLM

Choose Local LLM:

- **Ollama native:** `http://127.0.0.1:11434`, exact installed Ollama model ID (e.g. `qwen3:4b`). No API key is normally needed.
- **Local OpenAI-compatible:** `http://127.0.0.1:1234/v1` for LM Studio, or the corresponding loopback address for llama.cpp, vLLM, compatible self-hosted servers, and AirLLM when running a suitable serving API. Use the server's actual model ID; an API key is optional.

The current implementation intentionally only connects to services **on the same PC** over loopback. It does not yet accept unauthenticated HTTP services on LAN IP addresses. This does not mean every model file can be loaded; the model must already be hosted by a compatible server.

## Model management behavior

- `SAVE MODEL`: validates the endpoint and stores the profile (including the API key) encrypted in `.jarvis-private/model-vault/`. This directory is gitignored.
- `TEST CONNECTION`: makes one small actual model request; it can incur quota or charges. A successful test proves connectivity and a basic text reply, **not agent intelligence**.
- `USE`: selects this model for **new tasks**, without restarting JARVIS.
- `EDIT`: edit metadata, or enter a replacement key. An empty edit password field retains the previous key.
- `DELETE`: remove a model profile. Active deletion falls back to the legacy `.env` provider.
- Existing, paused agent tasks have a durable model binding; if their original profile is changed or deleted, resume fails rather than silently routing to another provider.
- Profiles belong to the authenticated OWNER. Devices and unauthenticated requests cannot configure them.

## Credentials and limitations

The model manager never echoes a stored API key back to the browser. It encrypts profile records with a generated AES-256-GCM key on disk. However, the encryption master key is also on the same machine; **this is local-development credential protection, not certified OS-backed DPAPI/TPM storage**. Back up the encrypted profiles and master key together, never put either into source control, and restrict Windows filesystem ACLs to the test operator. Loss of the key makes stored credentials unreadable.

This build was tested in a Linux sandbox using repeated offline fixtures. Actual Windows UI integration, cloud-provider authentication, native app control, and full V1 certification require live checks on your PC. No third-party cloud credentials were used in sandbox testing.
