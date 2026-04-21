import 'reflect-metadata';
import { LabelTemplateAllListerRepository } from '@core/repositories/labelTemplate/LabelTemplateAllLister.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('LabelTemplateAllListerRepository', () => {
  it('returns all active label templates for account', async () => {
    const chain = createChain([
      { label_template_id: 'lt-1', label: 'VIP', color: '#111' },
    ]);
    const dbRo = { select: chain.select };
    const repository = new LabelTemplateAllListerRepository(dbRo as never);

    await expect(repository.listLabelTemplateAll('acc-1')).resolves.toEqual([
      { label_template_id: 'lt-1', label: 'VIP', color: '#111' },
    ]);
  });
});
