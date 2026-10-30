# JARVIS V1 — Console Settings and Local Laya Router (2026-10-28)

## Where it lives

Open NEXUS → **ASSISTANT CONSOLE** → **⚙ SETTINGS**.

- **LAYA ROUTING**: Auto/manual mode, privacy policy, Laya local server, quality/speed/cost priorities, health check, and task-to-model routing preview.
- **AI MODELS · API / LOCAL**: Save cloud APIs or local LLM servers, set strengths (reasoning, coding, vision, speed, affordability), enable/disable profiles, connection test, choose manual model. API keys remain encrypted on the JARVIS server. Ratings are user-entered, NOT benchmark facts.

The old top-level **AI MODELS** console header button is removed; its functionality is under Settings.

## Routing (new tasks only)

The Core calls `selectTaskModel(ownerId, objective)` and persists `model_route` and `model_pin` records before opening the model bridge. A resumed task keeps its previous model/version, even if Settings changed. No model switch may change Guardian authorization.

1. Enforce privacy policy. `Auto` uses keyword-level sensitive-content detection, `Local only` disallows cloud, `Cloud allowed` is an explicit owner override.
2. Remove disabled or privacy-ineligible profiles. A task with no permissible model is **blocked** rather than disclosed to cloud. No saved profiles uses the old `.env` model only for non-sensitive tasks.
3. Exactly **one** eligible model: select it without Laya inference.
4. **Multiple**: score configured reasoning/coding/vision against task category and workload with owner-configured quality/speed/cost priorities. When enabled, send a typed `choice` question to the **local** Laya server and accept its suggestion if confidence is adequate and it is within 15% of the top weighted score. Otherwise deterministic ranking is used and the fallback is recorded.
5. In manual mode, the chosen enabled profile applies (except when a sole privacy-eligible model exists); privacy still applies. All provider requests use the existing encrypted owner profile and model bridge.

Important limitations: Privacy keyword detection is not a formal PII/DLP system; actual task steps may encounter data not visible in the initial objective. An enabled profile does not prove a provider is currently online—use **TEST CONNECTION**. The router does not silently retry a failed task on a different cloud API.

## Install the actual open-source Laya inference model (optional)

JARVIS has a fully working **deterministic weight-based fallback** without Laya installed. To use the actual open-source decision model, install official `laya[serve]` on the same PC (Python 3.10+; 3.11 suggested if compatible with your environment):

```powershell
py -3.11 -m venv .laya-venv
.\.laya-venv\Scripts\python.exe -m pip install "laya[serve]"
$env:LAYA_HOST = "127.0.0.1"
$env:LAYA_PORT = "8000"
$env:LAYA_MODELS = "english"
.\.laya-venv\Scripts\laya-serve.exe
```

Keep that PowerShell window open. The Laya service can download a ~800 MB checkpoint from Hugging Face on first run, and may need PyTorch-compatible GPU/CPU installation. `LAYA_MODELS=english` preloads one checkpoint; the local Laya Router may select another checkpoint for multilingual requests. Set `LAYA_DEVICE=cpu` if CUDA isn't available. Configure `http://127.0.0.1:8000` in JARVIS Settings → LAYA ROUTING, click **SAVE**, then **TEST LOCAL LAYA SERVER**.

Upstream: https://github.com/NandhaKishorM/laya (Apache 2.0); HTTP contract: `POST /v1/systemone` with `state` and `questions`, `choice` response at `answers.model.choice`.

The installed JARVIS ZIP does **not** bundle Laya's model weights or the Laya Python package. Real Laya inference requires the external localhost service; its absence is clearly indicated by the deterministic fallback. Do not confuse its typed decisions with a generative chat model.

## Validate on Windows

```powershell
bun install --frozen-lockfile
bunx prisma generate
bun run test:laya-offline
bunx tsc --noEmit
bun run lint
bun run build
bun run dev:windows
```

For repeated tests, run `RUN_LAYA_ACCEPTANCE.ps1` in PowerShell. Keep your existing `.env` (and the `.jarvis-private/model-vault/master.key` if upgrading an existing install). Never delete or regenerate an old vault master key; it is necessary to decrypt existing model credentials. Copy the vault folder locally only through an appropriate trusted migration procedure. Use a new test database when testing in a separate folder. Live Windows, external Gemini/Ollama, and Laya weights are not exercised by the provided Linux offline tests.
