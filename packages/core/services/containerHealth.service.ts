import { injectable } from 'tsyringe';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

@injectable()
export class ContainerHealthService {
  private readonly maxAttempts = 10;
  private readonly delayMs = 1000;

  async isServiceHealthy(containerId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const code = await this.getStatusCode(containerId);

      console.log('code:', code);

      if (code === '200') return true;

      await this.sleep(this.delayMs);
    }

    return false;
  }

  private async getStatusCode(containerId: string): Promise<string> {
    const cmd = `bash -c "docker exec ${containerId} sh -c 'curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3005/v1/health/check'"`;

    try {
      const { stdout } = await exec(cmd);

      console.log('stdout:', stdout);

      return stdout.trim();
    } catch {
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
