---
'manifest': patch
---

Fallback routes now get the same stream warm-up as the primary, so a fallback that returns 200 and never streams a byte moves on to the next route.
