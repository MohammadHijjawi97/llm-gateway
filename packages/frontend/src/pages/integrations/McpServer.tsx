import { createMemo, createSignal, For, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import CodeBlock from '../../components/CodeBlock.jsx';
import { mcpEndpoint } from '../../services/install-endpoints.js';

const DOCS_URL = 'https://manifest.build/docs/integrations/mcp/';

interface ClientSetup {
  id: string;
  label: string;
  language: string;
  code: string;
}

/** One client, one snippet. Data, so the page stays a tab list rather than a wall. */
export function clientSetups(endpoint: string): ClientSetup[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      language: 'bash',
      code: `claude mcp add --transport http manifest ${endpoint}`,
    },
    {
      id: 'codex',
      label: 'Codex',
      language: 'bash',
      code: `codex mcp add manifest --url ${endpoint}\ncodex mcp login manifest`,
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      language: 'json',
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "manifest": {
      "type": "remote",
      "url": "${endpoint}",
      "enabled": true
    }
  }
}`,
    },
  ];
}

const McpServer: Component = () => {
  const endpoint = createMemo(() => mcpEndpoint());
  const clients = createMemo(() => clientSetups(endpoint()));
  const [activeId, setActiveId] = createSignal('claude-code');
  const active = createMemo(() => clients().find((c) => c.id === activeId()) ?? clients()[0]);

  return (
    <div class="container--lg">
      <Title>MCP server - Manifest</Title>
      <Meta
        name="description"
        content="Connect Claude, Cursor, Codex and other MCP clients to this Manifest install over OAuth."
      />
      <div class="page-header">
        <div>
          <h1 class="page-header__title">MCP server</h1>
          <p class="page-header__subtitle">
            Manage harnesses, providers, routing and the request log from any MCP client
          </p>
        </div>
      </div>

      <div class="panel">
        <div class="panel__title">Your endpoint</div>
        <p class="integration-panel__desc">
          Point any MCP client here. It signs in with OAuth, so the first connection opens a consent
          screen in your browser and keeps a short-lived, revocable token.
        </p>
        <CodeBlock code={endpoint()} language="bash" />
      </div>

      <div class="panel">
        <div class="panel__title">Connect your client</div>
        <div class="integration-panel__tabs">
          <div class="panel__tabs" role="tablist" aria-label="MCP client">
            <For each={clients()}>
              {(client) => (
                <button
                  type="button"
                  class="panel__tab"
                  classList={{ 'panel__tab--active': activeId() === client.id }}
                  role="tab"
                  aria-selected={activeId() === client.id}
                  onClick={() => setActiveId(client.id)}
                >
                  {client.label}
                </button>
              )}
            </For>
          </div>
        </div>
        <CodeBlock code={active().code} language={active().language} />
        <p class="integration-panel__desc" style="margin: var(--gap-md) 0 0;">
          Any other client works the same way. Add the endpoint and approve it in the browser.
        </p>
      </div>

      <div class="panel">
        <div class="integration-panel__header">
          <div class="panel__title">Read-only or read-and-write</div>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn--outline btn--sm"
            style="text-decoration: none;"
          >
            Full tool list
          </a>
        </div>
        <p class="integration-panel__desc" style="margin-bottom: 0;">
          The consent screen asks which you want. A read-only connection never sees the write tools
          at all, so it can look but not touch.
        </p>
      </div>
    </div>
  );
};

export default McpServer;
