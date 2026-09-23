import { CoverRequestsLogFilters1803000000000 } from './1803000000000-CoverRequestsLogFilters';

type Responder = (sql: string, params?: unknown[]) => unknown[];

/** A query runner that answers catalog probes from `respond` and records SQL. */
function createQueryRunner(respond: Responder = () => []) {
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => respond(sql, params)),
  };
}

const statements = (runner: ReturnType<typeof createQueryRunner>): string[] =>
  runner.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

const isCoveringProbe = (sql: string) => sql.includes('FROM pg_indexes');
const isInvalidProbe = (sql: string) => sql.includes('FROM pg_index i');

describe('CoverRequestsLogFilters1803000000000', () => {
  it('runs outside a transaction so the builds can be concurrent', () => {
    expect(new CoverRequestsLogFilters1803000000000().transaction).toBe(false);
  });

  it('rebuilds the requests index as a covering index under the same name', async () => {
    const runner = createQueryRunner();

    await new CoverRequestsLogFilters1803000000000().up(runner as never);

    const sql = statements(runner).filter((s) => !isCoveringProbe(s) && !isInvalidProbe(s));
    expect(sql).toEqual([
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_requests_tenant_timestamp_next" ON "requests" ("tenant_id", "timestamp") INCLUDE ("id", "agent_id", "status", "error_origin", "error_class", "requested_model")',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_timestamp"',
      'ALTER INDEX "IDX_requests_tenant_timestamp_next" RENAME TO "IDX_requests_tenant_timestamp"',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_agent_messages_fallback_window" ON "agent_messages" ("tenant_id", "timestamp") INCLUDE ("request_id") WHERE "fallback_from_model" IS NOT NULL',
    ]);
  });

  it('leaves an already covering requests index alone on rerun', async () => {
    const runner = createQueryRunner((sql) => (isCoveringProbe(sql) ? [{}] : []));

    await new CoverRequestsLogFilters1803000000000().up(runner as never);

    const sql = statements(runner);
    expect(sql.some((s) => s.includes('"IDX_requests_tenant_timestamp_next"'))).toBe(false);
    expect(
      sql.some((s) =>
        s.includes('DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_timestamp"'),
      ),
    ).toBe(false);
    expect(sql.at(-1)).toContain('"IDX_agent_messages_fallback_window"');
  });

  it('drops invalid shells left by an interrupted build before retrying', async () => {
    const runner = createQueryRunner((sql) => (isInvalidProbe(sql) ? [{}] : []));

    await new CoverRequestsLogFilters1803000000000().up(runner as never);

    const drops = statements(runner).filter((s) => s.startsWith('DROP INDEX'));
    expect(drops).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_timestamp_next"',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_timestamp"',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_agent_messages_fallback_window"',
    ]);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('FROM pg_index i'), [
      'IDX_requests_tenant_timestamp_next',
    ]);
  });

  it('restores the plain requests index and drops the fallback index on revert', async () => {
    const runner = createQueryRunner((sql) => (isCoveringProbe(sql) ? [{}] : []));

    await new CoverRequestsLogFilters1803000000000().down(runner as never);

    const sql = statements(runner).filter((s) => !isCoveringProbe(s) && !isInvalidProbe(s));
    expect(sql).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_agent_messages_fallback_window"',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_requests_tenant_timestamp_next" ON "requests" ("tenant_id", "timestamp")',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_timestamp"',
      'ALTER INDEX "IDX_requests_tenant_timestamp_next" RENAME TO "IDX_requests_tenant_timestamp"',
    ]);
  });

  it('skips the requests rebuild on revert when the index is already plain', async () => {
    const runner = createQueryRunner();

    await new CoverRequestsLogFilters1803000000000().down(runner as never);

    expect(statements(runner).filter((s) => !isCoveringProbe(s))).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_agent_messages_fallback_window"',
    ]);
  });
});
