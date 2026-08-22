import 'reflect-metadata';

import { EPaymentStatus } from '@core/common/enums/EPaymentStatus';
import * as schema from '@core/models';
import { ChatbotUnderchatUserLookupRepository } from '@core/repositories/user/ChatbotUnderchatUserLookup.repository';
import { drizzle } from 'drizzle-orm/node-postgres';

interface CapturedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

const compactSql = (value: string): string =>
  value.replaceAll(/\s+/gu, ' ').trim();

const createHarness = () => {
  const queries: CapturedQuery[] = [];
  const client = {
    query: jest.fn(
      async (
        query: string | { readonly text: string },
        params: readonly unknown[] = []
      ) => {
        queries.push({
          text: typeof query === 'string' ? query : query.text,
          params,
        });
        return { rows: [] };
      }
    ),
  };
  const db = drizzle(client as never, { schema });

  return {
    queries,
    repository: new ChatbotUnderchatUserLookupRepository(db),
  };
};

describe('ChatbotUnderchatUserLookupRepository', () => {
  it('searches email across non-deleted accounts and picks the newest user deterministically', async () => {
    const { queries, repository } = createHarness();

    await expect(
      repository.findNewestUser({
        lookupType: 'email',
        identityHashes: ['email-hash-normalized', 'email-hash-legacy'],
      })
    ).resolves.toBeNull();

    expect(queries).toHaveLength(1);
    const sql = compactSql(queries[0]?.text ?? '');
    expect(sql).toMatch(
      /^select "user"\."user_id", "account"\."account_id", "account"\."name",/u
    );
    expect(sql).not.toMatch(/\bwhere\b.*"user"\."account_id" = \$\d+/u);
    expect(sql).toContain('"user"."deleted_at" is null');
    expect(sql).toContain('"account"."deleted_at" is null');
    expect(sql).toContain('"user"."email_c" in ($1, $2)');
    expect(sql).toContain(
      'order by "user"."created_at" DESC NULLS LAST, "user"."user_id" desc'
    );
    expect(queries[0]?.params).toEqual([
      'email-hash-normalized',
      'email-hash-legacy',
      1,
    ]);
  });

  it('searches document across accounts through the identity subquery', async () => {
    const { queries, repository } = createHarness();

    await repository.findNewestUser({
      lookupType: 'document',
      identityHashes: ['document-hash'],
    });

    const sql = compactSql(queries[0]?.text ?? '');
    expect(sql).not.toMatch(/\bwhere\b.*"user"\."account_id" = \$\d+/u);
    expect(sql).toContain(
      '"user"."user_id" in (select "user_id" from "user_document" where "user_document"."document_c" in ($1))'
    );
    expect(queries[0]?.params).toEqual(['document-hash', 1]);
  });

  it('follows the user assignments even when legacy links belong to another account', async () => {
    const { queries, repository } = createHarness();

    await repository.findAccessGroup('user-1');
    await repository.listSectors('user-1');
    await repository.listChannels({
      accountId: 'account-1',
      userId: 'user-1',
    });
    await repository.listAllAccountChannels('account-1');

    const accessGroupSql = compactSql(queries[0]?.text ?? '');
    expect(accessGroupSql).toContain('"permission_assignment"."user_id" = $1');
    expect(accessGroupSql).not.toContain('"permission_role"."account_id" =');
    expect(accessGroupSql).toContain('"permission_role"."deleted_at" is null');
    expect(queries[0]?.params).toEqual(['user-1', 1]);

    const sectorSql = compactSql(queries[1]?.text ?? '');
    expect(sectorSql).not.toContain('"sector"."account_id" =');
    expect(sectorSql).toContain('"sector_user"."deleted_at" is null');
    expect(sectorSql).toContain('"sector"."deleted_at" is null');
    expect(sectorSql).toContain('order by "sector"."name"');
    expect(queries[1]?.params).toEqual(['user-1']);

    const restrictedChannelSql = compactSql(queries[2]?.text ?? '');
    expect(restrictedChannelSql).toContain('"user_channel"."account_id" = $2');
    expect(restrictedChannelSql).toContain('"worker"."account_id" = $3');
    expect(restrictedChannelSql).toContain('"worker"."deleted_at" is null');
    expect(restrictedChannelSql).toContain('order by "worker"."name"');
    expect(queries[2]?.params).toEqual(['user-1', 'account-1', 'account-1']);

    const unrestrictedChannelSql = compactSql(queries[3]?.text ?? '');
    expect(unrestrictedChannelSql).toContain('"worker"."account_id" = $1');
    expect(unrestrictedChannelSql).toContain('"worker"."deleted_at" is null');
    expect(queries[3]?.params).toEqual(['account-1']);
  });

  it('prioritizes a current plan and otherwise selects the most recent non-deleted history', async () => {
    const { queries, repository } = createHarness();

    await repository.findCurrentOrRecentPlan('account-1');

    const sql = compactSql(queries[0]?.text ?? '');
    expect(sql).toContain('"plan_account"."account_id" = $1');
    expect(sql).toContain('"plan"."deleted_at" is null');
    expect(sql).toContain('"plan_account"."next_payment_date" > NOW()');
    expect(sql).toContain(
      '"plan_account"."cancellation_date" IS NULL OR "plan_account"."cancellation_date" > NOW()'
    );
    expect(sql).toContain(
      'GREATEST( COALESCE("plan_account"."last_payment_date", \'epoch\'::timestamptz), COALESCE("plan_account"."cancellation_date", \'epoch\'::timestamptz), COALESCE("plan_account"."created_at", \'epoch\'::timestamptz) ) desc'
    );
    expect(sql).toContain('"plan_account"."plan_account_id" desc');
    expect(queries[0]?.params).toEqual(['account-1', 1]);
  });

  it('selects date and amount from the same latest paid transaction', async () => {
    const { queries, repository } = createHarness();

    await expect(
      repository.findLatestPaidPayment('account-1')
    ).resolves.toBeNull();

    const sql = compactSql(queries[0]?.text ?? '');
    expect(
      sql.startsWith('select "payment_date", "value" from "account_payment"')
    ).toBe(true);
    expect(sql).toContain('"account_payment"."account_id" = $1');
    expect(sql).toContain(
      '"account_payment"."payment_status_id" in ($2, $3, $4, $5)'
    );
    expect(sql).toContain('"account_payment"."payment_date" is not null');
    expect(sql).toContain(
      'order by "account_payment"."payment_date" desc, "account_payment"."created_at" DESC NULLS LAST, "account_payment"."account_payment_id" desc'
    );
    expect(queries[0]?.params).toEqual([
      'account-1',
      EPaymentStatus.received,
      EPaymentStatus.confirmed,
      EPaymentStatus.received_in_cash,
      EPaymentStatus.dunning_received,
      1,
    ]);
  });
});
