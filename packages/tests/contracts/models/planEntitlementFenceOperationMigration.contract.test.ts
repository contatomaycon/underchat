import fs from 'node:fs';
import path from 'node:path';

describe('Integration deny-fence operation identity migration', () => {
  const migration = fs.readFileSync(
    path.resolve('atlas/prod/20260711180000.sql'),
    'utf8'
  );
  const model = fs.readFileSync(
    path.resolve(
      'packages/models/plan/accountPlanProductEntitlementRevision.model.ts'
    ),
    'utf8'
  );

  it('persists a nullable operation key and requires it to clear with the owner', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "deny_fence_token" uuid'
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "deny_fence_created_at" timestamp with time zone'
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "deny_fence_released_at" timestamp with time zone'
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "deny_fence_operation_key" varchar(255)'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "account_plan_product_entitlement_revision_fence_pair_check"'
    );
    expect(migration).toContain('"deny_fence_operation_key" IS NULL');
    expect(model).toContain('deny_fence_operation_key: varchar(');
    expect(model).toContain('table.deny_fence_operation_key} IS NULL');
  });

  it('keeps ordinary fences non-adoptable by leaving the operation key nullable', () => {
    expect(migration).not.toMatch(
      /"deny_fence_operation_key"\s+varchar\(255\)\s+NOT NULL/i
    );
    expect(migration).toContain('NULL fences are exclusive');
  });
});
