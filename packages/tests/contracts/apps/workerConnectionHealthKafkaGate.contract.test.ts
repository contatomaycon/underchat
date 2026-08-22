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

const baileysEnvironment = {
  isRuntimeActivated: true,
  isWarmStandby: false,
  baileysWorkerId: 'baileys-worker-id',
  baileysAccountId: 'baileys-account-id',
  workerTypeId: 'baileys-worker-type-id',
};
const wwebjsEnvironment = {
  isRuntimeActivated: true,
  isWarmStandby: false,
  wwebjsWorkerId: 'wwebjs-worker-id',
  wwebjsAccountId: 'wwebjs-account-id',
  workerTypeId: 'wwebjs-worker-type-id',
};

jest.mock('@core/config/environments', () => ({
  baileysEnvironment,
  wwebjsEnvironment,
}));

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

jest.mock('@core/services/baileys/methods/healthCheck.service', () => ({
  BaileysHealthCheckService: class {},
}));

jest.mock('@core/services/wwebjs/methods/healthCheck.service', () => ({
  WwebjsHealthCheckService: class {},
}));

jest.mock('@core/services/baileys/methods/connection.service', () => ({
  BaileysConnectionService: class {
    hasCentralOnlineAcknowledgement(): boolean {
      return false;
    }

    hasSession(): boolean {
      return false;
    }
  },
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

interface ConnectionHealthHandlerModule {
  viewConnectionHealth: (request: unknown, reply: unknown) => Promise<void>;
}

const handlerModules = [
  '../../../../apps/worker_baileys/src/controllers/health/methods/viewConnectionHealth',
  '../../../../apps/worker_wwebjs/src/controllers/health/methods/viewConnectionHealth',
];

function loadHandler(modulePath: string): ConnectionHealthHandlerModule {
  return require(modulePath) as ConnectionHealthHandlerModule;
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

describe.each(handlerModules)(
  'worker connection health Kafka gate %s',
  (modulePath) => {
    beforeEach(() => {
      verifyCurrentSession.mockResolvedValue({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
        runtime_generation: 7,
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
          provider: 'baileys',
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
        leaseRequired: false,
        leaseProofValid: true,
        sessionStorage: 'legacy_volume',
      });
      isWorkerKafkaDispatchAuthorized.mockReturnValue(true);
      getKafkaConsumerHealthSnapshots.mockReturnValue([]);
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 0,
        missing: 1,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(false);
    });

    it('returns 503 and masks connected/ready while Kafka is bootstrapping', async () => {
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: false,
          data: expect.objectContaining({
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
            connected: false,
            ready: false,
            kafka_unhealthy: true,
            kafka_consumers_ready: false,
            kafka_consumer_summary: {
              expected: 1,
              active: 0,
              missing: 1,
              unhealthy: 0,
            },
          }),
        })
      );
    });

    it('returns 503 when Kafka is ready but the provider session is not', async () => {
      verifyCurrentSession.mockResolvedValue({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        runtime_generation: 7,
      });
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connected: false,
            ready: false,
            has_session: true,
            qr_stream_ready: false,
            kafka_unhealthy: false,
            kafka_consumers_ready: true,
          }),
        })
      );
    });

    it('exposes pairing readiness without marking an empty session connected', async () => {
      verifyCurrentSession.mockResolvedValue({
        session_ready: false,
        can_send: false,
        can_receive_runtime: false,
        authenticated: false,
        runtime_generation: 7,
      });
      hasSession.mockReturnValue(false);
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth(
        { server: { qrStreamReady: true } },
        reply
      );

      expect(reply.code).toHaveBeenCalledWith(503);
      const expectedRuntimeIdentity = modulePath.includes('worker_wwebjs')
        ? {
            worker_id: 'wwebjs-worker-id',
            account_id: 'wwebjs-account-id',
            worker_type_id: 'wwebjs-worker-type-id',
          }
        : {
            worker_id: 'baileys-worker-id',
            account_id: 'baileys-account-id',
            worker_type_id: 'baileys-worker-type-id',
          };
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ...expectedRuntimeIdentity,
            has_session: false,
            qr_stream_ready: true,
            runtime_state: 'active',
            activated: true,
            standby: false,
            connected: false,
            ready: false,
            session_ready: false,
          }),
        })
      );
    });

    it('returns 503 while central online acknowledgement is pending', async () => {
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      hasCentralOnlineAcknowledgement.mockReturnValue(false);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connected: false,
            ready: false,
            central_online_acknowledged: false,
            runtime_generation_ready: true,
          }),
        })
      );
    });

    it('returns 503 and masks provider capabilities while Kafka dispatch authorization is missing', async () => {
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      isWorkerKafkaDispatchAuthorized.mockReturnValue(false);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

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
            kafka_unhealthy: false,
            kafka_consumers_ready: true,
            kafka_consumers_authorized: false,
            runtime_health_schema_version: 3,
            degraded_reason: 'awaiting_dispatch_authorization',
          }),
        })
      );
    });

    it('returns 503 when runtime generation is absent', async () => {
      verifyCurrentSession.mockResolvedValue({
        session_ready: true,
        can_send: true,
        can_receive_runtime: true,
        authenticated: true,
      });
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            central_online_acknowledged: true,
            runtime_generation_ready: false,
            connected: false,
            ready: false,
          }),
        })
      );
    });

    it.each([
      {
        label: 'native status is not ONLINE',
        evidence: {
          connectionStatus: {
            provider: 'baileys',
            status: 'offline',
            connected: false,
            authenticated: true,
            sessionValid: true,
            recoverable: true,
            qrAvailable: false,
            sequence: 4,
            changedAt: new Date().toISOString(),
          },
          connectionStatusSourceId: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60',
          sourceCurrent: true,
          leaseRequired: false,
          leaseProofValid: true,
          sessionStorage: 'legacy_volume',
        },
      },
      {
        label: 'PostgreSQL lease proof is unavailable',
        evidence: {
          connectionStatus: {
            provider: 'baileys',
            status: 'online',
            connected: true,
            authenticated: true,
            sessionValid: true,
            recoverable: false,
            qrAvailable: false,
            sequence: 4,
            changedAt: new Date().toISOString(),
          },
          connectionStatusSourceId: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60',
          sourceCurrent: true,
          leaseRequired: true,
          leaseProofValid: false,
          sessionStorage: 'postgres',
        },
      },
    ])('returns 503 when $label', async ({ evidence }) => {
      getConnectionStatusHealthEvidence.mockReturnValue(evidence);
      getKafkaConsumerHealthSummary.mockReturnValue({
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      });
      areKafkaConsumersReady.mockReturnValue(true);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(reply.code).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connected: false,
            ready: false,
            session_ready: false,
            can_send: false,
            can_receive_runtime: false,
          }),
        })
      );
    });

    it('returns 200 only after provider, Kafka, runtime generation, and central ACK are ready', async () => {
      const snapshots = [{ owner: 'send-message', connected: true }];
      const summary = {
        expected: 1,
        active: 1,
        missing: 0,
        unhealthy: 0,
      };
      getKafkaConsumerHealthSnapshots.mockReturnValue(snapshots);
      getKafkaConsumerHealthSummary.mockReturnValue(summary);
      areKafkaConsumersReady.mockReturnValue(true);
      const reply = buildReply();

      await loadHandler(modulePath).viewConnectionHealth({}, reply);

      expect(getKafkaConsumerHealthSummary).toHaveBeenCalledWith(snapshots);
      expect(areKafkaConsumersReady).toHaveBeenCalledWith(summary);
      expect(reply.code).toHaveBeenCalledWith(200);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: true,
          data: expect.objectContaining({
            connected: true,
            ready: true,
            central_online_acknowledged: true,
            runtime_generation: 7,
            runtime_generation_ready: true,
            kafka_unhealthy: false,
            kafka_consumers_ready: true,
            kafka_consumers_authorized: true,
            runtime_health_schema_version: 3,
            native_connection_online: true,
            connection_status_source_current: true,
            connection_status_lease_proof_valid: true,
            kafka_consumers: snapshots,
            kafka_consumer_summary: summary,
          }),
        })
      );
    });
  }
);
