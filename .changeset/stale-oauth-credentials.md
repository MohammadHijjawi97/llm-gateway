---
"manifest": patch
---

A subscription token that a provider rejects with a 401 before its expiry is now actually refreshed and retried. Before, the refresh was skipped because the stored token had not expired yet, so every request failed on the dead token and fell back. A credential that still gets a 401 (refresh rejected, account refused, or a revoked API key) is now skipped for five minutes instead of being retried on every request, and reconnecting or replacing it is picked up at once.
