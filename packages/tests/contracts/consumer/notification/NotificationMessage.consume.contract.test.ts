import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { NotificationMessageConsume } from '@core/consumer/notification/NotificationMessage.consume';

describe('NotificationMessageConsume assignment fencing', () => {
  it('uses the producer operation id or a stable physical Kafka identity', () => {
    const consumer = Object.create(NotificationMessageConsume.prototype) as any;

    expect(
      consumer.resolveOperationId(
        {
          notification_type_id: 'notification-type-1',
          account_id: 'account-1',
          operation_id: ' operation-1 ',
        },
        'notification.message',
        2,
        41
      )
    ).toBe('operation-1');
    expect(
      consumer.resolveOperationId(
        {
          notification_type_id: 'notification-type-1',
          account_id: 'account-1',
        },
        'notification.message',
        2,
        41
      )
    ).toBe('notification_message_v1:notification.message:2:41');
  });

  it('checks assignment authorization immediately before notification delivery', async () => {
    const sendNotificationMessage = jest.fn(async () => undefined);
    const consumer = Object.create(NotificationMessageConsume.prototype) as any;
    consumer.notificationMessageService = { sendNotificationMessage };
    const assertActive = jest.fn();

    await consumer.processNotificationMessage(
      {
        notification_type_id: 'notification-type-1',
        account_id: 'account-1',
        operation_id: 'operation-1',
      },
      assertActive
    );

    expect(assertActive).toHaveBeenCalledTimes(1);
    expect(sendNotificationMessage).toHaveBeenCalledWith(
      'notification-type-1',
      'account-1',
      assertActive,
      'operation-1'
    );
    expect(assertActive.mock.invocationCallOrder[0]).toBeLessThan(
      sendNotificationMessage.mock.invocationCallOrder[0]
    );
  });

  it('does not deliver a notification after assignment revocation', async () => {
    const sendNotificationMessage = jest.fn(async () => undefined);
    const consumer = Object.create(NotificationMessageConsume.prototype) as any;
    consumer.notificationMessageService = { sendNotificationMessage };
    const assertActive = jest.fn(() => {
      throw new KafkaConsumerDispatchRevokedError();
    });

    await expect(
      consumer.processNotificationMessage(
        {
          notification_type_id: 'notification-type-1',
          account_id: 'account-1',
          operation_id: 'operation-1',
        },
        assertActive
      )
    ).rejects.toBeInstanceOf(KafkaConsumerDispatchRevokedError);

    expect(sendNotificationMessage).not.toHaveBeenCalled();
  });

  it('propagates delivery failures so the runner can retry before committing', async () => {
    const deliveryError = new Error('temporary notification failure');
    const sendNotificationMessage = jest.fn(async () => {
      throw deliveryError;
    });
    const consumer = Object.create(NotificationMessageConsume.prototype) as any;
    consumer.notificationMessageService = { sendNotificationMessage };

    await expect(
      consumer.processNotificationMessage(
        {
          notification_type_id: 'notification-type-1',
          account_id: 'account-1',
          operation_id: 'operation-1',
        },
        () => undefined
      )
    ).rejects.toBe(deliveryError);
  });
});
