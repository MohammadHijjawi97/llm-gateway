---
'manifest': patch
---

Make Requests log filters fast on a cold cache: harness, status, origin, trigger, provider, and model filters no longer scan every request in range one heap page at a time.
