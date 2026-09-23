import { createHash } from 'crypto';

/** How long a credential the provider rejected with a 401 is skipped. */
export const CREDENTIAL_REJECTION_COOLDOWN_MS = 5 * 60_000;
const MAX_ENTRIES = 2_000;

/** The credential a provider call used, as routing knows it. */
export interface RejectedCredentialRef {
  tenantId?: string;
  provider: string;
  authType?: string;
  keyLabel?: string;
  /** The secret actually sent upstream: an API key or an OAuth access token. */
  secret: string;
}

/**
 * Remembers credentials a provider rejected with a 401, so routing skips them
 * for a while instead of paying an upstream round-trip (and, for OAuth, a
 * refresh attempt) on every request before falling back.
 *
 * Entries are keyed by a fingerprint of the rejected secret. Reconnecting an
 * OAuth subscription or replacing an API key changes the secret, so the new
 * credential is tried at once without any invalidation hook. The state is
 * in-memory per replica: a restart or another replica costs at most one more
 * rejected call before it learns the same thing.
 */
export class CredentialRejectionCooldown {
  private readonly rejectedUntilByKey = new Map<string, number>();

  constructor(
    private readonly ttlMs = CREDENTIAL_REJECTION_COOLDOWN_MS,
    private readonly maxEntries = MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  reject(ref: RejectedCredentialRef): void {
    const key = cooldownKey(ref);
    if (!key) return;
    // Re-insert so insertion order stays expiry order (see evict).
    this.rejectedUntilByKey.delete(key);
    if (this.rejectedUntilByKey.size >= this.maxEntries) this.evict();
    this.rejectedUntilByKey.set(key, this.now() + this.ttlMs);
  }

  /** Epoch ms until which the credential is skipped, or null when it is usable. */
  rejectedUntil(ref: RejectedCredentialRef): number | null {
    const key = cooldownKey(ref);
    if (!key) return null;
    const until = this.rejectedUntilByKey.get(key);
    if (until === undefined) return null;
    if (until <= this.now()) {
      this.rejectedUntilByKey.delete(key);
      return null;
    }
    return until;
  }

  /** Drop expired entries, then the oldest one if the map is still full. */
  private evict(): void {
    const now = this.now();
    for (const [key, until] of this.rejectedUntilByKey) {
      if (until <= now) this.rejectedUntilByKey.delete(key);
    }
    if (this.rejectedUntilByKey.size < this.maxEntries) return;
    // Every entry shares one TTL, so insertion order is expiry order.
    const oldest = this.rejectedUntilByKey.keys().next().value as string;
    this.rejectedUntilByKey.delete(oldest);
  }
}

function cooldownKey(ref: RejectedCredentialRef): string | null {
  if (!ref.tenantId || !ref.secret) return null;
  const fingerprint = createHash('sha256').update(ref.secret).digest('hex').slice(0, 32);
  return [
    ref.tenantId,
    ref.provider.toLowerCase(),
    ref.authType ?? '',
    ref.keyLabel ?? '',
    fingerprint,
  ].join('\u0000');
}
