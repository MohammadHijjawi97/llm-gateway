---
"manifest": patch
---

A provider that sends response headers and then times out or drops the connection mid-body on a non-streaming request now falls back to the next route and is recorded as a provider 503/504, instead of an M500 with no fallback. Manifest errors raised after routing (M500) now keep their tier, specificity and header-tier fields, so tier filters find them.
