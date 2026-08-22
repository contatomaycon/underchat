import 'reflect-metadata';

jest.mock('@core/plugins/kafkaStreams', () => ({}));
jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class KafkaConsumerRunner {},
}));
jest.mock('@core/config/environments', () => ({
  baileysEnvironment: { baileysWorkerId: 'worker-1' },
  wwebjsEnvironment: { wwebjsWorkerId: 'worker-1' },
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));
jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class StreamProducerService {},
}));
jest.mock('@core/services/baileys', () => ({
  BaileysService: class BaileysService {},
}));
jest.mock('@core/services/wwebjs', () => ({
  WwebjsService: class WwebjsService {},
}));
jest.mock('@core/services/baileys/methods/incoming.service', () => ({
  BaileysIncomingMessageService: class BaileysIncomingMessageService {},
}));
jest.mock('@core/services/wwebjs/methods/incoming.service', () => ({
  WwebjsIncomingMessageService: class WwebjsIncomingMessageService {},
}));

import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { PhoneValidationConsume } from '@core/consumer/phoneValidation/PhoneValidation.consume';
import { PhoneValidationResponseConsume } from '@core/consumer/phoneValidation/PhoneValidationResponse.consume';
import { PhoneValidationWwebjsConsume } from '@core/consumer/phoneValidation/PhoneValidationWwebjs.consume';

const request = {
  request_id: 'request-1',
  account_id: 'account-1',
  worker_id: 'worker-1',
  phone_ddi: '55',
  phone: '11999999999',
};

type WorkerConsumerConstructor =
  typeof PhoneValidationConsume | typeof PhoneValidationWwebjsConsume;

function makeWorkerConsumer(
  Consumer: WorkerConsumerConstructor,
  validatePhone: jest.Mock
) {
  const consumer = Object.create(Consumer.prototype) as any;
  const send = jest.fn(async () => undefined);
  const provider = { validatePhone };

  consumer.baileysService = provider;
  consumer.wwebjsService = provider;
  const connectionScope = {
    worker_id: 'worker-1',
    source_provider: Consumer === PhoneValidationConsume ? 'baileys' : 'wwebjs',
    runtime_generation: 11,
    connection_epoch: 'connection-11',
    activated_at: Date.now(),
  };
  const incomingMessageService = {
    captureActiveConnectionScope: jest.fn(async () => connectionScope),
  };
  consumer.baileysIncomingMessageService = incomingMessageService;
  consumer.wwebjsIncomingMessageService = incomingMessageService;
  consumer.streamProducerService = { send };
  consumer.kafkaServiceQueueService = {
    phoneValidationResponse: jest.fn(() => 'phone.validation.response'),
  };

  return { consumer, send, validatePhone, incomingMessageService };
}

describe.each([
  ['Baileys', PhoneValidationConsume],
  ['WWebJS', PhoneValidationWwebjsConsume],
] as const)('%s phone validation consumer', (_providerName, Consumer) => {
  it('preserves a real invalid result and publishes it with the request id key', async () => {
    const validatePhone = jest.fn(async () => ({ valid: false }));
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);
    const assertActive = jest.fn();

    await consumer.processValidation(request, assertActive);

    expect(validatePhone).toHaveBeenCalledWith('55', '11999999999');
    expect(send).toHaveBeenCalledWith(
      'phone.validation.response',
      {
        request_id: 'request-1',
        account_id: 'account-1',
        worker_id: 'worker-1',
        valid: false,
        jid: null,
        phone: null,
        source_provider:
          Consumer === PhoneValidationConsume ? 'baileys' : 'wwebjs',
        runtime_generation: 11,
        connection_epoch: 'connection-11',
      },
      'request-1',
      undefined,
      expect.any(Function)
    );
    expect(assertActive).toHaveBeenCalledTimes(6);
    expect(assertActive.mock.invocationCallOrder[0]).toBeLessThan(
      validatePhone.mock.invocationCallOrder[0]
    );
    expect(assertActive.mock.invocationCallOrder[3]).toBeLessThan(
      send.mock.invocationCallOrder[0]
    );
  });

  it('keeps an invalid request response for a missing DDI', async () => {
    const validatePhone = jest.fn(async () => ({ valid: true }));
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);
    const assertActive = jest.fn();

    await consumer.processValidation(
      { ...request, phone_ddi: null },
      assertActive
    );

    expect(validatePhone).not.toHaveBeenCalled();
    expect(assertActive).toHaveBeenCalledTimes(6);
    expect(send).toHaveBeenCalledWith(
      'phone.validation.response',
      expect.objectContaining({
        request_id: 'request-1',
        valid: false,
        error: 'DDI is required for phone validation',
      }),
      'request-1',
      undefined,
      expect.any(Function)
    );
  });

  it('does not call the provider after assignment revocation', async () => {
    const validatePhone = jest.fn(async () => ({ valid: true }));
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest.fn(() => {
      throw revoked;
    });

    await expect(
      consumer.processValidation(request, assertActive)
    ).rejects.toBe(revoked);

    expect(validatePhone).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not publish when assignment is revoked after provider validation', async () => {
    const validatePhone = jest.fn(async () => ({
      valid: true,
      jid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
    }));
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest
      .fn<void, []>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw revoked;
      });

    await expect(
      consumer.processValidation(request, assertActive)
    ).rejects.toBe(revoked);

    expect(validatePhone).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not publish a validation result from a replaced connection', async () => {
    const validatePhone = jest.fn(async () => ({
      valid: true,
      jid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
    }));
    const { consumer, send, incomingMessageService } = makeWorkerConsumer(
      Consumer,
      validatePhone
    );
    incomingMessageService.captureActiveConnectionScope
      .mockResolvedValueOnce({
        worker_id: 'worker-1',
        source_provider:
          Consumer === PhoneValidationConsume ? 'baileys' : 'wwebjs',
        runtime_generation: 11,
        connection_epoch: 'connection-11',
        activated_at: Date.now(),
      })
      .mockResolvedValue({
        worker_id: 'worker-1',
        source_provider:
          Consumer === PhoneValidationConsume ? 'baileys' : 'wwebjs',
        runtime_generation: 11,
        connection_epoch: 'connection-12',
        activated_at: Date.now(),
      });

    await expect(
      consumer.processValidation(request, () => undefined)
    ).rejects.toThrow('Phone validation runtime is stale');

    expect(validatePhone).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates a technical provider failure instead of reporting valid false', async () => {
    const providerError = new Error('provider temporarily unavailable');
    const validatePhone = jest.fn(async () => {
      throw providerError;
    });
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);

    await expect(
      consumer.processValidation(request, () => undefined)
    ).rejects.toBe(providerError);

    expect(send).not.toHaveBeenCalled();
  });

  it('propagates an ambiguous producer failure without emitting a false response', async () => {
    const validatePhone = jest.fn(async () => ({
      valid: true,
      jid: '5511999999999@s.whatsapp.net',
      phone: '5511999999999',
    }));
    const producerError = new Error('delivery acknowledgement was lost');
    const accepted: unknown[][] = [];
    const { consumer, send } = makeWorkerConsumer(Consumer, validatePhone);
    send.mockImplementation(async (...args: unknown[]) => {
      accepted.push(args);
      throw producerError;
    });

    await expect(
      consumer.processValidation(request, () => undefined)
    ).rejects.toBe(producerError);

    expect(accepted).toEqual([
      [
        'phone.validation.response',
        {
          request_id: 'request-1',
          account_id: 'account-1',
          worker_id: 'worker-1',
          valid: true,
          jid: '5511999999999@s.whatsapp.net',
          phone: '5511999999999',
          source_provider:
            Consumer === PhoneValidationConsume ? 'baileys' : 'wwebjs',
          runtime_generation: 11,
          connection_epoch: 'connection-11',
        },
        'request-1',
        undefined,
        expect.any(Function),
      ],
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneValidationResponseConsume', () => {
  function makeResponseConsumer(set: jest.Mock) {
    const consumer = Object.create(
      PhoneValidationResponseConsume.prototype
    ) as any;
    consumer.runtimeFence = { setValueIfCurrent: set };
    return consumer;
  }

  const response = {
    request_id: 'request-1',
    account_id: 'account-1',
    worker_id: 'worker-1',
    valid: true,
    jid: '5511999999999@s.whatsapp.net',
    phone: '5511999999999',
    source_provider: 'baileys',
    runtime_generation: 11,
    connection_epoch: 'connection-11',
  };

  it('atomically writes only while the runtime fence is current', async () => {
    const set = jest.fn(async () => true);
    const consumer = makeResponseConsumer(set);
    const assertActive = jest.fn();

    await consumer.processResponse(response, assertActive);

    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(assertActive.mock.invocationCallOrder[0]).toBeLessThan(
      set.mock.invocationCallOrder[0]
    );
    expect(set).toHaveBeenCalledWith(
      response,
      'phone_validation:request-1',
      JSON.stringify(response),
      30
    );
  });

  it('does not write a response after assignment revocation', async () => {
    const set = jest.fn(async () => true);
    const consumer = makeResponseConsumer(set);
    const revoked = new KafkaConsumerDispatchRevokedError();

    await expect(
      consumer.processResponse(response, () => {
        throw revoked;
      })
    ).rejects.toBe(revoked);

    expect(set).not.toHaveBeenCalled();
  });

  it('discards a response produced by a replaced connection', async () => {
    const set = jest.fn(async () => true);
    const consumer = makeResponseConsumer(set);
    consumer.runtimeFence.setValueIfCurrent.mockResolvedValueOnce(false);

    await consumer.processResponse(response, jest.fn());

    expect(set).toHaveBeenCalledTimes(1);
  });

  it('propagates Redis failures so the runner cannot commit the response', async () => {
    const redisError = new Error('Redis unavailable');
    const set = jest.fn(async () => {
      throw redisError;
    });
    const consumer = makeResponseConsumer(set);

    await expect(
      consumer.processResponse(response, () => undefined)
    ).rejects.toBe(redisError);
  });
});
