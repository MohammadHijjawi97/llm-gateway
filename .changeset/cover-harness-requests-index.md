---
'manifest': patch
---

Make harness-scoped Requests filters (status, error origin) fast on a cold cache: the harness index now covers the columns they test, so a large harness no longer reads one row per request in range.
