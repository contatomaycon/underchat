import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { AiAgentPromptCreatorRepository } from '@core/repositories/aiAgent/AiAgentPromptCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository(
  findFirstResult: unknown,
  insertResult: unknown = { rowCount: 1 }
) {
  const execute = jest.fn(async () => insertResult);
  const values = jest.fn(() => ({ execute }));
  const dbRw = {
    query: {
      aiAgent: {
        findFirst: jest.fn(async () => findFirstResult),
      },
    },
    insert: jest.fn(() => ({ values })),
  };

  return {
    repository: new AiAgentPromptCreatorRepository(dbRw as never),
    dbRw,
    values,
  };
}

describe('AiAgentPromptCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('prompt-id-1');
  });

  it('returns null when AI agent does not exist', async () => {
    const { repository, dbRw } = createRepository(null);

    await expect(
      repository.createAiAgentPrompt(
        {
          ai_agent_id: 'agent-1',
          value: 'prompt',
          status: 'active',
        } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
    expect(dbRw.insert).not.toHaveBeenCalled();
  });

  it('creates prompt and returns generated id', async () => {
    const { repository, values } = createRepository({ account_id: 'acc-1' });

    await expect(
      repository.createAiAgentPrompt(
        {
          ai_agent_id: 'agent-1',
          value: 'prompt',
          status: 'active',
        } as never,
        'acc-1'
      )
    ).resolves.toBe('prompt-id-1');
    expect(values).toHaveBeenCalledWith({
      ai_agent_prompt_id: 'prompt-id-1',
      ai_agent_id: 'agent-1',
      value: 'prompt',
      status: 'active',
    });
  });

  it('returns null when insert result is empty', async () => {
    const { repository } = createRepository({ account_id: 'acc-1' }, null);

    await expect(
      repository.createAiAgentPrompt(
        {
          ai_agent_id: 'agent-1',
          value: 'prompt',
          status: 'active',
        } as never,
        'acc-1'
      )
    ).resolves.toBeNull();
  });
});
