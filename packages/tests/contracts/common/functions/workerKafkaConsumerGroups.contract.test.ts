import { buildWorkerKafkaConsumerGroup } from '@core/common/functions/workerKafkaConsumerGroups';

describe('buildWorkerKafkaConsumerGroup', () => {
  it.each([
    ['send', 'group-underchat-send-worker-1'],
    ['schedule-message', 'group-underchat-schedule-message-worker-1'],
    ['validate-phone', 'group-underchat-validate-phone-worker-1'],
    ['notification-send', 'group-underchat-notification-send-worker-1'],
    ['webhook-integration', 'group-underchat-webhook-integration-worker-1'],
    ['mark-read', 'group-underchat-mark-read-worker-1'],
    ['worker-config-update', 'group-underchat-worker-config-update-worker-1'],
  ] as const)('builds the canonical %s group', (flow, expected) => {
    expect(buildWorkerKafkaConsumerGroup(flow, ' worker-1 ')).toBe(expected);
  });

  it('rejects an empty worker id', () => {
    expect(() => buildWorkerKafkaConsumerGroup('send', ' ')).toThrow(
      'worker_id_required_for_kafka_consumer_group'
    );
  });
});
