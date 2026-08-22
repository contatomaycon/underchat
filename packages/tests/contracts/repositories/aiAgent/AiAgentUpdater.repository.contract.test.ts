import 'reflect-metadata';
import { AiAgentUpdaterRepository } from '@core/repositories/aiAgent/AiAgentUpdater.repository';

function createRepository(rowCount = 1) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const update = jest.fn(() => ({ set }));
  const dbRw = { update };

  return {
    repository: new AiAgentUpdaterRepository(dbRw as never),
    dbRw,
    set,
  };
}

describe('AiAgentUpdaterRepository', () => {
  it('updates ai agent with mapped nullable fields', async () => {
    const { repository, set } = createRepository(1);

    await expect(
      repository.updateAiAgentById(
        {
          name: 'new name',
          base_url: null,
          voice_ia_id: null,
          enable_human_transfer: true,
        } as never,
        'agent-1',
        'acc-1'
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'new name',
        base_url: null,
        voice_ia_id: null,
        enable_human_transfer: true,
      })
    );
  });

  it('returns false when updateAiAgentById affects zero rows', async () => {
    const { repository } = createRepository(0);

    await expect(
      repository.updateAiAgentById({ name: 'n' } as never, 'agent-1', 'acc-1')
    ).resolves.toBe(false);
  });

  it('returns true and skips update when no OpenAI ids are provided', async () => {
    const { repository, dbRw } = createRepository(1);

    await expect(
      repository.updateAiAgentOpenAIIds('agent-1', 'acc-1', {})
    ).resolves.toBe(true);
    expect(dbRw.update).not.toHaveBeenCalled();
  });

  it('updates OpenAI ids and returns operation status', async () => {
    const { repository, set } = createRepository(1);
    const { repository: repositoryNoRow } = createRepository(0);

    await expect(
      repository.updateAiAgentOpenAIIds('agent-1', 'acc-1', {
        openai_assistant_id: 'asst-1',
        openai_vector_store_id: 'vs-1',
      })
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      openai_assistant_id: 'asst-1',
      openai_vector_store_id: 'vs-1',
    });

    await expect(
      repositoryNoRow.updateAiAgentOpenAIIds('agent-1', 'acc-1', {
        openai_assistant_id: 'asst-1',
      })
    ).resolves.toBe(false);
  });
});
