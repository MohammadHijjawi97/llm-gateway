import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@solidjs/testing-library';

vi.mock('@solidjs/meta', () => ({
  Title: (props: { children?: unknown }) => <title>{String(props.children ?? '')}</title>,
  Meta: () => null,
}));

let mockIsSelfHosted = false;
vi.mock('../../src/services/setup-status.js', () => ({
  checkIsSelfHosted: () => Promise.resolve(mockIsSelfHosted),
}));

import Cli, { loginCommand } from '../../src/pages/integrations/Cli';

describe('loginCommand', () => {
  it('pins the host on self-hosted, where only the dashboard knows it', () => {
    expect(loginCommand(true, 'https://llm.acme.internal')).toBe(
      'mnfst login --url https://llm.acme.internal',
    );
  });

  it('omits the flag on cloud, where the CLI already defaults there', () => {
    expect(loginCommand(false, 'https://app.manifest.build')).toBe('mnfst login');
  });
});

describe('CLI page', () => {
  beforeEach(() => {
    mockIsSelfHosted = false;
  });

  it('shows the npm install for the published package', () => {
    const { container } = render(() => <Cli />);
    expect(container.textContent).toContain('npm install -g @mnfst/gateway-cli');
  });

  it('shows a bare login on cloud', async () => {
    const { container } = render(() => <Cli />);
    await waitFor(() => expect(container.textContent).toContain('mnfst login'));
    expect(container.textContent).not.toContain('--url');
  });

  it('adds the host flag on self-hosted', async () => {
    mockIsSelfHosted = true;
    const { container } = render(() => <Cli />);
    await waitFor(() =>
      expect(container.textContent).toContain(`mnfst login --url ${window.location.origin}`),
    );
  });

  it('links to the command reference', () => {
    const { container } = render(() => <Cli />);
    const link = container.querySelector('a[href="https://manifest.build/docs/cli/"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
