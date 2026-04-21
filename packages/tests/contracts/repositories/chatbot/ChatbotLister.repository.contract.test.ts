import 'reflect-metadata';
import { ChatbotListerRepository } from '@core/repositories/chatbot/ChatbotLister.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatbotListerRepository', () => {
  it('returns empty array when there are no chatbots', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotListerRepository(dbRo as never);

    await expect(repository.listChatbots('acc-1')).resolves.toEqual([]);
  });

  it('maps list result and normalizes optional fields', async () => {
    const chain = createChain([
      {
        chatbot_id: 'chatbot-1',
        name: 'Bot',
        type: undefined,
        created_at: undefined,
      },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotListerRepository(dbRo as never);

    await expect(repository.listChatbots('acc-1')).resolves.toEqual([
      {
        chatbot_id: 'chatbot-1',
        name: 'Bot',
        type: null,
        created_at: '',
      },
    ]);
  });
});
