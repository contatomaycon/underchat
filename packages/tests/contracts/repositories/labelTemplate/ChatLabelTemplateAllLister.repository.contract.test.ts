import 'reflect-metadata';
import { ChatLabelTemplateAllListerRepository } from '@core/repositories/labelTemplate/ChatLabelTemplateAllLister.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChatLabelTemplateAllListerRepository', () => {
  it('returns list of chat labels', async () => {
    const chain = createChain([
      { label_template_id: 'lt-1', label: 'Urgente', color: '#f00' },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChatLabelTemplateAllListerRepository(dbRo as never);

    await expect(repository.listChatLabelTemplateAll('acc-1')).resolves.toEqual(
      [{ label_template_id: 'lt-1', label: 'Urgente', color: '#f00' }]
    );
  });
});
