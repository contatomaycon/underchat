import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';

jest.mock('strip-ansi', () => ({
  __esModule: true,
  default: (value: string) => value,
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class CentrifugoService {},
}));

import {
  SshCommandTimeoutError,
  SshRunCommandsError,
  SshService,
} from '@core/services/ssh.service';
import { buildServerInstallStageMarker } from '@core/common/interfaces/IServerInstallEvent';

function makeNeverClosingStream() {
  const stream = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    close: jest.Mock;
    destroy: jest.Mock;
    end: jest.Mock;
  };
  stream.stderr = new EventEmitter();
  stream.close = jest.fn();
  stream.destroy = jest.fn();
  stream.end = jest.fn();
  return stream;
}

describe('SshService hard command deadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('destroys a connected SSH stream that never emits close', async () => {
    jest.useFakeTimers();
    const stream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => callback(undefined, stream)
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const runPromise = service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      ['docker inspect container'],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
        commandTimeoutMs: 5_000,
      }
    );
    const rejection = expect(runPromise).rejects.toMatchObject({
      name: 'SshRunCommandsError',
      causeError: expect.objectContaining({
        name: 'SshCommandTimeoutError',
        timeoutMs: 5_000,
      }),
    });

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5_000);
    await rejection;

    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(stream.destroy).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.end).toHaveBeenCalled();
  });

  it('starts the deadline before ssh2 invokes the exec callback', async () => {
    jest.useFakeTimers();
    const connection = {
      exec: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);

    const commandPromise = (
      service as unknown as {
        execCommand: (
          connectionValue: unknown,
          command: string,
          options: { timeoutMs: number }
        ) => Promise<string>;
      }
    ).execCommand(connection, 'docker ps', { timeoutMs: 5_000 });
    const rejection = expect(commandPromise).rejects.toEqual(
      expect.any(SshCommandTimeoutError)
    );

    await jest.advanceTimersByTimeAsync(5_000);
    await rejection;

    expect(connection.end).toHaveBeenCalledTimes(1);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
  });

  it('exposes the timed-out command as the runCommands cause', () => {
    const timeout = new SshCommandTimeoutError('docker ps', 5_000);
    const error = new SshRunCommandsError('docker ps', [], timeout);

    expect(error.message).toContain('timed out after 5000ms');
    expect(error.causeError).toBe(timeout);
  });

  it('retries transient Balance rollout fence errors before failing the installation command', async () => {
    jest.useFakeTimers();
    const firstStream = makeNeverClosingStream();
    const secondStream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          const stream =
            connection.exec.mock.calls.length === 1
              ? firstStream
              : secondStream;
          callback(undefined, stream);

          queueMicrotask(() => {
            if (stream === firstStream) {
              stream.stderr.emit(
                'data',
                Buffer.from(
                  'ERROR: Legacy Balance mutation blocked because managed rollout lock is busy\n'
                )
              );
              stream.emit('close', 1, '');
              return;
            }

            stream.emit('data', Buffer.from('SUCCESS: lock released\n'));
            stream.emit('close', 0, '');
          });
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const resultPromise = service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      ['bash -c "legacy balance install"'],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
      }
    );

    await Promise.resolve();
    await Promise.resolve();
    jest.runAllTicks();
    expect(connection.exec).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(10_000);
    jest.runAllTicks();
    const result = await resultPromise;
    const output = result.map((entry) => entry.output).join('\n');

    expect(connection.exec).toHaveBeenCalledTimes(2);
    expect(output).toContain('managed rollout lock is busy');
    expect(output).toContain('[ssh][balance-rollout]');
    expect(output).toContain('SUCCESS: lock released');
  });

  it('publishes concise installation command labels and collapses terminal repaint noise', async () => {
    const stream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          callback(undefined, stream);

          queueMicrotask(() => {
            stream.emit(
              'data',
              Buffer.from(
                '\rReading package lists... 99%\rReading package lists... 99%'
              )
            );
            stream.emit('data', Buffer.from('\rReading package lists... 99%'));
            stream.emit('data', Buffer.from('\rDone\n'));
            stream.emit('close', 0, '');
          });
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const result = await service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      [
        "bash -c 'set -o pipefail && bash -s' <<'UNDERCHAT_LEGACY_BALANCE_test'\napt-get update\nUNDERCHAT_LEGACY_BALANCE_test",
      ],
      false,
      {
        failOnNonZero: true,
        connectMaxAttempts: 1,
      }
    );

    expect(result).toEqual([
      {
        command: 'Install base packages, Docker, images and Balance API',
        date: expect.any(Date),
        install_event_type: 'output',
        output: 'Reading package lists... 99%',
        server_id: 'server-1',
      },
      {
        command: 'Install base packages, Docker, images and Balance API',
        date: expect.any(Date),
        install_event_type: 'output',
        output: 'Done\n',
        server_id: 'server-1',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('UNDERCHAT_LEGACY_BALANCE');
  });

  it('preserves PTY CRLF boundaries when CR and LF arrive in separate SSH chunks', async () => {
    const stream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          callback(undefined, stream);

          queueMicrotask(() => {
            stream.emit('data', Buffer.from('first docker record\r'));
            stream.emit('data', Buffer.from('\nsecond docker record\r'));
            stream.emit('data', Buffer.from('\n'));
            stream.emit('close', 0, '');
          });
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const result = await service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      ['docker inspect containers'],
      false,
      { failOnNonZero: true }
    );

    expect(result.map((entry) => entry.output).join('')).toBe(
      'first docker record\nsecond docker record\n'
    );
  });

  it('reassembles split stage markers and attaches the real stage to following output', async () => {
    const stream = makeNeverClosingStream();
    const marker = buildServerInstallStageMarker('packages', 'running');
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          callback(undefined, stream);

          queueMicrotask(() => {
            stream.emit('data', Buffer.from(marker.slice(0, 12)));
            stream.emit('data', Buffer.from(`${marker.slice(12)}\n`));
            stream.emit('data', Buffer.from('under-balance-api metadata\n'));
            stream.emit('close', 0, '');
          });
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const result = await service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      ['legacy installer'],
      false,
      { failOnNonZero: true }
    );

    expect(result).toEqual([
      expect.objectContaining({
        install_event_type: 'stage',
        install_stage: 'packages',
        install_stage_status: 'running',
      }),
      expect.objectContaining({
        install_event_type: 'output',
        install_stage: 'packages',
        output: 'under-balance-api metadata\n',
      }),
    ]);
  });

  it('requires remote installation quiescence and the expected running image before readiness', () => {
    const service = new SshService({ publish: jest.fn() } as never);
    const [command] = service.getStatusCommands(
      { distro: 'Ubuntu', version: '24.04' },
      '10.0.2.43',
      3003,
      {
        baileys: 'registry.test/under-worker-baileys:v1',
        wwebjs: 'registry.test/under-worker-wwebjs:v2',
        whatsmeow: 'registry.test/under-worker-whatsmeow:v3',
        balance_api: 'registry.test/under-balance-api:v4',
      }
    );

    expect(command).toContain('UNDERCHAT_INSTALL_READINESS');
    expect(command).toContain('flock -n 9');
    expect(command).toContain('ActiveState');
    expect(command).toContain('ROLLOUT_STATE_FILE');
    expect(command).toContain('complete|rolled_back');
    expect(command).toContain('EXPECTED_BAILEYS_IMAGE_ID');
    expect(command).toContain('BAILEYS_ALIAS_IMAGE_ID');
    expect(command).toContain('EXPECTED_WWEBJS_IMAGE_ID');
    expect(command).toContain('WWEBJS_ALIAS_IMAGE_ID');
    expect(command).toContain('EXPECTED_WHATSMEOW_IMAGE_ID');
    expect(command).toContain('WHATSMEOW_ALIAS_IMAGE_ID');
    expect(command).toContain('EXPECTED_BALANCE_IMAGE_ID');
    expect(command).toContain('BALANCE_ALIAS_IMAGE_ID');
    expect(command).toContain('RUNNING_IMAGE_ID');
    expect(command).toContain('registry.test/under-worker-whatsmeow:v3');
    expect(command).toContain('/v1/health/check');

    const syntaxCheck = spawnSync('bash', ['-n'], {
      input: command,
      encoding: 'utf8',
    });
    expect(syntaxCheck.status).toBe(0);
    expect(syntaxCheck.stderr).toBe('');
  });

  it('does not retry non-transient Balance rollout fence errors', async () => {
    const stream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          _command: string,
          _options: unknown,
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          callback(undefined, stream);

          queueMicrotask(() => {
            stream.stderr.emit(
              'data',
              Buffer.from(
                'ERROR: Legacy Balance mutation blocked because reserved rollback container exists\n'
              )
            );
            stream.emit('close', 1, '');
          });
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    await expect(
      service.runCommands(
        'server-1',
        { host: '127.0.0.1' },
        ['bash -c "legacy balance install"'],
        false,
        {
          failOnNonZero: true,
          connectMaxAttempts: 1,
        }
      )
    ).rejects.toMatchObject({
      name: 'SshRunCommandsError',
    });

    expect(connection.exec).toHaveBeenCalledTimes(1);
  });

  it('sends sensitive stdin once without a PTY or command/output exposure', async () => {
    const secret = `registry-password-'quoted'-must-not-leak`;
    const stream = makeNeverClosingStream();
    const connection = {
      exec: jest.fn(
        (
          command: string,
          options: { pty?: boolean },
          callback: (error: Error | undefined, channel: unknown) => void
        ) => {
          expect(command).not.toContain(secret);
          expect(options.pty).toBe(false);
          callback(undefined, stream);
        }
      ),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const service = new SshService({ publish: jest.fn() } as never);
    jest
      .spyOn(service as never, 'connect' as never)
      .mockResolvedValue(connection as never);

    const resultPromise = service.runCommands(
      'server-1',
      { host: '127.0.0.1' },
      ['systemd-run --pipe /usr/local/sbin/reconcile'],
      false,
      {
        failOnNonZero: true,
        stdin: secret,
      }
    );

    await Promise.resolve();
    expect(stream.end).toHaveBeenCalledTimes(1);
    expect(stream.end).toHaveBeenCalledWith(secret);
    stream.emit('close', 0, '');

    await expect(resultPromise).resolves.toEqual([]);
    expect(JSON.stringify(await resultPromise)).not.toContain(secret);
  });

  it('rejects stdin for a command batch before opening SSH', async () => {
    const service = new SshService({ publish: jest.fn() } as never);
    const connect = jest.spyOn(service as never, 'connect' as never);

    await expect(
      service.runCommands(
        'server-1',
        { host: '127.0.0.1' },
        ['first', 'second'],
        false,
        { stdin: 'sensitive' }
      )
    ).rejects.toThrow('SSH stdin requires exactly one command');
    expect(connect).not.toHaveBeenCalled();
  });
});
