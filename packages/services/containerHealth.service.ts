import { injectable } from 'tsyringe';
import Docker from 'dockerode';
import { PassThrough } from 'node:stream';

const SERVICE_HEALTH_URL = 'http://127.0.0.1:3005/v1/health/check';
const CONNECTION_HEALTH_URL =
  'http://127.0.0.1:3005/v1/connection/health/check';
const CONTAINER_HEALTH_DOCKER_API_TIMEOUT_MS = 8_000;
const CONTAINER_HEALTH_EXEC_STREAM_TIMEOUT_MS = 5_000;

export interface ContainerHealthCheckOptions {
  maxAttempts?: number;
  delayMs?: number;
  requiredConsecutiveSuccesses?: number;
  failFastAfterFirstSuccessFailures?: number;
}

export interface ContainerHealthAttempt {
  container_id: string;
  health_url: string;
  health_attempt: number;
  health_max_attempts: number;
  health_delay_ms: number;
  health_status_code: string;
  consecutive_successes: number;
  required_consecutive_successes: number;
  health_duration_ms: number;
  health_error?: string;
}

export interface ContainerHealthResult {
  healthy: boolean;
  container_id: string;
  health_url: string;
  health_attempt: number;
  health_max_attempts: number;
  health_delay_ms: number;
  health_status_code: string;
  consecutive_successes: number;
  required_consecutive_successes: number;
  health_duration_ms: number;
  health_error?: string;
  health_failure_reason?: string;
  attempts: ContainerHealthAttempt[];
}

interface ContainerHttpStatusResult {
  statusCode: string;
  durationMs: number;
  error?: string;
}

@injectable()
export class ContainerHealthService {
  private readonly maxAttempts = 20;
  private readonly delayMs = 1000;
  private readonly docker: Docker;

  constructor() {
    this.docker = new Docker({
      socketPath: '/var/run/docker.sock',
      timeout: CONTAINER_HEALTH_DOCKER_API_TIMEOUT_MS,
    });
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
      this.delayMs
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
      this.connectionHealthDelayMs
    );
  }

  private async checkHttpHealth(
    containerId: string,
    url: string,
    overrides: ContainerHealthCheckOptions | undefined,
    defaultMaxAttempts: number,
    defaultDelayMs: number
  ): Promise<ContainerHealthResult> {
    const maxAttempts = overrides?.maxAttempts ?? defaultMaxAttempts;
    const delayMs = overrides?.delayMs ?? defaultDelayMs;
    const configuredRequiredConsecutiveSuccesses =
      overrides?.requiredConsecutiveSuccesses ?? 1;
    const requiredConsecutiveSuccesses =
      Number.isFinite(configuredRequiredConsecutiveSuccesses) &&
      configuredRequiredConsecutiveSuccesses > 0
        ? Math.floor(configuredRequiredConsecutiveSuccesses)
        : 1;
    const failFastAfterFirstSuccessFailures = this.normalizePositiveInteger(
      overrides?.failFastAfterFirstSuccessFailures
    );
    const attempts: ContainerHealthAttempt[] = [];
    let lastStatusCode = '';
    let lastHealthError: string | undefined;
    let lastHealthDurationMs = 0;
    let consecutiveSuccesses = 0;
    let hasSeenHealthyStatus = false;
    let failuresAfterFirstSuccess = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const probe = await this.getHttpStatusCode(containerId, url);
      const code = probe.statusCode;
      lastStatusCode = code;
      lastHealthError = probe.error;
      lastHealthDurationMs = probe.durationMs;
      const hasHealthyStatus = Number(code) === 200;
      if (hasHealthyStatus) {
        hasSeenHealthyStatus = true;
        failuresAfterFirstSuccess = 0;
      } else if (
        hasSeenHealthyStatus &&
        this.isStartupFlappingFailure(code, probe.error)
      ) {
        failuresAfterFirstSuccess += 1;
      } else {
        failuresAfterFirstSuccess = 0;
      }
      consecutiveSuccesses = hasHealthyStatus ? consecutiveSuccesses + 1 : 0;
      const attemptResult: ContainerHealthAttempt = {
        container_id: containerId,
        health_url: url,
        health_attempt: attempt,
        health_max_attempts: maxAttempts,
        health_delay_ms: delayMs,
        health_status_code: code,
        consecutive_successes: consecutiveSuccesses,
        required_consecutive_successes: requiredConsecutiveSuccesses,
        health_duration_ms: probe.durationMs,
        ...(probe.error ? { health_error: probe.error } : {}),
      };
      attempts.push(attemptResult);

      const healthy = consecutiveSuccesses >= requiredConsecutiveSuccesses;
      const shouldFailFast =
        failFastAfterFirstSuccessFailures !== undefined &&
        failuresAfterFirstSuccess >= failFastAfterFirstSuccessFailures;

      if (healthy) {
        return {
          healthy: true,
          container_id: containerId,
          health_url: url,
          health_attempt: attempt,
          health_max_attempts: maxAttempts,
          health_delay_ms: delayMs,
          health_status_code: code,
          consecutive_successes: consecutiveSuccesses,
          required_consecutive_successes: requiredConsecutiveSuccesses,
          health_duration_ms: probe.durationMs,
          ...(probe.error ? { health_error: probe.error } : {}),
          attempts,
        };
      }

      if (shouldFailFast) {
        return {
          healthy: false,
          container_id: containerId,
          health_url: url,
          health_attempt: attempt,
          health_max_attempts: maxAttempts,
          health_delay_ms: delayMs,
          health_status_code: code,
          consecutive_successes: consecutiveSuccesses,
          required_consecutive_successes: requiredConsecutiveSuccesses,
          health_duration_ms: probe.durationMs,
          ...(probe.error ? { health_error: probe.error } : {}),
          health_failure_reason: 'health_flapping_after_success',
          attempts,
        };
      }

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }

    return {
      healthy: false,
      container_id: containerId,
      health_url: url,
      health_attempt: maxAttempts,
      health_max_attempts: maxAttempts,
      health_delay_ms: delayMs,
      health_status_code: lastStatusCode,
      consecutive_successes: consecutiveSuccesses,
      required_consecutive_successes: requiredConsecutiveSuccesses,
      health_duration_ms: lastHealthDurationMs,
      ...(lastHealthError ? { health_error: lastHealthError } : {}),
      health_failure_reason: 'http_health_not_ready',
      attempts,
    };
  }

  private async getHttpStatusCode(
    containerId: string,
    url: string
  ): Promise<ContainerHttpStatusResult> {
    const startedAt = Date.now();
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
      const errorChunks: string[] = [];

      stdoutStream.on('data', (chunk) => chunks.push(chunk.toString()));
      stderrStream.on('data', (chunk) => errorChunks.push(chunk.toString()));

      await this.waitForExecStreamEnd(execStream);

      const statusCode = chunks.join('').trim();
      const stderr = this.sanitizeHealthError(errorChunks.join(''));
      const execInspection = (await execInstance.inspect().catch(() => {
        return undefined;
      })) as { ExitCode?: number } | undefined;
      const exitCode = execInspection?.ExitCode;
      const errorParts = [
        statusCode ? undefined : 'empty_status_code',
        exitCode !== undefined && exitCode !== 0
          ? `curl_exit_code=${exitCode}`
          : undefined,
        stderr,
      ].filter((part): part is string => Boolean(part));

      return {
        statusCode,
        durationMs: Date.now() - startedAt,
        error: errorParts.length > 0 ? errorParts.join('; ') : undefined,
      };
    } catch (error) {
      return {
        statusCode: '',
        durationMs: Date.now() - startedAt,
        error: this.sanitizeHealthError(
          error instanceof Error ? error.message : String(error)
        ),
      };
    }
  }

  private waitForExecStreamEnd(
    execStream: NodeJS.ReadWriteStream
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (deadlineTimer) {
          clearTimeout(deadlineTimer);
        }
        execStream.removeListener('end', onEnd);
        execStream.removeListener('error', onError);
      };
      const settle = (error?: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      const onEnd = (): void => settle();
      const onError = (error: unknown): void => settle(error);

      execStream.once('end', onEnd);
      execStream.once('error', onError);
      deadlineTimer = setTimeout(() => {
        settle(new Error('container_health_exec_stream_timeout'));
        try {
          (
            execStream as NodeJS.ReadWriteStream & {
              destroy?: () => void;
            }
          ).destroy?.();
        } catch {
          // The deadline has already failed the probe. Stream teardown is
          // best-effort and must never keep a lifecycle lease alive.
        }
      }, CONTAINER_HEALTH_EXEC_STREAM_TIMEOUT_MS);
      deadlineTimer.unref?.();
    });
  }

  private normalizePositiveInteger(
    value: number | undefined
  ): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Number.isFinite(value) || value <= 0) {
      return undefined;
    }

    return Math.floor(value);
  }

  private isStartupFlappingFailure(
    statusCode: string,
    error: string | undefined
  ): boolean {
    return (
      !statusCode ||
      statusCode === '000' ||
      error?.includes('curl_exit_code=28') === true
    );
  }

  private sanitizeHealthError(value: string | undefined): string | undefined {
    const normalized = value?.replace(/\s+/gu, ' ').trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.length > 240
      ? `${normalized.slice(0, 240)}...`
      : normalized;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
