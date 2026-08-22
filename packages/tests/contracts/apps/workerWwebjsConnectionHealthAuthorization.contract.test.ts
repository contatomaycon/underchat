import 'reflect-metadata';

const verifyCurrentSession = jest.fn();
const getKafkaConsumerHealthSnapshots = jest.fn();
const getKafkaConsumerHealthSummary = jest.fn();
const areKafkaConsumersReady = jest.fn();
const hasCentralOnlineAcknowledgement = jest.fn();
const hasSession = jest.fn();
const isWorkerKafkaDispatchAuthorized = jest.fn();
const getConnectionStatus = jest.fn();
const getConnectionStatusSourceId = jest.fn();
const getConnectionStatusHealthEvidence = jest.fn();

const wwebjsEnvironment = {
  isRuntimeActivated: true,
  isWarmStandby: false,
  wwebjsWorkerId: 'wwebjs-worker-id',
  wwebjsAccountId: 'wwebjs-account-id',
  workerTypeId: 'wwebjs-worker-type-id',
};

jest.mock('@core/config/environments', () => ({ wwebjsEnvironment }));

jest.mock('tsyringe', () => ({
  container: {
    resolve: (token: {
      prototype?: { hasCentralOnlineAcknowledgement?: unknown };
    }) =>
      typeof token?.prototype?.hasCentralOnlineAcknowledgement === 'function'
        ? {
            getConnectionStatus,
            getConnectionStatusSourceId,
            getConnectionStatusHealthEvidence,
            hasCentralOnlineAcknowledgement,
            hasSession,
          }
        : { verifyCurrentSession },
  },
}));

jest.mock('@core/services/wwebjs/methods/healthCheck.service', () => ({
  WwebjsHealthCheckService: class {},
}));

jest.mock('@core/services/wwebjs/methods/connection.service', () => ({
  WwebjsConnectionService: class {
    hasCentralOnlineAcknowledgement(): boolean {
      return false;
    }

    hasSession(): boolean {
      return false;
    }
  },
}));

jest.mock('@core/common/functions/workerKafkaDispatchAuthorization', () => ({
  isWorkerKafkaDispatchAuthorized,
}));

jest.mock(
  '@/consumer/registry',
  () => ({
    getKafkaConsumerHealthSnapshots,
    getKafkaConsumerHealthSummary,
    areKafkaConsumersReady,
  }),
  { virtual: true }
);

const { viewConnectionHealth } =
  require('../../../../apps/worker_wwebjs/src/controllers/health/methods/viewConnectionHealth') as {
    viewConnectionHealth: (request: unknown, reply: unknown) => Promise<void>;
  };

function buildReply() {
  const reply = {
    request: { id: 'request-wwebjs-authorization' },
    code: jest.fn(),
    send: jest.fn(),
  };
  reply.code.mockReturnValue(reply);
  return reply;
}

describe('WWebJS connection health dispatch authorization gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyCurrentSession.mockResolvedValue({
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      runtime_generation: 34,
      degraded_reason: undefined,
    });
    hasCentralOnlineAcknowledgement.mockReturnValue(true);
    hasSession.mockReturnValue(true);
    getConnectionStatus.mockReturnValue({
      status: 'online',
      connected: true,
      authenticated: true,
      sessionValid: true,
    });
    getConnectionStatusSourceId.mockReturnValue(
      '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60'
    );
    getConnectionStatusHealthEvidence.mockReturnValue({
      connectionStatus: {
        provider: 'wwebjs',
        status: 'online',
        connected: true,
        authenticated: true,
        sessionValid: true,
        recoverable: false,
        qrAvailable: false,
        sequence: 3,
        changedAt: new Date().toISOString(),
      },
      connectionStatusSourceId: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60',
      sourceCurrent: true,
      leaseRequired: true,
      leaseProofValid: true,
      sessionStorage: 'postgres',
    });
    isWorkerKafkaDispatchAuthorized.mockReturnValue(false);
    getKafkaConsumerHealthSnapshots.mockReturnValue(
      Array.from({ length: 1 }, (_, index) => ({
        owner: `consumer-${index}`,
        dispatch_authorized: false,
      }))
    );
    getKafkaConsumerHealthSummary.mockReturnValue({
      expected: 1,
      active: 1,
      missing: 0,
      unhealthy: 0,
    });
    areKafkaConsumersReady.mockReturnValue(true);
  });

  it.each([
    {
      gate: 'global Kafka dispatch authorization',
      centralOnlineAcknowledged: true,
      kafkaConsumersAuthorized: false,
    },
    {
      gate: 'central online acknowledgement',
      centralOnlineAcknowledged: false,
      kafkaConsumersAuthorized: true,
    },
  ])(
    'fails closed and masks provider capabilities without $gate',
    async ({ centralOnlineAcknowledged, kafkaConsumersAuthorized }) => {
      hasCentralOnlineAcknowledgement.mockReturnValue(
        centralOnlineAcknowledged
      );
      isWorkerKafkaDispatchAuthorized.mockReturnValue(kafkaConsumersAuthorized);
      const reply = buildReply();

      await viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: false,
          data: expect.objectContaining({
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
            authenticated: true,
            connected: false,
            ready: false,
            central_online_acknowledged: centralOnlineAcknowledged,
            kafka_consumers_ready: true,
            kafka_consumers_authorized: kafkaConsumersAuthorized,
            runtime_health_schema_version: 3,
            degraded_reason: 'awaiting_dispatch_authorization',
          }),
        })
      );
    }
  );
});
