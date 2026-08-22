import 'reflect-metadata';

jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
  SshRunCommandsCancelledError: class SshRunCommandsCancelledError extends Error {},
  SshRunCommandsError: class SshRunCommandsError extends Error {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import { BalanceCreatorConsume } from '@core/consumer/balance/BalanceCreator.consume';

interface IBalanceCreatorStatusDecisions {
  getServerStatus(serverId: string): Promise<EServerStatus | null>;
  handleCreateServerMessage(
    server: { log: { warn: jest.Mock } },
    data: {
      server_id: string;
      installation_id?: string;
      force_install?: boolean;
    }
  ): Promise<void>;
  isServerCanceled(serverId: string): Promise<boolean>;
  processMessageWithRetry(
    server: { log: { warn: jest.Mock } },
    data: { server_id: string; installation_id?: string }
  ): Promise<void>;
  validate(serverId: string): Promise<unknown>;
}

function makeConsumer(input: {
  authoritativeStatus: EServerStatus;
  replicaStatus: EServerStatus;
  sshConnection?: Promise<boolean>;
}) {
  const serverService = {
    viewServerSshById: jest.fn().mockResolvedValue({
      server_status_id: input.replicaStatus,
      ssh_ip: '10.0.2.43',
      ssh_port: 22,
      ssh_username: 'encrypted-user',
      ssh_password: 'encrypted-password',
    }),
    viewServerWebById: jest.fn().mockResolvedValue({
      server_id: 'server-1',
      server_status_id: input.replicaStatus,
      web_domain: '10.0.2.43',
      web_port: 9000,
      web_protocol: 'http',
    }),
    viewServerStatusByIdAuthoritative: jest
      .fn()
      .mockResolvedValue(input.authoritativeStatus),
    updateServerStatusById: jest.fn().mockResolvedValue(true),
    deleteLogInstallServer: jest.fn().mockResolvedValue(true),
    recordLogInstallServerBulk: jest.fn().mockResolvedValue([]),
  };
  const sshService = {
    testSSHConnection: jest
      .fn()
      .mockImplementation(() => input.sshConnection ?? Promise.resolve(true)),
    getDistroAndVersion: jest.fn().mockResolvedValue({
      distro: 'Ubuntu',
      version: '24.04',
    }),
    getInstallCommands: jest.fn().mockResolvedValue(['install']),
    getImagesCommands: jest.fn().mockReturnValue(['images']),
    getStatusCommands: jest.fn().mockReturnValue(['status']),
    runCommands: jest
      .fn()
      .mockImplementation(
        async (_serverId: string, _config: unknown, commands: string[]) => [
          {
            server_id: 'server-1',
            command: commands[0] ?? 'unknown',
            output: commands[0] === 'install' ? 'installed' : 'true',
            date: new Date(),
          },
        ]
      ),
  };
  const passwordEncryptor = {
    decrypt: jest.fn((value: string) => value.replace('encrypted-', '')),
  };
  const serverBuildService = {
    getDefaultImages: jest.fn().mockResolvedValue({
      baileys: 'registry/baileys:v1',
      wwebjs: 'registry/wwebjs:v1',
      whatsmeow: 'registry/whatsmeow:v1',
      balance_api: 'registry/balance:v1',
    }),
  };

  const consumer = new BalanceCreatorConsume(
    {} as never,
    sshService as never,
    serverService as never,
    passwordEncryptor as never,
    {} as never,
    serverBuildService as never
  );

  return {
    consumer: consumer as unknown as IBalanceCreatorStatusDecisions,
    serverService,
    sshService,
  };
}

describe('BalanceCreator authoritative installation status contract', () => {
  it('continues preflight after RW moved to installing while RO still reports new', async () => {
    const { consumer, serverService } = makeConsumer({
      authoritativeStatus: EServerStatus.installing,
      replicaStatus: EServerStatus.new,
    });

    await expect(consumer.validate('server-1')).resolves.toBeDefined();

    expect(
      serverService.viewServerStatusByIdAuthoritative
    ).toHaveBeenCalledWith('server-1');
    expect(serverService.viewServerSshById).toHaveBeenCalledWith('server-1');
  });

  it('rejects stale RO installing when the authoritative state is already canceled', async () => {
    const { consumer } = makeConsumer({
      authoritativeStatus: EServerStatus.canceled,
      replicaStatus: EServerStatus.installing,
    });

    await expect(consumer.validate('server-1')).rejects.toMatchObject({
      name: 'ServerInstallationAlreadySettledError',
      status: EServerStatus.canceled,
    });
  });

  it('uses RW for initial and cancellation decisions instead of the SSH replica view', async () => {
    const { consumer, serverService } = makeConsumer({
      authoritativeStatus: EServerStatus.canceled,
      replicaStatus: EServerStatus.new,
    });

    await expect(consumer.getServerStatus('server-1')).resolves.toBe(
      EServerStatus.canceled
    );
    await expect(consumer.isServerCanceled('server-1')).resolves.toBe(true);

    expect(serverService.viewServerSshById).not.toHaveBeenCalled();
    expect(
      serverService.viewServerStatusByIdAuthoritative
    ).toHaveBeenCalledTimes(2);
  });

  it('preserves forced reinstall semantics after a new server is claimed as installing', async () => {
    jest.useFakeTimers();
    try {
      const { consumer, sshService } = makeConsumer({
        authoritativeStatus: EServerStatus.installing,
        replicaStatus: EServerStatus.new,
      });
      const execution = consumer.handleCreateServerMessage(
        { log: { warn: jest.fn() } },
        {
          server_id: 'server-1',
          installation_id: '019d0000-0000-7000-8000-000000000001',
          force_install: true,
        }
      );

      await jest.advanceTimersByTimeAsync(5_000);
      await expect(execution).resolves.toBeUndefined();

      expect(sshService.getInstallCommands).toHaveBeenCalledTimes(1);
      expect(sshService.runCommands).toHaveBeenCalledWith(
        'server-1',
        expect.any(Object),
        ['install'],
        false,
        expect.objectContaining({
          commandTimeoutMs: expect.any(Number),
        })
      );
      const installOptions = sshService.runCommands.mock.calls.find(
        (call) => call[2]?.[0] === 'install'
      )?.[4];
      expect(installOptions?.commandTimeoutMs).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('terminalizes an installation whose preflight never settles', async () => {
    jest.useFakeTimers();
    try {
      const { consumer, serverService } = makeConsumer({
        authoritativeStatus: EServerStatus.installing,
        replicaStatus: EServerStatus.new,
        sshConnection: new Promise<boolean>(() => undefined),
      });
      const server = { log: { warn: jest.fn() } };

      const execution = consumer.processMessageWithRetry(server, {
        server_id: 'server-1',
        installation_id: '019d0000-0000-7000-8000-000000000001',
      });
      await jest.advanceTimersByTimeAsync(120_000);

      await expect(execution).resolves.toBeUndefined();
      expect(serverService.updateServerStatusById).toHaveBeenLastCalledWith(
        'server-1',
        EServerStatus.error,
        [EServerStatus.installing, EServerStatus.new]
      );
      expect(serverService.recordLogInstallServerBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            install_event_type: 'lifecycle',
            install_status: 'error',
          }),
        ])
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
