import { unlink } from 'node:fs/promises';

export class FileUtils {
  static async safeUnlink(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {}
  }
}
