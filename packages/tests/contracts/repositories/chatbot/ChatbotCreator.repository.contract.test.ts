import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ChatbotCreatorRepository } from '@core/repositories/chatbot/ChatbotCreator.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createRepository(returningRows: unknown[]) {
  const returning = jest.fn(async () => returningRows);
  const values = jest.fn(() => ({ returning }));
  const dbRw = {
    insert: jest.fn(() => ({ values })),
  };

  return {
    repository: new ChatbotCreatorRepository(dbRw as never),
    values,
  };
}

describe('ChatbotCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('chatbot-id-1');
  });

  it('creates chatbot with valid input type', async () => {
    const { repository, values } = createRepository([
      {
        chatbot_id: 'chatbot-id-1',
        name: 'Bot',
        account_id: 'acc-1',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);

    await expect(
      repository.createChatbot(
        { name: 'Bot', type: EChatbotType.output } as never,
        'acc-1'
      )
    ).resolves.toEqual({
      chatbot_id: 'chatbot-id-1',
      name: 'Bot',
      account_id: 'acc-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(values).toHaveBeenCalledWith({
      chatbot_id: 'chatbot-id-1',
      account_id: 'acc-1',
      name: 'Bot',
      type: EChatbotType.output,
    });
  });

  it('uses input type as fallback and returns null when insert returns empty', async () => {
    const { repository, values } = createRepository([]);

    await expect(
      repository.createChatbot({ name: 'Bot', type: 'x' } as never, 'acc-1')
    ).resolves.toBeNull();
    expect(values).toHaveBeenCalledWith({
      chatbot_id: 'chatbot-id-1',
      account_id: 'acc-1',
      name: 'Bot',
      type: EChatbotType.input,
    });
  });
});
