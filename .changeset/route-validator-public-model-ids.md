---
"manifest": patch
---

Setting a route or fallback now accepts every name Manifest publishes for a model: the id shown in `/v1/models` (including a custom provider's alias), a custom model's bare name next to its provider, or the internal id. Before, a brand-new harness rejected valid custom-provider and OpenRouter models with an unrelated "choose from" list; that hint now lists the named provider's own models.
