import { CodeAssistClientService, CodeAssistSetupError } from './codeassist-client.service';

const originalFetch = global.fetch;

function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockErrorResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

describe('CodeAssistClientService', () => {
  let svc: CodeAssistClientService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    svc = new CodeAssistClientService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('onboard', () => {
    it('returns projectId and tierId directly when loadCodeAssist already has a project', async () => {
      fetchMock.mockResolvedValue(
        mockOkResponse({
          currentTier: { id: 'free-tier' },
          cloudaicompanionProject: 'proj-123',
        }),
      );

      const result = await svc.onboard('access-token');

      expect(result).toEqual({ projectId: 'proj-123', tierId: 'free-tier' });
      // Only one HTTP call — onboardUser must NOT be called when the project exists.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('calls onboardUser when loadCodeAssist returns no project and picks the default tier', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({
            allowedTiers: [{ id: 'free-tier', isDefault: true }],
          }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({
            done: true,
            response: { cloudaicompanionProject: { id: 'proj-456' } },
          }),
        );

      const result = await svc.onboard('access-token');

      expect(result).toEqual({ projectId: 'proj-456', tierId: 'free-tier' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('polls the operation when onboardUser returns an unfinished LRO', async () => {
      jest.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({
            allowedTiers: [{ id: 'free-tier', isDefault: true }],
          }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({
            name: 'operations/onboard-123',
          }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({
            done: true,
            response: { cloudaicompanionProject: { id: 'proj-polled' } },
          }),
        );

      const resultPromise = svc.onboard('access-token');
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(resultPromise).resolves.toEqual({
        projectId: 'proj-polled',
        tierId: 'free-tier',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][0]).toBe(
        'https://cloudcode-pa.googleapis.com/v1internal/operations/onboard-123',
      );
      expect(fetchMock.mock.calls[2][1].method).toBe('GET');
    });

    it('falls back to the first allowed tier when no tier is marked isDefault', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({
            allowedTiers: [{ id: 'standard-tier' }],
          }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({
            done: true,
            response: { cloudaicompanionProject: { id: 'proj-789' } },
          }),
        );

      const result = await svc.onboard('access-token');

      expect(result.tierId).toBe('standard-tier');
      expect(result.projectId).toBe('proj-789');
    });

    it('throws when allowedTiers is empty', async () => {
      fetchMock.mockResolvedValue(mockOkResponse({ allowedTiers: [] }));

      await expect(svc.onboard('access-token')).rejects.toThrow('needs a Google Cloud project');
    });

    it('throws when allowedTiers is missing', async () => {
      fetchMock.mockResolvedValue(mockOkResponse({}));

      await expect(svc.onboard('access-token')).rejects.toThrow('needs a Google Cloud project');
    });

    it('throws when onboardUser returns no project id', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(mockOkResponse({ done: true, response: {} }));

      await expect(svc.onboard('access-token')).rejects.toThrow('needs a Google Cloud project');
    });

    describe('Workspace and Standard-tier accounts (#2842)', () => {
      const bodyOf = (call: number) =>
        JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);

      it('rejects a numeric project number before calling Google', async () => {
        await expect(svc.onboard('access-token', '123456789')).rejects.toBeInstanceOf(
          CodeAssistSetupError,
        );
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it('uses the user project when the account has a tier but no assigned project', async () => {
        fetchMock.mockResolvedValue(mockOkResponse({ currentTier: {} }));

        const result = await svc.onboard('access-token', 'my-project');

        expect(result).toEqual({ projectId: 'my-project', tierId: 'standard-tier' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bodyOf(0)).toMatchObject({
          cloudaicompanionProject: 'my-project',
          metadata: { duetProject: 'my-project' },
        });
      });

      it('asks for a project when the account has a tier but none is available', async () => {
        fetchMock.mockResolvedValue(mockOkResponse({ currentTier: { id: 'standard-tier' } }));

        await expect(svc.onboard('access-token')).rejects.toThrow(
          new CodeAssistSetupError(
            'This Google account needs a Google Cloud project (Workspace and Standard-tier accounts do). Enter your project ID and log in again.',
          ),
        );
      });

      it('onboards a non-free tier with the user project and keeps it when Google returns none', async () => {
        fetchMock
          .mockResolvedValueOnce(
            mockOkResponse({ allowedTiers: [{ id: 'standard-tier', isDefault: true }] }),
          )
          .mockResolvedValueOnce(mockOkResponse({ done: true, response: {} }));

        const result = await svc.onboard('access-token', 'my-project');

        expect(result).toEqual({ projectId: 'my-project', tierId: 'standard-tier' });
        expect(bodyOf(1)).toMatchObject({
          tierId: 'standard-tier',
          cloudaicompanionProject: 'my-project',
          metadata: { duetProject: 'my-project' },
        });
      });

      it('never sends the user project when onboarding the free tier', async () => {
        fetchMock
          .mockResolvedValueOnce(
            mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
          )
          .mockResolvedValueOnce(
            mockOkResponse({
              done: true,
              response: { cloudaicompanionProject: { id: 'managed' } },
            }),
          );

        const result = await svc.onboard('access-token', 'my-project');

        expect(result.projectId).toBe('managed');
        expect(bodyOf(1).cloudaicompanionProject).toBeUndefined();
        expect(bodyOf(1).metadata.duetProject).toBeUndefined();
      });

      it("surfaces Google's ineligibility reasons", async () => {
        fetchMock.mockResolvedValue(
          mockOkResponse({
            allowedTiers: [],
            ineligibleTiers: [
              { reasonMessage: 'Your organization disabled Gemini.' },
              { reasonMessage: '' },
              {},
            ],
          }),
        );

        await expect(svc.onboard('access-token')).rejects.toThrow(
          'This Google account cannot use Gemini: Your organization disabled Gemini.',
        );
      });
    });

    it('throws with the method name when loadCodeAssist returns non-OK', async () => {
      fetchMock.mockResolvedValue(mockErrorResponse(403, 'Forbidden'));

      await expect(svc.onboard('access-token')).rejects.toThrow(':loadCodeAssist');
    });

    it('throws with the method name when onboardUser returns non-OK', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(mockErrorResponse(500, 'Internal error'));

      await expect(svc.onboard('access-token')).rejects.toThrow(':onboardUser');
    });

    it('sends Authorization: Bearer and Content-Type: application/json on both requests', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({ done: true, response: { cloudaicompanionProject: { id: 'p1' } } }),
        );

      await svc.onboard('my-token');

      for (const [, init] of fetchMock.mock.calls) {
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer my-token');
        expect(headers['Content-Type']).toBe('application/json');
      }
    });

    it('POSTs to the loadCodeAssist and onboardUser paths', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({ done: true, response: { cloudaicompanionProject: { id: 'p1' } } }),
        );

      await svc.onboard('my-token');

      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      );
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://cloudcode-pa.googleapis.com/v1internal:onboardUser',
      );
    });

    it('includes the metadata block on both requests', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(
          mockOkResponse({ done: true, response: { cloudaicompanionProject: { id: 'p1' } } }),
        );

      await svc.onboard('my-token');

      for (const [, init] of fetchMock.mock.calls) {
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        const metadata = body.metadata as Record<string, unknown>;
        expect(metadata).toBeDefined();
        expect(metadata.ideType).toBe('IDE_UNSPECIFIED');
        expect(metadata.platform).toBe('PLATFORM_UNSPECIFIED');
        expect(metadata.pluginType).toBe('GEMINI');
        expect(metadata.pluginVersion).toBe('0.1.0');
      }
    });

    it('throws when the onboard operation has no name to poll', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(mockOkResponse({ done: false }));

      await expect(svc.onboard('access-token')).rejects.toThrow(
        'CodeAssist onboardUser operation returned no operation name.',
      );
    });

    it('throws when the operation never completes within the poll budget', async () => {
      jest.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValue(mockOkResponse({ name: 'operations/op-1' }));

      const resultPromise = svc.onboard('access-token');
      const assertion = expect(resultPromise).rejects.toThrow(
        'CodeAssist onboardUser operation did not complete.',
      );
      await jest.advanceTimersByTimeAsync(5_000 * 13);
      await assertion;
    });

    it('throws when polling an operation returns non-OK', async () => {
      jest.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(
          mockOkResponse({ allowedTiers: [{ id: 'free-tier', isDefault: true }] }),
        )
        .mockResolvedValueOnce(mockOkResponse({ name: 'operations/op-err' }))
        .mockResolvedValueOnce(mockErrorResponse(403, 'Forbidden'));

      const resultPromise = svc.onboard('access-token');
      const assertion = expect(resultPromise).rejects.toThrow(
        'CodeAssist operation operations/op-err failed (403)',
      );
      await jest.advanceTimersByTimeAsync(5_000);
      await assertion;
    });
  });
});
