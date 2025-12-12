import { EServerStatus } from '@core/common/enums/EServerStatus';
import { ServerService } from '@core/services/server.service';
import { SshService } from '@core/services/ssh.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { injectable } from 'tsyringe';
import axios from 'axios';
import { ConnectConfig } from 'ssh2';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';

export interface IBalanceMonitorActivity {
  monitor(): Promise<void>;
}

@injectable()
export class BalanceMonitorActivity implements IBalanceMonitorActivity {
  constructor(
    private readonly serverService: ServerService,
    private readonly sshService: SshService,
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
      await this.setOfflineIfNeeded(serverData);
      return;
    }

    const targetDomain = serverData.web_domain ?? serverData.ssh_ip;
    const port = serverData.web_port ?? 80;
    const protocol = this.resolveProtocol(serverData.web_protocol);
    const url = `${protocol}://${targetDomain}:${port}/v1/health/check`;

    const isHealthy = await this.isHealthy(url);
    const desiredStatus = isHealthy
      ? EServerStatus.online
      : EServerStatus.offline;
    const alreadyUpdated = desiredStatus === serverData.server_status_id;

    if (alreadyUpdated) {
      return;
    }

    await this.serverService.updateServerStatusById(
      serverData.server_id,
      desiredStatus
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

  private readonly setOfflineIfNeeded = async (
    serverData: IBalanceMonitorServer
  ): Promise<void> => {
    const alreadyOffline =
      serverData.server_status_id === EServerStatus.offline;
    if (alreadyOffline) {
      return;
    }
    await this.serverService.updateServerStatusById(
      serverData.server_id,
      EServerStatus.offline
    );
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
}
