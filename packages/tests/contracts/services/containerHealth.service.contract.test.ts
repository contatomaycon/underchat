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
      .mockResolvedValueOnce('500')
      .mockResolvedValueOnce('200')
      .mockResolvedValue('500');
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

    await expect(
      service.isServiceHealthy('c1', { maxAttempts: 2, delayMs: 1 })
    ).resolves.toBe(true);

    await expect(
      service.isConnectionHealthy('c1', { maxAttempts: 2, delayMs: 1 })
    ).resolves.toBe(false);

    expect(getHttpStatusCode).toHaveBeenCalled();
  });

  it('returns http status code from docker exec stream and handles errors', async () => {
    const service = new ContainerHealthService();
    const execStream = new EventEmitter();

    (service as any).docker = {
      getContainer: jest.fn(() => ({
        exec: jest.fn(async () => ({
          start: jest.fn(async () => execStream),
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
    ).resolves.toBe('200');

    (service as any).docker.getContainer = jest.fn(() => {
      throw new Error('docker fail');
    });

    await expect(
      (service as any).getHttpStatusCode('container-1', 'http://127.0.0.1')
    ).resolves.toBe('');
  });
});
