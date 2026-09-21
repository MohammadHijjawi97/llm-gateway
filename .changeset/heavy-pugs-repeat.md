---
'manifest': patch
---

Fix remote MCP connections stalling in Claude Code. `subscriptions/listen` is served over SSE whatever the response mode says, and buffering that body held back the acknowledgement the client waits for, so every listen attempt hung until the client timed out and the connection handshake stalled behind it. Stream those responses instead, and stop advertising `tools.listChanged`, which a per-request server can never send.
