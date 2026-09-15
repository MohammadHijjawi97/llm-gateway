import { createMemo, For, type Component } from 'solid-js';
import { Title, Meta } from '@solidjs/meta';
import CodeBlock from '../../components/CodeBlock.jsx';
import { mcpEndpoint } from '../../services/install-endpoints.js';

const DOCS_URL = 'https://manifest.build/docs/integrations/mcp/';

/** One client, one snippet. Kept as data so the page stays a list, not a wall. */
function clientSetups(endpoint: string): { name: string; language: string; code: string }[] {
  return [
    {
      name: 'Claude Code',
      language: 'bash',
      code: `claude mcp add --transport http manifest ${endpoint}`,
    },
    {
      name: 'Codex',
      language: 'bash',
      code: `codex mcp add manifest --url ${endpoint}\ncodex mcp login manifest`,
    },
    {
      name: 'OpenCode',
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

  return (
    <div class="container--sm">
      <Title>MCP server - Manifest</Title>
      <Meta
        name="description"
        content="Connect Claude, Cursor, Codex and other MCP clients to this Manifest install over OAuth."
      />
      <div class="page-header">
        <div>
          <h1>MCP server</h1>
          <span class="breadcrumb">
            Manage harnesses, providers, routing and the request log from any MCP client
          </span>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Your endpoint</span>
            <span class="settings-card__label-desc">
              Point any MCP client here. It signs in with OAuth, so the first connection opens a
              consent screen in your browser.
            </span>
          </div>
        </div>
        <CodeBlock code={endpoint()} language="bash" />
      </div>

      <For each={clientSetups(endpoint())}>
        {(client) => (
          <div class="settings-card">
            <div class="settings-card__row">
              <div class="settings-card__label">
                <span class="settings-card__label-title">{client.name}</span>
              </div>
            </div>
            <CodeBlock code={client.code} language={client.language} />
          </div>
        )}
      </For>

      <div class="settings-card">
        <div class="settings-card__row">
          <div class="settings-card__label">
            <span class="settings-card__label-title">Read-only or read-and-write</span>
            <span class="settings-card__label-desc">
              The consent screen asks which you want. A read-only connection never sees the write
              tools at all, so it can look but not touch.
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
              Full tool list
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpServer;
