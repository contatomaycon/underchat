import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';

describe('KafkaBaileysQueueService', () => {
  it('builds all worker topics and delegates ensure/delete/close', async () => {
    const createTopics = jest.fn(async () => undefined);
    const deleteTopics = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);

    const service = new KafkaBaileysQueueService({
      createTopics,
      deleteTopics,
      close,
    } as never);

    const topics = service.all('w1');
    expect(topics).toEqual([
      'worker.w1.send.message',
      'worker.w1.schedule.send.message',
      'worker.w1.validate.phone',
      'worker.w1.notification.message',
      'worker.w1.webhook.integration',
    ]);
    expect(service.userPhoneJidUpdate()).toBe('user.phone.jid.update');

    await expect(service.ensure('w1')).resolves.toBeUndefined();
    expect(createTopics).toHaveBeenCalledWith(topics, 1, 2);

    await expect(service.delete('w1')).resolves.toBeUndefined();
    expect(deleteTopics).toHaveBeenCalledWith(topics);

    await expect(service.close()).resolves.toBeUndefined();
  });
});
