import 'reflect-metadata';
import { ChatbotChatTagsListerRepository } from '@core/repositories/labelTemplate/ChatbotChatTagsLister.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const leftJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ leftJoin }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatbotChatTagsListerRepository', () => {
  it('returns empty list when query has no rows', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotChatTagsListerRepository(dbRo as never);

    await expect(repository.listChatbotChatTags('acc-1')).resolves.toEqual([]);
  });

  it('maps chatbot tags', async () => {
    const chain = createChain([
      { label_template_id: 'lt-1', label: 'VIP', color: '#fff' },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChatbotChatTagsListerRepository(dbRo as never);

    await expect(repository.listChatbotChatTags('acc-1')).resolves.toEqual([
      { label_template_id: 'lt-1', label: 'VIP', color: '#fff' },
    ]);
  });
});
