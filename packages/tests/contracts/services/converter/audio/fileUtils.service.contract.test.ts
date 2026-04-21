import { FileUtils } from '@core/services/converter/audio/fileUtils.service';
import { unlink } from 'node:fs/promises';

jest.mock('node:fs/promises', () => ({
  unlink: jest.fn(),
}));

describe('FileUtils', () => {
  it('safeUnlink calls unlink and resolves on success', async () => {
    (unlink as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(FileUtils.safeUnlink('/tmp/file')).resolves.toBeUndefined();
    expect(unlink).toHaveBeenCalledWith('/tmp/file');
  });

  it('safeUnlink swallows unlink errors', async () => {
    (unlink as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    await expect(FileUtils.safeUnlink('/tmp/file')).resolves.toBeUndefined();
  });
});
