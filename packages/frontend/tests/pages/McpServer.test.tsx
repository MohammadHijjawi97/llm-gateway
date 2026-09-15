import { describe, it, expect, vi } from 'vitest';
import { render } from '@solidjs/testing-library';

vi.mock('@solidjs/meta', () => ({
  Title: (props: { children?: unknown }) => <title>{String(props.children ?? '')}</title>,
  Meta: () => null,
}));

import McpServer from '../../src/pages/integrations/McpServer';
import { mcpEndpoint, installOrigin } from '../../src/services/install-endpoints';

describe('install-endpoints', () => {
  it('derives the origin from the browser', () => {
    expect(installOrigin()).toBe(window.location.origin);
  });

  it('builds the MCP endpoint under the install origin', () => {
    expect(mcpEndpoint()).toBe(`${window.location.origin}/api/v1/mcp`);
  });
});

describe('MCP server page', () => {
  it('shows this install own endpoint, not a hardcoded host', () => {
    const { container } = render(() => <McpServer />);
    expect(container.textContent).toContain(`${window.location.origin}/api/v1/mcp`);
    expect(container.textContent).not.toContain('app.manifest.build');
  });

  it('renders a snippet for every supported client, each carrying the endpoint', () => {
    const { container } = render(() => <McpServer />);
    const text = container.textContent ?? '';
    for (const client of ['Claude Code', 'Codex', 'OpenCode']) {
      expect(text).toContain(client);
    }
    expect(text).toContain('claude mcp add --transport http manifest');
    expect(text).toContain('codex mcp add manifest --url');
    expect(text).toContain('opencode.ai/config.json');
  });

  it('explains the read-only scope and links to the tool list', () => {
    const { container } = render(() => <McpServer />);
    expect(container.textContent).toContain('never sees the write');
    const link = container.querySelector('a[href="https://manifest.build/docs/integrations/mcp/"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
