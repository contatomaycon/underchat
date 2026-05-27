import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

const SERVICE_HEALTH_URL = 'http://127.0.0.1:3005/v1/health/check';
const CONNECTION_HEALTH_URL =
  'http://127.0.0.1:3005/v1/connection/health/check';
const HEALTH_HTTP_DEADLINE_MS = 3000;

export interface ContainerHealthCheckOptions {
  maxAttempts?: number;
  delayMs?: number;
}

export interface ContainerHealthAttempt {
  container_id: string;
  health_url: string;
  health_attempt: number;
  health_max_attempts: number;
  health_delay_ms: number;
  health_status_code: string;
}

export interface ContainerHealthResult {
  healthy: boolean;
  container_id: string;
  health_url: string;
  health_attempt: number;
  health_max_attempts: number;
  health_delay_ms: number;
  health_status_code: string;
  attempts: ContainerHealthAttempt[];
}

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
    overrides?: ContainerHealthCheckOptions
  ): Promise<boolean> {
    const result = await this.checkServiceHealth(containerId, overrides);
    return result.healthy;
  }

  async isConnectionHealthy(
    containerId: string,
    overrides?: ContainerHealthCheckOptions
  ): Promise<boolean> {
    const result = await this.checkConnectionHealth(containerId, overrides);
    return result.healthy;
  }

  async checkServiceHealth(
    containerId: string,
    overrides?: ContainerHealthCheckOptions
  ): Promise<ContainerHealthResult> {
    return this.checkHttpHealth(
      containerId,
      SERVICE_HEALTH_URL,
      overrides,
      this.maxAttempts,
      this.delayMs,
      'service'
    );
  }

  async checkConnectionHealth(
    containerId: string,
    overrides?: ContainerHealthCheckOptions
  ): Promise<ContainerHealthResult> {
    return this.checkHttpHealth(
      containerId,
      CONNECTION_HEALTH_URL,
      overrides,
      this.connectionHealthMaxAttempts,
      this.connectionHealthDelayMs,
      'connection'
    );
  }

  private async checkHttpHealth(
    containerId: string,
    url: string,
    overrides: ContainerHealthCheckOptions | undefined,
    defaultMaxAttempts: number,
    defaultDelayMs: number,
    healthType: 'service' | 'connection'
  ): Promise<ContainerHealthResult> {
    const maxAttempts = overrides?.maxAttempts ?? defaultMaxAttempts;
    const delayMs = overrides?.delayMs ?? defaultDelayMs;
    const attempts: ContainerHealthAttempt[] = [];
    let lastStatusCode = '';

    recordConnectionLifecycle({
      stage: `connection.balancer.container_health.${healthType}_start`,
      decision: 'http_health_check',
      outcome: 'started',
      container_id: containerId,
      health_url: url,
      health_max_attempts: maxAttempts,
      health_delay_ms: delayMs,
      deadline_ms: HEALTH_HTTP_DEADLINE_MS,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = await this.getHttpStatusCode(containerId, url);
      lastStatusCode = code;
      const attemptResult: ContainerHealthAttempt = {
        container_id: containerId,
        health_url: url,
        health_attempt: attempt,
        health_max_attempts: maxAttempts,
        health_delay_ms: delayMs,
        health_status_code: code,
      };
      attempts.push(attemptResult);

      const healthy = Number(code) === 200;
      recordConnectionLifecycle({
        stage: `connection.balancer.container_health.${healthType}_attempt`,
        decision: 'http_health_check',
        outcome: healthy ? 'healthy' : 'unhealthy',
        container_id: containerId,
        health_url: url,
        health_status_code: code || 'none',
        health_attempt: attempt,
        health_max_attempts: maxAttempts,
        health_delay_ms: delayMs,
        deadline_ms: HEALTH_HTTP_DEADLINE_MS,
      });

      if (healthy) {
        recordConnectionLifecycle({
          stage: `connection.balancer.container_health.${healthType}_success`,
          decision: 'http_health_check',
          outcome: 'success',
          container_id: containerId,
          health_url: url,
          health_status_code: code,
          health_attempt: attempt,
          health_max_attempts: maxAttempts,
          health_delay_ms: delayMs,
          deadline_ms: HEALTH_HTTP_DEADLINE_MS,
        });

        return {
          healthy: true,
          container_id: containerId,
          health_url: url,
          health_attempt: attempt,
          health_max_attempts: maxAttempts,
          health_delay_ms: delayMs,
          health_status_code: code,
          attempts,
        };
      }

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }

    recordConnectionLifecycle({
      stage: `connection.balancer.container_health.${healthType}_failed`,
      decision: 'http_health_check',
      outcome: 'failed',
      reason: 'http_health_not_ready',
      level: 'warn',
      container_id: containerId,
      health_url: url,
      health_status_code: lastStatusCode || 'none',
      health_attempt: maxAttempts,
      health_max_attempts: maxAttempts,
      health_delay_ms: delayMs,
      deadline_ms: HEALTH_HTTP_DEADLINE_MS,
    });

    return {
      healthy: false,
      container_id: containerId,
      health_url: url,
      health_attempt: maxAttempts,
      health_max_attempts: maxAttempts,
      health_delay_ms: delayMs,
      health_status_code: lastStatusCode,
      attempts,
    };
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
