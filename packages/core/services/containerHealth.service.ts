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
      if (code === '200') return true;

      await this.sleep(this.delayMs);
    }

    return false;
  }

  private async getStatusCode(containerId: string): Promise<string> {
    const cmd = [
      'docker exec',
      containerId,
      "curl -s -o /dev/null -w '%{http_code}'",
      'http://127.0.0.1:3005/v1/health/check',
    ].join(' ');

    try {
      const { stdout, stderr } = await exec(cmd);
      if (stderr)
        console.warn(`[health][${containerId}] stderr:`, stderr.trim());
      return stdout.trim();
    } catch (err: any) {
      console.error(`[health][${containerId}] exec error:`, err.message);
      return '';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
