# Examples to give JARVIS

1. "Jarvis, download and inspect the skill in `https://github.com/owner/repository`. Tell me what is supported and request approval to enable it."
2. "Jarvis, list all approved skills and load the `inspect-code` skill when working on this repository."
3. "Jarvis, use the approved MCP server to discover its tools. Then call the relevant tool to help with the task and verify its response."

For an official read-only example, register `https://developers.openai.com/mcp` directly in Settings → SKILLS · MCP · TOOLS (Direct MCP endpoint). This public documentation endpoint is documented by OpenAI, but its live availability and authentication were NOT checked by this release. The endpoint's tool names must be discovered live before using them.

Remember: a staged package is not installed/approved; a registered server isn't necessarily reachable; an MCP receipt is not proof of an external-side-effect outcome.
