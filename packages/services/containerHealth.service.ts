import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { PassThrough } from 'node:stream';

@injectable()
export class ContainerHealthService {
  private readonly maxAttempts = 20;
  private readonly delayMs = 1000;
  private readonly docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  private readonly connectionHealthMaxAttempts = 10;
  private readonly connectionHealthDelayMs = 2000;

  async isServiceHealthy(
    containerId: string,
    overrides?: { maxAttempts?: number; delayMs?: number }
  ): Promise<boolean> {
    const maxAttempts = overrides?.maxAttempts ?? this.maxAttempts;
    const delayMs = overrides?.delayMs ?? this.delayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = await this.getHttpStatusCode(
        containerId,
        'http://127.0.0.1:3005/v1/health/check'
      );
      if (Number(code) === 200) {
        return true;
      }

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }

    return false;
  }

  async isConnectionHealthy(
    containerId: string,
    overrides?: { maxAttempts?: number; delayMs?: number }
  ): Promise<boolean> {
    const maxAttempts =
      overrides?.maxAttempts ?? this.connectionHealthMaxAttempts;
    const delayMs = overrides?.delayMs ?? this.connectionHealthDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = await this.getHttpStatusCode(
        containerId,
        'http://127.0.0.1:3005/v1/connection/health/check'
      );
      if (Number(code) === 200) {
        return true;
      }

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }

    return false;
  }

  private async getHttpStatusCode(
    containerId: string,
    url: string
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      const execInstance = await container.exec({
        Cmd: [
          'curl',
          '-s',
          '--connect-timeout',
          '2',
          '--max-time',
          '3',
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          url,
        ],
        AttachStdout: true,
        AttachStderr: true,
      });

      const execStream = await execInstance.start({
        hijack: true,
        stdin: false,
      });

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      this.docker.modem.demuxStream(execStream, stdoutStream, stderrStream);

      const chunks: string[] = [];

      stdoutStream.on('data', (chunk) => chunks.push(chunk.toString()));

      await new Promise<void>((resolve) => execStream.on('end', resolve));

      return chunks.join('').trim();
    } catch {
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
