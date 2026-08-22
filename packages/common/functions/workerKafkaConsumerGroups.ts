export type WorkerKafkaConsumerFlow =
  | 'send'
  | 'schedule-message'
  | 'validate-phone'
  | 'notification-send'
  | 'webhook-integration'
  | 'mark-read'
  | 'worker-config-update';

const GROUP_PREFIX_BY_FLOW: Record<WorkerKafkaConsumerFlow, string> = {
  send: 'group-underchat-send',
  'schedule-message': 'group-underchat-schedule-message',
  'validate-phone': 'group-underchat-validate-phone',
  'notification-send': 'group-underchat-notification-send',
  'webhook-integration': 'group-underchat-webhook-integration',
  'mark-read': 'group-underchat-mark-read',
  'worker-config-update': 'group-underchat-worker-config-update',
};

const LEGACY_WORKER_GROUP_PREFIXES = [
  'group-underchat-whatsmeow-send',
  'group-underchat-schedule-message-whatsmeow',
  'group-underchat-whatsmeow-validate-phone',
  'group-underchat-whatsmeow-notification-send',
  'group-underchat-webhook-integration-whatsmeow',
  'group-underchat-mark-read-whatsmeow',
  'group-underchat-worker-config-update-whatsmeow',
  'group-underchat-baileys-send',
  'group-underchat-wwebjs-send',
  'group-underchat-schedule-message-wwebjs',
  'group-underchat-baileys-validate-phone',
  'group-underchat-wwebjs-validate-phone',
  'group-underchat-baileys-notification-send',
  'group-underchat-wwebjs-notification-send',
  'group-underchat-webhook-integration-wwebjs',
  'group-underchat-mark-read-wwebjs',
  'group-underchat-worker-config-update-wwebjs',
] as const;

export function buildWorkerKafkaConsumerGroup(
  flow: WorkerKafkaConsumerFlow,
  workerId: string
): string {
  const normalizedWorkerId = workerId.trim();
  if (!normalizedWorkerId) {
    throw new Error('worker_id_required_for_kafka_consumer_group');
  }

  return `${GROUP_PREFIX_BY_FLOW[flow]}-${normalizedWorkerId}`;
}

export function workerKafkaConsumerGroupsForDeletion(
  workerId: string
): string[] {
  const normalizedWorkerId = workerId.trim();
  if (!normalizedWorkerId) {
    throw new Error('worker_id_required_for_kafka_consumer_group');
  }
  return Array.from(
    new Set([
      ...Object.values(GROUP_PREFIX_BY_FLOW).map(
        (prefix) => `${prefix}-${normalizedWorkerId}`
      ),
      ...LEGACY_WORKER_GROUP_PREFIXES.map(
        (prefix) => `${prefix}-${normalizedWorkerId}`
      ),
    ])
  );
}
