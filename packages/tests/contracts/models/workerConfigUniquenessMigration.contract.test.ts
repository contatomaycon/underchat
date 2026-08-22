import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { workerConfig } from '@core/models';

const migration = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260716120000.sql'),
  'utf8'
);
const workingHoursRuleType = EWorkerConfigType.chatbot_working_hours_rule;

describe('worker config partial uniqueness migration', () => {
  it('deduplicates only singleton config types and preserves working-hours rules', () => {
    expect(migration).toMatch(
      new RegExp(
        `FROM "worker_config"\\s+WHERE "worker_config_type_id" <> '${workingHoursRuleType}'::uuid\\s+\\)`
      )
    );
    expect(migration).not.toContain(
      'DROP INDEX IF EXISTS "worker_config_worker_id_worker_config_type_id_idx"'
    );
    expect(migration).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "worker_config_worker_id_worker_config_type_id_uidx"[\\s\\S]+WHERE "worker_config_type_id" <> '${workingHoursRuleType}'::uuid;`
      )
    );
  });

  it('keeps the general lookup index and models the same partial unique predicate', () => {
    const indexes = getTableConfig(workerConfig).indexes;
    const lookupIndex = indexes.find(
      (index) =>
        index.config.name ===
        'worker_config_worker_id_worker_config_type_id_idx'
    );
    const uniqueIndex = indexes.find(
      (index) =>
        index.config.name ===
        'worker_config_worker_id_worker_config_type_id_uidx'
    );
    const columnNames = (index: typeof lookupIndex) =>
      index?.config.columns.map((column) =>
        'name' in column ? column.name : null
      ) ?? [];

    expect(lookupIndex?.config.unique).toBe(false);
    expect(columnNames(lookupIndex)).toEqual([
      'worker_id',
      'worker_config_type_id',
    ]);
    expect(uniqueIndex?.config.unique).toBe(true);
    expect(columnNames(uniqueIndex)).toEqual([
      'worker_id',
      'worker_config_type_id',
    ]);

    const predicate = new PgDialect().sqlToQuery(
      uniqueIndex?.config.where as SQL
    );
    expect(predicate.sql).toBe(
      `"worker_config"."worker_config_type_id" <> '${workingHoursRuleType}'::uuid`
    );
    expect(predicate.params).toEqual([]);
  });
});
