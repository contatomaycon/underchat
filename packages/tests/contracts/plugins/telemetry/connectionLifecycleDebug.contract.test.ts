import { Metadata } from '@grpc/grpc-js';
import { logger } from '@core/plugins/telemetry/logger';
import {
  buildConnectionLifecycleContext,
  connectionLifecycleIdFromGrpcMetadata,
  injectGrpcConnectionMetadata,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
  runWithGrpcConnectionContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('connectionLifecycleDebug', () => {
  const previousEnabled = process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
  const previousValueLimit = process.env.CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT;
  const previousRawLimit = process.env.CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
    delete process.env.CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT;
    delete process.env.CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT;
  });

  afterAll(() => {
    if (previousEnabled === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = previousEnabled;
    }
    if (previousValueLimit === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT = previousValueLimit;
    }
    if (previousRawLimit === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT = previousRawLimit;
    }
  });

  it('does not emit when env is disabled', () => {
    recordConnectionLifecycle({
      stage: 'test.disabled',
      decision: 'env_gate',
      outcome: 'skipped',
    });

    expect(mockedLogger.info).not.toHaveBeenCalled();
  });

  it('emits default fields, callsite, truncation and sensitive metadata', () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    process.env.CONNECTION_LIFECYCLE_DEBUG_VALUE_LIMIT = '5';
    process.env.CONNECTION_LIFECYCLE_DEBUG_RAW_LIMIT = '80';

    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: 'connection-1',
      account_id: 'account-1',
      worker_id: 'worker-1',
      worker_type: 'baileys',
      source_provider: 'baileys',
      connection_type: 'qrcode',
      connection_action: 'connect',
    });

    runWithConnectionLifecycleContext(contextData, () => {
      recordConnectionLifecycle({
        stage: 'test.enabled',
        decision: 'emit',
        outcome: 'logged',
        qrcode: 'qr-secret-value',
        pairing_code: 'pair-secret',
        value: 'abcdef',
        raw_payload: { qrcode: 'raw-qr-secret' },
      });
    });

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    const [payload] = mockedLogger.info.mock.calls[0] as [
      Record<string, unknown>,
      ...unknown[],
    ];
    expect(payload).toEqual(
      expect.objectContaining({
        debug_index: 'connection_lifecycle',
        log_type: 'connection_lifecycle',
        stage: 'test.enabled',
        decision: 'emit',
        outcome: 'logged',
        connection_lifecycle_id: 'connection-1',
        account_id: 'account-1',
        worker_id: 'worker-1',
        channel_id: 'worker-1',
        worker_type: 'baileys',
        source_provider: 'baileys',
        connection_type: 'qrcode',
        connection_action: 'connect',
        has_qr: true,
        qr_length: 'qr-secret-value'.length,
        has_pairing_code: true,
        pairing_code_length: 'pair-secret'.length,
        value_truncated: true,
      })
    );
    expect(payload.source_file).toEqual(expect.any(String));
    expect(payload.source_line).toEqual(expect.any(Number));
    expect(JSON.stringify(payload)).not.toContain('qr-secret-value');
    expect(JSON.stringify(payload)).not.toContain('pair-secret');
    expect(JSON.stringify(payload)).not.toContain('raw-qr-secret');
  });

  it('propagates connection lifecycle id through grpc metadata', () => {
    const contextData = buildConnectionLifecycleContext({
      connection_lifecycle_id: 'connection-grpc-1',
      account_id: 'account-1',
      worker_id: 'worker-1',
    });

    const metadata = runWithConnectionLifecycleContext(contextData, () =>
      injectGrpcConnectionMetadata()
    );

    expect(connectionLifecycleIdFromGrpcMetadata(metadata)).toBe(
      'connection-grpc-1'
    );

    const received = new Metadata();
    received.set('x-connection-lifecycle-id', 'connection-grpc-2');

    runWithGrpcConnectionContext(received, contextData, () => {
      recordConnectionLifecycle({
        stage: 'test.grpc',
        decision: 'extract',
        outcome: 'logged',
      });
    });

    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';
    runWithGrpcConnectionContext(received, contextData, () => {
      recordConnectionLifecycle({
        stage: 'test.grpc.enabled',
        decision: 'extract',
        outcome: 'logged',
      });
    });

    const [payload] = mockedLogger.info.mock.calls[0] as [
      Record<string, unknown>,
      ...unknown[],
    ];
    expect(payload.connection_lifecycle_id).toBe('connection-grpc-2');
  });
});
