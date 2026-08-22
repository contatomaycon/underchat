import 'reflect-metadata';

const mockRunnerOptions: Array<Record<string, unknown>> = [];

jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class KafkaConsumerRunner {
    public consumer = {};

    constructor(options: Record<string, unknown>) {
      mockRunnerOptions.push(options);
    }

    async start(onConnected?: () => void): Promise<void> {
      onConnected?.();
    }

    async close(): Promise<void> {}
  },
}));

jest.mock('@core/common/functions/createI18nInstance', () => ({
  createI18nInstance: jest.fn(async () => jest.fn((key: string) => key)),
}));

import { ConfigChannelsRecreateAllConsume } from '@core/consumer/config/ConfigChannelsRecreateAll.consume';
import type { IConfigChannelsRecreateAllPayload } from '@core/common/interfaces/IConfigChannelsRecreateAllPayload';
import type {
  KafkaConsumerRunnerContext,
  KafkaConsumerRunnerOptions,
} from '@core/common/interfaces/KafkaConsumerRunnerOptions';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

type CapturedOptions =
  KafkaConsumerRunnerOptions<IConfigChannelsRecreateAllPayload>;

const REQUESTER_ACCOUNT_ID = '019fb6d4-432b-7000-8000-000000000010';
const FILTER_ACCOUNT_ID = '019fb6d4-432b-7000-8000-000000000011';

function makeContext(
  payload: IConfigChannelsRecreateAllPayload,
  assertActive: () => void
): KafkaConsumerRunnerContext<IConfigChannelsRecreateAllPayload> {
  return {
    topic: 'config.channels.recreate.all',
    groupId: 'group-underchat-config-channels-recreate-all',
    message: {
      value: Buffer.from(JSON.stringify(payload)),
      partition: 2,
      offset: 17,
    },
    partition: 2,
    offset: 17,
    kafkaKey: payload.account_id,
    entityKey: payload.account_id,
    attempt: 1,
    payload,
    isActive: () => true,
    assertActive,
  };
}

function createConsumer() {
  const kafkaServiceQueueService = {
    configChannelsRecreateAll: jest.fn(() => 'config.channels.recreate.all'),
  };
  const plannerService = {
    prepare: jest.fn(async () => ({
      batchId: '019fb6d4-432b-7000-8000-000000000001',
      created: true,
      targetCount: 4,
    })),
  };
  const executorService = {
    start: jest.fn(),
    kick: jest.fn(),
    close: jest.fn(async () => undefined),
  };
  const centrifugoService = {
    publish: jest.fn(async () => undefined),
  };
  const consumer = new ConfigChannelsRecreateAllConsume(
    {} as never,
    kafkaServiceQueueService as never,
    plannerService as never,
    executorService as never,
    centrifugoService as never
  );

  return {
    consumer,
    plannerService,
    executorService,
    centrifugoService,
  };
}

describe('ConfigChannelsRecreateAllConsume', () => {
  beforeEach(() => {
    mockRunnerOptions.length = 0;
    jest.clearAllMocks();
  });

  it('serializes bulk requests per account and wires bounded failure handling', async () => {
    const { consumer, executorService } = createConsumer();

    await consumer.execute();

    expect(mockRunnerOptions).toHaveLength(1);
    expect(mockRunnerOptions[0]).toMatchObject({
      groupId: 'group-underchat-config-channels-recreate-all',
      preserveEntityOrder: true,
      maxRetries: 1,
      classifyError: expect.any(Function),
      shouldContinueRetryWithoutCommit: expect.any(Function),
      onFailed: expect.any(Function),
      onDiscarded: expect.any(Function),
    });
    expect(executorService.start).toHaveBeenCalledTimes(1);
  });

  it('durably snapshots the bulk request and returns without waiting for target recreations', async () => {
    const { consumer, plannerService, executorService, centrifugoService } =
      createConsumer();
    const payload: IConfigChannelsRecreateAllPayload = {
      request_id: '019fb6d4-432b-7000-8000-000000000002',
      account_id: REQUESTER_ACCOUNT_ID,
      session_storage: EWorkerSessionStorage.postgres,
      name: 'Channel',
    };
    const assertActive = jest.fn();

    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;
    await options.handle(payload, makeContext(payload, assertActive));

    expect(plannerService.prepare).toHaveBeenCalledWith(
      expect.any(Function),
      {
        requestId: '019fb6d4-432b-7000-8000-000000000002',
        topic: 'config.channels.recreate.all',
        partition: 2,
        offset: 17,
        accountId: REQUESTER_ACCOUNT_ID,
      },
      {
        status: undefined,
        type: undefined,
        session_storage: EWorkerSessionStorage.postgres,
        account: undefined,
        name: 'Channel',
        number: undefined,
      },
      { assertActive }
    );
    expect(executorService.kick).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publish).not.toHaveBeenCalled();
    expect(assertActive).toHaveBeenCalled();
  });

  it('does not publish completion from a revoked assignment', async () => {
    const { consumer, plannerService, centrifugoService } = createConsumer();
    const payload: IConfigChannelsRecreateAllPayload = {
      account_id: REQUESTER_ACCOUNT_ID,
    };
    const revoked = new KafkaConsumerDispatchRevokedError();
    const assertActive = jest.fn(() => {
      throw revoked;
    });

    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;

    await expect(
      options.handle(payload, makeContext(payload, assertActive))
    ).rejects.toBe(revoked);
    expect(plannerService.prepare).not.toHaveBeenCalled();
    expect(centrifugoService.publish).not.toHaveBeenCalled();
  });

  it('derives a stable request id from the Kafka identity for legacy payloads', async () => {
    const { consumer, plannerService } = createConsumer();
    const payload: IConfigChannelsRecreateAllPayload = {
      account_id: REQUESTER_ACCOUNT_ID,
    };

    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;
    await options.handle(payload, makeContext(payload, jest.fn()));
    await options.handle(payload, makeContext(payload, jest.fn()));

    const calls = plannerService.prepare.mock.calls as unknown as Array<
      [unknown, { requestId: string }]
    >;
    const firstSource = calls[0]?.[1];
    const secondSource = calls[1]?.[1];
    if (!firstSource || !secondSource) {
      throw new Error('Expected both planner calls to capture a source');
    }
    expect(firstSource.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(secondSource.requestId).toBe(firstSource.requestId);
  });

  it('publishes a single terminal error when an active bulk request is discarded', async () => {
    const { consumer, centrifugoService } = createConsumer();
    const payload: IConfigChannelsRecreateAllPayload = {
      account_id: REQUESTER_ACCOUNT_ID,
    };
    const assertActive = jest.fn();
    const context = makeContext(payload, assertActive);

    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;
    await options.onDiscarded?.(
      payload,
      context,
      new Error('failed'),
      'retry_exhausted'
    );

    expect(centrifugoService.publish).toHaveBeenCalledWith(expect.any(String), {
      type: 'recreate_all_completed',
      account_id: REQUESTER_ACCOUNT_ID,
      success: 0,
      errors: 1,
    });
    expect(assertActive).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed poison payloads before they can enter infinite retry', async () => {
    const { consumer } = createConsumer();
    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;
    const parse = (payload: unknown) =>
      options.parse({
        value: Buffer.from(JSON.stringify(payload)),
        partition: 0,
        offset: 1,
      } as never);

    for (const malformed of [
      null,
      [],
      {},
      { account_id: 123 },
      { account_id: 'not-a-uuid' },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        request_id: 123,
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        request_id: 'not-a-uuid',
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        status: 'unknown-status',
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        type: 'unknown-type',
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        session_storage: 'unknown-session-storage',
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        account: 'not-a-uuid',
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        name: 123,
      },
      {
        account_id: REQUESTER_ACCOUNT_ID,
        number: false,
      },
    ]) {
      expect(parse(malformed)).toBeNull();
    }
  });

  it('accepts and normalizes a fully validated bulk payload', async () => {
    const { consumer } = createConsumer();
    await consumer.execute();
    const options = mockRunnerOptions[0] as unknown as CapturedOptions;

    expect(
      options.parse({
        value: Buffer.from(
          JSON.stringify({
            account_id: ` ${REQUESTER_ACCOUNT_ID} `,
            request_id: ' 019fb6d4-432b-7000-8000-000000000012 ',
            status: EWorkerStatus.online,
            type: EWorkerType.whatsmeow,
            session_storage: EWorkerSessionStorage.legacy_volume,
            account: ` ${FILTER_ACCOUNT_ID} `,
            name: 'Canal',
            number: '5561999999999',
          })
        ),
        partition: 0,
        offset: 1,
      } as never)
    ).toEqual({
      account_id: REQUESTER_ACCOUNT_ID,
      request_id: '019fb6d4-432b-7000-8000-000000000012',
      status: EWorkerStatus.online,
      type: EWorkerType.whatsmeow,
      session_storage: EWorkerSessionStorage.legacy_volume,
      account: FILTER_ACCOUNT_ID,
      name: 'Canal',
      number: '5561999999999',
    });
  });
});
