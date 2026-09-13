---
'manifest': patch
---

The mnfst CLI no longer sends a telemetry request per command. Commands are recorded in a local spool (`~/.config/manifest/telemetry-spool.jsonl`, mode 0600) and shipped in one anonymous request per install per day to `/v1/cli-report`, matching the self-hosted install report. The first command ever flushes immediately so a new install is counted the day it appears; the spool is capped at 500 events and a failed send is retried at most hourly. Payload fields and the `MANIFEST_TELEMETRY_DISABLED=1` opt-out are unchanged.
