import {
  getConsumerOwnerKafkaHealthSnapshot,
  getManagedKafkaConsumerHealthSnapshot,
} from '@core/common/functions/kafkaConsumerHealth';

describe('kafkaConsumerHealth', () => {
  it('returns null for unmanaged consumers', () => {
    expect(getManagedKafkaConsumerHealthSnapshot({})).toBeNull();
    expect(getConsumerOwnerKafkaHealthSnapshot({ consumer: {} })).toBeNull();
  });

  it('extracts managed consumer health with owner name', () => {
    class Owner {
      consumer = {
        __health: () => ({
          group_id: 'group-1',
          topics: ['worker.w1.send.message'],
          connected: true,
          consuming: true,
          restart_count: 2,
          last_message_at: 10,
          last_commit_at: 20,
          last_restart_at: 30,
          last_error: '',
        }),
      };
    }

    expect(getConsumerOwnerKafkaHealthSnapshot(new Owner())).toEqual({
      owner: 'Owner',
      group_id: 'group-1',
      topics: ['worker.w1.send.message'],
      connected: true,
      consuming: true,
      restart_count: 2,
      last_message_at: 10,
      last_commit_at: 20,
      last_restart_at: 30,
      last_error: '',
    });
  });
});
