import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export class BaileysLegacyVolumeMigrationError extends Error {
  readonly code: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'BaileysLegacyVolumeMigrationError';
    this.code = `ERR_${reason.toUpperCase()}`;
    Object.setPrototypeOf(this, BaileysLegacyVolumeMigrationError.prototype);
  }
}

const fail = (code: string): never => {
  throw new BaileysLegacyVolumeMigrationError(code);
};

const assertDirectory = async (directory: string): Promise<void> => {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail('legacy_session_migration_layout_invalid');
  }
};

const readJsonFiles = async (
  directory: string
): Promise<Record<string, string>> => {
  await assertDirectory(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length === 0) {
    fail('legacy_session_migration_layout_empty');
  }

  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (
      entry.isSymbolicLink() ||
      !entry.isFile() ||
      !entry.name.endsWith('.json')
    ) {
      fail('legacy_session_migration_layout_invalid');
    }
    files[entry.name] = await readFile(resolve(directory, entry.name), 'utf8');
  }
  return files;
};

/**
 * Resolves the two Baileys legacy-volume layouts that exist in production.
 *
 * Older dedicated volumes contain the multi-file auth JSON files at their
 * root. Current workers mount the whole `/app/data` volume, so those files are
 * under `storage/<worker-id>`. The migration must never choose a directory by
 * heuristics: a mixed volume, another worker or any extra entry is ambiguous
 * and therefore rejected fail-closed.
 */
export const readBaileysLegacyVolumeAuthFiles = async (
  rootInput: string,
  workerId: string
): Promise<Record<string, string>> => {
  const root = resolve(rootInput);
  await assertDirectory(root);

  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length === 0) {
    fail('legacy_session_migration_layout_empty');
  }

  const isFlatLayout = entries.every(
    (entry) =>
      !entry.isSymbolicLink() && entry.isFile() && entry.name.endsWith('.json')
  );
  if (isFlatLayout) {
    return readJsonFiles(root);
  }

  if (
    entries.length !== 1 ||
    entries[0]?.name !== 'storage' ||
    entries[0].isSymbolicLink() ||
    !entries[0].isDirectory()
  ) {
    fail('legacy_session_migration_layout_invalid');
  }

  const normalizedWorkerId = workerId.trim();
  const storageRoot = resolve(root, 'storage');
  const workerRoot = resolve(storageRoot, normalizedWorkerId);
  if (
    !normalizedWorkerId ||
    workerRoot === storageRoot ||
    !workerRoot.startsWith(`${storageRoot}${sep}`)
  ) {
    fail('legacy_session_migration_context_invalid');
  }

  await assertDirectory(storageRoot);
  const storageEntries = await readdir(storageRoot, { withFileTypes: true });
  if (
    storageEntries.length !== 1 ||
    storageEntries[0]?.name !== normalizedWorkerId ||
    storageEntries[0].isSymbolicLink() ||
    !storageEntries[0].isDirectory()
  ) {
    fail('legacy_session_migration_layout_invalid');
  }

  return readJsonFiles(workerRoot);
};
