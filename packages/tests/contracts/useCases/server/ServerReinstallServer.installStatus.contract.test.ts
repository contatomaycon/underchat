import 'reflect-metadata';

jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));
jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerReinstallServerUseCase } from '@core/useCases/server/ServerReinstallServer.useCase';

const t = ((key: string) => key) as never;

function makeUseCase(
  input: {
    currentStatus?: EServerStatus;
    latestStatus?: EServerStatus;
    statusUpdated?: boolean;
    sendError?: Error;
  } = {}
) {
  const currentStatus = input.currentStatus ?? EServerStatus.online;
  const serverService = {
    viewServerSshById: jest.fn().mockResolvedValue({
      ssh_ip: '10.0.2.43',
      ssh_port: 22,
      ssh_username: 'encrypted-user',
      ssh_password: 'encrypted-password',
      server_status_id: currentStatus,
    }),
    existsServerById: jest.fn().mockResolvedValue(true),
    viewServerStatusByIdAuthoritative: jest
      .fn()
      .mockResolvedValueOnce(currentStatus)
      .mockResolvedValue(input.latestStatus ?? currentStatus),
    updateServerStatusById: jest
      .fn()
      .mockResolvedValue(input.statusUpdated ?? true),
    deleteLogInstallServer: jest.fn().mockResolvedValue(true),
  };
  const sshService = {
    testSSHConnection: jest.fn().mockResolvedValue(true),
    getDistroAndVersion: jest.fn().mockResolvedValue({
      distro: 'Ubuntu',
      version: '24.04',
    }),
  };
  const passwordEncryptor = {
    decrypt: jest.fn((value: string) => value.replace('encrypted-', '')),
  };
  const streamProducer = {
    send: input.sendError
      ? jest.fn().mockRejectedValue(input.sendError)
      : jest.fn().mockResolvedValue(undefined),
  };
  const queue = { createServer: jest.fn().mockReturnValue('create-server') };
  const useCase = new ServerReinstallServerUseCase(
    serverService as never,
    sshService as never,
    passwordEncryptor as never,
    streamProducer as never,
    queue as never
  );

  return { useCase, serverService, streamProducer };
}

describe('ServerReinstallServerUseCase installation status contract', () => {
  it('does not report success for an already-installing orphan', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase({
      currentStatus: EServerStatus.installing,
    });

    await expect(useCase.execute(t, 'server-1')).rejects.toThrow(
      'server_reinstall_failed'
    );

    expect(serverService.updateServerStatusById).not.toHaveBeenCalled();
    expect(streamProducer.send).not.toHaveBeenCalled();
  });

  it('queues a fenced installation session only after claiming the server state', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase();

    await expect(useCase.execute(t, 'server-1')).resolves.toBe(true);

    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.new,
      [
        EServerStatus.online,
        EServerStatus.error,
        EServerStatus.offline,
        EServerStatus.canceled,
      ]
    );
    expect(streamProducer.send).toHaveBeenCalledWith(
      'create-server',
      {
        server_id: 'server-1',
        installation_id: expect.any(String),
        force_install: true,
      },
      'server-1'
    );
    expect(
      serverService.updateServerStatusById.mock.invocationCallOrder[0]
    ).toBeLessThan(streamProducer.send.mock.invocationCallOrder[0]);
  });

  it('does not delete history or enqueue work when another transition won the race', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase({
      statusUpdated: false,
      latestStatus: EServerStatus.online,
    });

    await expect(useCase.execute(t, 'server-1')).rejects.toThrow(
      'server_reinstall_failed'
    );
    expect(serverService.deleteLogInstallServer).not.toHaveBeenCalled();
    expect(streamProducer.send).not.toHaveBeenCalled();
  });

  it('treats a concurrent reinstall claim as success without publishing a duplicate', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase({
      currentStatus: EServerStatus.online,
      statusUpdated: false,
      latestStatus: EServerStatus.new,
    });

    await expect(useCase.execute(t, 'server-1')).resolves.toBe(true);

    expect(serverService.deleteLogInstallServer).not.toHaveBeenCalled();
    expect(streamProducer.send).not.toHaveBeenCalled();
  });

  it('claims and republishes a server left in new without deleting its install history', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase({
      currentStatus: EServerStatus.new,
    });

    await expect(useCase.execute(t, 'server-1')).resolves.toBe(true);

    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.installing,
      [EServerStatus.new]
    );
    expect(serverService.deleteLogInstallServer).not.toHaveBeenCalled();
    expect(streamProducer.send).toHaveBeenCalledWith(
      'create-server',
      {
        server_id: 'server-1',
        installation_id: expect.any(String),
        force_install: true,
      },
      'server-1'
    );
  });

  it('does not republish when another request already claimed a new server', async () => {
    const { useCase, serverService, streamProducer } = makeUseCase({
      currentStatus: EServerStatus.new,
      statusUpdated: false,
      latestStatus: EServerStatus.installing,
    });

    await expect(useCase.execute(t, 'server-1')).resolves.toBe(true);

    expect(serverService.deleteLogInstallServer).not.toHaveBeenCalled();
    expect(streamProducer.send).not.toHaveBeenCalled();
  });

  it('compensates a failed new-server requeue from installing to error', async () => {
    const { useCase, serverService } = makeUseCase({
      currentStatus: EServerStatus.new,
      sendError: new Error('kafka_error'),
    });

    await expect(useCase.execute(t, 'server-1')).rejects.toThrow('kafka_error');

    expect(serverService.updateServerStatusById).toHaveBeenNthCalledWith(
      2,
      'server-1',
      EServerStatus.error,
      [EServerStatus.installing]
    );
    expect(serverService.deleteLogInstallServer).not.toHaveBeenCalled();
  });
});
