import 'reflect-metadata';
import { ChannelViewerRepository } from '@core/repositories/config/ChannelViewer.repository';

function createChain(result: unknown[]) {
  const execute = jest.fn(async () => result);
  const where = jest.fn(() => ({ execute }));
  const queryBuilder = {
    innerJoin: jest.fn(),
    where,
  } as any;
  queryBuilder.innerJoin.mockReturnValue(queryBuilder);
  const from = jest.fn(() => queryBuilder);
  const select = jest.fn(() => ({ from }));

  return { select };
}

describe('ChannelViewerRepository', () => {
  it('returns channel context without requiring server data', async () => {
    const chain = createChain([
      {
        worker_id: 'channel-1',
        account_id: 'acc-1',
        worker_type_id: 'whatsapp',
        worker_status_id: 'online',
        name: 'Official',
      },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChannelViewerRepository(dbRo as never);

    await expect(repository.viewChannelContext('channel-1')).resolves.toEqual({
      worker_id: 'channel-1',
      account_id: 'acc-1',
      worker_type_id: 'whatsapp',
      worker_status_id: 'online',
      name: 'Official',
    });
  });

  it('returns null when channel is not found', async () => {
    const chain = createChain([]);
    const dbRo = { select: chain.select };
    const repository = new ChannelViewerRepository(dbRo as never);

    await expect(
      repository.viewChannelBalancer('channel-1')
    ).resolves.toBeNull();
  });

  it('returns balancer data when channel exists', async () => {
    const chain = createChain([
      {
        server_id: 'srv-1',
        key: 'api-key',
        web_domain: 'example.com',
        web_port: '443',
        web_protocol: 'https',
        account_id: 'acc-1',
      },
    ]);
    const dbRo = { select: chain.select };
    const repository = new ChannelViewerRepository(dbRo as never);

    await expect(repository.viewChannelBalancer('channel-1')).resolves.toEqual({
      server_id: 'srv-1',
      key: 'api-key',
      web_domain: 'example.com',
      web_port: '443',
      web_protocol: 'https',
      account_id: 'acc-1',
    });
  });
});
