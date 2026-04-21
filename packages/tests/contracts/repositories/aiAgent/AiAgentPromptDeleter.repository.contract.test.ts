import 'reflect-metadata';
import { AiAgentPromptDeleterRepository } from '@core/repositories/aiAgent/AiAgentPromptDeleter.repository';

function createRepository(findFirstResult: unknown, rowCount = 1) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const dbRw = {
    query: {
      aiAgentPrompt: {
        findFirst: jest.fn(async () => findFirstResult),
      },
    },
    delete: jest.fn(() => ({ where })),
  };

  return {
    repository: new AiAgentPromptDeleterRepository(dbRw as never),
    dbRw,
  };
}

describe('AiAgentPromptDeleterRepository', () => {
  it('returns false when prompt is not found', async () => {
    const { repository, dbRw } = createRepository(null);

    await expect(
      repository.deleteAiAgentPromptById('prompt-1', 'acc-1')
    ).resolves.toBe(false);
    expect(dbRw.delete).not.toHaveBeenCalled();
  });

  it('returns false when prompt account does not match', async () => {
    const { repository, dbRw } = createRepository({
      aag: { account_id: 'acc-2' },
    });

    await expect(
      repository.deleteAiAgentPromptById('prompt-1', 'acc-1')
    ).resolves.toBe(false);
    expect(dbRw.delete).not.toHaveBeenCalled();
  });

  it('returns true only when delete affects one row', async () => {
    const { repository } = createRepository(
      { aag: { account_id: 'acc-1' } },
      1
    );
    const { repository: repositoryNoRow } = createRepository(
      { aag: { account_id: 'acc-1' } },
      0
    );

    await expect(
      repository.deleteAiAgentPromptById('prompt-1', 'acc-1')
    ).resolves.toBe(true);
    await expect(
      repositoryNoRow.deleteAiAgentPromptById('prompt-1', 'acc-1')
    ).resolves.toBe(false);
  });
});
