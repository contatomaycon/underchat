import 'reflect-metadata';
import { LabelTemplateViewerRepository } from '@core/repositories/labelTemplate/LabelTemplateViewer.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const chain = {} as {
    innerJoin: jest.Mock;
    where: jest.Mock;
  };
  chain.where = jest.fn(() => ({ execute }));
  chain.innerJoin = jest.fn(() => chain);
  const from = jest.fn(() => ({
    innerJoin: chain.innerJoin,
    where: chain.where,
  }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    select,
    where: chain.where,
  };
}

describe('LabelTemplateViewerRepository', () => {
  it('returns null when label template by id is not found', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new LabelTemplateViewerRepository(dbRo as never);

    await expect(
      repository.viewLabelTemplateById('label-1')
    ).resolves.toBeNull();
  });

  it('returns label template by id when found', async () => {
    const row = {
      label_template_id: 'label-1',
      account: { account_id: 'acc-1', name: 'Conta' },
      label_status: { label_status_id: 'status-1', name: 'Active' },
      label: 'VIP',
      color: '#fff000',
      created_at: '2026-04-21T00:00:00.000Z',
    };
    const { dbRo, where } = createSelectChain([row]);
    const repository = new LabelTemplateViewerRepository(dbRo as never);

    await expect(
      repository.viewLabelTemplateById('label-1', 'acc-1')
    ).resolves.toEqual(row);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('returns empty list by ids when input is empty', async () => {
    const { dbRo, select } = createSelectChain([{ label_template_id: 'x' }]);
    const repository = new LabelTemplateViewerRepository(dbRo as never);

    await expect(repository.viewLabelTemplatesByIds([])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns label templates by ids', async () => {
    const rows = [
      {
        label_template_id: 'label-1',
        account: { account_id: 'acc-1', name: 'Conta' },
        label_status: { label_status_id: 'status-1', name: 'Active' },
        label: 'VIP',
        color: '#fff000',
        created_at: '2026-04-21T00:00:00.000Z',
      },
    ];
    const { dbRo } = createSelectChain(rows);
    const repository = new LabelTemplateViewerRepository(dbRo as never);

    await expect(
      repository.viewLabelTemplatesByIds(['label-1'], 'acc-1')
    ).resolves.toEqual(rows);
  });
});
