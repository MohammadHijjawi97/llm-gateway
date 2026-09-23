---
'manifest': patch
---

Remove the public usage stats endpoints (`/api/v1/public/usage`, `/free-models`, `/provider-tokens`, `/agent-tokens`, `/free-providers`). They scanned the whole Provider Attempt table for minutes on every refresh. The public error pages endpoint and `MANIFEST_PUBLIC_STATS` are unchanged.
