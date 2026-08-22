import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { lstat, opendir } from 'fs/promises';
import { relative, resolve, sep } from 'path';

export interface LegacySessionVolumeSnapshotProof {
  checksumSha256: string;
  sizeBytes: number;
  recordCount: number;
}

interface LegacySessionVolumeSnapshotRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const isTransientSnapshotFilesystemError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );

/**
 * A stopped Chromium process can finish deleting one ephemeral directory just
 * after its termination was confirmed. Retry only that narrow ENOENT race;
 * integrity, symlink and special-file failures remain immediate/fail-closed.
 */
export const retryLegacySessionVolumeSnapshot = async (
  snapshot: () => Promise<LegacySessionVolumeSnapshotProof>,
  options: LegacySessionVolumeSnapshotRetryOptions = {}
): Promise<LegacySessionVolumeSnapshotProof> => {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 250));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await snapshot();
    } catch (error) {
      if (
        attempt >= maxAttempts ||
        !isTransientSnapshotFilesystemError(error)
      ) {
        throw error;
      }
      if (retryDelayMs > 0) {
        await new Promise<void>((resolveDelay) => {
          setTimeout(resolveDelay, retryDelayMs);
        });
      }
    }
  }

  throw new Error('legacy_session_snapshot_retry_exhausted');
};

const hashFile = async (
  hash: ReturnType<typeof createHash>,
  filePath: string
): Promise<number> => {
  let size = 0;
  await new Promise<void>((resolveStream, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('end', resolveStream);
    stream.on('error', reject);
  });
  return size;
};

/**
 * Produces a deterministic proof without serializing session bytes. Symlinks
 * and special files fail closed so a crafted volume cannot escape its root.
 */
export const snapshotLegacySessionVolume = async (
  rootInput = '/app/data'
): Promise<LegacySessionVolumeSnapshotProof> => {
  const root = resolve(rootInput);
  const files: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      break;
    }
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const absolute = resolve(directory, entry.name);
      if (!absolute.startsWith(`${root}${sep}`)) {
        throw new Error('legacy_session_snapshot_path_escape');
      }
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        throw new Error('legacy_session_snapshot_symlink_forbidden');
      }
      if (metadata.isDirectory()) {
        pending.push(absolute);
      } else if (metadata.isFile()) {
        files.push(absolute);
      } else {
        throw new Error('legacy_session_snapshot_special_file_forbidden');
      }
    }
  }

  files.sort((first, second) => first.localeCompare(second));
  if (files.length === 0) {
    throw new Error('legacy_session_snapshot_empty');
  }

  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of files) {
    const path = relative(root, file).split(sep).join('/');
    const pathBytes = Buffer.from(path, 'utf8');
    hash.update(Buffer.from(`${pathBytes.length}:`, 'ascii'));
    hash.update(pathBytes);
    hash.update(Buffer.from(':', 'ascii'));
    sizeBytes += await hashFile(hash, file);
    hash.update(Buffer.from('\n', 'ascii'));
  }

  return {
    checksumSha256: hash.digest('hex'),
    sizeBytes,
    recordCount: files.length,
  };
};
