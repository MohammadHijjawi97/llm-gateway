---
'manifest': patch
---

Faster first paint of the dashboard: sessions are validated from a signed cookie (Better Auth cookie cache, 5 minute max age) instead of a database round trip on every request, and the plan lookup no longer waits behind the session probe. A failed plan lookup is no longer remembered for the session.
