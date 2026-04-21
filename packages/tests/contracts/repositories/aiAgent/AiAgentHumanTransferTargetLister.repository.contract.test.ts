import 'reflect-metadata';
import { AiAgentHumanTransferTargetListerRepository } from '@core/repositories/aiAgent/AiAgentHumanTransferTargetLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select, execute };
}

describe('AiAgentHumanTransferTargetListerRepository', () => {
  it('returns empty array when query result is empty', async () => {
    const chain = createSelectChain([]);
    const dbRo = { select: chain.select };
    const repository = new AiAgentHumanTransferTargetListerRepository(
      dbRo as never
    );

    await expect(
      repository.listByAiAgentId('agent-1', 'acc-1')
    ).resolves.toEqual([]);
  });

  it('maps nullable columns to null', async () => {
    const chain = createSelectChain([
      { target_type: 'sector', sector_id: 'sec-1', user_id: undefined },
      { target_type: 'user', sector_id: null, user_id: 'usr-1' },
    ]);
    const dbRo = { select: chain.select };
    const repository = new AiAgentHumanTransferTargetListerRepository(
      dbRo as never
    );

    await expect(
      repository.listByAiAgentId('agent-1', 'acc-1')
    ).resolves.toEqual([
      { target_type: 'sector', sector_id: 'sec-1', user_id: null },
      { target_type: 'user', sector_id: null, user_id: 'usr-1' },
    ]);
    expect(chain.execute).toHaveBeenCalledTimes(1);
  });
});
