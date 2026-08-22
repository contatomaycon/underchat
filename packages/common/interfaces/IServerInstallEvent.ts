export const serverInstallStageIds = [
  'queued',
  'packages',
  'docker',
  'images',
  'worker_baileys',
  'worker_wwebjs',
  'worker_meow',
  'balance',
  'health',
] as const;

export type ServerInstallStageId = (typeof serverInstallStageIds)[number];

export type ServerInstallStageStatus =
  'pending' | 'running' | 'complete' | 'error';

export type ServerInstallStatus =
  'queued' | 'running' | 'complete' | 'error' | 'canceled';

export type ServerInstallEventType = 'output' | 'stage' | 'lifecycle';

export const serverInstallStageMarkerPrefix = '__UNDERCHAT_INSTALL_STAGE__:';

export function buildServerInstallStageMarker(
  stage: ServerInstallStageId,
  status: Extract<ServerInstallStageStatus, 'running' | 'complete'>
): string {
  return `${serverInstallStageMarkerPrefix}${stage}:${status}`;
}

export function parseServerInstallStageMarker(value: string): {
  stage: ServerInstallStageId;
  status: Extract<ServerInstallStageStatus, 'running' | 'complete'>;
} | null {
  const normalized = value.trim();
  if (!normalized.startsWith(serverInstallStageMarkerPrefix)) {
    return null;
  }

  const [stage, status] = normalized
    .slice(serverInstallStageMarkerPrefix.length)
    .split(':');

  if (
    !serverInstallStageIds.includes(stage as ServerInstallStageId) ||
    (status !== 'running' && status !== 'complete')
  ) {
    return null;
  }

  return {
    stage: stage as ServerInstallStageId,
    status,
  };
}
