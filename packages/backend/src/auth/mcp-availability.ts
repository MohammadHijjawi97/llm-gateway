/**
 * Whether the remote MCP server can run on this install, decided before Better
 * Auth is constructed.
 *
 * `@better-auth/mcp` validates the protected-resource URL the moment the
 * plugin is built and throws for any non-HTTPS origin that is not loopback.
 * That throw happens while `auth.instance.ts` is being imported, so a
 * self-hosted install served over plain HTTP on a LAN or tailnet hostname
 * cannot start at all — the dashboard and the gateway go down with it, even
 * though neither needs MCP. Deciding here keeps that failure out of boot: an
 * install whose origin cannot carry an MCP resource simply runs without the
 * MCP surface.
 *
 * This module is a leaf on purpose. It imports nothing from Better Auth, so
 * the unit suite — which cannot load that ESM-only package on Node 22 — can
 * cover it, and `setup.service.ts` can report the same answer to the dashboard
 * without pulling the auth instance into its own spec. Same reason
 * `mcp-scopes.ts` exists.
 */

const DEFAULT_PORT = '3001';
const MCP_ROUTE = '/api/v1/mcp';
const FALSEY = new Set(['false', '0', 'no', 'off']);

/**
 * The canonical origin Better Auth, its issuer, and the MCP resource all
 * derive from. Trailing slashes are stripped so a later change to one cannot
 * silently split it from the others.
 */
export function authOriginFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const port = env['PORT'] ?? DEFAULT_PORT;
  return (env['BETTER_AUTH_URL'] ?? `http://localhost:${port}`).replace(/\/+$/, '');
}

export function mcpResourceFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return `${authOriginFromEnv(env)}${MCP_ROUTE}`;
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true;
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d+$/.test(octet) && Number(octet) <= 255)
  );
}

/**
 * Mirrors `@better-auth/mcp`'s own rule for a usable protected-resource URL:
 * HTTPS, or HTTP on loopback for local development. Kept in step with that
 * library deliberately — this predicate exists to answer "would constructing
 * the plugin throw?" without constructing it.
 */
export function isMcpCapableResource(resource: string): boolean {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
}

export interface McpAvailability {
  enabled: boolean;
  /** Why MCP is off, for the boot log and the dashboard; null when it is on. */
  reason: string | null;
}

/**
 * MCP is on by default and turns itself off in the two cases where it cannot
 * serve: the operator said so with `MCP_ENABLED=false`, or the configured
 * origin cannot carry an MCP resource at all.
 *
 * The second case is not an opt-in, because it has to hold for an install that
 * is already running: the HTTP-only deployments this protects upgrade into the
 * crash and never get a chance to set a variable first.
 */
export function resolveMcpAvailability(env: NodeJS.ProcessEnv = process.env): McpAvailability {
  const flag = env['MCP_ENABLED'];
  if (flag && FALSEY.has(flag.trim().toLowerCase())) {
    return { enabled: false, reason: 'disabled by MCP_ENABLED' };
  }
  const resource = mcpResourceFromEnv(env);
  if (!isMcpCapableResource(resource)) {
    return {
      enabled: false,
      reason:
        `the MCP resource ${resource} must use HTTPS (loopback HTTP is allowed for ` +
        'development). Serve this install over HTTPS, or set MCP_ENABLED=false to ' +
        'silence this notice. The dashboard and the gateway are unaffected.',
    };
  }
  return { enabled: true, reason: null };
}
