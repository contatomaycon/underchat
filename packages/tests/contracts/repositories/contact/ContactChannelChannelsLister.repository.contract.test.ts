import 'reflect-metadata';
import { ContactChannelChannelsListerRepository } from '@core/repositories/contact/ContactChannelChannelsLister.repository';

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
    where: chain.where,
  };
}

describe('ContactChannelChannelsListerRepository', () => {
  it('returns an empty array when there are no channels', async () => {
    const { dbRo } = createSelectChain([]);
    const repository = new ContactChannelChannelsListerRepository(
      dbRo as never
    );

    await expect(
      repository.listChannelIdsByContactAndAccount('contact-1', 'account-1')
    ).resolves.toEqual([]);
  });

  it('returns channel ids from query result', async () => {
    const { dbRo, where } = createSelectChain([
      { channel_id: 'ch-1' },
      { channel_id: 'ch-2' },
    ]);
    const repository = new ContactChannelChannelsListerRepository(
      dbRo as never
    );

    await expect(
      repository.listChannelIdsByContactAndAccount('contact-1', 'account-1')
    ).resolves.toEqual(['ch-1', 'ch-2']);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
