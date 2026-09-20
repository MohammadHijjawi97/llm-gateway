import {
  authOriginFromEnv,
  isMcpCapableResource,
  mcpResourceFromEnv,
  resolveMcpAvailability,
} from './mcp-availability';

describe('authOriginFromEnv', () => {
  it('uses BETTER_AUTH_URL with trailing slashes stripped', () => {
    expect(authOriginFromEnv({ BETTER_AUTH_URL: 'https://app.manifest.build//' })).toBe(
      'https://app.manifest.build',
    );
  });

  it('falls back to loopback on PORT', () => {
    expect(authOriginFromEnv({ PORT: '4242' })).toBe('http://localhost:4242');
  });

  it('falls back to the default port when PORT is unset', () => {
    expect(authOriginFromEnv({})).toBe('http://localhost:3001');
  });
});

describe('mcpResourceFromEnv', () => {
  it('appends the MCP route to the auth origin', () => {
    expect(mcpResourceFromEnv({ BETTER_AUTH_URL: 'https://mnfst.example.com' })).toBe(
      'https://mnfst.example.com/api/v1/mcp',
    );
  });
});

describe('reading process.env by default', () => {
  const saved = { url: process.env['BETTER_AUTH_URL'], port: process.env['PORT'] };

  beforeEach(() => {
    process.env['BETTER_AUTH_URL'] = 'https://env-default.example.com';
    delete process.env['PORT'];
  });

  afterEach(() => {
    if (saved.url === undefined) delete process.env['BETTER_AUTH_URL'];
    else process.env['BETTER_AUTH_URL'] = saved.url;
    if (saved.port === undefined) delete process.env['PORT'];
    else process.env['PORT'] = saved.port;
  });

  it('authOriginFromEnv reads the ambient environment', () => {
    expect(authOriginFromEnv()).toBe('https://env-default.example.com');
  });

  it('mcpResourceFromEnv reads the ambient environment', () => {
    expect(mcpResourceFromEnv()).toBe('https://env-default.example.com/api/v1/mcp');
  });

  it('resolveMcpAvailability reads the ambient environment', () => {
    expect(resolveMcpAvailability()).toEqual({ enabled: true, reason: null });
  });
});

describe('isMcpCapableResource', () => {
  it.each([
    'https://app.manifest.build/api/v1/mcp',
    'http://localhost:3001/api/v1/mcp',
    'http://127.0.0.1:3001/api/v1/mcp',
    'http://127.5.5.5/api/v1/mcp',
    'http://[::1]:3001/api/v1/mcp',
  ])('accepts %s', (resource) => {
    expect(isMcpCapableResource(resource)).toBe(true);
  });

  it.each([
    'http://manifest.example.internal/api/v1/mcp',
    'http://192.168.1.50:3001/api/v1/mcp',
    'http://manifest.tail1234.ts.net/api/v1/mcp',
    'http://128.0.0.1/api/v1/mcp',
    'ftp://example.com/api/v1/mcp',
    'not a url',
  ])('rejects %s', (resource) => {
    expect(isMcpCapableResource(resource)).toBe(false);
  });
});

describe('resolveMcpAvailability', () => {
  it('enables MCP on an HTTPS origin', () => {
    expect(resolveMcpAvailability({ BETTER_AUTH_URL: 'https://mnfst.example.com' })).toEqual({
      enabled: true,
      reason: null,
    });
  });

  it('enables MCP on the loopback default used in development', () => {
    expect(resolveMcpAvailability({})).toEqual({ enabled: true, reason: null });
  });

  it.each(['false', 'FALSE', '0', 'no', 'off'])('disables MCP when MCP_ENABLED=%s', (value) => {
    const result = resolveMcpAvailability({
      BETTER_AUTH_URL: 'https://mnfst.example.com',
      MCP_ENABLED: value,
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('MCP_ENABLED');
  });

  it.each(['true', '1', 'yes', 'on', ''])('keeps MCP on when MCP_ENABLED=%s', (value) => {
    expect(
      resolveMcpAvailability({ BETTER_AUTH_URL: 'https://mnfst.example.com', MCP_ENABLED: value }),
    ).toEqual({ enabled: true, reason: null });
  });

  it('disables MCP on a plain-HTTP non-loopback origin instead of letting boot fail', () => {
    const result = resolveMcpAvailability({
      BETTER_AUTH_URL: 'http://manifest.example.internal',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('http://manifest.example.internal/api/v1/mcp');
    expect(result.reason).toContain('HTTPS');
  });

  it('reports the explicit opt-out even when the origin is also incapable', () => {
    const result = resolveMcpAvailability({
      BETTER_AUTH_URL: 'http://manifest.example.internal',
      MCP_ENABLED: 'false',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('MCP_ENABLED');
  });

  it('still refuses an incapable origin when MCP_ENABLED asks for it', () => {
    const result = resolveMcpAvailability({
      BETTER_AUTH_URL: 'http://192.168.1.50:3001',
      MCP_ENABLED: 'true',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });
});
