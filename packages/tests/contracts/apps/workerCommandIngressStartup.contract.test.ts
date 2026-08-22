export {};

type Handler = jest.Mock<Promise<void>, unknown[]>;

const mockHandlers: Record<string, { handleJetStreamCommand: Handler }> = {};
const mockIngressInstances: Array<{
  options: {
    accountId: string;
    workerId: string;
    runtimeWriterEpoch: string;
    runtimeGeneration: number;
    handlers: Record<string, (input: Record<string, unknown>) => Promise<void>>;
  };
  epochs: unknown;
  lanes: unknown;
  execute: jest.Mock<Promise<void>, []>;
}> = [];
const mockLifecycleOrder: string[] = [];
const mockBaileysEnvironment: {
  baileysAccountId: string;
  baileysWorkerId: string;
  runtimeGeneration: number | undefined;
} = {
  baileysAccountId: 'account-baileys',
  baileysWorkerId: 'worker-baileys',
  runtimeGeneration: 11,
};
const mockWwebjsEnvironment: {
  wwebjsAccountId: string;
  wwebjsWorkerId: string;
  runtimeGeneration: number | undefined;
} = {
  wwebjsAccountId: 'account-wwebjs',
  wwebjsWorkerId: 'worker-wwebjs',
  runtimeGeneration: 12,
};

function handler(name: string): { handleJetStreamCommand: Handler } {
  return (mockHandlers[name] ??= {
    handleJetStreamCommand: jest.fn(async () => undefined),
  });
}

jest.mock('@core/consumer/message/MessageSend.consume', () => ({
  MessageSendConsume: class MessageSendConsume {},
}));
jest.mock(
  '@core/consumer/notification/NotificationMessageSend.consume',
  () => ({
    NotificationMessageSendConsume: class NotificationMessageSendConsume {},
  })
);
jest.mock('@core/consumer/schedule/ScheduleMessage.consume', () => ({
  ScheduleMessageConsume: class ScheduleMessageConsume {},
}));
jest.mock('@core/consumer/webhook/WebhookIntegration.consume', () => ({
  WebhookIntegrationConsume: class WebhookIntegrationConsume {},
}));
jest.mock('@core/consumer/worker/MessageMarkRead.consume', () => ({
  MessageMarkReadConsume: class MessageMarkReadConsume {},
}));
jest.mock('@core/consumer/worker/WorkerConfigUpdate.consume', () => ({
  WorkerConfigUpdateConsume: class WorkerConfigUpdateConsume {},
}));

jest.mock('@core/consumer/message/MessageSendWwebjs.consume', () => ({
  MessageSendWwebjsConsume: class MessageSendWwebjsConsume {},
}));
jest.mock(
  '@core/consumer/notification/NotificationMessageSendWwebjs.consume',
  () => ({
    NotificationMessageSendWwebjsConsume: class NotificationMessageSendWwebjsConsume {},
  })
);
jest.mock('@core/consumer/schedule/ScheduleMessageWwebjs.consume', () => ({
  ScheduleMessageWwebjsConsume: class ScheduleMessageWwebjsConsume {},
}));
jest.mock('@core/consumer/webhook/WebhookIntegrationWwebjs.consume', () => ({
  WebhookIntegrationWwebjsConsume: class WebhookIntegrationWwebjsConsume {},
}));
jest.mock('@core/consumer/worker/MessageMarkReadWwebjs.consume', () => ({
  MessageMarkReadWwebjsConsume: class MessageMarkReadWwebjsConsume {},
}));
jest.mock('@core/consumer/worker/WorkerConfigUpdateWwebjs.consume', () => ({
  WorkerConfigUpdateWwebjsConsume: class WorkerConfigUpdateWwebjsConsume {},
}));

jest.mock('@core/services/workerCommandEpoch.service', () => ({
  WorkerCommandEpochService: class WorkerCommandEpochService {},
}));
jest.mock('@core/services/workerCommandLane.service', () => ({
  WorkerCommandLaneService: class WorkerCommandLaneService {},
}));

jest.mock('@core/config/environments', () => ({
  baileysEnvironment: mockBaileysEnvironment,
  wwebjsEnvironment: mockWwebjsEnvironment,
}));

jest.mock('tsyringe', () => ({
  container: {
    resolve: jest.fn((token: { name?: string }) => {
      if (token.name === 'WorkerCommandEpochService') {
        return { dependency: 'epochs' };
      }
      if (token.name === 'WorkerCommandLaneService') {
        return { dependency: 'lanes' };
      }
      return handler(token.name ?? 'unknown');
    }),
  },
}));

jest.mock('@core/services/workerCommandJetStreamIngress.service', () => ({
  WorkerCommandJetStreamIngressService: class WorkerCommandJetStreamIngressService {
    public readonly execute = jest.fn(async () => {
      mockLifecycleOrder.push('execute');
    });

    constructor(
      public readonly options: (typeof mockIngressInstances)[number]['options'],
      public readonly epochs: unknown,
      public readonly lanes: unknown
    ) {
      mockIngressInstances.push(this);
    }
  },
}));

const startupCases = [
  {
    provider: 'baileys',
    modulePath:
      '../../../../apps/worker_baileys/src/consumer/workerCommandIngress.consume',
    exportName: 'startWorkerCommandIngressConsume',
    accountId: 'account-baileys',
    workerId: 'worker-baileys',
    runtimeGeneration: 11,
    environment: mockBaileysEnvironment,
    handlerNames: {
      message: 'MessageSendConsume',
      schedule: 'ScheduleMessageConsume',
      notification: 'NotificationMessageSendConsume',
      markRead: 'MessageMarkReadConsume',
      workerConfig: 'WorkerConfigUpdateConsume',
      webhook: 'WebhookIntegrationConsume',
    },
  },
  {
    provider: 'wwebjs',
    modulePath:
      '../../../../apps/worker_wwebjs/src/consumer/workerCommandIngress.consume',
    exportName: 'startWorkerCommandIngressWwebjsConsume',
    accountId: 'account-wwebjs',
    workerId: 'worker-wwebjs',
    runtimeGeneration: 12,
    environment: mockWwebjsEnvironment,
    handlerNames: {
      message: 'MessageSendWwebjsConsume',
      schedule: 'ScheduleMessageWwebjsConsume',
      notification: 'NotificationMessageSendWwebjsConsume',
      markRead: 'MessageMarkReadWwebjsConsume',
      workerConfig: 'WorkerConfigUpdateWwebjsConsume',
      webhook: 'WebhookIntegrationWwebjsConsume',
    },
  },
] as const;

describe.each(startupCases)(
  '$provider worker command ingress startup',
  (testCase) => {
    const previousWriterEpoch = process.env.WORKER_WRITER_EPOCH;

    beforeEach(() => {
      jest.clearAllMocks();
      mockIngressInstances.length = 0;
      mockLifecycleOrder.length = 0;
      for (const key of Object.keys(mockHandlers)) {
        delete mockHandlers[key];
      }
      process.env.WORKER_WRITER_EPOCH = 'writer-epoch-1';
      testCase.environment.runtimeGeneration = testCase.runtimeGeneration;
    });

    afterAll(() => {
      if (previousWriterEpoch === undefined) {
        delete process.env.WORKER_WRITER_EPOCH;
      } else {
        process.env.WORKER_WRITER_EPOCH = previousWriterEpoch;
      }
    });

    function startup(): (
      server: unknown,
      onCreated?: (consumer: unknown) => void
    ) => Promise<unknown> {
      const loaded = require(testCase.modulePath) as Record<string, unknown>;
      return loaded[testCase.exportName] as (
        server: unknown,
        onCreated?: (consumer: unknown) => void
      ) => Promise<unknown>;
    }

    it('creates one fail-closed ingress and wires every migrated command handler', async () => {
      const onCreated = jest.fn(() => mockLifecycleOrder.push('created'));
      const server = { log: { error: jest.fn() } };

      await expect(startup()(server, onCreated)).resolves.toBeDefined();

      expect(mockIngressInstances).toHaveLength(1);
      const ingress = mockIngressInstances[0];
      expect(ingress.options).toMatchObject({
        accountId: testCase.accountId,
        workerId: testCase.workerId,
        runtimeWriterEpoch: 'writer-epoch-1',
        runtimeGeneration: testCase.runtimeGeneration,
      });
      expect(Object.keys(ingress.options.handlers).sort()).toEqual([
        'direct_send',
        'mark_read',
        'notification_send',
        'provider_command',
        'schedule_send',
        'webhook_integration',
        'worker_config',
      ]);
      expect(ingress.options.handlers).not.toHaveProperty('validate_phone');
      expect(mockLifecycleOrder).toEqual(['created', 'execute']);

      const assertActive = jest.fn();
      const input = {
        commandId: 'command-1',
        operationId: 'operation-1',
        entityKey: 'chat:account:worker:jid',
        entitySequence: 1,
        payload: { message_id: 'message-1' },
        assertActive,
      };
      await ingress.options.handlers.direct_send(input);
      await ingress.options.handlers.provider_command(input);
      await ingress.options.handlers.schedule_send(input);
      await ingress.options.handlers.notification_send(input);
      await ingress.options.handlers.mark_read(input);
      await ingress.options.handlers.worker_config(input);
      await ingress.options.handlers.webhook_integration(input);

      expect(
        handler(testCase.handlerNames.message).handleJetStreamCommand
      ).toHaveBeenNthCalledWith(1, input);
      expect(
        handler(testCase.handlerNames.message).handleJetStreamCommand
      ).toHaveBeenNthCalledWith(2, input);
      expect(
        handler(testCase.handlerNames.schedule).handleJetStreamCommand
      ).toHaveBeenCalledWith(input.payload, assertActive, input.operationId);
      expect(
        handler(testCase.handlerNames.notification).handleJetStreamCommand
      ).toHaveBeenCalledWith(input.payload, assertActive, input.operationId);
      expect(
        handler(testCase.handlerNames.markRead).handleJetStreamCommand
      ).toHaveBeenCalledWith(input.payload, assertActive);
      expect(
        handler(testCase.handlerNames.workerConfig).handleJetStreamCommand
      ).toHaveBeenCalledWith(input.payload, assertActive);
      expect(
        handler(testCase.handlerNames.webhook).handleJetStreamCommand
      ).toHaveBeenCalledWith('command-1', input.payload, assertActive);
    });

    it('requires the session writer only as the runtime-instance fence', async () => {
      delete process.env.WORKER_WRITER_EPOCH;

      await expect(startup()({ log: { error: jest.fn() } })).rejects.toThrow(
        'worker_command_runtime_writer_epoch_required'
      );

      expect(mockIngressInstances).toHaveLength(0);
    });

    it('rejects startup when the runtime generation is absent', async () => {
      testCase.environment.runtimeGeneration = undefined;

      await expect(startup()({ log: { error: jest.fn() } })).rejects.toThrow(
        'worker_command_runtime_generation_required'
      );

      expect(mockIngressInstances).toHaveLength(0);
    });
  }
);
