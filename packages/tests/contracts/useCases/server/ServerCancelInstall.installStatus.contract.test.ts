import 'reflect-metadata';

jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerCancelInstallUseCase } from '@core/useCases/server/ServerCancelInstall.useCase';

const t = ((key: string) => key) as never;

function makeUseCase(authoritativeStatus: EServerStatus | null) {
  const serverService = {
    existsServerById: jest.fn().mockResolvedValue(true),
    viewServerSshById: jest.fn().mockResolvedValue({
      server_status_id: EServerStatus.online,
    }),
    viewServerStatusByIdAuthoritative: jest
      .fn()
      .mockResolvedValue(authoritativeStatus),
    updateServerStatusById: jest.fn().mockResolvedValue(true),
  };
  const sshService = {
    cancelServerExecution: jest.fn(),
  };
  const useCase = new ServerCancelInstallUseCase(
    serverService as never,
    sshService as never
  );

  return { serverService, sshService, useCase };
}

describe('ServerCancelInstallUseCase authoritative status contract', () => {
  it('cancels from RW installing even when the SSH replica is stale', async () => {
    const { serverService, sshService, useCase } = makeUseCase(
      EServerStatus.installing
    );

    await expect(useCase.execute(t, 'server-1')).resolves.toBe(true);

    expect(serverService.viewServerSshById).not.toHaveBeenCalled();
    expect(sshService.cancelServerExecution).toHaveBeenCalledWith('server-1');
    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.canceled,
      [EServerStatus.installing]
    );
  });

  it('rejects a stale RO installing view when RW is not installing', async () => {
    const { serverService, sshService, useCase } = makeUseCase(
      EServerStatus.online
    );

    await expect(useCase.execute(t, 'server-1')).rejects.toThrow(
      'server_cancel_install_invalid_status'
    );

    expect(serverService.viewServerSshById).not.toHaveBeenCalled();
    expect(sshService.cancelServerExecution).not.toHaveBeenCalled();
    expect(serverService.updateServerStatusById).not.toHaveBeenCalled();
  });
});
