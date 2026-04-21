import 'reflect-metadata';
import { AiAgentPromptUpdaterRepository } from '@core/repositories/aiAgent/AiAgentPromptUpdater.repository';

function createRepository(findFirstResult: unknown, rowCount = 1) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    query: {
      aiAgentPrompt: {
        findFirst: jest.fn(async () => findFirstResult),
      },
    },
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new AiAgentPromptUpdaterRepository(dbRw as never),
    dbRw,
    set,
  };
}

describe('AiAgentPromptUpdaterRepository', () => {
  it('returns false when prompt does not exist or account differs', async () => {
    const { repository } = createRepository(null);
    const { repository: mismatchRepository } = createRepository({
      aag: { account_id: 'acc-2' },
    });

    await expect(
      repository.updateAiAgentPromptById(
        { value: 'x' } as never,
        'prompt-1',
        'acc-1'
      )
    ).resolves.toBe(false);
    await expect(
      mismatchRepository.updateAiAgentPromptById(
        { value: 'x' } as never,
        'prompt-1',
        'acc-1'
      )
    ).resolves.toBe(false);
  });

  it('returns true without update when no mutable fields are provided', async () => {
    const { repository, dbRw } = createRepository({
      aag: { account_id: 'acc-1' },
    });

    await expect(
      repository.updateAiAgentPromptById({} as never, 'prompt-1', 'acc-1')
    ).resolves.toBe(true);
    expect(dbRw.update).not.toHaveBeenCalled();
  });

  it('updates mutable fields and returns operation status', async () => {
    const { repository, set } = createRepository(
      { aag: { account_id: 'acc-1' } },
      1
    );
    const { repository: repositoryNoRow } = createRepository(
      { aag: { account_id: 'acc-1' } },
      0
    );

    await expect(
      repository.updateAiAgentPromptById(
        {
          value: 'new',
          openai_file_id: null,
          status: 'active',
        } as never,
        'prompt-1',
        'acc-1'
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'new',
        openai_file_id: null,
        status: 'active',
        updated_at: expect.any(String),
      })
    );

    await expect(
      repositoryNoRow.updateAiAgentPromptById(
        {
          value: 'new',
        } as never,
        'prompt-1',
        'acc-1'
      )
    ).resolves.toBe(false);
  });

  it('updates OpenAI file id only when account matches', async () => {
    const { repository } = createRepository(
      { aag: { account_id: 'acc-1' } },
      1
    );
    const { repository: mismatchRepository } = createRepository({
      aag: { account_id: 'acc-2' },
    });

    await expect(
      repository.updateAiAgentPromptOpenAIFileId('prompt-1', 'acc-1', 'file-1')
    ).resolves.toBe(true);
    await expect(
      mismatchRepository.updateAiAgentPromptOpenAIFileId(
        'prompt-1',
        'acc-1',
        'file-1'
      )
    ).resolves.toBe(false);
  });
});
