import 'reflect-metadata';
import { EAiAgentHumanTransferTargetType } from '@core/common/enums/EAiAgentHumanTransferTargetType';
import { AiAgentHumanTransferTargetCreatorRepository } from '@core/repositories/aiAgent/AiAgentHumanTransferTargetCreator.repository';

describe('AiAgentHumanTransferTargetCreatorRepository', () => {
  it('inserts mapped sector and user targets', async () => {
    const execute = jest.fn(async () => ({ rowCount: 3 }));
    const values = jest.fn(() => ({ execute }));
    const dbRw = {
      insert: jest.fn(() => ({ values })),
    };
    const repository = new AiAgentHumanTransferTargetCreatorRepository(
      dbRw as never
    );

    await repository.insertMany(
      'agent-1',
      'acc-1',
      ['sec-1'],
      ['usr-1', 'usr-2']
    );

    expect(values).toHaveBeenCalledWith([
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: EAiAgentHumanTransferTargetType.sector,
        sector_id: 'sec-1',
        user_id: null,
      },
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: EAiAgentHumanTransferTargetType.user,
        sector_id: null,
        user_id: 'usr-1',
      },
      {
        ai_agent_id: 'agent-1',
        account_id: 'acc-1',
        target_type: EAiAgentHumanTransferTargetType.user,
        sector_id: null,
        user_id: 'usr-2',
      },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no targets', async () => {
    const dbRw = {
      insert: jest.fn(),
    };
    const repository = new AiAgentHumanTransferTargetCreatorRepository(
      dbRw as never
    );

    await repository.insertMany('agent-1', 'acc-1', [], []);

    expect(dbRw.insert).not.toHaveBeenCalled();
  });
});
