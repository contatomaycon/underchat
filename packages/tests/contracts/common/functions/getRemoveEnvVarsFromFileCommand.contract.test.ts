import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPrepareExternalAppEnvFileCommand,
  getRemoveEnvVarsFromFileCommand,
  getUpsertEnvVarInFileCommand,
} from '@core/common/functions/getRemoveEnvVarsFromFileCommand';

describe('getRemoveEnvVarsFromFileCommand', () => {
  it('returns noop command when env var list is empty', () => {
    expect(getRemoveEnvVarsFromFileCommand('/tmp/.env', [])).toBe(':');
  });

  it('builds sed command with escaped key patterns and path', () => {
    const command = getRemoveEnvVarsFromFileCommand("/tmp/a'b.env", [
      'A+B',
      'DB.URL',
    ]);

    expect(command).toContain("sed -i -e '/^A\\+B=/d' -e '/^DB\\.URL=/d'");
    expect(command).toContain("'/tmp/a'\"'\"'b.env'");
  });
});

describe('getUpsertEnvVarInFileCommand', () => {
  it('returns noop when key is empty', () => {
    expect(getUpsertEnvVarInFileCommand('/tmp/.env', '', 'v')).toBe(':');
  });

  it('builds delete-and-append command with escaped key and value', () => {
    const command = getUpsertEnvVarInFileCommand(
      "/tmp/a'b.env",
      'DB.URL',
      "postgres://x?y='1'"
    );

    expect(command).toContain("sed -i -e '/^DB\\.URL=/d'");
    expect(command).toContain("'/tmp/a'\"'\"'b.env'");
    expect(command).toContain(
      "'DB.URL=postgres://x?y='\"'\"'1'\"'\"'' >> '/tmp/a'\"'\"'b.env'"
    );
  });
});

describe('getPrepareExternalAppEnvFileCommand', () => {
  it('promotes discrete public endpoints and removes every composite database URL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'underchat-external-env-'));
    const envFile = join(directory, '.env');
    writeFileSync(
      envFile,
      [
        'DB_PUBLIC_HOST_RW=public-postgres',
        'DB_PRIVATE_HOST_RW=private-postgres',
        'DB_HOST_RW=stale-postgres',
        'DB_PUBLIC_DATABASE_URL=postgres://public-secret',
        'DB_PRIVATE_DATABASE_URL=postgres://private-secret',
        'DB_DATABASE_URL=postgres://legacy-secret',
        'UNDERCHAT_ENV_SCOPE=private',
      ].join('\n') + '\n'
    );

    try {
      execFileSync('bash', [
        '-c',
        getPrepareExternalAppEnvFileCommand(envFile),
      ]);

      const prepared = readFileSync(envFile, 'utf8');
      expect(prepared).toContain('DB_PUBLIC_HOST_RW=public-postgres\n');
      expect(prepared).toContain('DB_HOST_RW=public-postgres\n');
      expect(prepared).toContain('UNDERCHAT_ENV_SCOPE=public\n');
      expect(prepared).not.toMatch(/^DB_(?:PUBLIC_|PRIVATE_)?DATABASE_URL=/mu);
      expect(prepared).not.toContain('DB_PRIVATE_HOST_RW=');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
