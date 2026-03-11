import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inject, injectable } from 'tsyringe';
import {
  buildEnvironment,
  generalEnvironment,
} from '@core/config/environments';
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
    message = 'Build job canceled'
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
  private readonly realtimeLogLineLimit = 2_000;
  private readonly realtimeLogBufferFlushThreshold = 8_000;
  private readonly realtimeLogBufferByStream = new Map<string, string>();
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
  ) {}

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
    stream: 'stdout' | 'stderr'
  ): string {
    return `${serverBuildJobId}:${stream}`;
  }

  private appendRealtimeOutputChunk(
    serverBuildJobId: string,
    buildType: EServerBuildType | null,
    stream: 'stdout' | 'stderr',
    chunk: string
  ): void {
    const bufferKey = this.getRealtimeBufferKey(serverBuildJobId, stream);
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
    buildType: EServerBuildType | null,
    stream: 'stdout' | 'stderr'
  ): void {
    const bufferKey = this.getRealtimeBufferKey(serverBuildJobId, stream);
    const pendingLine = this.realtimeLogBufferByStream.get(bufferKey);

    if (!pendingLine) {
      return;
    }

    this.realtimeLogBufferByStream.delete(bufferKey);
    this.publishCommandLog(serverBuildJobId, buildType, stream, pendingLine);
  }

  private flushRealtimeOutputBuffersByJob(serverBuildJobId: string): void {
    const jobPrefix = `${serverBuildJobId}:`;
    for (const [bufferKey, pendingLine] of this.realtimeLogBufferByStream) {
      if (!bufferKey.startsWith(jobPrefix)) {
        continue;
      }

      const stream = bufferKey.endsWith(':stderr') ? 'stderr' : 'stdout';
      this.realtimeLogBufferByStream.delete(bufferKey);
      this.publishCommandLog(serverBuildJobId, null, stream, pendingLine);
    }
  }

  private hasAllDockerfiles(workspaceRoot: string): boolean {
    return this.buildTargets.every((target) =>
      fs.existsSync(path.resolve(workspaceRoot, target.dockerfilePath))
    );
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

  private getWorkspaceRootForJob(serverBuildJobId: string): string {
    const workspaceParent = path.resolve(buildEnvironment.buildGitCloneDir);
    return path.resolve(workspaceParent, `server-build-${serverBuildJobId}`);
  }

  private async prepareWorkspaceFromGit(
    serverBuildJobId: string,
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

  private trimCommandOutput(output: string): string {
    if (output.length <= this.commandOutputLimit) {
      return output;
    }

    return output.slice(output.length - this.commandOutputLimit);
  }

  private clearActiveProcess(
    serverBuildJobId: string,
    child?: ChildProcessWithoutNullStreams
  ): void {
    const runningChild = this.activeProcesses.get(serverBuildJobId);
    if (!runningChild) {
      return;
    }

    if (child && runningChild !== child) {
      return;
    }

    this.activeProcesses.delete(serverBuildJobId);
  }

  private async isCancelRequested(serverBuildJobId: string): Promise<boolean> {
    if (this.cancelRequested.has(serverBuildJobId)) {
      return true;
    }

    return this.serverBuildService.isCancelRequested(serverBuildJobId);
  }

  private async runCommand(
    serverBuildJobId: string,
    command: string,
    args: string[],
    options: IRunServerBuildCommandOptions
  ): Promise<void> {
    if (await this.isCancelRequested(serverBuildJobId)) {
      throw new BuildJobCanceledError(serverBuildJobId);
    }

    const argsForDisplay = options.displayArgs ?? args;
    const commandDisplay = `${command} ${argsForDisplay.join(' ')}`.trim();
    const commandStartedAt = Date.now();
    this.publishActionLog(
      serverBuildJobId,
      options.buildType ?? null,
      `Executing command: ${commandDisplay}`
    );

    await new Promise<void>((resolve, reject) => {
      let output = '';

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: 'pipe',
      });

      this.activeProcesses.set(serverBuildJobId, child);

      const appendOutput = (
        chunk: Buffer,
        stream: 'stdout' | 'stderr'
      ): void => {
        const chunkText = chunk.toString();
        output += chunkText;
        if (output.length > this.commandOutputLimit * 2) {
          output = this.trimCommandOutput(output);
        }

        if (options.emitRealtimeLogs !== false) {
          this.appendRealtimeOutputChunk(
            serverBuildJobId,
            options.buildType ?? null,
            stream,
            chunkText
          );
        }
      };

      child.stdout.on('data', (chunk) => appendOutput(chunk, 'stdout'));
      child.stderr.on('data', (chunk) => appendOutput(chunk, 'stderr'));

      child.on('error', (error) => {
        this.flushRealtimeOutputBuffer(
          serverBuildJobId,
          options.buildType ?? null,
          'stdout'
        );
        this.flushRealtimeOutputBuffer(
          serverBuildJobId,
          options.buildType ?? null,
          'stderr'
        );
        this.publishActionLog(
          serverBuildJobId,
          options.buildType ?? null,
          `Command error: ${error.message}`
        );
        this.clearActiveProcess(serverBuildJobId, child);
        reject(error);
      });

      child.on('close', (code, signal) => {
        this.flushRealtimeOutputBuffer(
          serverBuildJobId,
          options.buildType ?? null,
          'stdout'
        );
        this.flushRealtimeOutputBuffer(
          serverBuildJobId,
          options.buildType ?? null,
          'stderr'
        );

        this.clearActiveProcess(serverBuildJobId, child);
        const commandDurationMs = Date.now() - commandStartedAt;
        const commandDurationLabel = `${commandDurationMs}ms`;

        if (this.cancelRequested.has(serverBuildJobId)) {
          this.publishActionLog(
            serverBuildJobId,
            options.buildType ?? null,
            `Command canceled (${signal ?? `code ${code ?? 'unknown'}`}) after ${commandDurationLabel}: ${commandDisplay}`
          );
          reject(
            new BuildJobCanceledError(
              serverBuildJobId,
              `Build canceled (${signal ?? `code ${code ?? 'unknown'}`})`
            )
          );
          return;
        }

        if (code === 0) {
          this.publishActionLog(
            serverBuildJobId,
            options.buildType ?? null,
            `Command finished in ${commandDurationLabel}: ${commandDisplay}`
          );
          resolve();
          return;
        }

        const commandOutput = this.trimCommandOutput(output);
        this.publishActionLog(
          serverBuildJobId,
          options.buildType ?? null,
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

    const child = this.activeProcesses.get(serverBuildJobId);
    if (!child) {
      await this.serverBuildService.cancelJobIfNotRunning(serverBuildJobId);
      await this.publishJobSnapshot(serverBuildJobId);
      return;
    }

    try {
      child.kill('SIGTERM');
    } catch {}

    setTimeout(() => {
      const runningChild = this.activeProcesses.get(serverBuildJobId);
      if (!runningChild) {
        return;
      }

      try {
        runningChild.kill('SIGKILL');
      } catch {}
    }, 5000);
  }

  async executeBuildJob(serverBuildJobId: string): Promise<void> {
    const job = await this.serverBuildService.getBuildJobById(serverBuildJobId);

    if (!job) {
      return;
    }

    const started =
      await this.serverBuildService.markJobRunning(serverBuildJobId);
    if (!started) {
      if (await this.serverBuildService.isCancelRequested(serverBuildJobId)) {
        await this.serverBuildService.cancelJobIfNotRunning(serverBuildJobId);
        await this.publishJobSnapshot(serverBuildJobId);
      }
      return;
    }

    await this.publishJobSnapshot(serverBuildJobId);
    this.publishActionLog(serverBuildJobId, null, 'Build job started');

    let finalStatus: 'completed' | 'failed' | 'canceled' = 'completed';
    let finalErrorMessage: string | null = null;
    let workspaceRoot: string | null = null;

    try {
      workspaceRoot = this.getWorkspaceRootForJob(serverBuildJobId);
      this.publishActionLog(
        serverBuildJobId,
        null,
        `Preparing workspace for version ${job.version}`
      );
      await this.prepareWorkspaceFromGit(serverBuildJobId, workspaceRoot);

      if (
        !fs.existsSync(workspaceRoot) ||
        !this.hasAllDockerfiles(workspaceRoot)
      ) {
        finalStatus = 'failed';
        finalErrorMessage = `Build workspace root not found or incomplete: ${workspaceRoot}`;
        this.publishActionLog(serverBuildJobId, null, finalErrorMessage);
        return;
      }

      await this.runCommand(
        serverBuildJobId,
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
        }
      );

      for (const target of this.buildTargets) {
        if (await this.isCancelRequested(serverBuildJobId)) {
          finalStatus = 'canceled';
          this.publishActionLog(
            serverBuildJobId,
            target.buildType,
            'Cancellation requested before starting next build target'
          );
          break;
        }

        const dockerfileAbsolutePath = path.resolve(
          workspaceRoot,
          target.dockerfilePath
        );
        if (!fs.existsSync(dockerfileAbsolutePath)) {
          finalStatus = 'failed';
          finalErrorMessage = `Dockerfile not found: ${dockerfileAbsolutePath}`;
          this.publishActionLog(
            serverBuildJobId,
            target.buildType,
            finalErrorMessage
          );
          await this.serverBuildService.markJobItemFailed(
            serverBuildJobId,
            target.buildType,
            finalErrorMessage
          );
          await this.publishJobSnapshot(serverBuildJobId);
          break;
        }

        this.publishActionLog(
          serverBuildJobId,
          target.buildType,
          `Starting build target ${target.buildType}`
        );

        await this.serverBuildService.markJobItemRunning(
          serverBuildJobId,
          target.buildType
        );
        await this.publishJobSnapshot(serverBuildJobId);

        try {
          const { harborRepository, imageReference } = this.getImageReferences(
            target,
            job.version
          );

          await this.runCommand(
            serverBuildJobId,
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
              buildType: target.buildType,
            }
          );

          await this.serverBuildService.markJobItemSuccessAndPersistVersion({
            server_build_job_id: serverBuildJobId,
            build_type: target.buildType,
            version: job.version,
            harbor_registry: buildEnvironment.harborRegistry,
            harbor_repository: harborRepository,
            image_reference: imageReference,
          });
          this.publishActionLog(
            serverBuildJobId,
            target.buildType,
            `Build target ${target.buildType} finished successfully`
          );
          await this.publishJobSnapshot(serverBuildJobId);
        } catch (error) {
          const errorMessage = this.getErrorMessage(error);

          if (error instanceof BuildJobCanceledError) {
            finalStatus = 'canceled';
            finalErrorMessage = errorMessage;
            this.publishActionLog(
              serverBuildJobId,
              target.buildType,
              `Build target ${target.buildType} canceled: ${errorMessage}`
            );
            await this.serverBuildService.markJobItemCanceled(
              serverBuildJobId,
              target.buildType,
              errorMessage
            );
            await this.publishJobSnapshot(serverBuildJobId);
          } else {
            finalStatus = 'failed';
            finalErrorMessage = errorMessage;
            this.publishActionLog(
              serverBuildJobId,
              target.buildType,
              `Build target ${target.buildType} failed: ${errorMessage}`
            );
            await this.serverBuildService.markJobItemFailed(
              serverBuildJobId,
              target.buildType,
              errorMessage
            );
            await this.publishJobSnapshot(serverBuildJobId);
          }

          break;
        }
      }
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      finalStatus =
        error instanceof BuildJobCanceledError ? 'canceled' : 'failed';
      finalErrorMessage = errorMessage;
      this.publishActionLog(
        serverBuildJobId,
        null,
        `Build job ${finalStatus}: ${errorMessage}`
      );
    } finally {
      this.cancelRequested.delete(serverBuildJobId);
      this.clearActiveProcess(serverBuildJobId);
      this.flushRealtimeOutputBuffersByJob(serverBuildJobId);
      this.cleanupWorkspace(workspaceRoot);

      if (finalStatus === 'completed') {
        await this.serverBuildService.markJobCompleted(serverBuildJobId);
        await this.publishJobSnapshot(serverBuildJobId);
        this.publishActionLog(serverBuildJobId, null, 'Build job completed');
        return;
      }

      if (finalStatus === 'canceled') {
        await this.serverBuildService.markJobCanceled(
          serverBuildJobId,
          finalErrorMessage
        );
        await this.publishJobSnapshot(serverBuildJobId);
        this.publishActionLog(serverBuildJobId, null, 'Build job canceled');
        return;
      }

      await this.serverBuildService.markJobFailed(
        serverBuildJobId,
        finalErrorMessage ?? 'Build execution failed'
      );
      await this.publishJobSnapshot(serverBuildJobId);
      this.publishActionLog(serverBuildJobId, null, 'Build job failed');
    }
  }
}
