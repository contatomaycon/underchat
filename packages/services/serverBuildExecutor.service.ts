import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inject, injectable } from 'tsyringe';
import {
  buildEnvironment,
  generalEnvironment,
} from '@core/config/environments';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { serverBuildCentrifugoQueue } from '@core/common/functions/centrifugoQueue';
import { IRunServerBuildCommandOptions } from '@core/common/interfaces/IRunServerBuildCommandOptions';
import { IServerBuildCentrifugo } from '@core/common/interfaces/IServerBuildCentrifugo';
import { IServerBuildTarget } from '@core/common/interfaces/IServerBuildTarget';
import { CentrifugoService } from './centrifugo.service';
import { ServerBuildService } from './serverBuild.service';

class BuildJobCanceledError extends Error {
  constructor(
    readonly serverBuildJobId: string,
    readonly buildType: EServerBuildType,
    message = 'Build job item canceled'
  ) {
    super(message);
    this.name = 'BuildJobCanceledError';
  }
}

@injectable()
export class ServerBuildExecutorService {
  private readonly activeProcesses = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();
  private readonly cancelRequested = new Set<string>();
  private readonly commandOutputLimit = 12_000;
  private readonly commandInactivityTimeoutMs =
    buildEnvironment.buildCommandInactivityTimeoutMs;
  private readonly commandMaxDurationMs =
    buildEnvironment.buildCommandMaxDurationMs;
  private readonly commandHeartbeatIntervalMs =
    buildEnvironment.buildHeartbeatIntervalMs;
  private readonly staleRunningItemTimeoutMs =
    buildEnvironment.buildStaleRunningItemTimeoutMs;
  private readonly staleRunningItemCheckIntervalMs =
    buildEnvironment.buildStaleCheckIntervalMs;
  private readonly realtimeLogLineLimit = 2_000;
  private readonly realtimeLogBufferFlushThreshold = 8_000;
  private readonly realtimeLogBufferByStream = new Map<string, string>();
  private staleRunningItemMonitorTimer: ReturnType<typeof setInterval> | null =
    null;
  private isRecoveringStaleItems = false;
  private readonly buildTargets: IServerBuildTarget[] = [
    {
      buildType: EServerBuildType.baileys,
      imageName: 'under-worker-baileys',
      dockerfilePath: 'apps/worker_baileys/Dockerfile',
    },
    {
      buildType: EServerBuildType.wwebjs,
      imageName: 'under-worker-wwebjs',
      dockerfilePath: 'apps/worker_wwebjs/Dockerfile',
    },
    {
      buildType: EServerBuildType.balance_api,
      imageName: 'under-balance-api',
      dockerfilePath: 'apps/balance_api/Dockerfile',
    },
  ];

  constructor(
    @inject(ServerBuildService)
    private readonly serverBuildService: ServerBuildService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {
    this.startStaleRunningItemMonitor();
  }

  private getExecutionKey(
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): string {
    return `${serverBuildJobId}:${buildType}`;
  }

  private getBuildTarget(
    buildType: EServerBuildType
  ): IServerBuildTarget | null {
    return (
      this.buildTargets.find((target) => target.buildType === buildType) ?? null
    );
  }

  private async publishRealtimeEvent(
    payload: IServerBuildCentrifugo
  ): Promise<void> {
    try {
      await this.centrifugoService.publishImmediate(
        serverBuildCentrifugoQueue(),
        payload
      );
    } catch {}
  }

  private getRealtimeTimestamp(): string {
    return new Date().toISOString();
  }

  private async publishJobSnapshot(serverBuildJobId: string): Promise<void> {
    const job = await this.serverBuildService.getBuildJobById(serverBuildJobId);
    if (!job) {
      return;
    }

    await this.publishRealtimeEvent({
      event: 'job_snapshot',
      server_build_job_id: serverBuildJobId,
      timestamp: this.getRealtimeTimestamp(),
      build_type: null,
      stream: null,
      log: null,
      job: {
        server_build_job_id: job.server_build_job_id,
        requested_by: job.requested_by ?? null,
        version: job.version,
        status: job.status,
        error_message: job.error_message ?? null,
        created_at: job.created_at ?? '',
        updated_at: job.updated_at ?? '',
        started_at: job.started_at ?? null,
        finished_at: job.finished_at ?? null,
        items: (job.items ?? []).map((item) => ({
          server_build_job_item_id: item.server_build_job_item_id,
          server_build_job_id: item.server_build_job_id,
          build_type: item.build_type,
          status: item.status,
          image_reference: item.image_reference ?? null,
          error_message: item.error_message ?? null,
          created_at: item.created_at ?? '',
          updated_at: item.updated_at ?? '',
          started_at: item.started_at ?? null,
          finished_at: item.finished_at ?? null,
        })),
      },
    });
  }

  private publishCommandLog(
    serverBuildJobId: string,
    buildType: EServerBuildType | null,
    stream: 'stdout' | 'stderr',
    line: string
  ): void {
    const normalized = line.trimEnd();

    if (normalized.trim().length === 0) {
      return;
    }

    const finalLine =
      normalized.length > this.realtimeLogLineLimit
        ? `${normalized.slice(0, this.realtimeLogLineLimit)} ... [truncated ${normalized.length - this.realtimeLogLineLimit} chars]`
        : normalized;

    void this.publishRealtimeEvent({
      event: 'command_log',
      server_build_job_id: serverBuildJobId,
      timestamp: this.getRealtimeTimestamp(),
      job: null,
      build_type: buildType as IServerBuildCentrifugo['build_type'],
      stream,
      log: finalLine,
    });
  }

  private publishActionLog(
    serverBuildJobId: string,
    buildType: EServerBuildType | null,
    message: string
  ): void {
    const normalizedMessage = message
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(' | ');

    if (!normalizedMessage) {
      return;
    }

    this.publishCommandLog(
      serverBuildJobId,
      buildType,
      'stdout',
      `[action] ${normalizedMessage}`
    );
  }

  private getRealtimeBufferKey(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    stream: 'stdout' | 'stderr'
  ): string {
    return `${serverBuildJobId}:${buildType}:${stream}`;
  }

  private appendRealtimeOutputChunk(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    stream: 'stdout' | 'stderr',
    chunk: string
  ): void {
    const bufferKey = this.getRealtimeBufferKey(
      serverBuildJobId,
      buildType,
      stream
    );
    const previousBuffer = this.realtimeLogBufferByStream.get(bufferKey) ?? '';
    const normalizedChunk = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const mergedChunk = `${previousBuffer}${normalizedChunk}`;
    const lines = mergedChunk.split('\n');
    const pendingLine = lines.pop() ?? '';

    for (const line of lines) {
      this.publishCommandLog(serverBuildJobId, buildType, stream, line);
    }

    if (pendingLine.length >= this.realtimeLogBufferFlushThreshold) {
      this.publishCommandLog(serverBuildJobId, buildType, stream, pendingLine);
      this.realtimeLogBufferByStream.delete(bufferKey);
      return;
    }

    if (pendingLine.length > 0) {
      this.realtimeLogBufferByStream.set(bufferKey, pendingLine);
      return;
    }

    this.realtimeLogBufferByStream.delete(bufferKey);
  }

  private flushRealtimeOutputBuffer(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    stream: 'stdout' | 'stderr'
  ): void {
    const bufferKey = this.getRealtimeBufferKey(
      serverBuildJobId,
      buildType,
      stream
    );
    const pendingLine = this.realtimeLogBufferByStream.get(bufferKey);

    if (!pendingLine) {
      return;
    }

    this.realtimeLogBufferByStream.delete(bufferKey);
    this.publishCommandLog(serverBuildJobId, buildType, stream, pendingLine);
  }

  private flushRealtimeOutputBuffersByExecution(
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): void {
    const executionPrefix = `${serverBuildJobId}:${buildType}:`;

    for (const [bufferKey, pendingLine] of this.realtimeLogBufferByStream) {
      if (!bufferKey.startsWith(executionPrefix)) {
        continue;
      }

      const stream = bufferKey.endsWith(':stderr') ? 'stderr' : 'stdout';
      this.realtimeLogBufferByStream.delete(bufferKey);
      this.publishCommandLog(serverBuildJobId, buildType, stream, pendingLine);
    }
  }

  private trimCommandOutput(output: string): string {
    if (output.length <= this.commandOutputLimit) {
      return output;
    }

    return output.slice(output.length - this.commandOutputLimit);
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }

    return `${minutes}m ${remainingSeconds}s`;
  }

  private startStaleRunningItemMonitor(): void {
    if (this.staleRunningItemMonitorTimer) {
      return;
    }

    this.staleRunningItemMonitorTimer = setInterval(() => {
      void this.recoverStaleRunningItems();
    }, this.staleRunningItemCheckIntervalMs);
    this.staleRunningItemMonitorTimer.unref?.();

    void this.recoverStaleRunningItems();
  }

  private async recoverStaleRunningItems(): Promise<void> {
    if (this.isRecoveringStaleItems) {
      return;
    }

    this.isRecoveringStaleItems = true;
    try {
      const staleReason = `Build item sem heartbeat por ${this.formatDuration(this.staleRunningItemTimeoutMs)}.`;
      const affectedJobIds =
        await this.serverBuildService.failStaleRunningItems(
          this.staleRunningItemTimeoutMs,
          staleReason
        );

      if (affectedJobIds.length === 0) {
        return;
      }

      for (const serverBuildJobId of affectedJobIds) {
        const status =
          await this.serverBuildService.syncJobStatusFromItems(
            serverBuildJobId
          );

        this.publishActionLog(
          serverBuildJobId,
          null,
          `Detected stale running build item and marked it as failed (${staleReason})`
        );
        await this.publishJobSnapshot(serverBuildJobId);

        if (
          status === EServerBuildJobStatus.completed ||
          status === EServerBuildJobStatus.failed ||
          status === EServerBuildJobStatus.canceled
        ) {
          this.cancelRequested.delete(serverBuildJobId);
        }
      }
    } catch {
    } finally {
      this.isRecoveringStaleItems = false;
    }
  }

  private getImageReferences(
    target: IServerBuildTarget,
    version: string
  ): {
    harborRepository: string;
    imageReference: string;
  } {
    const harborRepository = `${buildEnvironment.harborNamespace}/${target.imageName}`;
    const imageReference = `${buildEnvironment.harborRegistry}/${harborRepository}:${version}`;

    return {
      harborRepository,
      imageReference,
    };
  }

  private getRepositoryUrlWithToken(): string {
    const encodedToken = encodeURIComponent(generalEnvironment.gitToken);
    return `https://${encodedToken}@gitea.devunder.com/${generalEnvironment.gitRepo}.git`;
  }

  private getWorkspaceRootForJobItem(
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): string {
    const workspaceParent = path.resolve(buildEnvironment.buildGitCloneDir);
    return path.resolve(
      workspaceParent,
      `server-build-${serverBuildJobId}-${buildType}`
    );
  }

  private async prepareWorkspaceFromGit(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    workspaceRoot: string
  ): Promise<void> {
    const branch = generalEnvironment.gitBranch;
    const workspaceParent = path.dirname(workspaceRoot);
    const repositoryUrl = this.getRepositoryUrlWithToken();
    const repositoryUrlDisplay = `https://<token>@gitea.devunder.com/${generalEnvironment.gitRepo}.git`;

    fs.mkdirSync(workspaceParent, { recursive: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });

    await this.runCommand(
      serverBuildJobId,
      buildType,
      'git',
      [
        'clone',
        '--single-branch',
        '--branch',
        branch,
        repositoryUrl,
        workspaceRoot,
      ],
      {
        cwd: workspaceParent,
        displayArgs: [
          'clone',
          '--single-branch',
          '--branch',
          branch,
          repositoryUrlDisplay,
          workspaceRoot,
        ],
      }
    );

    await this.runCommand(
      serverBuildJobId,
      buildType,
      'git',
      ['pull', '--ff-only', 'origin', branch],
      { cwd: workspaceRoot }
    );
  }

  private cleanupWorkspace(workspaceRoot: string | null): void {
    if (!workspaceRoot) {
      return;
    }

    try {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    } catch {}
  }

  private clearActiveProcess(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    child?: ChildProcessWithoutNullStreams
  ): void {
    const executionKey = this.getExecutionKey(serverBuildJobId, buildType);
    const runningChild = this.activeProcesses.get(executionKey);
    if (!runningChild) {
      return;
    }

    if (child && runningChild !== child) {
      return;
    }

    this.activeProcesses.delete(executionKey);
  }

  private async isCancelRequested(serverBuildJobId: string): Promise<boolean> {
    if (this.cancelRequested.has(serverBuildJobId)) {
      return true;
    }

    return this.serverBuildService.isCancelRequested(serverBuildJobId);
  }

  private async runCommand(
    serverBuildJobId: string,
    buildType: EServerBuildType,
    command: string,
    args: string[],
    options: IRunServerBuildCommandOptions
  ): Promise<void> {
    if (await this.isCancelRequested(serverBuildJobId)) {
      throw new BuildJobCanceledError(serverBuildJobId, buildType);
    }

    const argsForDisplay = options.displayArgs ?? args;
    const commandDisplay = `${command} ${argsForDisplay.join(' ')}`.trim();
    const commandStartedAt = Date.now();

    this.publishActionLog(
      serverBuildJobId,
      buildType,
      `Executing command: ${commandDisplay}`
    );

    await new Promise<void>((resolve, reject) => {
      let output = '';
      let cancelMonitorTimer: ReturnType<typeof setInterval> | null = null;
      let cancelKillTimer: ReturnType<typeof setTimeout> | null = null;
      let cancelCheckInFlight = false;
      let timedOutMessage: string | null = null;
      let lastOutputAt = Date.now();
      let lastHeartbeatAt = Date.now();
      let heartbeatInFlight = false;

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: 'pipe',
      });

      const executionKey = this.getExecutionKey(serverBuildJobId, buildType);
      this.activeProcesses.set(executionKey, child);

      const requestTimeoutTermination = (
        timeoutReason: string,
        timeoutMs: number
      ): void => {
        if (timedOutMessage) {
          return;
        }

        timedOutMessage = timeoutReason;
        this.publishActionLog(
          serverBuildJobId,
          buildType,
          `Command watchdog triggered after ${this.formatDuration(timeoutMs)}: ${timeoutReason}`
        );

        try {
          child.kill('SIGTERM');
        } catch {}

        if (cancelKillTimer) {
          return;
        }

        cancelKillTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 5000);
      };

      const requestCancellation = (): void => {
        this.cancelRequested.add(serverBuildJobId);

        try {
          child.kill('SIGTERM');
        } catch {}

        if (cancelKillTimer) {
          return;
        }

        cancelKillTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 5000);
      };

      const stopCancelMonitor = (): void => {
        if (cancelMonitorTimer) {
          clearInterval(cancelMonitorTimer);
          cancelMonitorTimer = null;
        }

        if (cancelKillTimer) {
          clearTimeout(cancelKillTimer);
          cancelKillTimer = null;
        }
      };

      const tryHeartbeat = (now: number): void => {
        if (heartbeatInFlight) {
          return;
        }

        if (now - lastHeartbeatAt < this.commandHeartbeatIntervalMs) {
          return;
        }

        heartbeatInFlight = true;
        lastHeartbeatAt = now;
        this.serverBuildService
          .touchRunningJobItem(serverBuildJobId, buildType)
          .catch(() => {})
          .finally(() => {
            heartbeatInFlight = false;
          });
      };

      const pollCancellation = (): void => {
        if (this.cancelRequested.has(serverBuildJobId)) {
          requestCancellation();
          return;
        }

        const now = Date.now();
        const elapsedMs = now - commandStartedAt;
        if (elapsedMs >= this.commandMaxDurationMs) {
          requestTimeoutTermination(
            `Command exceeded maximum duration while executing: ${commandDisplay}`,
            elapsedMs
          );
          return;
        }

        const inactivityMs = now - lastOutputAt;
        if (inactivityMs >= this.commandInactivityTimeoutMs) {
          requestTimeoutTermination(
            `No command output for ${this.formatDuration(inactivityMs)} while executing: ${commandDisplay}`,
            inactivityMs
          );
          return;
        }

        tryHeartbeat(now);

        if (cancelCheckInFlight) {
          return;
        }

        cancelCheckInFlight = true;
        this.serverBuildService
          .isCancelRequested(serverBuildJobId)
          .then((cancelRequested) => {
            if (cancelRequested) {
              requestCancellation();
            }
          })
          .catch(() => {})
          .finally(() => {
            cancelCheckInFlight = false;
          });
      };

      cancelMonitorTimer = setInterval(pollCancellation, 1_000);
      pollCancellation();

      const appendOutput = (
        chunk: Buffer,
        stream: 'stdout' | 'stderr'
      ): void => {
        const chunkText = chunk.toString();
        lastOutputAt = Date.now();
        output += chunkText;

        if (output.length > this.commandOutputLimit * 2) {
          output = this.trimCommandOutput(output);
        }

        if (options.emitRealtimeLogs !== false) {
          this.appendRealtimeOutputChunk(
            serverBuildJobId,
            buildType,
            stream,
            chunkText
          );
        }
      };

      child.stdout.on('data', (chunk) => appendOutput(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => appendOutput(chunk, 'stderr'));

      child.on('error', (error) => {
        stopCancelMonitor();
        this.flushRealtimeOutputBuffer(serverBuildJobId, buildType, 'stdout');
        this.flushRealtimeOutputBuffer(serverBuildJobId, buildType, 'stderr');
        const errorMessage = timedOutMessage ?? error.message;
        this.publishActionLog(
          serverBuildJobId,
          buildType,
          `Command error: ${errorMessage}`
        );
        this.clearActiveProcess(serverBuildJobId, buildType, child);
        reject(timedOutMessage ? new Error(timedOutMessage) : error);
      });

      child.on('close', (code, signal) => {
        stopCancelMonitor();
        this.flushRealtimeOutputBuffer(serverBuildJobId, buildType, 'stdout');
        this.flushRealtimeOutputBuffer(serverBuildJobId, buildType, 'stderr');

        this.clearActiveProcess(serverBuildJobId, buildType, child);
        const commandDurationMs = Date.now() - commandStartedAt;
        const commandDurationLabel = `${commandDurationMs}ms`;

        if (timedOutMessage) {
          reject(new Error(timedOutMessage));
          return;
        }

        if (this.cancelRequested.has(serverBuildJobId)) {
          this.publishActionLog(
            serverBuildJobId,
            buildType,
            `Command canceled (${signal ?? `code ${code ?? 'unknown'}`}) after ${commandDurationLabel}: ${commandDisplay}`
          );

          reject(
            new BuildJobCanceledError(
              serverBuildJobId,
              buildType,
              `Build canceled (${signal ?? `code ${code ?? 'unknown'}`})`
            )
          );
          return;
        }

        if (code === 0) {
          this.publishActionLog(
            serverBuildJobId,
            buildType,
            `Command finished in ${commandDurationLabel}: ${commandDisplay}`
          );
          resolve();
          return;
        }

        const commandOutput = this.trimCommandOutput(output);
        this.publishActionLog(
          serverBuildJobId,
          buildType,
          `Command failed (${signal ?? `exit code ${code ?? 'unknown'}`}) after ${commandDurationLabel}: ${commandDisplay}`
        );

        reject(
          new Error(
            `Command failed (${signal ?? `exit code ${code ?? 'unknown'}`}): ${command} ${argsForDisplay.join(' ')}\n${commandOutput}`
          )
        );
      });

      if (options.stdin) {
        child.stdin.write(options.stdin);
      }
      child.stdin.end();
    });
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown build error';
  }

  async requestCancel(serverBuildJobId: string): Promise<void> {
    this.cancelRequested.add(serverBuildJobId);

    const executionPrefix = `${serverBuildJobId}:`;
    const activeChildren = Array.from(this.activeProcesses.entries()).filter(
      ([executionKey]) => executionKey.startsWith(executionPrefix)
    );

    if (activeChildren.length === 0) {
      await this.serverBuildService.cancelJobIfNotRunning(serverBuildJobId);
      await this.serverBuildService.syncJobStatusFromItems(serverBuildJobId);
      await this.publishJobSnapshot(serverBuildJobId);
      return;
    }

    for (const [, child] of activeChildren) {
      try {
        child.kill('SIGTERM');
      } catch {}
    }

    setTimeout(() => {
      const runningChildren = Array.from(this.activeProcesses.entries()).filter(
        ([executionKey]) => executionKey.startsWith(executionPrefix)
      );

      for (const [, child] of runningChildren) {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 5000);

    await this.publishJobSnapshot(serverBuildJobId);
  }

  async executeBuildJobItem(
    serverBuildJobId: string,
    buildType: EServerBuildType
  ): Promise<void> {
    const target = this.getBuildTarget(buildType);
    if (!target) {
      return;
    }

    const version = await this.serverBuildService.claimJobItemForExecution(
      serverBuildJobId,
      buildType
    );

    if (!version) {
      const job =
        await this.serverBuildService.getBuildJobById(serverBuildJobId);
      if (!job) {
        return;
      }

      const shouldSyncStatus =
        job.status !== EServerBuildJobStatus.completed &&
        job.status !== EServerBuildJobStatus.failed &&
        job.status !== EServerBuildJobStatus.canceled;
      const status = shouldSyncStatus
        ? await this.serverBuildService.syncJobStatusFromItems(serverBuildJobId)
        : job.status;

      if (
        status === EServerBuildJobStatus.completed ||
        status === EServerBuildJobStatus.failed ||
        status === EServerBuildJobStatus.canceled
      ) {
        this.cancelRequested.delete(serverBuildJobId);
      }

      await this.publishJobSnapshot(serverBuildJobId);
      return;
    }

    await this.publishJobSnapshot(serverBuildJobId);
    this.publishActionLog(
      serverBuildJobId,
      buildType,
      `Build target ${buildType} claimed for execution`
    );

    let workspaceRoot: string | null = null;

    try {
      workspaceRoot = this.getWorkspaceRootForJobItem(
        serverBuildJobId,
        buildType
      );

      this.publishActionLog(
        serverBuildJobId,
        buildType,
        `Preparing workspace for version ${version}`
      );

      await this.prepareWorkspaceFromGit(
        serverBuildJobId,
        buildType,
        workspaceRoot
      );

      const dockerfileAbsolutePath = path.resolve(
        workspaceRoot,
        target.dockerfilePath
      );

      if (!fs.existsSync(dockerfileAbsolutePath)) {
        throw new Error(`Dockerfile not found: ${dockerfileAbsolutePath}`);
      }

      const dockerConfigDir = path.join(workspaceRoot, '.docker');
      fs.mkdirSync(dockerConfigDir, { recursive: true });
      const dockerCommandEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: workspaceRoot,
        DOCKER_CONFIG: dockerConfigDir,
      };

      await this.runCommand(
        serverBuildJobId,
        buildType,
        'docker',
        [
          'login',
          buildEnvironment.harborRegistry,
          '-u',
          buildEnvironment.harborUsername,
          '--password-stdin',
        ],
        {
          cwd: workspaceRoot,
          stdin: `${buildEnvironment.harborPassword}\n`,
          env: dockerCommandEnv,
        }
      );

      const { harborRepository, imageReference } = this.getImageReferences(
        target,
        version
      );

      await this.runCommand(
        serverBuildJobId,
        buildType,
        'docker',
        [
          'buildx',
          'build',
          '--no-cache',
          '--push',
          '-t',
          imageReference,
          '-f',
          target.dockerfilePath,
          '.',
        ],
        {
          cwd: workspaceRoot,
          env: dockerCommandEnv,
        }
      );

      await this.serverBuildService.markJobItemSuccessAndPersistVersion({
        server_build_job_id: serverBuildJobId,
        build_type: buildType,
        version,
        harbor_registry: buildEnvironment.harborRegistry,
        harbor_repository: harborRepository,
        image_reference: imageReference,
      });

      this.publishActionLog(
        serverBuildJobId,
        buildType,
        `Build target ${buildType} finished successfully`
      );
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      const canceled =
        error instanceof BuildJobCanceledError ||
        (await this.serverBuildService.isCancelRequested(serverBuildJobId));

      if (canceled) {
        await this.serverBuildService.markJobItemCanceled(
          serverBuildJobId,
          buildType,
          errorMessage
        );

        this.publishActionLog(
          serverBuildJobId,
          buildType,
          `Build target ${buildType} canceled: ${errorMessage}`
        );
      } else {
        await this.serverBuildService.markJobItemFailed(
          serverBuildJobId,
          buildType,
          errorMessage
        );

        this.publishActionLog(
          serverBuildJobId,
          buildType,
          `Build target ${buildType} failed: ${errorMessage}`
        );
      }
    } finally {
      this.clearActiveProcess(serverBuildJobId, buildType);
      this.flushRealtimeOutputBuffersByExecution(serverBuildJobId, buildType);
      this.cleanupWorkspace(workspaceRoot);

      const status =
        await this.serverBuildService.syncJobStatusFromItems(serverBuildJobId);
      await this.publishJobSnapshot(serverBuildJobId);

      if (status === EServerBuildJobStatus.completed) {
        this.publishActionLog(serverBuildJobId, null, 'Build job completed');
      } else if (status === EServerBuildJobStatus.failed) {
        this.publishActionLog(serverBuildJobId, null, 'Build job failed');
      } else if (status === EServerBuildJobStatus.canceled) {
        this.publishActionLog(serverBuildJobId, null, 'Build job canceled');
      }

      if (
        status === EServerBuildJobStatus.completed ||
        status === EServerBuildJobStatus.failed ||
        status === EServerBuildJobStatus.canceled
      ) {
        this.cancelRequested.delete(serverBuildJobId);
      }
    }
  }

  async executeBuildJob(serverBuildJobId: string): Promise<void> {
    await Promise.all(
      this.buildTargets.map((target) =>
        this.executeBuildJobItem(serverBuildJobId, target.buildType)
      )
    );
  }
}
