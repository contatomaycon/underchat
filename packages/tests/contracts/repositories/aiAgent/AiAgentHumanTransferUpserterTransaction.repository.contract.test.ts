import 'reflect-metadata';
import { AiAgentHumanTransferUpserterTransactionRepository } from '@core/repositories/aiAgent/AiAgentHumanTransferUpserterTransaction.repository';

function createRepository(updateRowCount: number) {
  const updateExecute = jest.fn(async () => ({ rowCount: updateRowCount }));
  const updateWhere = jest.fn(() => ({ execute: updateExecute }));
  const updateSet = jest.fn(() => ({ where: updateWhere }));

  const deleteExecute = jest.fn(async () => ({ rowCount: 1 }));
  const deleteWhere = jest.fn(() => ({ execute: deleteExecute }));

  const insertExecute = jest.fn(async () => ({ rowCount: 1 }));
  const insertValues = jest.fn(() => ({ execute: insertExecute }));

  const tx = {
    update: jest.fn(() => ({ set: updateSet })),
    delete: jest.fn(() => ({ where: deleteWhere })),
    insert: jest.fn(() => ({ values: insertValues })),
  };

  const transaction = jest.fn(
    async (cb: (transactionArg: typeof tx) => Promise<boolean>) => cb(tx)
  );

  const dbRw = { transaction };

  return {
    repository: new AiAgentHumanTransferUpserterTransactionRepository(
      dbRw as never
    ),
    tx,
    deleteExecute,
    insertValues,
  };
}

describe('AiAgentHumanTransferUpserterTransactionRepository', () => {
  it('returns false when update of transfer flags fails', async () => {
    const { repository, tx, deleteExecute, insertValues } = createRepository(0);

    const result = await repository.upsert('agent-1', 'acc-1', {
      enable_human_transfer: true,
      enable_human_transfer_by_prompt: true,
      sector_targets: [{ sector_id: 'sec-1', user_ids: ['usr-1'] }],
    });

    expect(result).toBe(false);
    expect(tx.delete).not.toHaveBeenCalled();
    expect(deleteExecute).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('deletes targets and skips insert when human transfer is disabled', async () => {
    const { repository, tx, insertValues } = createRepository(1);

    const result = await repository.upsert('agent-1', 'acc-1', {
      enable_human_transfer: false,
      enable_human_transfer_by_prompt: false,
      sector_targets: [{ sector_id: 'sec-1', user_ids: ['usr-1'] }],
    });

    expect(result).toBe(true);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('inserts sector and user target rows when transfer is enabled', async () => {
    const { repository, insertValues } = createRepository(1);

    const result = await repository.upsert('agent-1', 'acc-1', {
      enable_human_transfer: true,
      enable_human_transfer_by_prompt: true,
      sector_targets: [
        { sector_id: 'sec-1', user_ids: ['usr-1', 'usr-2'] },
        { sector_id: 'sec-2', user_ids: [] },
      ],
    });

    expect(result).toBe(true);
    expect(insertValues).toHaveBeenCalledWith([
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: 'sector',
        sector_id: 'sec-1',
        user_id: null,
      },
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: 'user',
        sector_id: 'sec-1',
        user_id: 'usr-1',
      },
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: 'user',
        sector_id: 'sec-1',
        user_id: 'usr-2',
      },
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: 'sector',
        sector_id: 'sec-2',
        user_id: null,
      },
    ]);
  });
});
