import 'reflect-metadata';
import {
  KafkaStreamsClient,
  type KafkaConsumerCreateOptions,
} from '@core/plugins/kafkaStreams';
import { rdkafka } from '@core/common/vendors/nodeRdkafka';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

jest.mock('@core/common/vendors/nodeRdkafka', () => ({
  rdkafka: {
    Topic: { OFFSET_END: -1 },
    CODES: {
      ERRORS: {
        ERR__ASSIGN_PARTITIONS: -175,
        ERR__REVOKE_PARTITIONS: -174,
      },
    },
    KafkaConsumer: jest.fn(),
    Producer: jest.fn(),
  },
}));

function createClient(consumerClientId?: string): KafkaStreamsClient {
  return new KafkaStreamsClient(
    'broker:9092',
    'client-test',
    undefined,
    undefined,
    'plaintext',
    undefined,
    1,
    1,
    100,
    1024,
    consumerClientId
  );
}

function createNativeConsumer() {
  return {
    rebalanceProtocol: jest.fn(() => 'EAGER'),
    assign: jest.fn(),
    incrementalAssign: jest.fn(),
    unassign: jest.fn(),
    incrementalUnassign: jest.fn(),
  };
}

function kafkaConsumerConstructor(): jest.Mock {
  return rdkafka.KafkaConsumer as unknown as jest.Mock;
}

function kafkaProducerConstructor(): jest.Mock {
  return rdkafka.Producer as unknown as jest.Mock;
}

describe('KafkaStreamsClient consumer start position', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves committed offsets and earliest fallback by default', () => {
    const nativeConsumer = createNativeConsumer();
    kafkaConsumerConstructor().mockReturnValue(nativeConsumer);
    const onPartitionsAssigned = jest.fn();
    const onPartitionsRevoked = jest.fn();

    createClient().createConsumer('group-default', {
      onPartitionsAssigned,
      onPartitionsRevoked,
    });

    const [globalConfig, topicConfig] =
      kafkaConsumerConstructor().mock.calls[0];
    const committedAssignments = [
      { topic: 'internal.chat.direct.message', partition: 0, offset: -1000 },
      { topic: 'internal.chat.direct.message', partition: 1, offset: 41 },
    ];
    globalConfig.rebalance_cb.call(
      nativeConsumer,
      { code: -175 },
      committedAssignments
    );

    expect(globalConfig.rebalance_cb).toEqual(expect.any(Function));
    expect(globalConfig['client.id']).toBe('client-test');
    expect(globalConfig['partition.assignment.strategy']).toBe('range');
    expect(globalConfig['enable.auto.offset.store']).toBe(false);
    expect(globalConfig['allow.auto.create.topics']).toBe(true);
    expect(topicConfig['auto.offset.reset']).toBe('earliest');
    expect(nativeConsumer.assign).toHaveBeenCalledWith(committedAssignments);
    expect(nativeConsumer.assign).not.toHaveBeenCalledWith(
      committedAssignments.map(({ topic, partition }) => ({
        topic,
        partition,
        offset: -1,
      }))
    );
    expect(onPartitionsAssigned).toHaveBeenCalledWith(committedAssignments);

    globalConfig.rebalance_cb.call(
      nativeConsumer,
      { code: -174 },
      committedAssignments
    );
    expect(onPartitionsRevoked).toHaveBeenCalledWith(committedAssignments);
    expect(nativeConsumer.unassign).toHaveBeenCalledTimes(1);
  });

  it('uses latest only as the missing-offset fallback for durable WhatsApp groups', () => {
    const nativeConsumer = createNativeConsumer();
    kafkaConsumerConstructor().mockReturnValue(nativeConsumer);

    createClient().createConsumer(
      SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.messageUpsert
    );

    const [globalConfig, topicConfig] =
      kafkaConsumerConstructor().mock.calls[0];
    const committedAssignments = [
      { topic: 'upsert.message', partition: 0, offset: 73 },
    ];
    globalConfig.rebalance_cb.call(
      nativeConsumer,
      { code: -175 },
      committedAssignments
    );

    expect(topicConfig['auto.offset.reset']).toBe('latest');
    expect(nativeConsumer.assign).toHaveBeenCalledWith(committedAssignments);
    expect(nativeConsumer.assign).not.toHaveBeenCalledWith([
      { topic: 'upsert.message', partition: 0, offset: -1 },
    ]);
  });

  it('retires assignment-time end seeking outside the test runtime', () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const nativeConsumer = createNativeConsumer();
      kafkaConsumerConstructor().mockReturnValue(nativeConsumer);
      const onPartitionsAssigned = jest.fn();

      createClient().createConsumer('group-runtime-guard', {
        startPosition: 'latest-on-assignment',
        onPartitionsAssigned,
      });

      const [globalConfig, topicConfig] =
        kafkaConsumerConstructor().mock.calls[0];
      const assignments = [
        { topic: 'worker.w1.send.message', partition: 0, offset: 41 },
      ];
      globalConfig.rebalance_cb.call(
        nativeConsumer,
        { code: -175 },
        assignments
      );

      expect(topicConfig['auto.offset.reset']).toBe('earliest');
      expect(nativeConsumer.assign).toHaveBeenCalledWith(assignments);
      expect(onPartitionsAssigned).toHaveBeenCalledWith(assignments);
    } finally {
      if (previousNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnvironment;
      }
    }
  });

  it('puts the cutover generation marker in the native consumer client id', () => {
    kafkaConsumerConstructor().mockReturnValue(createNativeConsumer());

    createClient('client-service--ucg-0123456789abcdef01234567').createConsumer(
      'group-latest'
    );

    const [globalConfig] = kafkaConsumerConstructor().mock.calls[0];
    expect(globalConfig['client.id']).toBe(
      'client-service--ucg-0123456789abcdef01234567'
    );
  });

  it('enables broker auto-creation for producers', () => {
    kafkaProducerConstructor().mockReturnValue({});

    createClient().createProducer();

    const [globalConfig] = kafkaProducerConstructor().mock.calls[0];
    expect(globalConfig['allow.auto.create.topics']).toBe(true);
    expect(globalConfig['enable.idempotence']).toBe(true);
    expect(globalConfig.acks).toBe(-1);
  });

  it('assigns every partition at OFFSET_END for each eager assignment', () => {
    const nativeConsumer = createNativeConsumer();
    kafkaConsumerConstructor().mockReturnValue(nativeConsumer);
    const options: KafkaConsumerCreateOptions = {
      startPosition: 'latest-on-assignment',
      onPartitionsAssigned: jest.fn(),
      onPartitionsRevoked: jest.fn(),
      onRebalanceError: jest.fn(),
    };

    createClient().createConsumer('group-latest', options);

    const [globalConfig, topicConfig] =
      kafkaConsumerConstructor().mock.calls[0];
    const assignment = [
      { topic: 'worker.w1.send.message', partition: 0, offset: 7 },
      { topic: 'worker.w1.send.message', partition: 1, offset: 4 },
    ];
    globalConfig.rebalance_cb.call(nativeConsumer, { code: -175 }, assignment);

    const expectedEndAssignment = [
      { topic: 'worker.w1.send.message', partition: 0, offset: -1 },
      { topic: 'worker.w1.send.message', partition: 1, offset: -1 },
    ];
    expect(globalConfig['partition.assignment.strategy']).toBe('range');
    expect(globalConfig['enable.auto.offset.store']).toBe(false);
    expect(topicConfig['auto.offset.reset']).toBe('latest');
    expect(nativeConsumer.assign).toHaveBeenCalledWith(expectedEndAssignment);
    expect(options.onPartitionsAssigned).toHaveBeenCalledWith(
      expectedEndAssignment
    );

    globalConfig.rebalance_cb.call(nativeConsumer, { code: -174 }, assignment);
    expect(options.onPartitionsRevoked).toHaveBeenCalledWith(assignment);
    expect(nativeConsumer.unassign).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to a stored offset when OFFSET_END assignment fails', () => {
    const nativeConsumer = createNativeConsumer();
    nativeConsumer.assign.mockImplementation(() => {
      throw new Error('assign_failed');
    });
    kafkaConsumerConstructor().mockReturnValue(nativeConsumer);
    const onPartitionsAssigned = jest.fn();
    const onRebalanceError = jest.fn();

    createClient().createConsumer('group-latest', {
      startPosition: 'latest-on-assignment',
      onPartitionsAssigned,
      onRebalanceError,
    });

    const [globalConfig] = kafkaConsumerConstructor().mock.calls[0];
    globalConfig.rebalance_cb.call(nativeConsumer, { code: -175 }, [
      { topic: 'worker.w1.send.message', partition: 0 },
    ]);

    expect(onPartitionsAssigned).not.toHaveBeenCalled();
    expect(onRebalanceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'assign_failed' })
    );
    expect(nativeConsumer.assign).toHaveBeenCalledTimes(1);
  });

  it('uses incremental cooperative assignment and keeps empty members in the group', () => {
    const nativeConsumer = createNativeConsumer();
    nativeConsumer.rebalanceProtocol.mockReturnValue('COOPERATIVE');
    kafkaConsumerConstructor().mockReturnValue(nativeConsumer);
    const options: KafkaConsumerCreateOptions = {
      startPosition: 'latest-on-assignment',
      onPartitionsAssigned: jest.fn(),
      onPartitionsRevoked: jest.fn(),
      onRebalanceError: jest.fn(),
    };

    createClient().createConsumer('group-cooperative', options);

    const [globalConfig] = kafkaConsumerConstructor().mock.calls[0];
    const assignment = [
      { topic: 'upsert.message', partition: 0, offset: 7 },
      { topic: 'upsert.message', partition: 1, offset: 4 },
    ];
    globalConfig.rebalance_cb.call(nativeConsumer, { code: -175 }, assignment);

    const expectedEndAssignment = assignment.map(({ topic, partition }) => ({
      topic,
      partition,
      offset: -1,
    }));
    expect(nativeConsumer.incrementalAssign).toHaveBeenCalledWith(
      expectedEndAssignment
    );
    expect(nativeConsumer.assign).not.toHaveBeenCalled();
    expect(options.onPartitionsAssigned).toHaveBeenCalledWith(
      expectedEndAssignment
    );

    globalConfig.rebalance_cb.call(nativeConsumer, { code: -174 }, [
      assignment[1],
    ]);
    expect(options.onPartitionsRevoked).toHaveBeenCalledWith([assignment[1]]);
    expect(nativeConsumer.incrementalUnassign).toHaveBeenCalledWith([
      assignment[1],
    ]);
    expect(nativeConsumer.unassign).not.toHaveBeenCalled();

    globalConfig.rebalance_cb.call(nativeConsumer, { code: -174 }, []);
    expect(nativeConsumer.incrementalUnassign).toHaveBeenLastCalledWith([]);

    globalConfig.rebalance_cb.call(nativeConsumer, { code: -175 }, []);
    expect(options.onPartitionsAssigned).toHaveBeenLastCalledWith([]);
    expect(nativeConsumer.incrementalAssign).toHaveBeenLastCalledWith([]);
    expect(nativeConsumer.incrementalAssign).toHaveBeenCalledTimes(2);
    expect(options.onRebalanceError).not.toHaveBeenCalled();
  });
});
