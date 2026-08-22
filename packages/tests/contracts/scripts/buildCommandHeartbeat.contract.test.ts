import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface IRunHeartbeatCommandInput {
  readonly commandArguments: string[];
  readonly environment?: NodeJS.ProcessEnv;
}

const heartbeatScriptPath = path.resolve(
  process.cwd(),
  'scripts/build-command-heartbeat.mjs'
);

function runHeartbeatCommand(input: IRunHeartbeatCommandInput) {
  return spawnSync(
    process.execPath,
    [heartbeatScriptPath, '--', process.execPath, ...input.commandArguments],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        UNDERCHAT_COMMAND_HEARTBEAT_INTERVAL_MS: '20',
        UNDERCHAT_COMMAND_TIMEOUT_MS: '1000',
        UNDERCHAT_COMMAND_KILL_GRACE_MS: '20',
        UNDERCHAT_COMMAND_HEARTBEAT_LABEL: 'contract-test',
        ...input.environment,
      },
      timeout: 3_000,
    }
  );
}

describe('build command heartbeat contract', () => {
  it('wraps the Balance API TypeScript build with heartbeat and a scoped timeout', () => {
    const dockerfile = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/balance_api/Dockerfile'),
      'utf8'
    );

    expect(dockerfile).toContain(
      'COPY scripts/build-command-heartbeat.mjs ./scripts/build-command-heartbeat.mjs'
    );
    expect(dockerfile).toContain(
      'UNDERCHAT_COMMAND_HEARTBEAT_INTERVAL_MS=30000'
    );
    expect(dockerfile).toContain('UNDERCHAT_COMMAND_TIMEOUT_MS=1800000');
    expect(dockerfile).toContain(
      'node scripts/build-command-heartbeat.mjs -- \\\n      node node_modules/typescript/bin/tsc'
    );
    expect(dockerfile).toContain(
      'COPY --from=deps /app/node_modules ./node_modules'
    );
    expect(dockerfile).not.toContain(
      'node scripts/build-command-heartbeat.mjs -- pnpm build:balancer'
    );
  });

  it('keeps a silent successful command observable', () => {
    const result = runHeartbeatCommand({
      commandArguments: ['-e', 'setTimeout(() => process.exit(0), 80)'],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      '[build-heartbeat] contract-test still running'
    );
  });

  it('preserves the command exit code', () => {
    const result = runHeartbeatCommand({
      commandArguments: ['-e', 'process.exit(7)'],
    });

    expect(result.status).toBe(7);
  });

  it('terminates the complete command tree at the scoped timeout', () => {
    const result = runHeartbeatCommand({
      commandArguments: [
        '-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
      ],
      environment: {
        UNDERCHAT_COMMAND_TIMEOUT_MS: '80',
      },
    });

    expect(result.status).toBe(124);
    expect(result.stderr).toContain(
      '[build-heartbeat] contract-test exceeded 1s; terminating process tree'
    );
  });
});
