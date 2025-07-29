import { injectable } from 'tsyringe';
import { Client, ConnectConfig } from 'ssh2';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { EAllowedDistroVersion } from '@core/common/enums/EAllowedDistroVersion';
import { installUbuntu2504 } from '@core/common/functions/installUbuntu2504';
import { CentrifugoService } from './centrifugo.service';
import { ECentrifugoChannel } from '@core/common/enums/ECentrifugoChannel';
import { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';

@injectable()
export class SshService {
  constructor(private readonly centrifugoService: CentrifugoService) {}

  private connect(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const connectConfig: ConnectConfig = {
        ...config,
        readyTimeout: 600_000,
        keepaliveInterval: 20_000,
        keepaliveCountMax: 10,
      };

      conn
        .on('ready', () => resolve(conn))
        .on('error', (err) => reject(err))
        .connect(connectConfig);
    });
  }

  private execCommand(
    conn: Client,
    command: string,
    options: {
      pty?: boolean;
      timeoutMs?: number;
      onData?: (chunk: string) => void;
    } = {}
  ): Promise<string> {
    const { pty = false, timeoutMs = 0, onData } = options;

    return new Promise((resolve, reject) => {
      conn.exec(command, { pty }, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let output = '';
        let timer: NodeJS.Timeout | undefined;

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            stream.close();
            reject(new Error('execCommand timeout'));
          }, timeoutMs);
        }
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString();

          output += text;
          if (onData) {
            onData(text);
          }
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();

          output += text;
          if (onData) {
            onData(text);
          }
        });
        stream.on('close', () => {
          if (timer) {
            clearTimeout(timer);
          }

          resolve(output.trimEnd());
        });
        stream.on('error', (e: Error) => {
          if (timer) {
            clearTimeout(timer);
          }

          reject(e);
        });
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
    serverId: string,
    config: ConnectConfig,
    commands: string[]
  ): Promise<IServerSshCentrifugo[]> {
    const conn = await this.connect(config);
    const results: IServerSshCentrifugo[] = [];

    const stripAnsi = (await import('strip-ansi')).default;

    try {
      for (const cmd of commands) {
        await this.execCommand(conn, cmd, {
          pty: true,
          onData: async (linha) => {
            const date = new Date();

            const outputStripAnsi = stripAnsi(linha);
            const commandStripAnsi = stripAnsi(cmd);

            const serverSshCentrifugo: IServerSshCentrifugo = {
              server_id: serverId,
              command: commandStripAnsi,
              output: outputStripAnsi,
              date,
            };

            await this.centrifugoService.publish(
              ECentrifugoChannel.server_ssh,
              serverSshCentrifugo
            );

            results.push({
              command: commandStripAnsi,
              output: outputStripAnsi,
              date,
              server_id: serverId,
            });
          },
        });
      }

      return results;
    } finally {
      conn.end();
    }
  }

  async getInstallCommands(
    info: IDistroInfo,
    webView: IViewServerWebById
  ): Promise<string[]> {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_04]: await installUbuntu2504(webView),
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

  getStatusCommands(info: IDistroInfo, ip: string, port: number): string[] {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_04]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_10]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_04]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
    };

    return commandsMap[key] ?? [];
  }
}
