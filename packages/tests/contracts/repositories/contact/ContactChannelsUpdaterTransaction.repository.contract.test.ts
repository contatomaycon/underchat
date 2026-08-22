import 'reflect-metadata';
import { ContactChannelsUpdaterTransactionRepository } from '@core/repositories/contact/ContactChannelsUpdaterTransaction.repository';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

interface HarnessOptions {
  readonly currentAssignments?: Array<{ channel_id: string }>;
  readonly activeWorkers?: Array<{ channel_id: string }>;
}

function createSelectChain(result: unknown[]) {
  const chain = {} as Record<string, jest.Mock>;
  for (const method of ['from', 'where', 'for', 'limit']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.execute = jest.fn(async () => result);
  return chain;
}

function createHarness(options: HarnessOptions = {}) {
  const selectResults = [
    [{ contact_id: 'contact-1' }],
    options.currentAssignments ?? [],
    options.activeWorkers ?? [],
  ];
  const selectChains: Array<Record<string, jest.Mock>> = [];
  let selectIndex = 0;
  const select = jest.fn(() => {
    const chain = createSelectChain(selectResults[selectIndex] ?? []);
    selectIndex += 1;
    selectChains.push(chain);
    return chain;
  });

  const deleteExecute = jest.fn(async () => ({ rowCount: 1 }));
  const deleteWhere = jest.fn((_condition: SQL) => ({
    execute: deleteExecute,
  }));
  const del = jest.fn(() => ({ where: deleteWhere }));
  const tx = { delete: del, select };
  const dbRw = {
    transaction: jest.fn(async (callback: (trx: unknown) => unknown) =>
      callback(tx)
    ),
  };
  const contactChannelCreatorRepository = {
    createContactChannelInTransaction: jest.fn(async () => 'cc-1'),
  };
  const repository = new ContactChannelsUpdaterTransactionRepository(
    dbRw as never,
    contactChannelCreatorRepository as never
  );

  return {
    contactChannelCreatorRepository,
    dbRw,
    deleteWhere,
    repository,
    select,
    selectChains,
    tx,
  };
}

describe('ContactChannelsUpdaterTransactionRepository', () => {
  it('deletes current channels with contact and account scope when channel ids are empty', async () => {
    const harness = createHarness();

    await expect(
      harness.repository.updateContactChannels('contact-1', 'account-1', [])
    ).resolves.toBe(true);

    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).not.toHaveBeenCalled();
    expect(harness.select).toHaveBeenCalledTimes(1);

    const deleteCondition = new PgDialect().sqlToQuery(
      harness.deleteWhere.mock.calls[0]?.[0] as SQL
    );
    expect(deleteCondition.sql).toContain('"contact_channel"."contact_id" =');
    expect(deleteCondition.sql).toContain('"contact_channel"."account_id" =');
    expect(deleteCondition.params).toEqual(['contact-1', 'account-1']);
  });

  it('prevalidates active workers under key share and creates each unique channel once', async () => {
    const harness = createHarness({
      activeWorkers: [{ channel_id: 'ch-1' }, { channel_id: 'ch-2' }],
    });

    await expect(
      harness.repository.updateContactChannels('contact-1', 'account-1', [
        'ch-1',
        'ch-2',
        'ch-1',
      ])
    ).resolves.toBe(true);

    expect(harness.selectChains[2]?.for).toHaveBeenCalledWith('key share');
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenCalledTimes(2);
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenNthCalledWith(1, harness.tx, 'contact-1', 'ch-1', 'account-1');
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenNthCalledWith(2, harness.tx, 'contact-1', 'ch-2', 'account-1');
  });

  it('self-heals a legacy assignment to a removed worker without assigning a replacement', async () => {
    const harness = createHarness({
      currentAssignments: [{ channel_id: 'removed-channel' }],
      activeWorkers: [],
    });

    await expect(
      harness.repository.updateContactChannels('contact-1', 'account-1', [
        'removed-channel',
        'removed-channel',
      ])
    ).resolves.toBe(true);

    expect(harness.deleteWhere).toHaveBeenCalledTimes(1);
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).not.toHaveBeenCalled();
  });

  it('omits a removed legacy channel while preserving requested active channels', async () => {
    const harness = createHarness({
      currentAssignments: [{ channel_id: 'removed-channel' }],
      activeWorkers: [{ channel_id: 'active-channel' }],
    });

    await expect(
      harness.repository.updateContactChannels('contact-1', 'account-1', [
        'removed-channel',
        'active-channel',
      ])
    ).resolves.toBe(true);

    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).toHaveBeenCalledWith(
      harness.tx,
      'contact-1',
      'active-channel',
      'account-1'
    );
  });

  it('rejects an arbitrary unavailable channel before deleting existing assignments', async () => {
    const harness = createHarness({
      currentAssignments: [{ channel_id: 'legacy-channel' }],
      activeWorkers: [],
    });

    await expect(
      harness.repository.updateContactChannels('contact-1', 'account-1', [
        'arbitrary-channel',
      ])
    ).rejects.toThrow('contact_channel_not_available');

    expect(harness.deleteWhere).not.toHaveBeenCalled();
    expect(
      harness.contactChannelCreatorRepository.createContactChannelInTransaction
    ).not.toHaveBeenCalled();
  });
});
