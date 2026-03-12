import { TBuildEngine } from '@core/config/environments/BuildEnvironment';

interface IResolveServerBuildCommandInput {
  buildEngine: TBuildEngine;
  imageReference: string;
  dockerfilePath: string;
  dockerfileAbsolutePath: string;
  workspaceRoot: string;
  kanikoExecutorPath: string;
}

interface IResolvedServerBuildCommand {
  command: string;
  args: string[];
}

export function resolveServerBuildCommand(
  input: IResolveServerBuildCommandInput
): IResolvedServerBuildCommand {
  if (input.buildEngine === 'docker') {
    return {
      command: 'docker',
      args: [
        'buildx',
        'build',
        '--no-cache',
        '--push',
        '-t',
        input.imageReference,
        '-f',
        input.dockerfilePath,
        '.',
      ],
    };
  }

  return {
    command: input.kanikoExecutorPath,
    args: [
      '--context',
      `dir://${input.workspaceRoot}`,
      '--dockerfile',
      input.dockerfileAbsolutePath,
      '--destination',
      input.imageReference,
      '--cache=false',
      '--force',
      '--kaniko-dir',
      '/tmp/kaniko',
    ],
  };
}
