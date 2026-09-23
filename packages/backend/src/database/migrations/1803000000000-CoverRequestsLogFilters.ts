import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Serve the Requests log filters from indexes instead of scattered heap pages.
 *
 * 1. `IDX_requests_tenant_timestamp` gains the columns the log filters and
 *    joins on. Before, every filter beyond tenant + date read one `requests`
 *    heap page per row in range to learn its id, status, origin or requested
 *    model: about 19.5k random pages for the largest tenant's week, which is
 *    ~20 s on a cold cache. The key is unchanged, so every query that used the
 *    old index can still use it. It is rebuilt in place under the same name
 *    because the CRM metrics feed refuses to run unless that name is valid.
 *
 * 2. `IDX_agent_messages_fallback_window` lists fallback attempts by tenant and
 *    time, so the `fallback` and `none` triggers read them once per window
 *    rather than fetching every attempt's heap row to test the column.
 *
 * Both build concurrently so live request writes continue during deploy, and
 * every step is safe to rerun after an interruption. The Requests log runs on
 * self-hosted installs too, so nothing is gated by mode.
 */
export class CoverRequestsLogFilters1803000000000 implements MigrationInterface {
  name = 'CoverRequestsLogFilters1803000000000';
  transaction = false;

  static readonly REQUESTS_INDEX = 'IDX_requests_tenant_timestamp';
  static readonly REQUESTS_BUILD = 'IDX_requests_tenant_timestamp_next';
  static readonly FALLBACK_INDEX = 'IDX_agent_messages_fallback_window';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const { REQUESTS_BUILD, FALLBACK_INDEX } = CoverRequestsLogFilters1803000000000;

    if (!(await this.isCovering(queryRunner))) {
      await this.dropIfInvalid(queryRunner, REQUESTS_BUILD);
      await queryRunner.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "${REQUESTS_BUILD}"
          ON "requests" ("tenant_id", "timestamp")
          INCLUDE ("id", "agent_id", "status", "error_origin", "error_class", "requested_model")
      `);
      await this.swapIn(queryRunner);
    }

    await this.dropIfInvalid(queryRunner, FALLBACK_INDEX);
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "${FALLBACK_INDEX}"
        ON "agent_messages" ("tenant_id", "timestamp")
        INCLUDE ("request_id")
        WHERE "fallback_from_model" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const { REQUESTS_BUILD, FALLBACK_INDEX } = CoverRequestsLogFilters1803000000000;
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${FALLBACK_INDEX}"`);

    if (await this.isCovering(queryRunner)) {
      await this.dropIfInvalid(queryRunner, REQUESTS_BUILD);
      await queryRunner.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS "${REQUESTS_BUILD}"
          ON "requests" ("tenant_id", "timestamp")
      `);
      await this.swapIn(queryRunner);
    }
  }

  /**
   * Replace the live index with the freshly built one. Dropping first and then
   * renaming leaves the name missing only between two catalog statements, and
   * a rerun after a crash in that gap finds the build and simply renames it.
   */
  private async swapIn(queryRunner: QueryRunner): Promise<void> {
    const { REQUESTS_INDEX, REQUESTS_BUILD } = CoverRequestsLogFilters1803000000000;
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "${REQUESTS_INDEX}"`);
    await queryRunner.query(`ALTER INDEX "${REQUESTS_BUILD}" RENAME TO "${REQUESTS_INDEX}"`);
  }

  /** True when the live index already carries the covering columns. */
  private async isCovering(queryRunner: QueryRunner): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema() AND indexname = $1 AND indexdef LIKE '%INCLUDE%'`,
      [CoverRequestsLogFilters1803000000000.REQUESTS_INDEX],
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
