import type { AuthType, ModelRoute } from 'manifest-shared';
import type { DiscoveredModel } from '../../model-discovery/model-fetcher';
import { openAiModelId } from './public-model-id';

/** What the caller already knows about the route, besides the model name. */
export interface ModelRouteScope {
  provider?: string;
  authType?: AuthType;
  keyLabel?: string | null;
}

export type ModelRouteResolution =
  | { ok: true; route: ModelRoute }
  | { ok: false; reason: 'not_found' | 'wrong_provider' | 'ambiguous' };

const HINT_LIMIT = 20;

/**
 * Whether `name` refers to this discovered model. Accepts every name Manifest
 * publishes for it: the internal id discovery stores, the public id from
 * `/v1/models` (`openrouter/…`, a custom provider's `<alias>/…` or
 * `custom:<uuid>/…`, `…-subscription`), and a custom model's bare name.
 */
export function matchesModelName(model: DiscoveredModel, name: string): boolean {
  if (model.id === name || openAiModelId(model) === name) return true;
  return model.provider.startsWith('custom:') && model.id === `${model.provider}/${name}`;
}

/**
 * Resolve a configured model name to one route on this agent's discovered
 * models. The stored route always carries the canonical provider and internal
 * model id, whichever name the caller used.
 *
 * An explicit `authType` is taken as given (it is not validated against
 * discovery), so the name only has to identify a single model of the provider.
 */
export function resolveModelRoute(
  name: string,
  available: readonly DiscoveredModel[],
  scope: ModelRouteScope = {},
): ModelRouteResolution {
  const named = available.filter((m) => m.authType && matchesModelName(m, name));
  if (named.length === 0) return { ok: false, reason: 'not_found' };

  const provider = scope.provider?.toLowerCase();
  const candidates = provider ? named.filter((m) => m.provider.toLowerCase() === provider) : named;
  if (candidates.length === 0) return { ok: false, reason: 'wrong_provider' };

  const routeKey = (m: DiscoveredModel) =>
    [m.provider.toLowerCase(), scope.authType ?? m.authType, m.id].join('\u0000');
  if (new Set(candidates.map(routeKey)).size > 1) return { ok: false, reason: 'ambiguous' };

  const match = candidates[0];
  const route: ModelRoute = {
    provider: match.provider,
    authType: scope.authType ?? match.authType!,
    model: match.id,
  };
  return { ok: true, route: scope.keyLabel ? { ...route, keyLabel: scope.keyLabel } : route };
}

/** User-facing reason a model name could not be resolved. */
export function describeUnresolvedModel(
  name: string,
  reason: Exclude<ModelRouteResolution, { ok: true }>['reason'],
  available: readonly DiscoveredModel[],
  provider?: string,
): string {
  if (reason === 'ambiguous') {
    return (
      `Model "${name}" is offered by multiple providers — pass an explicit ` +
      `provider + authType so the route is unambiguous.`
    );
  }
  if (reason === 'wrong_provider') {
    return `Model "${name}" is not offered by provider "${provider}" for this agent.`;
  }
  // Suggest the named provider's own models, under the names callers can send.
  const pool = provider
    ? available.filter((m) => m.provider.toLowerCase() === provider.toLowerCase())
    : available;
  const providerHint = provider ? ` (provider: ${provider})` : '';
  if (provider && pool.length === 0) {
    return (
      `Model "${name}" is not in this agent's discovered model list${providerHint}. ` +
      `This agent has no models from "${provider}": connect it or enable it for this agent first.`
    );
  }
  const options = [...new Set(pool.map(openAiModelId))];
  const shown = options.slice(0, HINT_LIMIT);
  return (
    `Model "${name}" is not in this agent's discovered model list${providerHint}. ` +
    `Connect the appropriate provider first, or choose from: ${shown.join(', ')}${
      options.length > shown.length ? ', …' : ''
    }`
  );
}
