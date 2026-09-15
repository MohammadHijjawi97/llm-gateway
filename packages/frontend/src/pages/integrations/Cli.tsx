import { createMemo, createResource, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import CodeBlock from '../../components/CodeBlock.jsx';
import { installOrigin } from '../../services/install-endpoints.js';
import { checkIsSelfHosted } from '../../services/setup-status.js';

const DOCS_URL = 'https://manifest.build/docs/cli/';
const PACKAGE = '@mnfst/gateway-cli';

/**
 * On a self-hosted install the CLI has to be told which host to talk to, and
 * this dashboard is the only place that knows it. On Cloud the CLI already
 * defaults there, so the flag would be noise.
 */
export function loginCommand(selfHosted: boolean, origin: string): string {
  return selfHosted ? `mnfst login --url ${origin}` : 'mnfst login';
}

const Cli: Component = () => {
  const [selfHosted] = createResource(checkIsSelfHosted);
  const login = createMemo(() => loginCommand(selfHosted() === true, installOrigin()));

  return (
    <div class="container--sm">
      <Title>CLI - Manifest</Title>
      <Meta
        name="description"
        content="Install the mnfst CLI and manage harnesses, providers, routing and request logs from the terminal."
      />
      <div class="page-header">
        <div>
          <h1>CLI</h1>
          <span class="breadcrumb">
            Everything the dashboard does, from a terminal, a script, or a coding agent
          </span>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Install</span>
            <span class="settings-card__label-desc">
              The package is scoped, but the command you type is <code>mnfst</code>. Its version
              tracks the Manifest release it ships with.
            </span>
          </div>
        </div>
        <CodeBlock code={`npm install -g ${PACKAGE}`} language="bash" />
      </div>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Sign in</span>
            <span class="settings-card__label-desc">
              This opens your browser, you approve, and the CLI stores a token for this host. The
              token never travels through the URL.
            </span>
          </div>
        </div>
        <CodeBlock code={login()} language="bash" />
      </div>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Then</span>
            <span class="settings-card__label-desc">
              Create a harness, connect a provider, set a route, and prove it works with one real
              request.
            </span>
          </div>
          <div class="settings-card__control">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn--outline btn--sm"
              style="text-decoration: none;"
            >
              All commands
            </a>
          </div>
        </div>
        <CodeBlock
          code={`mnfst agent create --name coding-assistant --platform openclaw
mnfst provider connect xai --auth-type api_key --credential-env XAI_API_KEY
mnfst agent configure coding-assistant --models grok-4.5,grok-4 --provider xai
mnfst routing test coding-assistant`}
          language="bash"
        />
      </div>
    </div>
  );
};

export default Cli;
