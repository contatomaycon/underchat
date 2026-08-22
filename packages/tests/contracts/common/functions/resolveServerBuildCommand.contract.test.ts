import { resolveServerBuildCommand } from '@core/common/functions/resolveServerBuildCommand';

describe('resolveServerBuildCommand contract', () => {
  it('forces deterministic plain progress for Docker BuildKit', () => {
    const command = resolveServerBuildCommand({
      buildEngine: 'docker',
      imageReference: 'harbor.example/underchat/balance-api:1.2.3',
      dockerfilePath: 'apps/balance_api/Dockerfile',
      dockerfileAbsolutePath:
        '/var/tmp/underchat-build-source/job-1/apps/balance_api/Dockerfile',
      workspaceRoot: '/var/tmp/underchat-build-source/job-1',
      kanikoExecutorPath: '/kaniko/executor',
      kanikoWorkingDir: '/var/tmp/underchat-build-runtime/job-1/kaniko',
      kanikoIgnorePath: '/var/tmp/underchat-build-source',
    });

    expect(command.command).toBe('docker');
    expect(command.args).toEqual([
      'buildx',
      'build',
      '--progress=plain',
      '--no-cache',
      '--push',
      '-t',
      'harbor.example/underchat/balance-api:1.2.3',
      '-f',
      'apps/balance_api/Dockerfile',
      '.',
    ]);
  });

  it('uses the isolated Kaniko working directory supplied by the caller', () => {
    const kanikoWorkingDir = '/var/tmp/underchat-build-source/.kaniko/job-1';
    const kanikoIgnorePath = '/var/tmp/underchat-build-source';
    const command = resolveServerBuildCommand({
      buildEngine: 'kaniko',
      imageReference: 'harbor.example/underchat/worker:1.2.3',
      dockerfilePath: 'apps/worker_baileys/Dockerfile',
      dockerfileAbsolutePath:
        '/var/tmp/underchat-build-source/job-1/apps/worker_baileys/Dockerfile',
      workspaceRoot: '/var/tmp/underchat-build-source/job-1',
      kanikoExecutorPath: '/kaniko/executor',
      kanikoWorkingDir,
      kanikoIgnorePath,
    });
    const kanikoDirectoryArgumentIndex = command.args.indexOf('--kaniko-dir');
    const ignoredPaths = command.args.flatMap((argument, index) =>
      argument === '--ignore-path' ? [command.args[index + 1]] : []
    );

    expect(command.command).toBe('/kaniko/executor');
    expect(kanikoDirectoryArgumentIndex).toBeGreaterThanOrEqual(0);
    expect(command.args[kanikoDirectoryArgumentIndex + 1]).toBe(
      kanikoWorkingDir
    );
    expect(command.args).not.toContain('/tmp/kaniko');
    expect(ignoredPaths).toContain(kanikoIgnorePath);
  });
});
