import 'reflect-metadata';
import { LabelTemplateUpdaterRepository } from '@core/repositories/labelTemplate/LabelTemplateUpdater.repository';

function createRepository(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));
  const dbRw = {
    update: jest.fn(() => ({ set })),
  };

  return {
    repository: new LabelTemplateUpdaterRepository(dbRw as never),
    set,
  };
}

describe('LabelTemplateUpdaterRepository', () => {
  it('updates mapped fields and nested label status id', async () => {
    const { repository, set } = createRepository(1);

    await expect(
      repository.updateLabelTemplateById(
        'lt-1',
        {
          label: 'VIP',
          color: '#fff',
          label_status: { label_status_id: 'active' },
        } as never,
        'acc-1'
      )
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({
      label: 'VIP',
      color: '#fff',
      label_status_id: 'active',
    });
  });

  it('returns false when update affects zero rows', async () => {
    const { repository } = createRepository(0);

    await expect(
      repository.updateLabelTemplateById(
        'lt-1',
        { label: 'VIP' } as never,
        'acc-1'
      )
    ).resolves.toBe(false);
  });
});
