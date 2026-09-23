import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Serve the Requests log's harness-scoped filters from the harness index.
 *
 * With a harness picked, Postgres reads `IDX_requests_tenant_agent_timestamp`
 * and then fetched one `requests` heap page per row in range to test the
 * status or error origin. For a harness that carries most of its tenant's
 * traffic that was ~20k random pages for a week, about 16 s on a cold cache,
 * the one filter combination 1803000000000 did not reach. Including the
 * columns the log filters on makes those scans index-only. The key is
 * unchanged, so every query that used the old index can still use it.
 *
 * Rebuilt in place under the same name, concurrently so request writes
 * continue during deploy, and every step is safe to rerun after an
 * interruption.
 */
export class CoverHarnessRequestsIndex1803100000000 implements MigrationInterface {
  name = 'CoverHarnessRequestsIndex1803100000000';
  transaction = false;

  static readonly INDEX = 'IDX_requests_tenant_agent_timestamp';
  static readonly BUILD = 'IDX_requests_tenant_agent_timestamp_next';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.isCovering(queryRunner)) return;
    await this.rebuild(
      queryRunner,
      'INCLUDE ("id", "status", "error_origin", "error_class", "requested_model")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.isCovering(queryRunner))) return;
    await this.rebuild(queryRunner, '');
  }

  /**
   * Build the replacement under a temporary name, then drop the live index and
   * rename. The name is missing only between two catalog statements, and a
   * rerun after a crash in that gap finds the build and simply renames it.
   */
  private async rebuild(queryRunner: QueryRunner, include: string): Promise<void> {
    const { INDEX, BUILD } = CoverHarnessRequestsIndex1803100000000;
    await this.dropIfInvalid(queryRunner, BUILD);
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${BUILD}" ON "requests" ("tenant_id", "agent_id", "timestamp") ${include}`.trim(),
    );
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${INDEX}"`);
    await queryRunner.query(`ALTER INDEX "${BUILD}" RENAME TO "${INDEX}"`);
  }

  /** True when the live index already carries the covering columns. */
  private async isCovering(queryRunner: QueryRunner): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = $1 AND indexdef LIKE '%INCLUDE%'`,
      [CoverHarnessRequestsIndex1803100000000.INDEX],
    );
    return rows.length > 0;
  }

  /**
   * A cancelled CONCURRENTLY build leaves an INVALID shell that
   * `CREATE ... IF NOT EXISTS` would skip over by name. Drop only that shell,
   * never a valid index a previous run finished building.
   */
  private async dropIfInvalid(queryRunner: QueryRunner, indexName: string): Promise<void> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1 AND NOT i.indisvalid`,
      [indexName],
    );
    if (rows.length > 0) {
      await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`);
    }
  }
}
