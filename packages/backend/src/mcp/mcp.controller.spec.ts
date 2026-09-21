import { McpController } from './mcp.controller';
import type { Request, Response } from 'express';
import { PassThrough } from 'node:stream';

jest.mock('../auth/auth.instance', () => ({
  auth: { $context: Promise.resolve({ baseURL: '', internalAdapter: {} }) },
  authIssuer: 'http://localhost:3001/api/auth',
  mcpResource: 'http://localhost:3001/api/v1/mcp',
  authIssuerForHost: (host: string) =>
    host === 'gateway.manifest.build'
      ? 'https://gateway.manifest.build/api/auth'
      : 'http://localhost:3001/api/auth',
  mcpResourceForHost: (host: string) =>
    host === 'gateway.manifest.build'
      ? 'https://gateway.manifest.build/api/v1/mcp'
      : 'http://localhost:3001/api/v1/mcp',
  MCP_READ_SCOPE: 'mcp:read',
}));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: jest.fn(() => new Headers()) }));
jest.mock('better-auth/oauth2', () => ({ createDpopReplayStore: jest.fn(() => ({})) }));
jest.mock('@better-auth/mcp', () => ({ createMcpProtectedRequestHandler: jest.fn() }));
jest.mock('@modelcontextprotocol/server', () => ({
  createMcpHandler: jest.fn(),
  McpServer: jest.fn(),
}));

const { auth } = jest.requireMock('../auth/auth.instance') as {
  auth: { $context: Promise<{ baseURL: string; internalAdapter: object }> };
};
const { createDpopReplayStore } = jest.requireMock('better-auth/oauth2') as {
  createDpopReplayStore: jest.Mock;
};
const { createMcpProtectedRequestHandler } = jest.requireMock('@better-auth/mcp') as {
  createMcpProtectedRequestHandler: jest.Mock;
};
const { createMcpHandler } = jest.requireMock('@modelcontextprotocol/server') as {
  createMcpHandler: jest.Mock;
};

function makeController(tenantId: string | null): McpController {
  const args: unknown[] = new Array(24).fill(undefined);
  args[1] = { resolve: jest.fn().mockResolvedValue(tenantId) };
  return new (McpController as unknown as new (...a: unknown[]) => McpController)(...args);
}

function makeRes() {
  const res = {
    set: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res as unknown as Response & {
    set: jest.Mock;
    status: jest.Mock;
    send: jest.Mock;
  };
}

/** A response double that is a real writable, so a streamed body can be observed. */
function makeStreamRes() {
  const sink = new PassThrough();
  const chunks: string[] = [];
  const firstChunk = new Promise<void>((resolve) => {
    sink.once('data', () => resolve());
  });
  sink.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  const res = sink as unknown as Response & {
    set: jest.Mock;
    status: jest.Mock;
    send: jest.Mock;
    flushHeaders: jest.Mock;
  };
  res.set = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.send = jest.fn();
  res.flushHeaders = jest.fn();
  return { res, chunks, firstChunk };
}

const req = {
  method: 'POST',
  headers: {},
  body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
} as unknown as Request;

describe('McpController', () => {
  beforeEach(() => {
    createMcpProtectedRequestHandler.mockReset();
    createDpopReplayStore.mockClear();
    createMcpHandler.mockReset();
  });

  it('serves a tool call with an explicit issuer when auth has a dynamic base URL', async () => {
    createMcpHandler.mockReturnValue({
      fetch: jest.fn().mockResolvedValue(new Response('OK', { status: 200 })),
    });
    createMcpProtectedRequestHandler.mockImplementation(
      (_options: unknown, cb: (r: unknown, c: unknown) => Promise<Response>) =>
        (request: unknown) =>
          cb(request, { sub: 'user-1', scope: 'mcp:read' }),
    );
    const res = makeRes();
    await makeController('tenant-1').handle(req, res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('OK');
    const { internalAdapter, baseURL } = await auth.$context;
    expect(baseURL).toBe('');
    expect(createDpopReplayStore).toHaveBeenCalledWith(internalAdapter);
    expect(createMcpProtectedRequestHandler).toHaveBeenCalledWith(
      {
        issuer: 'http://localhost:3001/api/auth',
        audience: 'http://localhost:3001/api/v1/mcp',
        jwksUrl: 'http://localhost:3001/api/auth/jwks',
        requiredScopes: ['mcp:read'],
        dpop: { replayStore: createDpopReplayStore.mock.results[0].value },
      },
      expect.any(Function),
    );
  });

  // `subscriptions/listen` is served over SSE whatever `responseMode` says, and
  // the client blocks on the ack frame. Buffering the body would hold that
  // frame until the stream closed — which it never does — so the client timed
  // out on every listen and stalled the connection behind it.
  it('streams an SSE body through instead of buffering it to completion', async () => {
    const encoder = new TextEncoder();
    let push!: (frame: string) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (frame) => controller.enqueue(encoder.encode(frame));
        close = () => controller.close();
      },
    });
    createMcpHandler.mockReturnValue({
      fetch: jest
        .fn()
        .mockResolvedValue(
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        ),
    });
    createMcpProtectedRequestHandler.mockImplementation(
      (_options: unknown, cb: (r: unknown, c: unknown) => Promise<Response>) =>
        (request: unknown) =>
          cb(request, { sub: 'user-1', scope: 'mcp:read' }),
    );
    const { res, chunks, firstChunk } = makeStreamRes();

    const handled = makeController('tenant-1').handle(req, res as never);
    push('data: {"method":"notifications/subscriptions/acknowledged"}\n\n');
    // Resolves only because the ack reached the client while the stream is
    // still open; a buffering implementation would hang here.
    await firstChunk;

    expect(chunks.join('')).toContain('subscriptions/acknowledged');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();

    close();
    await handled;
    // A regression hangs forever, so this still fails; the explicit budget only
    // stops a loaded CI worker from tripping Jest's 5s default.
  }, 15000);

  it.each([
    ['carries no content-type', undefined],
    ['claims an event stream but has no body', { 'content-type': 'text/event-stream' }],
  ])('buffers a response that %s', async (_label, headers) => {
    createMcpHandler.mockReturnValue({
      fetch: jest.fn().mockResolvedValue(new Response(null, { status: 204, headers })),
    });
    createMcpProtectedRequestHandler.mockImplementation(
      (_options: unknown, cb: (r: unknown, c: unknown) => Promise<Response>) =>
        (request: unknown) =>
          cb(request, { sub: 'user-1', scope: 'mcp:read' }),
    );
    const res = makeRes();

    await makeController('tenant-1').handle(req, res as never);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith('');
  });

  it('ends quietly when the client hangs up mid-stream', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
      },
    });
    createMcpHandler.mockReturnValue({
      fetch: jest
        .fn()
        .mockResolvedValue(
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        ),
    });
    createMcpProtectedRequestHandler.mockImplementation(
      (_options: unknown, cb: (r: unknown, c: unknown) => Promise<Response>) =>
        (request: unknown) =>
          cb(request, { sub: 'user-1', scope: 'mcp:read' }),
    );
    const { res, firstChunk } = makeStreamRes();

    const handled = makeController('tenant-1').handle(req, res as never);
    await firstChunk;
    (res as unknown as PassThrough).destroy();

    await expect(handled).resolves.toBeUndefined();
  }, 15000);

  it('answers 401 with a WWW-Authenticate challenge when the operator is gone', async () => {
    createMcpProtectedRequestHandler.mockImplementation(
      (_options: unknown, cb: (r: unknown, c: unknown) => Promise<Response>) =>
        (request: unknown) =>
          cb(request, { sub: 'user-1', scope: 'mcp:read' }),
    );
    const res = makeRes();
    await makeController(null).handle(req, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.send.mock.calls[0][0] as string;
    expect(body).toContain('operator no longer exists');
    expect(res.set).toHaveBeenCalledWith(
      'www-authenticate',
      expect.stringContaining('resource_metadata='),
    );
    expect(res.set).toHaveBeenCalledWith(
      'www-authenticate',
      expect.stringContaining('invalid_token'),
    );
  });

  it('verifies gateway tokens against the gateway issuer and audience', async () => {
    createMcpProtectedRequestHandler.mockReturnValue(async () => new Response('OK'));
    const res = makeRes();
    await makeController('tenant-1').handle(
      { ...req, headers: { host: 'gateway.manifest.build' } } as Request,
      res as never,
    );
    expect(createMcpProtectedRequestHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: 'https://gateway.manifest.build/api/auth',
        audience: 'https://gateway.manifest.build/api/v1/mcp',
        jwksUrl: 'https://gateway.manifest.build/api/auth/jwks',
      }),
      expect.any(Function),
    );
  });

  it('answers a thrown verify with a JSON-RPC 500', async () => {
    createMcpProtectedRequestHandler.mockReturnValue(async () => {
      throw new Error('boom');
    });
    const res = makeRes();
    await makeController('tenant-1').handle(req, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = JSON.parse(res.send.mock.calls[0][0] as string) as {
      error: { code: number; message: string };
    };
    // The caller gets a constant message; the detail is logged server-side.
    expect(body.error).toMatchObject({ code: -32603, message: 'Internal error' });
  });

  it('answers a non-Error throw with a generic JSON-RPC 500', async () => {
    createMcpProtectedRequestHandler.mockReturnValue(async () => {
      throw 'nope';
    });
    const res = makeRes();
    await makeController('tenant-1').handle(req, res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send.mock.calls[0][0]).toContain('Internal error');
  });
  it.each(['rejectGet', 'rejectDelete'] as const)(
    '%s answers 405 with Allow: POST (stateless JSON transport, no SSE stream)',
    async (method) => {
      const controller = makeController('tenant-1');
      const res = makeRes();

      await controller[method](res);

      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.set).toHaveBeenCalledWith('allow', 'POST');
      expect(res.set).toHaveBeenCalledWith('content-type', 'application/json');
      const body = JSON.parse(res.send.mock.calls[0][0] as string) as {
        jsonrpc: string;
        id: null;
        error: { code: number; message: string };
      };
      expect(body).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Method not allowed' },
      });
      expect(createMcpProtectedRequestHandler).not.toHaveBeenCalled();
    },
  );
});
