import 'reflect-metadata';
import { v7 as uuidv7 } from 'uuid';
import { EChatbotType } from '@core/common/enums/EChatbotType';
import { ChatbotClonerRepository } from '@core/repositories/chatbot/ChatbotCloner.repository';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createFindChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatbotClonerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock).mockReturnValue('chatbot-new-id');
  });

  it('returns null when original chatbot does not exist', async () => {
    const findChain = createFindChain([]);
    const dbRo = { select: findChain.select };
    const dbRw = {
      insert: jest.fn(),
    };
    const repository = new ChatbotClonerRepository(
      dbRw as never,
      dbRo as never
    );

    await expect(
      repository.cloneChatbot('chatbot-1', 'Clone', 'acc-1')
    ).resolves.toBeNull();
    expect(dbRw.insert).not.toHaveBeenCalled();
  });

  it('clones chatbot using fallback type when original type is invalid', async () => {
    const findChain = createFindChain([
      {
        chatbot_id: 'chatbot-1',
        name: 'Original',
        type: 'invalid-type',
        account_id: 'acc-1',
      },
    ]);
    const returning = jest.fn(async () => [
      {
        chatbot_id: 'chatbot-new-id',
        name: 'Clone',
        account_id: 'acc-1',
        created_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
    ]);
    const where = jest.fn(() => ({ returning }));
    const set = jest.fn(() => ({ where }));
    const values = jest.fn(() => ({ returning }));
    const dbRo = { select: findChain.select };
    const dbRw = {
      insert: jest.fn(() => ({ values })),
      update: jest.fn(() => ({ set })),
    };
    const repository = new ChatbotClonerRepository(
      dbRw as never,
      dbRo as never
    );

    await expect(
      repository.cloneChatbot('chatbot-1', 'Clone', 'acc-1')
    ).resolves.toEqual({
      chatbot_id: 'chatbot-new-id',
      name: 'Clone',
      account_id: 'acc-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    });
    expect(values).toHaveBeenCalledWith({
      chatbot_id: 'chatbot-new-id',
      account_id: 'acc-1',
      name: 'Clone',
      type: EChatbotType.input,
    });
  });
});
