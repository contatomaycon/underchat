import {
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
