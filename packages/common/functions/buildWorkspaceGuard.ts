import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type TBuildWorkspacePreflightErrorCode =
  | 'BUILD_WORKSPACE_CAPACITY'
  | 'BUILD_WORKSPACE_INODES'
  | 'BUILD_WORKSPACE_NOT_WRITABLE';

export class BuildWorkspacePreflightError extends Error {
  constructor(
    readonly code: TBuildWorkspacePreflightErrorCode,
    message: string
  ) {
    super(`${code}: ${message}`);
    this.name = 'BuildWorkspacePreflightError';
  }
}

export interface IBuildWorkspaceCapacity {
  availableBytes: bigint;
  availableInodes: bigint | null;
}

interface IEnsureBuildWorkspaceReadyInput {
  workspaceParent: string;
  minFreeBytes: number;
  minFreeInodes: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: bigint): string {
  const gibibytes = Number(bytes) / (1024 * 1024 * 1024);
  return `${gibibytes.toFixed(2)} GiB`;
}

function runWriteProbe(workspaceParent: string): void {
  const probePath = path.join(
    workspaceParent,
    `.underchat-build-write-probe-${process.pid}-${randomUUID()}`
  );
  let descriptor: number | null = null;

  try {
    descriptor = fs.openSync(probePath, 'wx', 0o600);
    fs.writeSync(descriptor, Buffer.from([0]));
    fs.fsyncSync(descriptor);
  } catch (error) {
    throw new BuildWorkspacePreflightError(
      'BUILD_WORKSPACE_NOT_WRITABLE',
      `Cannot durably write to ${workspaceParent}: ${getErrorMessage(error)}`
    );
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }

    try {
      fs.rmSync(probePath, { force: true });
    } catch {}
  }
}

function getWorkspaceCapacity(
  workspaceParent: string
): IBuildWorkspaceCapacity {
  try {
    fs.mkdirSync(workspaceParent, { recursive: true });

    const stats = fs.statfsSync(workspaceParent, { bigint: true });
    return {
      availableBytes: stats.bavail * stats.bsize,
      availableInodes: stats.ffree >= 0n ? stats.ffree : null,
    };
  } catch (error) {
    throw new BuildWorkspacePreflightError(
      'BUILD_WORKSPACE_NOT_WRITABLE',
      `Cannot prepare or inspect ${workspaceParent}: ${getErrorMessage(error)}`
    );
  }
}

export function ensureBuildWorkspaceReady(
  input: IEnsureBuildWorkspaceReadyInput
): IBuildWorkspaceCapacity {
  const { availableBytes, availableInodes } = getWorkspaceCapacity(
    input.workspaceParent
  );

  if (availableBytes < BigInt(input.minFreeBytes)) {
    throw new BuildWorkspacePreflightError(
      'BUILD_WORKSPACE_CAPACITY',
      `${input.workspaceParent} has ${formatBytes(availableBytes)} free; ` +
        `at least ${formatBytes(BigInt(input.minFreeBytes))} is required before checkout`
    );
  }

  if (
    availableInodes !== null &&
    availableInodes < BigInt(input.minFreeInodes)
  ) {
    throw new BuildWorkspacePreflightError(
      'BUILD_WORKSPACE_INODES',
      `${input.workspaceParent} has ${availableInodes.toString()} free inodes; ` +
        `at least ${input.minFreeInodes} is required before checkout`
    );
  }

  runWriteProbe(input.workspaceParent);

  return {
    availableBytes,
    availableInodes,
  };
}

export function isBuildWorkspaceStorageFailure(error: unknown): boolean {
  const normalized = getErrorMessage(error).toLowerCase();
  const storageFailureMarkers = [
    'build_workspace_capacity',
    'build_workspace_inodes',
    'build_workspace_not_writable',
    'enospc',
    'edquot',
    'erofs',
    'no space left on device',
    'disk quota exceeded',
    'read-only file system',
    'unable to write file',
    'unable to checkout working tree',
  ];

  return storageFailureMarkers.some((marker) => normalized.includes(marker));
}

export function appendBuildWorkspaceStorageHint(error: unknown): string {
  const message = getErrorMessage(error);
  if (!isBuildWorkspaceStorageFailure(error)) {
    return message;
  }

  return (
    `${message}\nHint: the build workspace filesystem ran out of writable ` +
    'capacity, inodes, or quota. Free the configured BUILD_GIT_CLONE_DIR ' +
    'or move it to a disk-backed volume before retrying.'
  );
}
