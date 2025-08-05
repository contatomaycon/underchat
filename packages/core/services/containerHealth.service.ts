import { injectable } from 'tsyringe';
import Docker from 'dockerode';

@injectable()
export class ContainerHealthService {
  private readonly maxAttempts = 10;
  private readonly delayMs = 1000;
  private readonly docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async isServiceHealthy(containerId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const code = await this.getStatusCode(containerId);

      console.log('code:', code);

      if (code === '200') {
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

      const stream = await execInstance.start({ hijack: true, stdin: false });

      const output = await this.streamToString(stream);
      const code = output.trim();

      return code;
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
