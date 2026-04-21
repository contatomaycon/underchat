import 'reflect-metadata';
import { LabelTemplateViewerByNameRepository } from '@core/repositories/labelTemplate/LabelTemplateViewerByName.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const limit = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ limit }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));

  return {
    db: { select },
  };
}

describe('LabelTemplateViewerByNameRepository', () => {
  it('returns null when no template matches the name', async () => {
    const { db } = createSelectChain([]);
    const repository = new LabelTemplateViewerByNameRepository(db as never);

    await expect(
      repository.viewLabelTemplateByName('acc-1', 'VIP')
    ).resolves.toBe(null);
  });

  it('returns template for name lookup', async () => {
    const row = {
      label_template_id: 'label-1',
      label: 'VIP',
      color: '#fff000',
    };
    const { db } = createSelectChain([row]);
    const repository = new LabelTemplateViewerByNameRepository(db as never);

    await expect(
      repository.viewLabelTemplateByName('acc-1', 'VIP')
    ).resolves.toEqual(row);
  });

  it('returns null for transaction lookup when no row exists', async () => {
    const { db } = createSelectChain([]);
    const repository = new LabelTemplateViewerByNameRepository({} as never);

    await expect(
      repository.viewLabelTemplateByNameInTransaction(
        db as never,
        'acc-1',
        'VIP'
      )
    ).resolves.toBeNull();
  });

  it('returns row for transaction lookup', async () => {
    const row = {
      label_template_id: 'label-1',
      label: 'VIP',
      color: '#fff000',
    };
    const { db } = createSelectChain([row]);
    const repository = new LabelTemplateViewerByNameRepository({} as never);

    await expect(
      repository.viewLabelTemplateByNameInTransaction(
        db as never,
        'acc-1',
        'VIP'
      )
    ).resolves.toEqual(row);
  });
});
