import { logger } from '@core/plugins/telemetry/logger';
import {
  incrementCounter,
  recordGauge,
  recordHistogram,
} from '@core/plugins/telemetry/observability';
import { recordConnectionQrSummary } from '@core/plugins/telemetry/connectionQrSummary';
import { recordConnectionAttemptTelemetry } from '@core/plugins/telemetry/connectionAttemptTelemetry';

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@core/plugins/telemetry/observability', () => ({
  incrementCounter: jest.fn(),
  recordGauge: jest.fn(),
  recordHistogram: jest.fn(),
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedIncrementCounter = incrementCounter as jest.MockedFunction<
  typeof incrementCounter
>;
const mockedRecordGauge = recordGauge as jest.MockedFunction<
  typeof recordGauge
>;
const mockedRecordHistogram = recordHistogram as jest.MockedFunction<
  typeof recordHistogram
>;

describe('connection QR telemetry gates', () => {
  const previousEnabled = process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
  });

  afterAll(() => {
    if (previousEnabled === undefined) {
      delete process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED;
    } else {
      process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = previousEnabled;
    }
  });

  it('does not emit QR summary logs or metrics when disabled', () => {
    recordConnectionQrSummary({
      event: 'qr_generated',
      worker_id: 'worker-1',
      account_id: 'account-1',
      qrcode: 'secret-qr',
      time_to_first_qr_ms: 100,
    });

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedIncrementCounter).not.toHaveBeenCalled();
    expect(mockedRecordHistogram).not.toHaveBeenCalled();
  });

  it('does not emit attempt logs or metrics when disabled', () => {
    recordConnectionAttemptTelemetry({
      event: 'attempt',
      metric_event: 'runtime_generation',
      runtime_generation: 2,
      qrcode: 'secret-qr',
    });

    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedIncrementCounter).not.toHaveBeenCalled();
    expect(mockedRecordGauge).not.toHaveBeenCalled();
  });

  it('emits sanitized QR summary and metrics when enabled', () => {
    process.env.CONNECTION_LIFECYCLE_DEBUG_ENABLED = 'true';

    recordConnectionQrSummary({
      event: 'qr_generated',
      worker_id: 'worker-1',
      account_id: 'account-1',
      qrcode: 'secret-qr',
      time_to_first_qr_ms: 100,
    });

    expect(mockedIncrementCounter).toHaveBeenCalledTimes(1);
    expect(mockedRecordHistogram).toHaveBeenCalledTimes(1);
    expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    const [payload] = mockedLogger.info.mock.calls[0] as [
      Record<string, unknown>,
      ...unknown[],
    ];
    expect(payload).toEqual(
      expect.objectContaining({
        log_type: 'connection_qr_summary',
        has_qr: true,
        qr_length: 'secret-qr'.length,
      })
    );
    expect(JSON.stringify(payload)).not.toContain('secret-qr');
  });
});
