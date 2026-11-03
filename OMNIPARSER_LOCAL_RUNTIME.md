# Native JARVIS OmniParser v2 — exact optional runtime

The JARVIS Core/Guardian and its Windows Companion remain the only assistant
planner and effect executor. This adds an **actual read-only model driver** for
official OmniParser v2; it is not an independent agent. Neither OpenHands nor
any other external framework obtains command/screen-control authority.

## Provenance

Source: https://github.com/microsoft/OmniParser
Pinned official checkout commit:
`354021201345a96178360b28733573e27269f2de`.

The runtime imports official `util.omniparser.Omniparser` and calls its
`parse(image_base64)`; **upstream source and weights are not copied into
this repository**. Follow the upstream repository and Hugging Face model-card
terms for both source and model weights. Prefer v2's YOLOv9-E detector and
Florence caption model, and verify each downloaded artifact and its license.

## One-time operator Windows setup (not executed in GitHub)

Run within the **Prototype JARVIS Windows checkout**:

```powershell
git clone https://github.com/microsoft/OmniParser.git external\OmniParser
git -C external\OmniParser checkout 354021201345a96178360b28733573e27269f2de
python -m venv .venv-omniparser
.\.venv-omniparser\Scripts\python.exe -m pip install -r external\OmniParser\requirements.txt
.\.venv-omniparser\Scripts\python.exe -m pip install huggingface_hub
```

Download the v2 official detector into
`external\OmniParser\weights\icon_detect_v3\model.pt` and Florence
caption model into
`external\OmniParser\weights\icon_caption_florence\`.
The upstream README gives current Hugging Face commands, including the
temporary `refs/pr/37` detector revision where applicable. Large model
weights require user-managed disk space, model trust, and hardware resources.

Start **only on your own isolated Windows PC**, in a terminal with a
random private secret (not included in scripts, commits, logs, or screenshots):

```powershell
$env:JARVIS_OMNIPARSER_ENABLED="1"
$env:JARVIS_SCREEN_WATCH_ENABLED="1"
$env:JARVIS_EXPERIMENTAL_DESKTOP_CONTROL="1"
$env:JARVIS_OMNIPARSER_PORT="53071"
# Generate a unique unpredictable 32+ character secret locally:
$secret = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secret)
$env:JARVIS_OMNIPARSER_TOKEN=[Convert]::ToBase64String($secret)
.\.venv-omniparser\Scripts\python.exe windows-companion\omniparser_server.py --root external\OmniParser
```

Provide the **same secret and port** to the existing private JARVIS Windows
Companion process; environment variables are per process on Windows.
Never use a LAN bind or publish the inference endpoint, and do not commit
a `.env` containing the token. When disabled, the existing native
desktop-observation path operates without OmniParser.

The client captures a bounded local frame, sends it exclusively to
`127.0.0.1`, and returns at most 40 untrusted visual detection hints;
no coordinates or model output are automatically actionable. JARVIS must
re-inspect actual UIA controls and obtain Guardian approval before effects.
The model call has a 50-second local deadline; slow hardware may produce
an honest unavailable result rather than invented detections.

## Focused validation without GitHub Actions

```powershell
python windows-companion/verify_omniparser_offline.py
python windows-companion/verify_omniparser_loopback_offline.py
node scripts/verify-memory-route.cjs
node scripts/verify-memory-contracts.cjs
node scripts/verify-windows-policy.cjs
npx tsc --noEmit
```

Run the real Windows `windows_desktop_observe` action with explicit
test-mode flags and installed model only after offline gates. Verify
that disabling any opt-in yields no inference and that the response
does not authorize clicks or leak a screenshot. Full release acceptance
requires real Windows/model/Guardian/Minecraft tests.

**Honest status:** The real-model server implementation is in source,
but its official weights, dependencies and live Windows execution are
not installed or verified in this GitHub-only session.
