import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inject, injectable } from 'tsyringe';
import {
  buildEnvironment,
  generalEnvironment,
} from '@core/config/environments';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
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

interface IBuildTarget {
  buildType: EServerBuildType;
  imageName: string;
  dockerfilePath: string;
}

interface ICommandOptions {
  cwd: string;
  stdin?: string;
  displayArgs?: string[];
}

@injectable()
export class ServerBuildExecutorService {
  private readonly activeProcesses = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();
  private readonly cancelRequested = new Set<string>();
  private readonly commandOutputLimit = 12_000;
  private readonly buildTargets: IBuildTarget[] = [
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
    private readonly serverBuildService: ServerBuildService
  ) {}

  private hasAllDockerfiles(workspaceRoot: string): boolean {
    return this.buildTargets.every((target) =>
      fs.existsSync(path.resolve(workspaceRoot, target.dockerfilePath))
    );
  }

  private getImageReferences(
    target: IBuildTarget,
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
    options: ICommandOptions
  ): Promise<void> {
    if (await this.isCancelRequested(serverBuildJobId)) {
      throw new BuildJobCanceledError(serverBuildJobId);
    }

    await new Promise<void>((resolve, reject) => {
      let output = '';

      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: 'pipe',
      });

      this.activeProcesses.set(serverBuildJobId, child);

      const appendOutput = (chunk: Buffer): void => {
        output += chunk.toString();
        if (output.length > this.commandOutputLimit * 2) {
          output = this.trimCommandOutput(output);
        }
      };

      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);

      child.on('error', (error) => {
        this.clearActiveProcess(serverBuildJobId, child);
        reject(error);
      });

      child.on('close', (code, signal) => {
        this.clearActiveProcess(serverBuildJobId, child);

        if (this.cancelRequested.has(serverBuildJobId)) {
          reject(
            new BuildJobCanceledError(
              serverBuildJobId,
              `Build canceled (${signal ?? `code ${code ?? 'unknown'}`})`
            )
          );
          return;
        }

        if (code === 0) {
          resolve();
          return;
        }

        const commandOutput = this.trimCommandOutput(output);
        const argsForDisplay = options.displayArgs ?? args;
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
      }
      return;
    }

    let finalStatus: 'completed' | 'failed' | 'canceled' = 'completed';
    let finalErrorMessage: string | null = null;
    let workspaceRoot: string | null = null;

    try {
      workspaceRoot = this.getWorkspaceRootForJob(serverBuildJobId);
      await this.prepareWorkspaceFromGit(serverBuildJobId, workspaceRoot);

      if (
        !fs.existsSync(workspaceRoot) ||
        !this.hasAllDockerfiles(workspaceRoot)
      ) {
        finalStatus = 'failed';
        finalErrorMessage = `Build workspace root not found or incomplete: ${workspaceRoot}`;
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
          break;
        }

        const dockerfileAbsolutePath = path.resolve(
          workspaceRoot,
          target.dockerfilePath
        );
        if (!fs.existsSync(dockerfileAbsolutePath)) {
          finalStatus = 'failed';
          finalErrorMessage = `Dockerfile not found: ${dockerfileAbsolutePath}`;
          await this.serverBuildService.markJobItemFailed(
            serverBuildJobId,
            target.buildType,
            finalErrorMessage
          );
          break;
        }

        await this.serverBuildService.markJobItemRunning(
          serverBuildJobId,
          target.buildType
        );

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
            { cwd: workspaceRoot }
          );

          await this.serverBuildService.markJobItemSuccessAndPersistVersion({
            server_build_job_id: serverBuildJobId,
            build_type: target.buildType,
            version: job.version,
            harbor_registry: buildEnvironment.harborRegistry,
            harbor_repository: harborRepository,
            image_reference: imageReference,
          });
        } catch (error) {
          const errorMessage = this.getErrorMessage(error);

          if (error instanceof BuildJobCanceledError) {
            finalStatus = 'canceled';
            finalErrorMessage = errorMessage;
            await this.serverBuildService.markJobItemCanceled(
              serverBuildJobId,
              target.buildType,
              errorMessage
            );
          } else {
            finalStatus = 'failed';
            finalErrorMessage = errorMessage;
            await this.serverBuildService.markJobItemFailed(
              serverBuildJobId,
              target.buildType,
              errorMessage
            );
          }

          break;
        }
      }
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      finalStatus =
        error instanceof BuildJobCanceledError ? 'canceled' : 'failed';
      finalErrorMessage = errorMessage;
    } finally {
      this.cancelRequested.delete(serverBuildJobId);
      this.clearActiveProcess(serverBuildJobId);
      this.cleanupWorkspace(workspaceRoot);

      if (finalStatus === 'completed') {
        await this.serverBuildService.markJobCompleted(serverBuildJobId);
        return;
      }

      if (finalStatus === 'canceled') {
        await this.serverBuildService.markJobCanceled(
          serverBuildJobId,
          finalErrorMessage
        );
        return;
      }

      await this.serverBuildService.markJobFailed(
        serverBuildJobId,
        finalErrorMessage ?? 'Build execution failed'
      );
    }
  }
}
