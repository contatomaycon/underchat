import 'reflect-metadata';
import { AiAgentHumanTransferTargetDeleterRepository } from '@core/repositories/aiAgent/AiAgentHumanTransferTargetDeleter.repository';

describe('AiAgentHumanTransferTargetDeleterRepository', () => {
  it('deletes rows by AI agent id', async () => {
    const execute = jest.fn(async () => ({ rowCount: 2 }));
    const where = jest.fn(() => ({ execute }));
    const dbRw = {
      delete: jest.fn(() => ({ where })),
    };
    const repository = new AiAgentHumanTransferTargetDeleterRepository(
      dbRw as never
    );

    await repository.deleteByAiAgentId('agent-1');

    expect(dbRw.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
