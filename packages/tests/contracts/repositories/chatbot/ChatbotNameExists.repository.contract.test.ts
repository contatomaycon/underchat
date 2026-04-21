import 'reflect-metadata';
import { ChatbotNameExistsRepository } from '@core/repositories/chatbot/ChatbotNameExists.repository';

function createCountChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatbotNameExistsRepository', () => {
  it('returns false when query has no rows', async () => {
    const chain = createCountChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotNameExistsRepository(dbRo as never);

    await expect(repository.existsChatbotByName('Bot', 'acc-1')).resolves.toBe(
      false
    );
  });

  it('returns true when total is greater than zero', async () => {
    const chain = createCountChain([{ total: 2 }]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotNameExistsRepository(dbRo as never);

    await expect(
      repository.existsChatbotByName('Bot', 'acc-1', 'chatbot-1')
    ).resolves.toBe(true);
  });
});
