import { injectable } from 'tsyringe';
import { Client, ConnectConfig } from 'ssh2';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { EAllowedDistroVersion } from '@core/common/enums/EAllowedDistroVersion';
import { installUbuntu2504 } from '@core/common/functions/installUbuntu2504';

@injectable()
export class SshService {
  constructor() {}

  private connect(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn
        .on('ready', () => resolve(conn))
        .on('error', (err) => reject(err))
        .connect(config);
    });
  }

  private execCommand(conn: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) return reject(err);

        let output = '';
        stream
          .on('data', (chunk: Buffer) => {
            output += chunk.toString();
          })
          .on('close', () => resolve(output));
      });
    });
  }

  async getDistroAndVersion(config: ConnectConfig): Promise<IDistroInfo> {
    const conn = await this.connect(config);
    try {
      const raw = await this.execCommand(conn, 'cat /etc/os-release');
      const lines = raw.split('\n');

      const distro =
        lines
          .find((l) => l.startsWith('NAME='))
          ?.split('=')[1]
          .replace(/"/g, '')
          .trim() ?? 'unknown';

      const version =
        lines
          .find((l) => l.startsWith('VERSION_ID='))
          ?.split('=')[1]
          .replace(/"/g, '')
          .trim() ?? 'unknown';

      return { distro, version };
    } finally {
      conn.end();
    }
  }

  async testSSHConnection(config: ConnectConfig): Promise<boolean> {
    try {
      const conn = await this.connect(config);
      conn.end();

      return true;
    } catch {
      return false;
    }
  }

  async runCommands(
    config: ConnectConfig,
    commands: string[]
  ): Promise<Array<{ command: string; output: string }>> {
    const conn = await this.connect(config);
    const results: Array<{ command: string; output: string }> = [];

    try {
      for (const cmd of commands) {
        const wrapped = `yes | ${cmd}`;
        const output = await this.execCommand(conn, wrapped);

        console.log(`> ${wrapped}\n${output}`); // Debugging output

        results.push({ command: cmd, output });
      }
      return results;
    } finally {
      conn.end();
    }
  }

  async getInstallCommands(info: IDistroInfo): Promise<string[]> {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_04]: await installUbuntu2504(),
      [EAllowedDistroVersion.Ubuntu_24_10]: [
        'sudo apt-get update',
        'sudo apt-get dist-upgrade -y',
      ],
      [EAllowedDistroVersion.Ubuntu_24_04]: [
        'sudo apt-get update',
        'sudo apt-get upgrade -y',
      ],
    };

    return commandsMap[key] ?? [];
  }
}
