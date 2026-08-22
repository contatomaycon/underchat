import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WWEBJS_PROFILE_FINGERPRINT_FILE = '.wwebjs-profile-fingerprint';

/**
 * Copies a retired legacy Chromium profile to a private, writable directory.
 *
 * The source volume remains read-only during migration. PostgreSQL revisions,
 * however, bind their profile artifact to a revision-specific fingerprint.
 * A fingerprint copied from an earlier revision is therefore never trusted:
 * the native store creates a new one in the isolated copy before checkpointing.
 */
export const withWritableWwebjsLegacyProfileCopy = async <Result>(
  sourceProfilePath: string,
  operation: (profilePath: string) => Promise<Result>
): Promise<Result> => {
  const source = await fs.promises.stat(sourceProfilePath).catch(() => null);
  if (!source?.isDirectory()) {
    throw new Error('legacy_session_migration_profile_missing');
  }

  const stagingRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'underchat-wwebjs-legacy-import-')
  );
  const stagingProfilePath = path.join(stagingRoot, 'profile');

  try {
    await fs.promises.cp(sourceProfilePath, stagingProfilePath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
    });
    await fs.promises.rm(
      path.join(stagingProfilePath, WWEBJS_PROFILE_FINGERPRINT_FILE),
      { force: true }
    );
    return await operation(stagingProfilePath);
  } finally {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true });
  }
};
