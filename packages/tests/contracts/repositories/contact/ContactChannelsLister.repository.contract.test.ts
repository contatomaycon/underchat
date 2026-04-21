import 'reflect-metadata';
import { ContactChannelsListerRepository } from '@core/repositories/contact/ContactChannelsLister.repository';

function createSelectChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const orderBy = jest.fn(() => ({ execute }));
  const where = jest.fn(() => ({ orderBy }));
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  const select = jest.fn(() => ({ from }));

  return {
    dbRo: { select },
    orderBy,
  };
}

describe('ContactChannelsListerRepository', () => {
  it('returns empty array when no channels are found', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new ContactChannelsListerRepository(dbRo as never);

    await expect(repository.listChannelsByAccount('acc-1')).resolves.toEqual(
      []
    );
  });

  it('maps channels payload', async () => {
    const { dbRo, orderBy } = createSelectChain([
      { channel_id: 'w-1', name: 'Atendimento', number: '+551199999999' },
    ]);
    const repository = new ContactChannelsListerRepository(dbRo as never);

    await expect(repository.listChannelsByAccount('acc-1')).resolves.toEqual([
      {
        channel_id: 'w-1',
        name: 'Atendimento',
        number: '+551199999999',
      },
    ]);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });
});
