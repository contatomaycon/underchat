import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { PassThrough } from 'stream';

@injectable()
export class ContainerHealthService {
  private readonly maxAttempts = 20;
  private readonly delayMs = 1000;
  private readonly docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async isServiceHealthy(containerId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const code = await this.getStatusCode(containerId);

      if (Number(code) === 200) {
        return true;
      }

      await this.sleep(this.delayMs);
    }

    return false;
  }

  private async getStatusCode(containerId: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      const execInstance = await container.exec({
        Cmd: [
          'curl',
          '-s',
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          'http://127.0.0.1:3005/v1/health/check',
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

  private streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';

      stream.on('data', (chunk) => {
        data += chunk.toString();
      });

      stream.on('end', () => resolve(data));
      stream.on('error', (err) => reject(err));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
