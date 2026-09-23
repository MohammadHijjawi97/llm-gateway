---
'manifest': patch
---

Stop overlapping deployments from deadlocking on a concurrent index build: a deployment waiting for the migration lock now polls for it instead of holding a database snapshot while it waits.
