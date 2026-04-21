import 'reflect-metadata';
import type { TFunction } from 'i18next';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { ServerCreatorRepository } from '@core/repositories/server/ServerCreator.repository';
import { v7 as uuidv7 } from 'uuid';

jest.mock('uuid', () => ({
  v7: jest.fn(),
}));

function createInsertStep(rowCount: number) {
  const execute = jest.fn(async () => ({ rowCount }));
  const values = jest.fn(() => ({ execute }));

  return { values };
}

function createRepositoryWithSteps(rowCounts: number[]) {
  const steps = rowCounts.map((rowCount) => createInsertStep(rowCount));
  const insert = jest.fn();

  for (const step of steps) {
    insert.mockReturnValueOnce({ values: step.values });
  }

  const transaction = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ insert })
  );

  return {
    repository: new ServerCreatorRepository({ transaction } as never),
    steps,
  };
}

function createTranslator(): TFunction<'translation', undefined> {
  return ((key: string) => key) as unknown as TFunction<
    'translation',
    undefined
  >;
}

describe('ServerCreatorRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (uuidv7 as unknown as jest.Mock)
      .mockReturnValueOnce('server-id')
      .mockReturnValueOnce('server-ssh-id')
      .mockReturnValueOnce('server-web-id');
  });

  it('creates server, ssh and web records and returns server id', async () => {
    const { repository, steps } = createRepositoryWithSteps([1, 1, 1]);

    await expect(
      repository.createBalanceServer(
        createTranslator(),
        {
          server_status_id: EServerStatus.new,
          name: 'Server 1',
          quantity_workers: 2,
          proxy_enabled: false,
        },
        {
          ssh_ip: '127.0.0.1',
          ssh_port: 22,
          ssh_username: 'root',
          ssh_password: 'secret',
        },
        {
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.https,
        }
      )
    ).resolves.toBe('server-id');

    expect(steps[0].values).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'server-id',
        proxy_protocol: EProxyProtocol.http,
        proxy_host: null,
        proxy_port: null,
        proxy_username: null,
        proxy_password: null,
      })
    );
  });

  it('throws translated error when server creation fails', async () => {
    const { repository } = createRepositoryWithSteps([0]);

    await expect(
      repository.createBalanceServer(
        createTranslator(),
        {
          server_status_id: EServerStatus.new,
          name: 'Server 1',
          quantity_workers: 2,
          proxy_enabled: true,
          proxy_protocol: EProxyProtocol.http,
          proxy_host: 'host',
          proxy_port: 80,
        },
        {
          ssh_ip: '127.0.0.1',
          ssh_port: 22,
          ssh_username: 'root',
          ssh_password: 'secret',
        },
        {
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.http,
        }
      )
    ).rejects.toThrow('server_create_error');
  });

  it('throws translated error when server ssh creation fails', async () => {
    const { repository } = createRepositoryWithSteps([1, 0]);

    await expect(
      repository.createBalanceServer(
        createTranslator(),
        {
          server_status_id: EServerStatus.new,
          name: 'Server 1',
          quantity_workers: 2,
          proxy_enabled: false,
        },
        {
          ssh_ip: '127.0.0.1',
          ssh_port: 22,
          ssh_username: 'root',
          ssh_password: 'secret',
        },
        {
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.http,
        }
      )
    ).rejects.toThrow('server_ssh_create_error');
  });

  it('throws translated error when server web creation fails', async () => {
    const { repository } = createRepositoryWithSteps([1, 1, 0]);

    await expect(
      repository.createBalanceServer(
        createTranslator(),
        {
          server_status_id: EServerStatus.new,
          name: 'Server 1',
          quantity_workers: 2,
          proxy_enabled: false,
        },
        {
          ssh_ip: '127.0.0.1',
          ssh_port: 22,
          ssh_username: 'root',
          ssh_password: 'secret',
        },
        {
          web_domain: 'example.com',
          web_port: 443,
          web_protocol: EServerWebProtocol.http,
        }
      )
    ).rejects.toThrow('server_web_create_error');
  });
});
