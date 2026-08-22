export {};

const getServiceApiConsumerStartupState = jest.fn();
const getServiceApiKafkaHealthSnapshots = jest.fn();
const hasServiceApiConsumerStartupFailed = jest.fn();
const hasUnreadyServiceApiKafkaConsumer = jest.fn();
const hasUnhealthyServiceApiKafkaConsumer = jest.fn();
const getServiceApiKafkaConsumersRequiringPodReplacement = jest.fn();
const isServiceApiConsumerStartupPending = jest.fn();

jest.mock(
  '@/consumer/registry',
  () => ({
    getServiceApiConsumerStartupState,
    getServiceApiKafkaHealthSnapshots,
    hasServiceApiConsumerStartupFailed,
    hasUnreadyServiceApiKafkaConsumer,
    hasUnhealthyServiceApiKafkaConsumer,
    getServiceApiKafkaConsumersRequiringPodReplacement,
    isServiceApiConsumerStartupPending,
  }),
  { virtual: true }
);

jest.mock('@core/config/environments', () => ({
  buildEnvironment: {
    serviceApiHealthFailOnKafkaUnhealthy: true,
  },
}));

interface HealthHandlerModule {
  viewHealth: (request: unknown, reply: unknown) => Promise<void>;
  viewReadiness: (request: unknown, reply: unknown) => Promise<void>;
  viewLiveness: (request: unknown, reply: unknown) => Promise<void>;
}

function loadHealthHandlers(): HealthHandlerModule {
  return require('../../../../apps/service_api/src/controllers/health/methods/viewHealth') as HealthHandlerModule;
}

function buildReply() {
  const reply = {
    request: { id: 'request-1' },
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

function expectHealthData(
  reply: ReturnType<typeof buildReply>,
  expected: Record<string, unknown>
): void {
  expect(reply.send).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining(expected),
    })
  );
}

describe('service API readiness during Kafka startup', () => {
  beforeEach(() => {
    delete process.env.SERVICE_API_KAFKA_BOOTSTRAP_CUTOVER_ENABLED;
    getServiceApiConsumerStartupState.mockReturnValue('ready');
    isServiceApiConsumerStartupPending.mockReturnValue(false);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    getServiceApiKafkaHealthSnapshots.mockReturnValue([]);
    hasUnreadyServiceApiKafkaConsumer.mockReturnValue(false);
    hasUnhealthyServiceApiKafkaConsumer.mockReturnValue(false);
    getServiceApiKafkaConsumersRequiringPodReplacement.mockReturnValue([]);
  });

  it('stays HTTP 503 during normal startup until Kafka is ready', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('starting');
    isServiceApiConsumerStartupPending.mockReturnValue(true);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    const reply = buildReply();

    await loadHealthHandlers().viewReadiness({}, reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expectHealthData(reply, {
      consumer_startup_state: 'starting',
      consumer_startup_pending: true,
      consumer_startup_failed: false,
      kafka_ready: false,
    });
  });

  it('allows readiness during an explicitly enabled bootstrap cutover barrier', async () => {
    process.env.SERVICE_API_KAFKA_BOOTSTRAP_CUTOVER_ENABLED = 'true';
    getServiceApiConsumerStartupState.mockReturnValue('starting');
    isServiceApiConsumerStartupPending.mockReturnValue(true);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    const reply = buildReply();

    await loadHealthHandlers().viewReadiness({}, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expectHealthData(reply, {
      consumer_startup_state: 'starting',
      consumer_startup_pending: true,
      kafka_ready: false,
    });
  });

  it('returns HTTP 503 from readiness and liveness after consumer startup fails', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('failed');
    isServiceApiConsumerStartupPending.mockReturnValue(false);
    hasServiceApiConsumerStartupFailed.mockReturnValue(true);
    const readinessReply = buildReply();

    await loadHealthHandlers().viewReadiness({}, readinessReply);

    expect(readinessReply.code).toHaveBeenCalledWith(503);
    expectHealthData(readinessReply, {
      consumer_startup_state: 'failed',
      consumer_startup_failed: true,
      kafka_ready: false,
    });

    const livenessReply = buildReply();
    await loadHealthHandlers().viewLiveness({}, livenessReply);

    expect(livenessReply.code).toHaveBeenCalledWith(503);
    expectHealthData(livenessReply, {
      alive: false,
      consumer_startup_failed: true,
    });
  });

  it('keeps liveness healthy during the bounded normal startup window', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('starting');
    isServiceApiConsumerStartupPending.mockReturnValue(true);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    const reply = buildReply();

    await loadHealthHandlers().viewLiveness({}, reply);

    expect(reply.code).toHaveBeenCalledWith(200);
    expectHealthData(reply, {
      alive: true,
      consumer_startup_failed: false,
      kafka_pod_replacement_required: false,
    });
  });

  it('uses Kafka snapshots after startup completes', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('ready');
    isServiceApiConsumerStartupPending.mockReturnValue(false);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    hasUnreadyServiceApiKafkaConsumer.mockReturnValue(true);
    hasUnhealthyServiceApiKafkaConsumer.mockReturnValue(true);
    const unreadyReply = buildReply();

    await loadHealthHandlers().viewReadiness({}, unreadyReply);

    expect(unreadyReply.code).toHaveBeenCalledWith(503);
    expectHealthData(unreadyReply, {
      consumer_startup_state: 'ready',
      kafka_ready: false,
      kafka_unhealthy: true,
    });

    hasUnreadyServiceApiKafkaConsumer.mockReturnValue(false);
    hasUnhealthyServiceApiKafkaConsumer.mockReturnValue(false);
    const readyReply = buildReply();

    await loadHealthHandlers().viewReadiness({}, readyReply);

    expect(readyReply.code).toHaveBeenCalledWith(200);
    expectHealthData(readyReply, {
      consumer_startup_state: 'ready',
      kafka_ready: true,
      kafka_unhealthy: false,
    });
  });

  it('keeps liveness healthy during a global Kafka disconnect', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('ready');
    isServiceApiConsumerStartupPending.mockReturnValue(false);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    hasUnreadyServiceApiKafkaConsumer.mockReturnValue(true);
    hasUnhealthyServiceApiKafkaConsumer.mockReturnValue(true);
    getServiceApiKafkaConsumersRequiringPodReplacement.mockReturnValue([]);
    const readinessReply = buildReply();
    const livenessReply = buildReply();

    await loadHealthHandlers().viewReadiness({}, readinessReply);
    await loadHealthHandlers().viewLiveness({}, livenessReply);

    expect(readinessReply.code).toHaveBeenCalledWith(503);
    expect(livenessReply.code).toHaveBeenCalledWith(200);
    expectHealthData(livenessReply, {
      alive: true,
      kafka_pod_replacement_required: false,
    });
  });

  it('keeps readiness for an observable administrative stall while general health remains fail-closed', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('ready');
    isServiceApiConsumerStartupPending.mockReturnValue(false);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    hasUnreadyServiceApiKafkaConsumer.mockReturnValue(false);
    hasUnhealthyServiceApiKafkaConsumer.mockReturnValue(true);
    const readinessReply = buildReply();

    await loadHealthHandlers().viewReadiness({}, readinessReply);

    expect(readinessReply.code).toHaveBeenCalledWith(200);
    expectHealthData(readinessReply, {
      consumer_startup_state: 'ready',
      kafka_ready: true,
      kafka_unhealthy: true,
    });

    const healthReply = buildReply();
    await loadHealthHandlers().viewHealth({}, healthReply);

    expect(healthReply.code).toHaveBeenCalledWith(503);
    expectHealthData(healthReply, {
      consumer_startup_state: 'ready',
      kafka_ready: true,
      kafka_unhealthy: true,
    });
  });

  it('keeps the general health endpoint fail-closed during startup', async () => {
    getServiceApiConsumerStartupState.mockReturnValue('starting');
    isServiceApiConsumerStartupPending.mockReturnValue(true);
    hasServiceApiConsumerStartupFailed.mockReturnValue(false);
    const reply = buildReply();

    await loadHealthHandlers().viewHealth({}, reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expectHealthData(reply, {
      consumer_startup_state: 'starting',
      kafka_ready: false,
    });
  });

  it('fails liveness only after a critical Kafka consumer exhausts internal recovery', async () => {
    getServiceApiKafkaConsumersRequiringPodReplacement.mockReturnValue([
      {
        owner: 'MessageUpdateConsume',
        topics: ['update.message'],
        assigned_topics: ['update.message'],
        stall_reason: 'pending_offset_stall',
        last_error: 'no committed offset progress',
        restart_count: 3,
        consecutive_stall_restart_count: 3,
        stall_recovery_exhausted: true,
      },
    ]);
    const reply = buildReply();

    await loadHealthHandlers().viewLiveness({}, reply);

    expect(reply.code).toHaveBeenCalledWith(503);
    expectHealthData(reply, {
      alive: false,
      kafka_pod_replacement_required: true,
      kafka_replacement_consumers: [
        expect.objectContaining({
          owner: 'MessageUpdateConsume',
          topics: ['update.message'],
          stall_reason: 'pending_offset_stall',
        }),
      ],
    });
  });
});
