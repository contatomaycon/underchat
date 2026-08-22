import 'reflect-metadata';

jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));

import { EServerStatus } from '@core/common/enums/EServerStatus';
import type { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { BalanceMonitorActivity } from '@core/jobs/activities/balanceMonitor.activities';

function serverWithStatus(status: EServerStatus): IBalanceMonitorServer {
  return {
    server_id: 'server-1',
    server_status_id: status,
    ssh_ip: '10.0.2.43',
    ssh_port: 22,
    ssh_username: 'encrypted-user',
    ssh_password: 'encrypted-password',
    web_domain: null,
    web_port: 3003,
    web_protocol: 'http',
  };
}

function makeActivity() {
  const serverService = { updateServerStatusById: jest.fn() };
  const activity = new BalanceMonitorActivity(
    serverService as never,
    {} as never,
    {} as never
  );
  const internals = activity as unknown as {
    handleHealthyServer: (
      serverId: string,
      server: IBalanceMonitorServer
    ) => Promise<void>;
    handleMaxFailuresReached: (
      serverId: string,
      server: IBalanceMonitorServer
    ) => Promise<void>;
  };

  return { internals, serverService };
}

describe('BalanceMonitorActivity installation status fencing', () => {
  it('only restores online while the server is still offline', async () => {
    const { internals, serverService } = makeActivity();

    await internals.handleHealthyServer(
      'server-1',
      serverWithStatus(EServerStatus.offline)
    );

    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.online,
      [EServerStatus.offline]
    );
  });

  it('cannot overwrite a concurrent installation with an offline result', async () => {
    const { internals, serverService } = makeActivity();

    await internals.handleMaxFailuresReached(
      'server-1',
      serverWithStatus(EServerStatus.online)
    );

    expect(serverService.updateServerStatusById).toHaveBeenCalledWith(
      'server-1',
      EServerStatus.offline,
      [EServerStatus.online]
    );
  });
});
