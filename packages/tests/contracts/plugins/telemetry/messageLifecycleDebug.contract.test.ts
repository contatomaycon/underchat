import { logger } from '@core/plugins/telemetry/logger';
import {
  buildMessageLifecycleContext,
  recordMessageLifecycle,
  runWithMessageLifecycleContext,
} from '@core/plugins/telemetry/messageLifecycleDebug';
import { EMessageType } from '@core/common/enums/EMessageType';

jest.mock('@core/plugins/telemetry/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('messageLifecycleDebug', () => {
  const previousEnabled = process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED;
  const previousBodyLimit = process.env.MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT;
  const previousRawLimit = process.env.MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED;
    delete process.env.MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT;
    delete process.env.MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT;
  });

  afterAll(() => {
    if (previousEnabled === undefined) {
      delete process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED;
    } else {
      process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED = previousEnabled;
    }
    if (previousBodyLimit === undefined) {
      delete process.env.MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT;
    } else {
      process.env.MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT = previousBodyLimit;
    }
    if (previousRawLimit === undefined) {
      delete process.env.MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT;
    } else {
      process.env.MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT = previousRawLimit;
    }
  });

  it('does not emit when env is disabled', () => {
    recordMessageLifecycle({
      stage: 'test.disabled',
      decision: 'env_gate',
      outcome: 'skipped',
    });

    expect(mockedLogger.info).not.toHaveBeenCalled();
  });

  it('emits default fields, callsite and truncation when env is enabled', () => {
    process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED = 'true';
    process.env.MESSAGE_LIFECYCLE_DEBUG_BODY_LIMIT = '5';
    process.env.MESSAGE_LIFECYCLE_DEBUG_RAW_LIMIT = '10';

    const contextData = buildMessageLifecycleContext(
      {
        account_id: 'account-1',
        worker_id: 'worker-1',
        source_provider: 'baileys',
        type: EMessageType.text,
        message: {
          key: {
            id: 'message-1',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
        },
      },
      'baileys'
    );

    runWithMessageLifecycleContext(contextData, () => {
      recordMessageLifecycle({
        stage: 'test.enabled',
        decision: 'emit',
        outcome: 'skipped',
        message_text: 'abcdef',
        raw_payload: { value: 'abcdefghijklmnop' },
      });
    });

    expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    const [payload] = mockedLogger.info.mock.calls[0] as [
      Record<string, unknown>,
      ...unknown[],
    ];
    expect(payload).toEqual(
      expect.objectContaining({
        debug_index: 'message_lifecycle',
        log_type: 'message_lifecycle',
        stage: 'test.enabled',
        decision: 'emit',
        outcome: 'skipped',
        account_id: 'account-1',
        worker_id: 'worker-1',
        channel_id: 'worker-1',
        source_provider: 'baileys',
        message_key_id: 'message-1',
        phone: '5511999999999',
        message_truncated: true,
        raw_truncated: true,
      })
    );
    expect(payload.source_file).toEqual(expect.any(String));
    expect(payload.source_line).toEqual(expect.any(Number));
  });

  it('drops non-exception outcomes when env is enabled', () => {
    process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED = 'true';

    recordMessageLifecycle({
      stage: 'test.success',
      decision: 'drop',
      outcome: 'success',
    });
    recordMessageLifecycle({
      stage: 'test.published',
      decision: 'drop',
      outcome: 'published',
    });

    expect(mockedLogger.info).not.toHaveBeenCalled();
  });

  it('emits discarded, retrying and explicit error events', () => {
    process.env.MESSAGE_LIFECYCLE_DEBUG_ENABLED = 'true';

    recordMessageLifecycle({
      stage: 'test.discarded',
      decision: 'emit',
      outcome: 'discarded',
    });
    recordMessageLifecycle({
      stage: 'test.retrying',
      decision: 'emit',
      outcome: 'retrying',
    });
    recordMessageLifecycle({
      stage: 'test.error',
      decision: 'emit',
      outcome: 'success',
      level: 'error',
      error: 'forced error',
    });

    expect(mockedLogger.info).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
  });

  it('builds a stable lifecycle id for the same message', () => {
    const input = {
      account_id: 'account-1',
      worker_id: 'worker-1',
      source_provider: 'wwebjs' as const,
      type: EMessageType.text,
      message: {
        key: {
          id: 'message-1',
          remoteJid: '5511999999999@s.whatsapp.net',
          fromMe: false,
        },
      },
    };

    expect(
      buildMessageLifecycleContext(input, 'wwebjs').message_lifecycle_id
    ).toBe(buildMessageLifecycleContext(input, 'wwebjs').message_lifecycle_id);
  });
});
