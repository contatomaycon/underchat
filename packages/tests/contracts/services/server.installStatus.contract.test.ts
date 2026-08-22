import 'reflect-metadata';

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerService } from '@core/services/server.service';

function makeService(input: {
  statusUpdater?: Record<string, jest.Mock>;
  centrifugo?: Record<string, jest.Mock>;
  elastic?: Record<string, jest.Mock>;
}): ServerService {
  const dependencies = Array.from({ length: 18 }, () => ({}));
  dependencies[0] = input.elastic ?? {};
  dependencies[4] = input.statusUpdater ?? {};
  dependencies[12] = input.centrifugo ?? {};

  return Reflect.construct(ServerService, dependencies) as ServerService;
}

describe('ServerService installation status contract', () => {
  it('exposes the status observed by the authoritative write repository', async () => {
    const statusUpdater = {
      viewServerStatusById: jest
        .fn()
        .mockResolvedValue(EServerStatus.installing),
    };
    const service = makeService({ statusUpdater });

    await expect(
      service.viewServerStatusByIdAuthoritative('server-1')
    ).resolves.toBe(EServerStatus.installing);
    expect(statusUpdater.viewServerStatusById).toHaveBeenCalledWith('server-1');
  });

  it('persists an atomic status transition before publishing it', async () => {
    const order: string[] = [];
    const statusUpdater = {
      updateServerStatusById: jest.fn(async () => {
        order.push('persisted');
        return true;
      }),
    };
    const centrifugo = {
      publish: jest.fn(async () => {
        order.push('published');
      }),
    };
    const service = makeService({ statusUpdater, centrifugo });

    await expect(
      service.updateServerStatusById('server-1', EServerStatus.online, [
        EServerStatus.installing,
      ])
    ).resolves.toBe(true);

    expect(order).toEqual(['persisted', 'published']);
    expect(statusUpdater.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.online,
      [EServerStatus.installing],
      expect.any(String)
    );
  });

  it('does not publish a stale transition rejected by compare-and-set', async () => {
    const statusUpdater = {
      updateServerStatusById: jest.fn().mockResolvedValue(false),
    };
    const centrifugo = { publish: jest.fn() };
    const service = makeService({ statusUpdater, centrifugo });

    await expect(
      service.updateServerStatusById('server-1', EServerStatus.online, [
        EServerStatus.installing,
      ])
    ).resolves.toBe(false);
    expect(centrifugo.publish).not.toHaveBeenCalled();
  });

  it('retries index initialization after a transient persistence failure', async () => {
    const elastic = {
      indices: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary Elasticsearch failure'))
        .mockResolvedValueOnce(true),
      bulkCreateIdempotent: jest.fn().mockResolvedValue({
        created: 1,
        conflicts: 0,
      }),
    };
    const service = makeService({ elastic });
    const event = {
      server_id: 'server-1',
      command: 'Installation lifecycle',
      output: 'Installation running',
      date: new Date(),
    };

    await expect(service.updateLogInstallServerBulk([event])).rejects.toThrow(
      'temporary Elasticsearch failure'
    );
    await expect(service.updateLogInstallServerBulk([event])).resolves.toBe(
      true
    );

    expect(elastic.indices).toHaveBeenCalledTimes(2);
    expect(elastic.bulkCreateIdempotent).toHaveBeenCalledTimes(1);
  });
});
