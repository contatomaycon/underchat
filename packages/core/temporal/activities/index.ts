import { EServerStatus } from '@core/common/enums/EServerStatus';
import { IListerServerSsh } from '@core/common/interfaces/IListerServerSsh';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ServerService } from '@core/services/server.service';
import { SshService } from '@core/services/ssh.service';
import { ConnectConfig } from 'ssh2';
import { container } from 'tsyringe';

export interface IServerActivity {
  testSSHConnection(): Promise<void>;
}

export async function listServerSsh(): Promise<IListerServerSsh[]> {
  const serverService = container.resolve(ServerService);

  return serverService.listServerSsh();
}

export async function decryptConnectConfig(
  config: ConnectConfig
): Promise<ConnectConfig> {
  const passwordEncryptorService = container.resolve(PasswordEncryptorService);

  if (!config.username || !config.password) {
    throw new Error('Username or password is missing in the config');
  }

  const decryptedConfig: ConnectConfig = {
    host: config.host,
    port: config.port,
    username: passwordEncryptorService.decrypt(config.username),
    password: passwordEncryptorService.decrypt(config.password),
  };

  return decryptedConfig;
}

export async function updateServerStatusById(
  serverId: string,
  status: EServerStatus
) {
  const serverService = container.resolve(ServerService);

  return serverService.updateServerStatusById(serverId, status);
}

export async function testSSHConnection(): Promise<void> {
  const sshService = container.resolve(SshService);

  const serverSshList = await listServerSsh();

  if (serverSshList.length === 0) {
    throw new Error('No SSH servers found');
  }

  await Promise.all(
    serverSshList.map(async (server: IListerServerSsh) => {
      const config: ConnectConfig = {
        host: server.ssh_ip,
        port: server.ssh_port,
        username: server.ssh_username,
        password: server.ssh_password,
      };

      const decryptedConfig = await decryptConnectConfig(config);
      const testeSsh = await sshService.testSSHConnection(decryptedConfig);

      if (!testeSsh) {
        await updateServerStatusById(server.server_id, EServerStatus.offline);
      }
    })
  );
}
