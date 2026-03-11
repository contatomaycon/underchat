import { injectable, inject } from 'tsyringe';
import { Client, ClientChannel, ConnectConfig } from 'ssh2';
import stripAnsi from 'strip-ansi';
import { IDistroInfo } from '@core/common/interfaces/IDistroInfo';
import { EAllowedDistroVersion } from '@core/common/enums/EAllowedDistroVersion';
import { installUbuntu2510 } from '@core/common/functions/installUbuntu2510';
import { installUbuntu2504 } from '@core/common/functions/installUbuntu2504';
import { installUbuntu2410 } from '@core/common/functions/installUbuntu2410';
import { installUbuntu2404 } from '@core/common/functions/installUbuntu2404';
import { CentrifugoService } from './centrifugo.service';
import { IServerSshCentrifugo } from '@core/common/interfaces/IServerSshCentrifugo';
import { IViewServerWebById } from '@core/common/interfaces/IViewServerWebById';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { serverSshCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { IServerBuildDefaultImages } from '@core/common/interfaces/IServerBuildDefaultImages';

export class SshCommandExecutionError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly signal: string | null,
    readonly output: string
  ) {
    const suffix =
      exitCode !== null
        ? `exit code ${exitCode}`
        : signal
          ? `signal ${signal}`
          : 'unknown reason';

    super(`SSH command failed (${suffix}): ${command}`);
    this.name = 'SshCommandExecutionError';
  }
}

export class SshRunCommandsError extends Error {
  constructor(
    readonly command: string,
    readonly partialResults: IServerSshCentrifugo[],
    readonly causeError: unknown
  ) {
    super(`SSH runCommands interrupted on command failure: ${command}`);
    this.name = 'SshRunCommandsError';
  }
}

export class SshRunCommandsCancelledError extends Error {
  constructor(
    readonly serverId: string,
    readonly command: string,
    readonly partialResults: IServerSshCentrifugo[],
    readonly causeError?: unknown
  ) {
    super(`SSH runCommands canceled for server ${serverId}`);
    this.name = 'SshRunCommandsCancelledError';
  }
}

interface IRunningServerCommand {
  conn: Client;
  stream: ClientChannel | null;
  canceled: boolean;
}

@injectable()
export class SshService {
  private readonly connectMaxRetries = 3;
  private readonly connectRetryBaseDelayMs = 1000;
  private readonly runningCommandsByServer = new Map<
    string,
    IRunningServerCommand
  >();

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private connect(config: ConnectConfig): Promise<Client> {
    return this.connectWithRetry(config, 0, this.connectRetryBaseDelayMs);
  }

  private async connectWithRetry(
    config: ConnectConfig,
    attempt: number,
    delayMs: number
  ): Promise<Client> {
    try {
      return await this.connectOnce(config);
    } catch (err) {
      const lastAttempt = attempt >= this.connectMaxRetries - 1;
      if (!this.isConnectErrorRetryable(err) || lastAttempt) {
        throw err;
      }

      await this.sleep(delayMs);
      return this.connectWithRetry(config, attempt + 1, delayMs * 2);
    }
  }

  private isConnectErrorRetryable(err: unknown): boolean {
    if (!(err instanceof Error)) {
      return false;
    }

    const msg = err.message.toLowerCase();
    if (msg.includes('connection lost before handshake')) {
      return true;
    }
    if (msg.includes('ssh connection timeout')) {
      return true;
    }
    if (
      err.name === 'ConnectionError' ||
      err.name === 'ConnectionTimeoutError'
    ) {
      return true;
    }

    const code = (err as NodeJS.ErrnoException).code;
    const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
    if (code && retryableCodes.includes(code)) {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private connectOnce(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;
      let connectionTimeout: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = undefined;
        }
      };

      const handleError = (err: Error): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();

        try {
          conn.end();
        } catch {}

        reject(err);
      };

      const handleClose = (): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();

        const error = new Error('Connection lost before handshake');
        error.name = 'ConnectionError';

        reject(error);
      };

      const handleReady = (): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();

        resolve(conn);
      };

      const connectConfig: ConnectConfig = {
        ...config,
        readyTimeout: 30_000,
        keepaliveInterval: 20_000,
        keepaliveCountMax: 10,
      };

      connectionTimeout = setTimeout(() => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();

        try {
          conn.end();
        } catch {}

        const error = new Error('SSH connection timeout');
        error.name = 'ConnectionTimeoutError';

        reject(error);
      }, 30_000);

      conn.on('ready', handleReady);
      conn.on('error', handleError);
      conn.on('close', handleClose);

      conn.connect(connectConfig);
    });
  }

  private execCommand(
    conn: Client,
    command: string,
    options: {
      pty?: boolean;
      timeoutMs?: number;
      onData?: (chunk: string) => void;
      onStreamReady?: (stream: ClientChannel) => void;
      isCancelled?: () => boolean;
      createCancelError?: () => Error;
      failOnNonZero?: boolean;
    } = {}
  ): Promise<string> {
    const {
      pty = false,
      timeoutMs = 0,
      onData,
      onStreamReady,
      isCancelled,
      createCancelError,
      failOnNonZero = false,
    } = options;

    return new Promise((resolve, reject) => {
      conn.exec(command, { pty }, (err, stream) => {
        if (err) {
          return reject(err);
        }

        let output = '';
        let timer: NodeJS.Timeout | undefined;
        let settled = false;

        const resolveOnce = (value: string): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          resolve(value);
        };

        const rejectOnce = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
          }
          reject(error);
        };

        if (onStreamReady) {
          onStreamReady(stream);
        }

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            stream.close();
            rejectOnce(new Error('execCommand timeout'));
          }, timeoutMs);
        }
        stream.on('data', (chunk: Buffer) => {
          const text = chunk.toString();

          output += text;
          if (onData) {
            onData(text);
          }
        });
        stream.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();

          output += text;
          if (onData) {
            onData(text);
          }
        });
        stream.on('close', (code: number | undefined, signal: string) => {
          if (isCancelled?.()) {
            rejectOnce(
              createCancelError?.() ?? new Error('SSH command canceled')
            );
            return;
          }

          const normalizedCode = code ?? null;
          const normalizedSignal = signal || null;

          if (
            failOnNonZero &&
            normalizedCode !== null &&
            normalizedCode !== 0
          ) {
            return rejectOnce(
              new SshCommandExecutionError(
                command,
                normalizedCode,
                normalizedSignal,
                output.trimEnd()
              )
            );
          }

          resolveOnce(output.trimEnd());
        });
        stream.on('error', (e: Error) => {
          if (isCancelled?.()) {
            rejectOnce(
              createCancelError?.() ?? new Error('SSH command canceled')
            );
            return;
          }

          rejectOnce(e);
        });
      });
    });
  }

  cancelServerExecution(serverId: string): boolean {
    const runningCommand = this.runningCommandsByServer.get(serverId);

    if (!runningCommand) {
      return false;
    }

    runningCommand.canceled = true;

    try {
      runningCommand.stream?.close();
    } catch {}

    try {
      runningCommand.stream?.destroy();
    } catch {}

    try {
      runningCommand.conn.end();
    } catch {}

    try {
      runningCommand.conn.destroy();
    } catch {}

    return true;
  }

  async getDistroAndVersion(config: ConnectConfig): Promise<IDistroInfo> {
    const conn = await this.connect(config);
    try {
      const raw = await this.execCommand(conn, 'cat /etc/os-release');
      const lines = raw.split('\n');

      const distro =
        lines
          .find((l) => l.startsWith('NAME='))
          ?.split('=')[1]
          ?.replaceAll('"', '')
          .trim() ?? 'unknown';

      const version =
        lines
          .find((l) => l.startsWith('VERSION_ID='))
          ?.split('=')[1]
          ?.replaceAll('"', '')
          .trim() ?? 'unknown';

      return { distro, version };
    } finally {
      conn.end();
    }
  }

  async testSSHConnection(config: ConnectConfig): Promise<boolean> {
    try {
      const conn = await this.connect(config);
      conn.end();

      return true;
    } catch {
      return false;
    }
  }

  async runCommands(
    serverId: string,
    config: ConnectConfig,
    commands: string[],
    sendCentrifugo = true,
    options: {
      failOnNonZero?: boolean;
      cancellationKey?: string;
    } = {}
  ): Promise<IServerSshCentrifugo[]> {
    const conn = await this.connect(config);
    const results: IServerSshCentrifugo[] = [];
    const { failOnNonZero = false, cancellationKey } = options;
    const runningCommand: IRunningServerCommand | null = cancellationKey
      ? {
          conn,
          stream: null,
          canceled: false,
        }
      : null;

    if (cancellationKey && runningCommand) {
      this.runningCommandsByServer.set(cancellationKey, runningCommand);
    }

    try {
      for (const cmd of commands) {
        if (runningCommand?.canceled) {
          throw new SshRunCommandsCancelledError(
            cancellationKey ?? serverId,
            cmd,
            results
          );
        }

        try {
          await this.execCommand(conn, cmd, {
            pty: true,
            failOnNonZero,
            isCancelled: () => runningCommand?.canceled ?? false,
            createCancelError: () =>
              new SshRunCommandsCancelledError(
                cancellationKey ?? serverId,
                cmd,
                results
              ),
            onStreamReady: (stream) => {
              if (!runningCommand) {
                return;
              }

              runningCommand.stream = stream;

              if (runningCommand.canceled) {
                try {
                  stream.close();
                } catch {}
              }
            },
            onData: (linha) => {
              const date = new Date();

              const outputStripAnsi = stripAnsi(linha);
              const commandStripAnsi = stripAnsi(cmd);

              const serverSshCentrifugo: IServerSshCentrifugo = {
                server_id: serverId,
                command: commandStripAnsi,
                output: outputStripAnsi,
                date,
              };

              results.push({
                command: commandStripAnsi,
                output: outputStripAnsi,
                date,
                server_id: serverId,
              });

              if (sendCentrifugo) {
                this.centrifugoService.publish(
                  serverSshCentrifugoQueue(),
                  serverSshCentrifugo
                );
              }
            },
          });
        } catch (error) {
          if (error instanceof SshRunCommandsCancelledError) {
            throw error;
          }

          if (runningCommand?.canceled) {
            throw new SshRunCommandsCancelledError(
              cancellationKey ?? serverId,
              cmd,
              results,
              error
            );
          }

          throw new SshRunCommandsError(cmd, results, error);
        } finally {
          if (runningCommand) {
            runningCommand.stream = null;
          }
        }
      }

      return results;
    } finally {
      if (cancellationKey && runningCommand) {
        const current = this.runningCommandsByServer.get(cancellationKey);
        if (current === runningCommand) {
          this.runningCommandsByServer.delete(cancellationKey);
        }
      }

      conn.end();
    }
  }

  async getInstallCommands(
    info: IDistroInfo,
    webView: IViewServerWebById,
    defaultImages: IServerBuildDefaultImages
  ): Promise<string[]> {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_10]: await installUbuntu2510(
        webView,
        defaultImages
      ),
      [EAllowedDistroVersion.Ubuntu_25_04]: await installUbuntu2504(
        webView,
        defaultImages
      ),
      [EAllowedDistroVersion.Ubuntu_24_10]: await installUbuntu2410(
        webView,
        defaultImages
      ),
      [EAllowedDistroVersion.Ubuntu_24_04]: await installUbuntu2404(
        webView,
        defaultImages
      ),
    };

    return commandsMap[key] ?? [];
  }

  getStatusCommands(info: IDistroInfo, ip: string, port: number): string[] {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_10]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
      [EAllowedDistroVersion.Ubuntu_25_04]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_10]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_04]: [
        `bash -c "curl -s -o /dev/null -w "%{http_code}" http://${ip}:${port}/v1/health/check"`,
      ],
    };

    return commandsMap[key] ?? [];
  }

  getImagesCommands(info: IDistroInfo): string[] {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_10]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_25_04]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_10]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_04]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
    };

    return commandsMap[key] ?? [];
  }
}
