import { CoverHarnessRequestsIndex1803100000000 } from './1803100000000-CoverHarnessRequestsIndex';

type Responder = (sql: string) => unknown[];

function createQueryRunner(respond: Responder = () => []) {
  return { query: jest.fn(async (sql: string) => respond(sql)) };
}

const statements = (runner: ReturnType<typeof createQueryRunner>): string[] =>
  runner.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());

const isCoveringProbe = (sql: string) => sql.includes('FROM pg_indexes');
const isInvalidProbe = (sql: string) => sql.includes('FROM pg_index i');
const ddl = (runner: ReturnType<typeof createQueryRunner>) =>
  statements(runner).filter((s) => !isCoveringProbe(s) && !isInvalidProbe(s));

describe('CoverHarnessRequestsIndex1803100000000', () => {
  it('runs outside a transaction so the build can be concurrent', () => {
    expect(new CoverHarnessRequestsIndex1803100000000().transaction).toBe(false);
  });

  it('rebuilds the harness index as a covering index under the same name', async () => {
    const runner = createQueryRunner();

    await new CoverHarnessRequestsIndex1803100000000().up(runner as never);

    expect(ddl(runner)).toEqual([
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_requests_tenant_agent_timestamp_next" ON "requests" ("tenant_id", "agent_id", "timestamp") INCLUDE ("id", "status", "error_origin", "error_class", "requested_model")',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_agent_timestamp"',
      'ALTER INDEX "IDX_requests_tenant_agent_timestamp_next" RENAME TO "IDX_requests_tenant_agent_timestamp"',
    ]);
  });

  it('does nothing on rerun once the index is covering', async () => {
    const runner = createQueryRunner((sql) => (isCoveringProbe(sql) ? [{}] : []));

    await new CoverHarnessRequestsIndex1803100000000().up(runner as never);

    expect(ddl(runner)).toEqual([]);
  });

  it('drops an invalid shell left by an interrupted build before retrying', async () => {
    const runner = createQueryRunner((sql) => (isInvalidProbe(sql) ? [{}] : []));

    await new CoverHarnessRequestsIndex1803100000000().up(runner as never);

    expect(ddl(runner)[0]).toBe(
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_agent_timestamp_next"',
    );
  });

  it('restores the plain index on revert', async () => {
    const runner = createQueryRunner((sql) => (isCoveringProbe(sql) ? [{}] : []));

    await new CoverHarnessRequestsIndex1803100000000().down(runner as never);

    expect(ddl(runner)).toEqual([
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_requests_tenant_agent_timestamp_next" ON "requests" ("tenant_id", "agent_id", "timestamp")',
      'DROP INDEX CONCURRENTLY IF EXISTS "IDX_requests_tenant_agent_timestamp"',
      'ALTER INDEX "IDX_requests_tenant_agent_timestamp_next" RENAME TO "IDX_requests_tenant_agent_timestamp"',
    ]);
  });

  it('does nothing on revert when the index is already plain', async () => {
    const runner = createQueryRunner();

    await new CoverHarnessRequestsIndex1803100000000().down(runner as never);

    expect(ddl(runner)).toEqual([]);
  });
});
