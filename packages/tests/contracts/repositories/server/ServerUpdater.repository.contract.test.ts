import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { ServerUpdaterRepository } from '@core/repositories/server/ServerUpdater.repository';

type UpdateStep = {
  set: jest.Mock;
};

function createUpdateStep(rowCount: number): UpdateStep {
  const execute = jest.fn(async () => ({ rowCount }));
  const where = jest.fn(() => ({ execute }));
  const set = jest.fn(() => ({ where }));

  return { set };
}

function createRepositoryWithSteps(rowCounts: number[]) {
  const steps = rowCounts.map((rowCount) => createUpdateStep(rowCount));
  const update = jest.fn();

  for (const step of steps) {
    update.mockReturnValueOnce({ set: step.set });
  }

  const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ update })
  );

  return {
    repository: new ServerUpdaterRepository({ transaction } as never),
    steps,
  };
}

function createTranslator(): TFunction<'translation', undefined> {
  return ((key: string) => key) as unknown as TFunction<
    'translation',
    undefined
  >;
}

describe('ServerUpdaterRepository', () => {
  it('updates server, ssh and web and returns true', async () => {
    const { repository, steps } = createRepositoryWithSteps([1, 1, 1]);

    await expect(
      repository.updateServer(
        createTranslator(),
        {
          server_id: 'srv-1',
          name: 'Server Updated',
          quantity_workers: 3,
          proxy_enabled: false,
        },
        {
          server_id: 'srv-1',
          ssh_ip: '10.0.0.1',
          ssh_port: 22,
        },
        {
          server_id: 'srv-1',
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).resolves.toBe(true);

    expect(steps[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy_enabled: false,
        proxy_protocol: EProxyProtocol.http,
        proxy_host: null,
        proxy_port: null,
        proxy_username: null,
        proxy_password: null,
      })
    );

    expect(steps[1].set).toHaveBeenCalledWith({
      ssh_ip: '10.0.0.1',
      ssh_port: 22,
    });
  });

  it('keeps proxy credentials when proxy is enabled and credentials are provided', async () => {
    const { repository, steps } = createRepositoryWithSteps([1, 1, 1]);

    await expect(
      repository.updateServer(
        createTranslator(),
        {
          server_id: 'srv-1',
          name: 'Server Updated',
          quantity_workers: 3,
          proxy_enabled: true,
          proxy_protocol: EProxyProtocol.https,
          proxy_host: 'proxy.local',
          proxy_port: 443,
          proxy_username: 'proxy-user',
          proxy_password: 'proxy-pass',
        },
        {
          server_id: 'srv-1',
          ssh_ip: '10.0.0.1',
          ssh_port: 22,
          ssh_username: 'root',
          ssh_password: 'secret',
        },
        {
          server_id: 'srv-1',
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).resolves.toBe(true);

    expect(steps[0].set).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy_enabled: true,
        proxy_protocol: EProxyProtocol.https,
        proxy_username: 'proxy-user',
        proxy_password: 'proxy-pass',
      })
    );

    expect(steps[1].set).toHaveBeenCalledWith(
      expect.objectContaining({
        ssh_username: 'root',
        ssh_password: 'secret',
      })
    );
  });

  it('throws translated error when server update fails', async () => {
    const { repository } = createRepositoryWithSteps([0]);

    await expect(
      repository.updateServer(
        createTranslator(),
        {
          server_id: 'srv-1',
          name: 'Server Updated',
          quantity_workers: 3,
          proxy_enabled: false,
        },
        {
          server_id: 'srv-1',
          ssh_ip: '10.0.0.1',
          ssh_port: 22,
        },
        {
          server_id: 'srv-1',
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).rejects.toThrow('server_update_error');
  });

  it('throws translated error when ssh update fails', async () => {
    const { repository } = createRepositoryWithSteps([1, 0]);

    await expect(
      repository.updateServer(
        createTranslator(),
        {
          server_id: 'srv-1',
          name: 'Server Updated',
          quantity_workers: 3,
          proxy_enabled: false,
        },
        {
          server_id: 'srv-1',
          ssh_ip: '10.0.0.1',
          ssh_port: 22,
        },
        {
          server_id: 'srv-1',
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).rejects.toThrow('server_ssh_update_error');
  });

  it('throws translated error when web update fails', async () => {
    const { repository } = createRepositoryWithSteps([1, 1, 0]);

    await expect(
      repository.updateServer(
        createTranslator(),
        {
          server_id: 'srv-1',
          name: 'Server Updated',
          quantity_workers: 3,
          proxy_enabled: false,
        },
        {
          server_id: 'srv-1',
          ssh_ip: '10.0.0.1',
          ssh_port: 22,
        },
        {
          server_id: 'srv-1',
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).rejects.toThrow('server_web_update_error');
  });
});
