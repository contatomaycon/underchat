import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

const source = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260711150000.sql'),
  'utf8'
);
const paymentProvenanceSource = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260711160000.sql'),
  'utf8'
);
const paymentOrderingSource = readFileSync(
  resolve(process.cwd(), 'atlas/prod/20260711170000.sql'),
  'utf8'
);

describe('atomic Integration entitlement revision migration', () => {
  it('keeps enum UUID literals aligned with the application contract', () => {
    expect(source).toContain(`'${EAccountStatus.blocked}'::uuid`);
    expect(source).toContain(`'${EPlanProduct.integration}'::uuid`);
  });

  it('collects a transaction-wide workset and reconciles it only at commit', () => {
    expect(source).toContain(
      'PRIMARY KEY ("transaction_id", "account_id", "plan_product_id")'
    );
    expect(source).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(source).toContain('REFERENCING OLD TABLE AS old_rows');
    expect(source).toContain('REFERENCING NEW TABLE AS new_rows');
    expect(source).toContain('FOR EACH STATEMENT');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain(
      'ORDER BY queued.account_id, queued.plan_product_id'
    );
    expect(source).toContain('candidate_accounts AS MATERIALIZED');
    expect(source).toContain('INNER JOIN LATERAL');
    expect(source).toContain('FROM PUBLIC;');
  });

  it.each([
    'account',
    'plan_account',
    'plan',
    'plan_items',
    'plan_cross_sell',
    'plan_cross_sell_account',
  ])('covers source mutations on %s', (table) => {
    expect(source).toContain(`ON "${table}"`);
  });

  it('increments only for a final boolean transition and preserves fence columns', () => {
    expect(source).toContain(
      'persisted.allowed IS DISTINCT FROM EXCLUDED.allowed'
    );
    expect(source).toContain('THEN persisted.revision + 1');
    expect(source).not.toMatch(/SET[\s\S]{0,300}deny_fence_token\s*=/i);

    const transition = (revision: number, before: boolean, after: boolean) =>
      before === after ? revision : revision + 1;
    const granted = transition(1, true, true);
    const downgraded = transition(granted, true, false);
    const restored = transition(downgraded, false, true);
    expect([granted, downgraded, restored]).toEqual([1, 2, 3]);
  });

  it('rejects stale or raw true-to-false writers at commit without an active fence', () => {
    expect(source).toContain(
      'reconciliation_time timestamp with time zone := clock_timestamp()'
    );
    expect(
      source.match(/next_payment_date > reconciliation_time/g)
    ).toHaveLength(2);
    expect(source).toContain('persisted.allowed = TRUE');
    expect(source).toContain('resolved.allowed = FALSE');
    expect(source).toContain('persisted.deny_fence_token IS NULL');
    expect(source).toContain('persisted.deny_fence_released_at IS NOT NULL');
    expect(source).toContain("ERRCODE = 'UC001'");
    expect(source).toContain(
      "MESSAGE = 'plan_entitlement_deny_fence_required'"
    );
  });

  it('resolves hard-deleted accounts as denied and filters irrelevant updates', () => {
    expect(source.match(/LEFT JOIN account a ON/g)).toHaveLength(2);
    expect(source.match(/a\.account_id IS NOT NULL/g)).toHaveLength(2);
    expect(source).toContain('EXCEPT ALL');
    expect(source).toContain('AS is_blocked');
    expect(source).toContain("status = 'active' AS is_active");
    expect(source).toContain('quantity > 0 AS has_quantity');
    expect(source).toContain('deleted_at IS NOT NULL AS is_deleted');
    expect(source).not.toMatch(/AFTER UPDATE OF[\s\S]*REFERENCING OLD TABLE/i);
  });

  it('uses final-state boolean semantics for zero, duplicates, soft delete and cycle cancellation', () => {
    expect(source).toContain('item.quantity > 0');
    expect(source).toContain('item.deleted_at IS NULL');
    expect(source).toContain('addon.quantity > 0');
    expect(source).toContain('addon.deleted_at IS NULL');
    expect(source).toContain('assignment.deleted_at IS NULL');
    expect(source).toContain(
      'assignment.cancellation_date >= latest.last_payment_date'
    );
    expect(source).toContain(
      'plan_is_active AND (granted_by_plan OR granted_by_addon)'
    );
  });
});

describe('Integration add-on payment provenance migration', () => {
  it('adds a nullable, indexed payment reference without rewriting legacy assignments', () => {
    expect(paymentProvenanceSource).toContain(
      'ADD COLUMN "account_payment_id" uuid NULL'
    );
    expect(paymentProvenanceSource).toContain(
      'FOREIGN KEY ("account_payment_id")'
    );
    expect(paymentProvenanceSource).toContain(
      'REFERENCES "account_payment" ("account_payment_id")'
    );
    expect(paymentProvenanceSource).toContain(
      'plan_cross_sell_account_account_payment_id_idx'
    );
    expect(paymentProvenanceSource).not.toMatch(
      /UPDATE\s+"plan_cross_sell_account"/i
    );
  });

  it('persists provider event ordering without adding an unused timestamp index', () => {
    expect(paymentOrderingSource).toContain(
      '"payment_status_observed_at" timestamp with time zone NULL'
    );
    expect(paymentOrderingSource).toContain(
      '"payment_status_event_id" character varying(255) NULL'
    );
    expect(paymentOrderingSource).not.toContain(
      'account_payment_payment_status_observed_at_idx'
    );
  });
});
