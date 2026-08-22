import 'reflect-metadata';
import { EventEmitter } from 'node:events';

jest.mock('dockerode', () => {
  return jest.fn().mockImplementation(() => ({
    modem: { demuxStream: jest.fn() },
    getContainer: jest.fn(),
  }));
});

import { ContainerHealthService } from '@core/services/containerHealth.service';

describe('ContainerHealthService', () => {
  it('checks service and connection health with retries', async () => {
    const service = new ContainerHealthService();

    const getHttpStatusCode = jest
      .spyOn(service as any, 'getHttpStatusCode')
      .mockResolvedValueOnce({ statusCode: '500', durationMs: 1 })
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 1 })
      .mockResolvedValue({ statusCode: '500', durationMs: 1 });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.isServiceHealthy('c1', { maxAttempts: 2, delayMs: 1 })
    ).resolves.toBe(true);

    await expect(
      service.isConnectionHealthy('c1', { maxAttempts: 2, delayMs: 1 })
    ).resolves.toBe(false);

    expect(getHttpStatusCode).toHaveBeenCalled();
  });

  it('returns detailed service health attempts', async () => {
    const service = new ContainerHealthService();

    jest
      .spyOn(service as any, 'getHttpStatusCode')
      .mockResolvedValueOnce({
        statusCode: '',
        durationMs: 3,
        error: 'empty_status_code',
      })
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 2 });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.checkServiceHealth('container-1', {
        maxAttempts: 2,
        delayMs: 1,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: true,
        container_id: 'container-1',
        health_url: 'http://127.0.0.1:3005/v1/health/check',
        health_attempt: 2,
        health_max_attempts: 2,
        health_delay_ms: 1,
        health_status_code: '200',
        consecutive_successes: 1,
        required_consecutive_successes: 1,
        health_duration_ms: 2,
        attempts: [
          expect.objectContaining({
            health_attempt: 1,
            health_status_code: '',
            consecutive_successes: 0,
            health_error: 'empty_status_code',
          }),
          expect.objectContaining({
            health_attempt: 2,
            health_status_code: '200',
            consecutive_successes: 1,
          }),
        ],
      })
    );
  });

  it('requires consecutive successful health checks and resets after failures', async () => {
    const service = new ContainerHealthService();

    jest
      .spyOn(service as any, 'getHttpStatusCode')
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 1 })
      .mockResolvedValueOnce({ statusCode: '500', durationMs: 1 })
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 1 })
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 1 });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.checkServiceHealth('container-1', {
        maxAttempts: 4,
        delayMs: 1,
        requiredConsecutiveSuccesses: 2,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: true,
        health_attempt: 4,
        consecutive_successes: 2,
        required_consecutive_successes: 2,
        attempts: [
          expect.objectContaining({ consecutive_successes: 1 }),
          expect.objectContaining({ consecutive_successes: 0 }),
          expect.objectContaining({ consecutive_successes: 1 }),
          expect.objectContaining({ consecutive_successes: 2 }),
        ],
      })
    );
  });

  it('returns sanitized health error details when curl cannot produce a status', async () => {
    const service = new ContainerHealthService();

    jest.spyOn(service as any, 'getHttpStatusCode').mockResolvedValue({
      statusCode: '',
      durationMs: 3000,
      error: 'curl_exit_code=7; connection refused',
    });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.checkServiceHealth('container-1', {
        maxAttempts: 1,
        delayMs: 1,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        health_status_code: '',
        health_duration_ms: 3000,
        health_error: 'curl_exit_code=7; connection refused',
      })
    );
  });

  it('fails fast when health flaps after a first successful response', async () => {
    const service = new ContainerHealthService();

    const getHttpStatusCode = jest
      .spyOn(service as any, 'getHttpStatusCode')
      .mockResolvedValueOnce({ statusCode: '200', durationMs: 1 })
      .mockResolvedValueOnce({
        statusCode: '000',
        durationMs: 3000,
        error: 'curl_exit_code=28',
      })
      .mockResolvedValueOnce({
        statusCode: '',
        durationMs: 3000,
        error: 'empty_status_code; curl_exit_code=28',
      })
      .mockResolvedValueOnce({
        statusCode: '000',
        durationMs: 3000,
        error: 'curl_exit_code=28',
      });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.checkServiceHealth('container-1', {
        maxAttempts: 10,
        delayMs: 1,
        requiredConsecutiveSuccesses: 3,
        failFastAfterFirstSuccessFailures: 3,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        health_attempt: 4,
        consecutive_successes: 0,
        health_failure_reason: 'health_flapping_after_success',
      })
    );
    expect(getHttpStatusCode).toHaveBeenCalledTimes(4);
  });

  it('does not fail fast before the first successful response', async () => {
    const service = new ContainerHealthService();

    const getHttpStatusCode = jest
      .spyOn(service as any, 'getHttpStatusCode')
      .mockResolvedValue({
        statusCode: '000',
        durationMs: 3000,
        error: 'curl_exit_code=28',
      });
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.checkServiceHealth('container-1', {
        maxAttempts: 4,
        delayMs: 1,
        requiredConsecutiveSuccesses: 3,
        failFastAfterFirstSuccessFailures: 3,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        healthy: false,
        health_attempt: 4,
        health_failure_reason: 'http_health_not_ready',
      })
    );
    expect(getHttpStatusCode).toHaveBeenCalledTimes(4);
  });

  it('returns http status code from docker exec stream and handles errors', async () => {
    const service = new ContainerHealthService();
    const execStream = new EventEmitter();

    (service as any).docker = {
      getContainer: jest.fn(() => ({
        exec: jest.fn(async () => ({
          start: jest.fn(async () => execStream),
          inspect: jest.fn(async () => ({ ExitCode: 0 })),
        })),
      })),
      modem: {
        demuxStream: jest.fn((_exec: unknown, stdout: any) => {
          stdout.write('200');
          setImmediate(() => execStream.emit('end'));
        }),
      },
    };

    await expect(
      (service as any).getHttpStatusCode('container-1', 'http://127.0.0.1')
    ).resolves.toEqual(
      expect.objectContaining({
        statusCode: '200',
        error: undefined,
      })
    );

    (service as any).docker.getContainer = jest.fn(() => {
      throw new Error('docker fail');
    });

    await expect(
      (service as any).getHttpStatusCode('container-1', 'http://127.0.0.1')
    ).resolves.toEqual(
      expect.objectContaining({
        statusCode: '',
        error: 'docker fail',
      })
    );
  });

  it('fails and destroys a Docker exec stream that never reaches end', async () => {
    jest.useFakeTimers();
    try {
      const service = new ContainerHealthService();
      const execStream = Object.assign(new EventEmitter(), {
        destroy: jest.fn(),
      });

      (service as any).docker = {
        getContainer: jest.fn(() => ({
          exec: jest.fn(async () => ({
            start: jest.fn(async () => execStream),
            inspect: jest.fn(async () => ({ ExitCode: 0 })),
          })),
        })),
        modem: {
          demuxStream: jest.fn(),
        },
      };

      const pending = (service as any).getHttpStatusCode(
        'container-1',
        'http://127.0.0.1'
      );
      await jest.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toEqual(
        expect.objectContaining({
          statusCode: '',
          error: 'container_health_exec_stream_timeout',
        })
      );
      expect(execStream.destroy).toHaveBeenCalledTimes(1);
      expect(execStream.listenerCount('end')).toBe(0);
      expect(execStream.listenerCount('error')).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
