---
'manifest': patch
---

Speed up the first Overview load: the notification bell no longer refetches the workspace Autofix status on every gateway request and polls once a minute instead of every 15 seconds, and a partial index over unlinked provider attempts (`request_id IS NULL`) stops the Overview and Autofix analytics from scanning ~300 MB of the `agent_messages` heap twice per call.
