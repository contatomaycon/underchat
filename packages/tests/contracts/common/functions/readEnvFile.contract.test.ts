import { promises as fs } from 'node:fs';
import { readEnvFile } from '@core/common/functions/readEnvFile';

describe('readEnvFile', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads file and escapes shell-sensitive characters', async () => {
    const content = 'A=1\nB="x"`y`$z\\k';
    jest.spyOn(fs, 'readFile').mockResolvedValue(content as never);
    const expected = content
      .split('\n')
      .map((line) => line.replaceAll(/(["`\\$])/g, String.raw`\$1`))
      .join(String.raw`\n`);

    await expect(readEnvFile('/tmp/.env')).resolves.toBe(expected);
  });

  it('falls back to process env when file does not exist', async () => {
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' });
    jest.spyOn(fs, 'readFile').mockRejectedValue(enoent);
    const entriesSpy = jest.spyOn(Object, 'entries').mockReturnValue([
      ['TEST_READ_ENV_FILE', 'value$1'],
      ['TEST_READ_ENV_FILE_UNDEFINED', undefined],
    ] as never);

    try {
      const result = await readEnvFile('/tmp/missing.env');
      expect(result).toContain('TEST_READ_ENV_FILE=value\\$1');
      expect(result).not.toContain('TEST_READ_ENV_FILE_UNDEFINED=');
    } finally {
      entriesSpy.mockRestore();
    }
  });

  it('logs and rethrows non-ENOENT errors', async () => {
    const boom = new Error('boom');
    jest.spyOn(fs, 'readFile').mockRejectedValue(boom);
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(readEnvFile('/tmp/fail.env')).rejects.toBe(boom);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Erro ao ler o arquivo /tmp/fail.env:',
        boom
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('treats empty file as error and rethrows', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue('' as never);
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(readEnvFile('/tmp/empty.env')).rejects.toThrow(
        'File /tmp/empty.env is empty'
      );
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
