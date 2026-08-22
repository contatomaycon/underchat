import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerService } from '@core/services/server.service';
import { SshService } from '@core/services/ssh.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { injectable, inject } from 'tsyringe';
import axios from 'axios';
import { ConnectConfig } from 'ssh2';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IConnectionFailureTracker } from '@core/common/interfaces/IConnectionFailureTracker';

export interface IBalanceMonitorActivity {
  monitor(): Promise<void>;
}

@injectable()
export class BalanceMonitorActivity implements IBalanceMonitorActivity {
  private readonly maxServerFailures = 3;
  private readonly serverCheckIntervalMs = 60 * 1000;
  private readonly serverFailureTrackers = new Map<
    string,
    IConnectionFailureTracker
  >();
  private readonly activeContinuousChecks = new Set<string>();

  constructor(
    @inject(ServerService)
    private readonly serverService: ServerService,
    @inject(SshService)
    private readonly sshService: SshService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  monitor = async (): Promise<void> => {
    const servers = await this.serverService.listBalanceServers();

    if (!servers.length) {
      return;
    }

    const tasks = servers.map(async (server) => this.checkServer(server));

    await Promise.all(tasks);
  };

  private readonly checkServer = async (
    serverData: IBalanceMonitorServer
  ): Promise<void> => {
    const sshConfig = this.buildSshConfig(serverData);
    const sshOk = await this.sshService.testSSHConnection(sshConfig);

    if (!sshOk) {
      await this.syncServerStatusWithFailureTracking(
        serverData,
        false,
        sshConfig
      );
      return;
    }

    const targetDomain = serverData.web_domain ?? serverData.ssh_ip;
    const port = serverData.web_port ?? 80;
    const protocol = this.resolveProtocol(serverData.web_protocol);
    const url = `${protocol}://${targetDomain}:${port}/v1/health/check`;

    const isHealthy = await this.isHealthy(url);
    await this.syncServerStatusWithFailureTracking(
      serverData,
      isHealthy,
      sshConfig
    );
  };

  private readonly buildSshConfig = (
    serverData: IBalanceMonitorServer
  ): ConnectConfig => ({
    host: serverData.ssh_ip,
    port: serverData.ssh_port,
    username: this.passwordEncryptorService.decrypt(serverData.ssh_username),
    password: this.passwordEncryptorService.decrypt(serverData.ssh_password),
  });

  private readonly syncServerStatusWithFailureTracking = async (
    serverData: IBalanceMonitorServer,
    serverHealthy: boolean,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    const now = Date.now();
    const tracker = this.serverFailureTrackers.get(serverData.server_id);

    if (serverHealthy) {
      if (tracker) {
        this.serverFailureTrackers.delete(serverData.server_id);
      }

      if (serverData.server_status_id === EServerStatus.offline) {
        await this.serverService.updateServerStatusById(
          serverData.server_id,
          EServerStatus.online,
          [EServerStatus.offline]
        );
      }

      return;
    }

    if (!tracker) {
      this.serverFailureTrackers.set(serverData.server_id, {
        failureCount: 1,
        lastCheckTimestamp: now,
      });

      if (!this.activeContinuousChecks.has(serverData.server_id)) {
        this.activeContinuousChecks.add(serverData.server_id);
        this.startContinuousServerCheck(serverData, sshConfig).finally(() => {
          this.activeContinuousChecks.delete(serverData.server_id);
        });
      }

      return;
    }

    const newFailureCount = tracker.failureCount + 1;
    this.serverFailureTrackers.set(serverData.server_id, {
      failureCount: newFailureCount,
      lastCheckTimestamp: now,
    });

    if (newFailureCount >= this.maxServerFailures) {
      if (serverData.server_status_id !== EServerStatus.offline) {
        await this.serverService.updateServerStatusById(
          serverData.server_id,
          EServerStatus.offline,
          [serverData.server_status_id as EServerStatus]
        );
      }
    }
  };

  private readonly isHealthy = async (url: string): Promise<boolean> => {
    try {
      const response = await axios.get(url, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  };

  private readonly resolveProtocol = (protocol: string | null): string => {
    const normalized = protocol?.toLowerCase();
    if (normalized === 'https') {
      return 'https';
    }
    return 'http';
  };

  private readonly validateServerForCheck = (
    serverId: string,
    currentServer: IBalanceMonitorServer | null
  ): currentServer is IBalanceMonitorServer => {
    if (!currentServer) {
      this.serverFailureTrackers.delete(serverId);
      return false;
    }

    if (
      currentServer.server_status_id !== EServerStatus.online &&
      currentServer.server_status_id !== EServerStatus.offline
    ) {
      this.serverFailureTrackers.delete(serverId);
      return false;
    }

    return true;
  };

  private readonly handleHealthyServer = async (
    serverId: string,
    currentServer: IBalanceMonitorServer
  ): Promise<void> => {
    this.serverFailureTrackers.delete(serverId);
    this.activeContinuousChecks.delete(serverId);

    if (currentServer.server_status_id === EServerStatus.offline) {
      await this.serverService.updateServerStatusById(
        currentServer.server_id,
        EServerStatus.online,
        [EServerStatus.offline]
      );
    }
  };

  private readonly updateFailureTracker = (
    serverId: string,
    attempt: number
  ): void => {
    const updatedTracker = this.serverFailureTrackers.get(serverId);
    if (updatedTracker) {
      updatedTracker.failureCount = attempt;
      updatedTracker.lastCheckTimestamp = Date.now();
      this.serverFailureTrackers.set(serverId, updatedTracker);
    }
  };

  private readonly handleMaxFailuresReached = async (
    serverId: string,
    currentServer: IBalanceMonitorServer
  ): Promise<void> => {
    this.activeContinuousChecks.delete(serverId);

    if (currentServer.server_status_id !== EServerStatus.offline) {
      await this.serverService.updateServerStatusById(
        currentServer.server_id,
        EServerStatus.offline,
        [currentServer.server_status_id as EServerStatus]
      );
    }
  };

  private readonly startContinuousServerCheck = async (
    server: IBalanceMonitorServer,
    sshConfig: ConnectConfig
  ): Promise<void> => {
    for (let attempt = 2; attempt <= this.maxServerFailures; attempt++) {
      await this.sleep(this.serverCheckIntervalMs);

      const tracker = this.serverFailureTrackers.get(server.server_id);
      if (!tracker) {
        return;
      }

      const currentServer = await this.getCurrentServerStatus(server.server_id);
      if (!this.validateServerForCheck(server.server_id, currentServer)) {
        return;
      }

      const sshOk = await this.sshService.testSSHConnection(sshConfig);
      if (!sshOk) {
        this.updateFailureTracker(server.server_id, attempt);

        if (attempt >= this.maxServerFailures) {
          await this.handleMaxFailuresReached(server.server_id, currentServer);
        }

        continue;
      }

      const targetDomain = currentServer.web_domain ?? currentServer.ssh_ip;
      const port = currentServer.web_port ?? 80;
      const protocol = this.resolveProtocol(currentServer.web_protocol);
      const url = `${protocol}://${targetDomain}:${port}/v1/health/check`;

      const isHealthy = await this.isHealthy(url);

      if (isHealthy) {
        await this.handleHealthyServer(server.server_id, currentServer);
        return;
      }

      this.updateFailureTracker(server.server_id, attempt);

      if (attempt >= this.maxServerFailures) {
        await this.handleMaxFailuresReached(server.server_id, currentServer);
      }
    }
  };

  private readonly getCurrentServerStatus = async (
    serverId: string
  ): Promise<IBalanceMonitorServer | null> => {
    const servers = await this.serverService.listBalanceServers();
    return servers.find((s) => s.server_id === serverId) || null;
  };

  private readonly sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
}
