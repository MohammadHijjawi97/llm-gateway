/**
 * CodeAssist client — talks to `cloudcode-pa.googleapis.com/v1internal:*`.
 *
 * Gemini OAuth tokens for personal Google accounts (the `gemini-cli` flow)
 * cannot hit `generativelanguage.googleapis.com` directly: that API needs
 * either an API key or a billed GCP project for quota attribution. The
 * CodeAssist endpoint is what `gemini-cli` itself uses — Google's own
 * "free tier with personal account" path — and routes by an opaque
 * `cloudaicompanionProject` id assigned to the user during onboarding.
 *
 * Two responsibilities:
 *
 *   1. **Onboarding** — first time we see an OAuth token, call
 *      `:loadCodeAssist` to discover the user's tier + assigned project,
 *      then `:onboardUser` if they don't have one yet. The resulting
 *      project id is persisted in the OAuth token blob's `u` field.
 *      Personal free-tier accounts get a Google-managed project; Workspace
 *      and Standard-tier accounts must bring their own Google Cloud project,
 *      exactly like `gemini-cli`'s `GOOGLE_CLOUD_PROJECT`
 *      (packages/core/src/code_assist/setup.ts).
 *   2. **Envelope wrap/unwrap** — every chat request must be wrapped as
 *      `{ model, project, request: <standard-Gemini-payload> }`; responses
 *      come back as `{ response: <standard-Gemini-payload>, ... }`.
 *      Streaming chunks have the same wrapper shape.
 */
import { Injectable, Logger } from '@nestjs/common';
import { scrubSecrets } from '../../../common/utils/secret-scrub';

const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_VERSION = 'v1internal';
const CODE_ASSIST_OPERATION_POLL_MS = 5_000;
const CODE_ASSIST_OPERATION_MAX_POLLS = 12;
const FREE_TIER_ID = 'free-tier';
const STANDARD_TIER_ID = 'standard-tier';

const CLIENT_METADATA = {
  ideType: 'IDE_UNSPECIFIED',
  platform: 'PLATFORM_UNSPECIFIED',
  pluginType: 'GEMINI',
  pluginVersion: '0.1.0',
} as const;

export interface OnboardResult {
  /** The cloudaicompanionProject id to send on every subsequent request. */
  projectId: string;
  /** The tier id ('free-tier' or 'standard-tier'). */
  tierId: string;
}

interface LoadCodeAssistResponse {
  currentTier?: { id?: string };
  cloudaicompanionProject?: string;
  allowedTiers?: { id: string; isDefault?: boolean }[];
  ineligibleTiers?: { reasonMessage?: string }[];
}

/**
 * A Google account setup problem the user can act on (missing or invalid
 * Google Cloud project, ineligible account). Its message is shown as-is.
 */
export class CodeAssistSetupError extends Error {
  override readonly name = 'CodeAssistSetupError';
}

interface LongRunningOperation {
  done?: boolean;
  name?: string;
  response?: { cloudaicompanionProject?: { id?: string } };
}

@Injectable()
export class CodeAssistClientService {
  private readonly logger = new Logger(CodeAssistClientService.name);

  /**
   * One-time-per-user setup. Returns the project id that must be sent on
   * every chat request thereafter. Idempotent — safe to call repeatedly.
   *
   * @param userProjectId The user's own Google Cloud project id. Required for
   *   Workspace and Standard-tier accounts; ignored by the free tier, which
   *   uses a Google-managed project.
   */
  async onboard(accessToken: string, userProjectId?: string): Promise<OnboardResult> {
    if (userProjectId && /^\d+$/.test(userProjectId)) {
      throw new CodeAssistSetupError(
        `"${userProjectId}" is a Google Cloud project number. Enter the project ID instead (for example my-project-123).`,
      );
    }
    const loaded = await this.callJson<LoadCodeAssistResponse>(':loadCodeAssist', accessToken, {
      cloudaicompanionProject: userProjectId,
      metadata: projectMetadata(userProjectId),
    });

    // Already onboarded: Google assigned a project, or the account's tier
    // expects the user's own.
    if (loaded.currentTier) {
      const projectId = loaded.cloudaicompanionProject ?? userProjectId;
      if (!projectId) throw projectRequiredError(loaded);
      return { projectId, tierId: loaded.currentTier.id ?? STANDARD_TIER_ID };
    }

    // No project yet — pick the default-allowed tier and onboard. For
    // personal accounts this is `free-tier`.
    const tier = loaded.allowedTiers?.find((t) => t.isDefault) ?? loaded.allowedTiers?.[0];
    if (!tier) throw projectRequiredError(loaded);
    // The free tier uses a Google-managed project; sending one makes
    // `onboardUser` fail with Precondition Failed.
    const onboardProjectId = tier.id === FREE_TIER_ID ? undefined : userProjectId;
    const lro = await this.callJson<LongRunningOperation>(':onboardUser', accessToken, {
      tierId: tier.id,
      cloudaicompanionProject: onboardProjectId,
      metadata: projectMetadata(onboardProjectId),
    });
    const completed = await this.waitForOperation(lro, accessToken);
    const projectId = completed.response?.cloudaicompanionProject?.id ?? userProjectId;
    if (!projectId) throw projectRequiredError(loaded);
    return { projectId, tierId: tier.id };
  }

  private async waitForOperation(
    lro: LongRunningOperation,
    accessToken: string,
  ): Promise<LongRunningOperation> {
    let current = lro;
    for (let poll = 0; poll < CODE_ASSIST_OPERATION_MAX_POLLS && current.done !== true; poll++) {
      if (!current.name) {
        throw new Error('CodeAssist onboardUser operation returned no operation name.');
      }
      await new Promise((resolve) => setTimeout(resolve, CODE_ASSIST_OPERATION_POLL_MS));
      current = await this.callOperation(current.name, accessToken);
    }
    if (current.done !== true) {
      throw new Error('CodeAssist onboardUser operation did not complete.');
    }
    return current;
  }

  private async callJson<T>(
    method: ':loadCodeAssist' | ':onboardUser',
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${CODE_ASSIST_BASE}/${CODE_ASSIST_VERSION}${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(`CodeAssist ${method} failed (${response.status}): ${scrubSecrets(text)}`);
      throw new Error(`CodeAssist ${method} failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  private async callOperation(name: string, accessToken: string): Promise<LongRunningOperation> {
    const url = `${CODE_ASSIST_BASE}/${CODE_ASSIST_VERSION}/${name}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      this.logger.error(
        `CodeAssist operation ${name} failed (${response.status}): ${scrubSecrets(text)}`,
      );
      throw new Error(`CodeAssist operation ${name} failed (${response.status})`);
    }
    return (await response.json()) as LongRunningOperation;
  }
}

function projectMetadata(projectId: string | undefined): Record<string, string> {
  return projectId ? { ...CLIENT_METADATA, duetProject: projectId } : { ...CLIENT_METADATA };
}

/** Google's own ineligibility reasons when it gives any, else the project hint. */
function projectRequiredError(loaded: LoadCodeAssistResponse): CodeAssistSetupError {
  const reasons = (loaded.ineligibleTiers ?? [])
    .map((tier) => tier.reasonMessage)
    .filter((reason): reason is string => !!reason);
  if (reasons.length > 0) {
    return new CodeAssistSetupError(`This Google account cannot use Gemini: ${reasons.join(' ')}`);
  }
  return new CodeAssistSetupError(
    'This Google account needs a Google Cloud project (Workspace and Standard-tier accounts do). Enter your project ID and log in again.',
  );
}
