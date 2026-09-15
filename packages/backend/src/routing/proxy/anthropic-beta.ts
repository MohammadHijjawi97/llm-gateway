/**
 * `anthropic-beta` is how a caller opts into Anthropic API features that are
 * still gated behind a flag — structured outputs, context management, adaptive
 * thinking and friends. The body fields those features add (`output_config`,
 * `context_management`, `diagnostics`, `speed`, …) are only legal when the
 * matching flag rides along; without it Anthropic validates against the
 * non-beta schema and answers `<field>: Extra inputs are not permitted`.
 *
 * Manifest builds every upstream header set from scratch, so the caller's own
 * `anthropic-beta` never reached Anthropic: the api_key path sent no flags at
 * all and the subscription path sent a hardcoded list that goes stale the
 * moment Anthropic ships a new beta. Both turned perfectly valid client
 * requests into 400s. We merge instead of replace — Manifest keeps the flags
 * its own routes depend on (the OAuth pair on the subscription path) and the
 * caller's flags are appended.
 *
 * Caller flags are attacker-controlled input that ends up in an outbound
 * header, so they are sanitized rather than trusted: lowercase header tokens
 * only, bounded in count and in total size. A deliberately un-curated
 * pass-through — an allowlist here would reintroduce exactly the staleness
 * this fixes.
 */

/** A flag is a lowercase token: `structured-outputs-2025-11-13`. Max 64 chars. */
const BETA_FLAG_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Most flags a caller may contribute. Anthropic's own betas number in the dozens. */
export const MAX_CLIENT_BETA_FLAGS = 20;

/** Ceiling on the caller's contribution, so no request can inflate the header. */
export const MAX_CLIENT_BETA_BYTES = 1024;

/**
 * The caller's usable beta flags, in the order they were sent. Anything that is
 * not a well-formed flag — wrong case, whitespace, an embedded CRLF — is
 * dropped without failing the request; a malformed flag is the caller's
 * mistake, not a reason to refuse traffic Anthropic might well accept.
 */
export function parseClientBetas(header: unknown): string[] {
  // A repeated header arrives as an array; Anthropic reads either spelling as
  // one comma-separated list.
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string') return [];

  const kept: string[] = [];
  let bytes = 0;
  for (const segment of raw.split(',')) {
    const flag = segment.trim();
    if (!BETA_FLAG_RE.test(flag) || kept.includes(flag)) continue;
    const grown = bytes + flag.length + (kept.length > 0 ? 1 : 0);
    if (grown > MAX_CLIENT_BETA_BYTES) break;
    kept.push(flag);
    bytes = grown;
    if (kept.length === MAX_CLIENT_BETA_FLAGS) break;
  }
  return kept;
}

/**
 * Manifest's required flags followed by whatever else the caller asked for.
 * Returns `manifestHeader` untouched when the caller contributed nothing, so a
 * request that sent no beta header is byte-identical to before this existed.
 */
export function mergeAnthropicBeta(
  manifestHeader: string | undefined,
  clientHeader: unknown,
): string | undefined {
  const clientFlags = parseClientBetas(clientHeader);
  if (clientFlags.length === 0) return manifestHeader;

  const merged = manifestHeader
    ? manifestHeader
        .split(',')
        .map((flag) => flag.trim())
        .filter(Boolean)
    : [];
  for (const flag of clientFlags) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged.join(',');
}
