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
import {
  parseServerInstallStageMarker,
  type ServerInstallStageId,
} from '@core/common/interfaces/IServerInstallEvent';
import { escapeShellSingleQuotes } from '@core/common/functions/escapeShellSingleQuotes';

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

export class SshCommandTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly timeoutMs: number
  ) {
    super(`SSH command timed out after ${timeoutMs}ms: ${command}`);
    this.name = 'SshCommandTimeoutError';
  }
}

export class SshRunCommandsError extends Error {
  private static getCauseSummary(causeError: unknown): string | null {
    if (causeError instanceof SshCommandExecutionError) {
      const output = causeError.output.replace(/\s+/g, ' ').trim().slice(-800);

      if (output) {
        return `${causeError.message}. Output: ${output}`;
      }

      return causeError.message;
    }

    if (causeError instanceof Error) {
      return causeError.message;
    }

    return null;
  }

  constructor(
    readonly command: string,
    readonly partialResults: IServerSshCentrifugo[],
    readonly causeError: unknown
  ) {
    const baseMessage = `SSH runCommands interrupted on command failure: ${command}`;
    const causeSummary = SshRunCommandsError.getCauseSummary(causeError);
    super(
      causeSummary ? `${baseMessage}. Cause: ${causeSummary}` : baseMessage
    );
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
  private readonly aptLockRetryMaxAttempts = 18;
  private readonly aptLockRetryBaseDelayMs = 5000;
  private readonly aptLockRetryMaxDelayMs = 20000;
  private readonly balanceRolloutFenceRetryMaxAttempts = 120;
  private readonly balanceRolloutFenceRetryBaseDelayMs = 10_000;
  private readonly balanceRolloutFenceRetryMaxDelayMs = 30_000;
  private readonly runningCommandsByServer = new Map<
    string,
    IRunningServerCommand
  >();

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private connect(
    config: ConnectConfig,
    maxAttempts = this.connectMaxRetries
  ): Promise<Client> {
    return this.connectWithRetry(
      config,
      0,
      this.connectRetryBaseDelayMs,
      Math.max(1, Math.floor(maxAttempts))
    );
  }

  private async connectWithRetry(
    config: ConnectConfig,
    attempt: number,
    delayMs: number,
    maxAttempts: number
  ): Promise<Client> {
    try {
      return await this.connectOnce(config);
    } catch (err) {
      const lastAttempt = attempt >= maxAttempts - 1;
      if (!this.isConnectErrorRetryable(err) || lastAttempt) {
        throw err;
      }

      const jitter = delayMs * 0.5 * Math.random();
      await this.sleep(delayMs + jitter);
      return this.connectWithRetry(
        config,
        attempt + 1,
        delayMs * 2,
        maxAttempts
      );
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

  private isAptOrDpkgCommand(command: string): boolean {
    const normalized = command.toLowerCase();
    return (
      normalized.includes('apt-get') ||
      normalized.includes(' apt ') ||
      normalized.includes('dpkg')
    );
  }

  private isAptDpkgLockError(error: unknown): boolean {
    const fullText =
      error instanceof SshCommandExecutionError
        ? `${error.message}\n${error.output}`
        : error instanceof Error
          ? error.message
          : '';

    if (!fullText) {
      return false;
    }

    const normalized = fullText.toLowerCase();

    return (
      normalized.includes('frontend lock was locked by another process') ||
      normalized.includes('dpkg frontend lock') ||
      normalized.includes('lock-frontend') ||
      normalized.includes('could not get lock /var/lib/dpkg/lock') ||
      normalized.includes('could not get lock /var/lib/apt/lists/lock') ||
      normalized.includes('could not get lock /var/cache/apt/archives/lock') ||
      normalized.includes('unable to acquire the dpkg frontend lock') ||
      normalized.includes('is another process using it')
    );
  }

  private isBalanceRolloutTransientFenceError(error: unknown): boolean {
    const fullText =
      error instanceof SshCommandExecutionError
        ? `${error.message}\n${error.output}`
        : error instanceof Error
          ? error.message
          : '';

    if (!fullText) {
      return false;
    }

    const normalized = fullText.toLowerCase();

    return (
      normalized.includes(
        'legacy balance mutation blocked because managed rollout lock is busy'
      ) ||
      normalized.includes(
        'legacy balance mutation blocked because managed rollout service is active'
      ) ||
      normalized.includes(
        'legacy balance mutation blocked by managed rollout phase:'
      )
    );
  }

  private getAptLockRetryDelayMs(attempt: number): number {
    const delay = this.aptLockRetryBaseDelayMs * (attempt + 1);
    return Math.min(delay, this.aptLockRetryMaxDelayMs);
  }

  private getBalanceRolloutFenceRetryDelayMs(attempt: number): number {
    const delay = this.balanceRolloutFenceRetryBaseDelayMs * (attempt + 1);
    return Math.min(delay, this.balanceRolloutFenceRetryMaxDelayMs);
  }

  private normalizeTerminalOutput(output: string): string {
    return stripAnsi(output)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => {
        if (!line.includes('\r')) {
          return line;
        }

        const repaints = line.split('\r').filter((value) => value.trim());
        return repaints.at(-1) ?? '';
      })
      .join('\n')
      .replace(/[ \t]+\n/g, '\n');
  }

  private normalizeOutputForComparison(output: string): string {
    return output.replace(/\s+/g, ' ').trim();
  }

  private summarizeCommand(command: string): string {
    const normalized = stripAnsi(command).replace(/\s+/g, ' ').trim();

    if (normalized.includes('UNDERCHAT_LEGACY_BALANCE_')) {
      return 'Install base packages, Docker, images and Balance API';
    }

    if (normalized.includes('/v1/health/check')) {
      if (normalized.includes('UNDERCHAT_INSTALL_READINESS')) {
        return 'Check installation completion';
      }

      return 'Check Balance API health';
    }

    if (normalized.includes('docker image inspect')) {
      return 'Check required Docker images';
    }

    if (normalized.includes('docker logs under-balance-api')) {
      return 'Read Balance API container logs';
    }

    if (normalized.includes('docker ps')) {
      return 'Inspect Docker runtime';
    }

    if (normalized.length <= 180) {
      return normalized;
    }

    return `${normalized.slice(0, 177)}...`;
  }

  private appendCommandOutput(
    serverId: string,
    command: string,
    output: string,
    results: IServerSshCentrifugo[],
    sendCentrifugo: boolean,
    onOutput?: (event: IServerSshCentrifugo) => void,
    currentInstallStage?: ServerInstallStageId
  ): ServerInstallStageId | undefined {
    const date = new Date();
    const outputStripAnsi = this.normalizeTerminalOutput(output);
    const commandStripAnsi = this.summarizeCommand(command);

    if (!outputStripAnsi.trim()) {
      return currentInstallStage;
    }

    const lastResult = results.at(-1);
    if (
      lastResult?.command === commandStripAnsi &&
      this.normalizeOutputForComparison(lastResult.output) ===
        this.normalizeOutputForComparison(outputStripAnsi)
    ) {
      return currentInstallStage;
    }

    const stageMarker = parseServerInstallStageMarker(outputStripAnsi);
    const installStage = stageMarker?.stage ?? currentInstallStage;
    const serverSshCentrifugo: IServerSshCentrifugo = {
      server_id: serverId,
      command: stageMarker ? 'Installation stage' : commandStripAnsi,
      output: stageMarker
        ? `Installation stage ${stageMarker.stage} ${stageMarker.status}`
        : outputStripAnsi,
      date,
      install_event_type: stageMarker ? 'stage' : 'output',
      ...(installStage && { install_stage: installStage }),
      ...(stageMarker && {
        install_stage_status: stageMarker.status,
      }),
    };

    results.push(serverSshCentrifugo);
    onOutput?.(serverSshCentrifugo);

    if (sendCentrifugo) {
      this.centrifugoService.publish(
        serverSshCentrifugoQueue(),
        serverSshCentrifugo
      );
    }

    return installStage;
  }

  private clearRunningCommandStream(
    runningCommand: IRunningServerCommand | null
  ): void {
    if (runningCommand) {
      runningCommand.stream = null;
    }
  }

  private buildCancelledRunCommandsError(
    serverId: string,
    command: string,
    results: IServerSshCentrifugo[],
    causeError?: unknown
  ): SshRunCommandsCancelledError {
    return new SshRunCommandsCancelledError(
      serverId,
      command,
      results,
      causeError
    );
  }

  private handleRunningCommandStreamReady(
    runningCommand: IRunningServerCommand | null,
    stream: ClientChannel
  ): void {
    if (!runningCommand) {
      return;
    }

    runningCommand.stream = stream;

    if (!runningCommand.canceled) {
      return;
    }

    try {
      stream.close();
    } catch {}
  }

  private shouldRetryAptLock(
    command: string,
    error: unknown,
    attempts: number
  ): boolean {
    if (attempts >= this.aptLockRetryMaxAttempts) {
      return false;
    }

    if (!this.isAptOrDpkgCommand(command)) {
      return false;
    }

    return this.isAptDpkgLockError(error);
  }

  private shouldRetryBalanceRolloutFence(
    error: unknown,
    attempts: number
  ): boolean {
    if (attempts >= this.balanceRolloutFenceRetryMaxAttempts) {
      return false;
    }

    return this.isBalanceRolloutTransientFenceError(error);
  }

  private async executeCommandWithAptLockRetry(
    conn: Client,
    params: {
      serverId: string;
      command: string;
      failOnNonZero: boolean;
      sendCentrifugo: boolean;
      results: IServerSshCentrifugo[];
      cancellationId: string;
      runningCommand: IRunningServerCommand | null;
      commandTimeoutMs: number;
      stdin?: string | Buffer;
      onOutput?: (event: IServerSshCentrifugo) => void;
    }
  ): Promise<void> {
    const {
      serverId,
      command,
      failOnNonZero,
      sendCentrifugo,
      results,
      cancellationId,
      runningCommand,
      commandTimeoutMs,
      stdin,
      onOutput,
    } = params;
    let aptLockAttempts = 0;
    let balanceRolloutFenceAttempts = 0;
    let currentInstallStage: ServerInstallStageId | undefined;

    while (true) {
      try {
        await this.execCommand(conn, command, {
          // A PTY may echo stdin back to stdout. Commands carrying sensitive
          // input must use a raw channel so the payload can never reach
          // Centrifugo, accumulated results, or SSH error output.
          pty: stdin === undefined,
          timeoutMs: commandTimeoutMs,
          failOnNonZero,
          stdin,
          isCancelled: () => runningCommand?.canceled ?? false,
          createCancelError: () =>
            this.buildCancelledRunCommandsError(
              cancellationId,
              command,
              results
            ),
          onStreamReady: (stream) =>
            this.handleRunningCommandStreamReady(runningCommand, stream),
          onData: (line) => {
            currentInstallStage = this.appendCommandOutput(
              serverId,
              command,
              line,
              results,
              sendCentrifugo,
              onOutput,
              currentInstallStage
            );
          },
        });

        return;
      } catch (error) {
        if (error instanceof SshRunCommandsCancelledError) {
          throw error;
        }

        if (runningCommand?.canceled) {
          throw this.buildCancelledRunCommandsError(
            cancellationId,
            command,
            results,
            error
          );
        }

        if (this.shouldRetryAptLock(command, error, aptLockAttempts)) {
          const waitMs = this.getAptLockRetryDelayMs(aptLockAttempts);
          aptLockAttempts += 1;

          currentInstallStage = this.appendCommandOutput(
            serverId,
            command,
            `[ssh][apt-lock] lock detectado, aguardando ${Math.ceil(
              waitMs / 1000
            )}s para retry ${aptLockAttempts}/${this.aptLockRetryMaxAttempts}\n`,
            results,
            sendCentrifugo,
            onOutput,
            currentInstallStage
          );

          await this.sleep(waitMs);
          continue;
        }

        if (
          this.shouldRetryBalanceRolloutFence(
            error,
            balanceRolloutFenceAttempts
          )
        ) {
          const waitMs = this.getBalanceRolloutFenceRetryDelayMs(
            balanceRolloutFenceAttempts
          );
          balanceRolloutFenceAttempts += 1;

          currentInstallStage = this.appendCommandOutput(
            serverId,
            command,
            `[ssh][balance-rollout] managed rollout fence busy, waiting ${Math.ceil(
              waitMs / 1000
            )}s before retry ${balanceRolloutFenceAttempts}/${this.balanceRolloutFenceRetryMaxAttempts}\n`,
            results,
            sendCentrifugo,
            onOutput,
            currentInstallStage
          );

          await this.sleep(waitMs);
          continue;
        }

        throw new SshRunCommandsError(command, results, error);
      } finally {
        this.clearRunningCommandStream(runningCommand);
      }
    }
  }

  private connectOnce(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let resolved = false;
      let connectionTimeout: NodeJS.Timeout | undefined;
      const requestedReadyTimeout = Number(config.readyTimeout);
      const readyTimeoutMs =
        Number.isFinite(requestedReadyTimeout) && requestedReadyTimeout > 0
          ? Math.floor(requestedReadyTimeout)
          : 30_000;

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
        readyTimeout: readyTimeoutMs,
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
      }, readyTimeoutMs);

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
      stdin?: string | Buffer;
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
      stdin,
    } = options;

    return new Promise((resolve, reject) => {
      let output = '';
      let timer: NodeJS.Timeout | undefined;
      let settled = false;
      let activeStream: ClientChannel | null = null;
      let stdoutPending = '';
      let stderrPending = '';

      const emitCompleteFrames = (
        text: string,
        stream: 'stdout' | 'stderr',
        flush = false
      ): void => {
        let pending =
          stream === 'stdout' ? stdoutPending + text : stderrPending + text;
        let boundaryIndex = -1;

        while (true) {
          const newLineIndex = pending.indexOf('\n');
          const carriageReturnIndex = pending.indexOf('\r');

          if (
            carriageReturnIndex >= 0 &&
            (newLineIndex < 0 || carriageReturnIndex < newLineIndex)
          ) {
            /*
             * A PTY normally emits CRLF. Wait for the byte after a trailing
             * CR so a CRLF split across SSH chunks remains one complete line.
             * Emitting CR immediately loses the newline and makes consumers
             * concatenate adjacent command records.
             */
            if (carriageReturnIndex === pending.length - 1 && !flush) {
              break;
            }
            boundaryIndex =
              pending[carriageReturnIndex + 1] === '\n'
                ? carriageReturnIndex + 1
                : carriageReturnIndex;
          } else if (newLineIndex >= 0) {
            boundaryIndex = newLineIndex;
          } else {
            boundaryIndex = -1;
          }

          if (boundaryIndex < 0) break;

          const frame = pending.slice(0, boundaryIndex + 1);
          pending = pending.slice(boundaryIndex + 1);
          onData?.(frame);
        }

        if (flush && pending) {
          onData?.(pending);
          pending = '';
        }

        if (stream === 'stdout') {
          stdoutPending = pending;
        } else {
          stderrPending = pending;
        }
      };

      const flushPendingFrames = (): void => {
        emitCompleteFrames('', 'stdout', true);
        emitCompleteFrames('', 'stderr', true);
      };

      const cleanupTimer = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      };

      const resolveOnce = (value: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupTimer();
        resolve(value);
      };

      const rejectOnce = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanupTimer();
        reject(error);
      };

      const closeTimedOutTransport = (): void => {
        try {
          activeStream?.close();
        } catch {}
        try {
          activeStream?.destroy();
        } catch {}
        try {
          conn.end();
        } catch {}
        try {
          conn.destroy();
        } catch {}
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          rejectOnce(new SshCommandTimeoutError(command, timeoutMs));
          closeTimedOutTransport();
        }, timeoutMs);
      }

      try {
        conn.exec(command, { pty }, (err, stream) => {
          if (settled) {
            try {
              stream?.close();
            } catch {}
            try {
              stream?.destroy();
            } catch {}
            return;
          }

          if (err) {
            rejectOnce(err);
            return;
          }

          activeStream = stream;

          if (onStreamReady) {
            onStreamReady(stream);
          }

          stream.on('data', (chunk: Buffer) => {
            const text = chunk.toString();

            output += text;
            emitCompleteFrames(text, 'stdout');
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString();

            output += text;
            emitCompleteFrames(text, 'stderr');
          });
          stream.on('close', (code: number | undefined, signal: string) => {
            flushPendingFrames();

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
            flushPendingFrames();

            if (isCancelled?.()) {
              rejectOnce(
                createCancelError?.() ?? new Error('SSH command canceled')
              );
              return;
            }

            rejectOnce(e);
          });

          // End the writable side explicitly so remote consumers (including
          // `systemd-run --pipe`) receive EOF after the complete payload.
          // The value is deliberately never copied into output or errors.
          if (stdin !== undefined && !isCancelled?.()) {
            try {
              stream.end(stdin);
            } catch (error) {
              rejectOnce(
                error instanceof Error ? error : new Error(String(error))
              );
              closeTimedOutTransport();
            }
          }
        });
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)));
      }
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
      const raw = await this.execCommand(conn, 'cat /etc/os-release', {
        timeoutMs: 30_000,
      });
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
      signal?: AbortSignal;
      connectMaxAttempts?: number;
      commandTimeoutMs?: number;
      stdin?: string | Buffer;
      onOutput?: (event: IServerSshCentrifugo) => void;
    } = {}
  ): Promise<IServerSshCentrifugo[]> {
    if (options.stdin !== undefined && commands.length !== 1) {
      throw new Error('SSH stdin requires exactly one command.');
    }

    const conn = await this.connect(
      config,
      options.connectMaxAttempts ?? this.connectMaxRetries
    );
    const results: IServerSshCentrifugo[] = [];
    const {
      failOnNonZero = false,
      cancellationKey,
      signal,
      commandTimeoutMs = 0,
    } = options;
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

    const cancelOnAbort = () => {
      if (runningCommand) {
        runningCommand.canceled = true;
      }
      if (cancellationKey) {
        this.cancelServerExecution(cancellationKey);
      }
    };
    signal?.addEventListener('abort', cancelOnAbort, { once: true });
    if (signal?.aborted) {
      cancelOnAbort();
    }

    try {
      for (const cmd of commands) {
        if (runningCommand?.canceled) {
          throw this.buildCancelledRunCommandsError(
            cancellationKey ?? serverId,
            cmd,
            results
          );
        }

        await this.executeCommandWithAptLockRetry(conn, {
          serverId,
          command: cmd,
          failOnNonZero,
          sendCentrifugo,
          results,
          cancellationId: cancellationKey ?? serverId,
          runningCommand,
          commandTimeoutMs,
          stdin: options.stdin,
          onOutput: options.onOutput,
        });
      }

      return results;
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
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

  getStatusCommands(
    info: IDistroInfo,
    ip: string,
    port: number,
    defaultImages: IServerBuildDefaultImages
  ): string[] {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;
    const baileysImage = escapeShellSingleQuotes(defaultImages.baileys);
    const wwebjsImage = escapeShellSingleQuotes(defaultImages.wwebjs);
    const whatsmeowImage = escapeShellSingleQuotes(defaultImages.whatsmeow);
    const balanceApiImage = escapeShellSingleQuotes(defaultImages.balance_api);
    const command = `bash -c 'UNDERCHAT_INSTALL_READINESS=1; \
      EXPECTED_BAILEYS_REF="$1"; \
      EXPECTED_WWEBJS_REF="$2"; \
      EXPECTED_WHATSMEOW_REF="$3"; \
      EXPECTED_BALANCE_REF="$4"; \
      ROLLOUT_STATE_DIR=/var/lib/underchat/balance-rollout; \
      ROLLOUT_STATE_FILE="$ROLLOUT_STATE_DIR/state.env"; \
      ROLLOUT_UNIT=underchat-balance-rollout-v1.service; \
      if [ ! -d "$ROLLOUT_STATE_DIR" ] || [ -L "$ROLLOUT_STATE_DIR" ]; then echo false; exit 0; fi; \
      if ! exec 9<"$ROLLOUT_STATE_DIR" || ! flock -n 9; then echo false; exit 0; fi; \
      ROLLOUT_ACTIVE_STATE=$(systemctl show "$ROLLOUT_UNIT" --property=ActiveState --value 2>/dev/null || true); \
      case "$ROLLOUT_ACTIVE_STATE" in inactive|failed) ;; *) echo false; exit 0 ;; esac; \
      if [ -e "$ROLLOUT_STATE_FILE" ] || [ -L "$ROLLOUT_STATE_FILE" ]; then \
        if [ -L "$ROLLOUT_STATE_FILE" ] || [ ! -f "$ROLLOUT_STATE_FILE" ] || [ ! -r "$ROLLOUT_STATE_FILE" ] || \
          [ "$(stat -c "%u" -- "$ROLLOUT_STATE_FILE" 2>/dev/null)" != 0 ] || \
          [ "$(stat -c "%a" -- "$ROLLOUT_STATE_FILE" 2>/dev/null)" != 600 ] || \
          [ "$(grep -c "^PHASE=" "$ROLLOUT_STATE_FILE" 2>/dev/null)" != 1 ]; then echo false; exit 0; fi; \
        ROLLOUT_PHASE=$(sed -n "s/^PHASE=//p" "$ROLLOUT_STATE_FILE" | head -n 1 | tr -d "\\r"); \
        case "$ROLLOUT_PHASE" in complete|rolled_back) ;; *) echo false; exit 0 ;; esac; \
      fi; \
      EXPECTED_BAILEYS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" "$EXPECTED_BAILEYS_REF" 2>/dev/null || true); \
      EXPECTED_WWEBJS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" "$EXPECTED_WWEBJS_REF" 2>/dev/null || true); \
      EXPECTED_WHATSMEOW_IMAGE_ID=$(docker image inspect --format "{{.Id}}" "$EXPECTED_WHATSMEOW_REF" 2>/dev/null || true); \
      EXPECTED_BALANCE_IMAGE_ID=$(docker image inspect --format "{{.Id}}" "$EXPECTED_BALANCE_REF" 2>/dev/null || true); \
      BAILEYS_ALIAS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" ${EWorkerImage.baileys} 2>/dev/null || true); \
      WWEBJS_ALIAS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" ${EWorkerImage.wwebjs} 2>/dev/null || true); \
      WHATSMEOW_ALIAS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" ${EWorkerImage.whatsmeow} 2>/dev/null || true); \
      BALANCE_ALIAS_IMAGE_ID=$(docker image inspect --format "{{.Id}}" ${EWorkerImage.balance_api} 2>/dev/null || true); \
      RUNNING_IMAGE_ID=$(docker inspect --format "{{.Image}}" under-balance-api 2>/dev/null || true); \
      HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://${ip}:${port}/v1/health/check 2>/dev/null || true); \
      if [ -n "$EXPECTED_BAILEYS_IMAGE_ID" ] && [ "$BAILEYS_ALIAS_IMAGE_ID" = "$EXPECTED_BAILEYS_IMAGE_ID" ] && \
        [ -n "$EXPECTED_WWEBJS_IMAGE_ID" ] && [ "$WWEBJS_ALIAS_IMAGE_ID" = "$EXPECTED_WWEBJS_IMAGE_ID" ] && \
        [ -n "$EXPECTED_WHATSMEOW_IMAGE_ID" ] && [ "$WHATSMEOW_ALIAS_IMAGE_ID" = "$EXPECTED_WHATSMEOW_IMAGE_ID" ] && \
        [ -n "$EXPECTED_BALANCE_IMAGE_ID" ] && [ "$BALANCE_ALIAS_IMAGE_ID" = "$EXPECTED_BALANCE_IMAGE_ID" ] && \
        [ "$RUNNING_IMAGE_ID" = "$EXPECTED_BALANCE_IMAGE_ID" ] && \
        docker ps --filter "name=^/under-balance-api$" --filter status=running --format "{{.ID}}" | grep -q . && \
        [ "$HTTP_STATUS" = 200 ]; then echo true; else echo false; fi' -- \
      '${baileysImage}' '${wwebjsImage}' '${whatsmeowImage}' '${balanceApiImage}'`;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_10]: [command],
      [EAllowedDistroVersion.Ubuntu_25_04]: [command],
      [EAllowedDistroVersion.Ubuntu_24_10]: [command],
      [EAllowedDistroVersion.Ubuntu_24_04]: [command],
    };

    return commandsMap[key] ?? [];
  }

  getImagesCommands(info: IDistroInfo): string[] {
    const key = `${info.distro}:${info.version}` as EAllowedDistroVersion;

    const commandsMap: Record<EAllowedDistroVersion, string[]> = {
      [EAllowedDistroVersion.Ubuntu_25_10]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.whatsmeow} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_25_04]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.whatsmeow} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_10]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.whatsmeow} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
      [EAllowedDistroVersion.Ubuntu_24_04]: [
        `bash -c "if docker image inspect ${EWorkerImage.baileys} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.wwebjs} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.whatsmeow} > /dev/null 2>&1 && docker image inspect ${EWorkerImage.balance_api} > /dev/null 2>&1; then echo true; else echo false; fi"`,
      ],
    };

    return commandsMap[key] ?? [];
  }
}
