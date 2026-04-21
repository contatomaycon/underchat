import 'reflect-metadata';
import { AiAgentDeleterRepository } from '@core/repositories/aiAgent/AiAgentDeleter.repository';

function createDeleteStep(rowCount = 1) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));

  return { where, execute };
}

describe('AiAgentDeleterRepository', () => {
  it('does not delete prompts when agent does not exist', async () => {
    const promptDeleteStep = createDeleteStep();
    const dbRw = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => null),
        },
      },
      delete: jest.fn(() => ({ where: promptDeleteStep.where })),
    };
    const repository = new AiAgentDeleterRepository(dbRw as never);

    await repository.deleteAiAgentPromptsByAgentId('agent-1', 'acc-1');

    expect(dbRw.query.aiAgent.findFirst).toHaveBeenCalledTimes(1);
    expect(dbRw.delete).not.toHaveBeenCalled();
  });

  it('deletes prompts when agent exists', async () => {
    const promptDeleteStep = createDeleteStep();
    const dbRw = {
      query: {
        aiAgent: {
          findFirst: jest.fn(async () => ({ ai_agent_id: 'agent-1' })),
        },
      },
      delete: jest.fn(() => ({ where: promptDeleteStep.where })),
    };
    const repository = new AiAgentDeleterRepository(dbRw as never);

    await repository.deleteAiAgentPromptsByAgentId('agent-1', 'acc-1');

    expect(dbRw.delete).toHaveBeenCalledTimes(1);
    expect(promptDeleteStep.where).toHaveBeenCalledTimes(1);
    expect(promptDeleteStep.execute).toHaveBeenCalledTimes(1);
  });

  it('returns true when final delete affects one row', async () => {
    const usageDelete = createDeleteStep();
    const workerDelete = createDeleteStep();
    const agentDelete = createDeleteStep(1);
    const dbRw = {
      delete: jest
        .fn()
        .mockReturnValueOnce({ where: usageDelete.where })
        .mockReturnValueOnce({ where: workerDelete.where })
        .mockReturnValueOnce({ where: agentDelete.where }),
    };
    const repository = new AiAgentDeleterRepository(dbRw as never);

    await expect(
      repository.deleteAiAgentById('agent-1', 'acc-1')
    ).resolves.toBe(true);
    expect(dbRw.delete).toHaveBeenCalledTimes(3);
  });

  it('returns false when final delete affects zero rows', async () => {
    const usageDelete = createDeleteStep();
    const workerDelete = createDeleteStep();
    const agentDelete = createDeleteStep(0);
    const dbRw = {
      delete: jest
        .fn()
        .mockReturnValueOnce({ where: usageDelete.where })
        .mockReturnValueOnce({ where: workerDelete.where })
        .mockReturnValueOnce({ where: agentDelete.where }),
    };
    const repository = new AiAgentDeleterRepository(dbRw as never);

    await expect(
      repository.deleteAiAgentById('agent-1', 'acc-1')
    ).resolves.toBe(false);
  });
});
