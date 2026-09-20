---
'manifest': patch
---

Fix self-hosted HTTP deployments failing to start after remote MCP became mandatory. `@better-auth/mcp` rejects a non-loopback HTTP resource URL while the plugin is constructed, so an install with a plain-HTTP `BETTER_AUTH_URL` (a LAN or tailnet hostname) exited before listening. Manifest now runs without the MCP surface on such an origin instead of refusing to boot, and `MCP_ENABLED=false` switches MCP off explicitly.
