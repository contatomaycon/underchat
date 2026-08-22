import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));
jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class {},
}));
jest.mock('@core/services/chat.service', () => ({
  ChatService: class {},
}));
jest.mock(
  '@core/services/chatbotInactivityAlertChannelDeactivator.service',
  () => ({
    ChatbotInactivityAlertChannelDeactivatorService: class {},
  })
);

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { ChannelDeleterUseCase } from '@core/useCases/config/ChannelDeleter.useCase';

function workerMonitor(
  overrides: Partial<IWorkerMonitor> = {}
): IWorkerMonitor {
  return {
    worker_id: 'worker-1',
    name: 'Channel',
    account_id: 'acc-1',
    server_id: 'srv-1',
    worker_status_id: EWorkerStatus.online,
    worker_type_id: EWorkerType.baileys,
    created_at: '2026-07-27T20:00:00.000Z',
    updated_at: '2026-07-27T21:00:00.000Z',
    deleted_at: null,
    container_id: 'container-1',
    lifecycle_operation_id: null,
    last_connection_check_at: '2026-07-27T21:00:00.000Z',
    ...overrides,
  };
}

function buildUseCase(
  overrides: {
    workerService?: Record<string, unknown>;
    configService?: Record<string, unknown>;
    centrifugoService?: Record<string, unknown>;
    workerLifecycleQueueService?: Record<string, unknown>;
    chatService?: Record<string, unknown>;
    inactivityAlertChannelDeactivator?: Record<string, unknown>;
  } = {}
) {
  const workerService = {
    deleteWorkerById: jest.fn(async () => true),
    viewWorkerForMonitorConsistent: jest.fn(async () => workerMonitor()),
    updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    ...overrides.workerService,
  };
  const configService = {
    viewChannelContext: jest.fn(async () => ({
      worker_id: 'worker-1',
      account_id: 'acc-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.online,
      name: 'Channel',
    })),
    viewChannelBalancer: jest.fn(async () => ({
      account_id: 'acc-1',
      server_id: 'srv-1',
    })),
    ...overrides.configService,
  };
  const centrifugoService = {
    publishSub: jest.fn(async () => undefined),
    publish: jest.fn(async () => undefined),
    ...overrides.centrifugoService,
  };
  const workerLifecycleQueueService = {
    preparePermanentDeletion: jest.fn(
      async (input: {
        worker_id: string;
        account_id: string;
        server_id: string;
        worker_type_id: EWorkerType;
        source: string;
        lifecycle_operation_id?: string;
      }) => {
        const operationId =
          input.lifecycle_operation_id ?? 'delete-operation-1';
        return {
          request_id: 'delete-request-1',
          operation_id: operationId,
          action: 'delete' as const,
          worker_id: input.worker_id,
          account_id: input.account_id,
          server_id: input.server_id,
          worker_type_id: input.worker_type_id,
          worker_status_id: EWorkerStatus.deleting,
          source: input.source,
          debug_trace_id: operationId,
          requested_at: '2026-07-27T22:00:00.000Z',
        };
      }
    ),
    publish: jest.fn(async () => undefined),
    ...overrides.workerLifecycleQueueService,
  };
  const chatService = {
    countOpenChatsByWorkerId: jest.fn(async () => 0),
    ...overrides.chatService,
  };
  const inactivityAlertChannelDeactivator = {
    deactivateByChannel: jest.fn(async () => 0),
    ...overrides.inactivityAlertChannelDeactivator,
  };
  const useCase = new ChannelDeleterUseCase(
    workerService as never,
    configService as never,
    centrifugoService as never,
    workerLifecycleQueueService as never,
    chatService as never,
    inactivityAlertChannelDeactivator as never
  );

  return {
    useCase,
    deps: {
      workerService,
      configService,
      centrifugoService,
      workerLifecycleQueueService,
      chatService,
      inactivityAlertChannelDeactivator,
    },
  };
}

describe('ChannelDeleterUseCase', () => {
  it('interpolates the open conversation count with backend i18next syntax', async () => {
    const translations = JSON.parse(
      readFileSync(
        path.join(
          process.cwd(),
          'packages/plugins/i18next/locales/pt/translation.json'
        ),
        'utf8'
      )
    ) as Record<string, string>;
    const translator = i18next.createInstance();
    await translator.init({
      lng: 'pt',
      resources: { pt: { translation: translations } },
    });

    expect(
      translator.t('channel_delete_has_open_conversations', { count: 3 })
    ).toContain('Existem 3 conversa(s)');
  });

  it('throws when the channel does not exist', async () => {
    const { useCase, deps } = buildUseCase({
      configService: {
        viewChannelContext: jest.fn(async () => null),
      },
    });

    await expect(
      useCase.execute(((key: string) => key) as never, 'worker-1')
    ).rejects.toThrow('worker_not_found');
    expect(deps.chatService.countOpenChatsByWorkerId).not.toHaveBeenCalled();
  });

  it('throws when the channel still has open conversations', async () => {
    const { useCase, deps } = buildUseCase({
      chatService: {
        countOpenChatsByWorkerId: jest.fn(async () => 3),
      },
    });

    const translate = jest.fn((key: string, options?: { count?: number }) =>
      options?.count ? `${key}:${options.count}` : key
    );

    await expect(
      useCase.execute(translate as never, 'worker-1')
    ).rejects.toThrow('channel_delete_has_open_conversations:3');
    expect(translate).toHaveBeenCalledWith(
      'channel_delete_has_open_conversations',
      { count: 3 }
    );
    expect(
      deps.workerLifecycleQueueService.preparePermanentDeletion
    ).not.toHaveBeenCalled();
  });

  it('claims and durably queues a non-official channel deletion', async () => {
    const { useCase, deps } = buildUseCase();

    await expect(useCase.execute(jest.fn() as never, 'worker-1')).resolves.toBe(
      true
    );

    expect(
      deps.workerLifecycleQueueService.preparePermanentDeletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        server_id: 'srv-1',
        source: 'channel_delete',
      })
    );
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        operation_id: 'delete-operation-1',
      })
    );
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#acc-1',
      expect.objectContaining({
        event_type: 'status',
        action: EWorkerAction.delete,
        worker_status_id: EWorkerStatus.deleting,
        lifecycle_operation_id: 'delete-operation-1',
      })
    );
    expect(deps.centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({
        event_type: 'status',
        action: EWorkerAction.delete,
        lifecycle_operation_id: 'delete-operation-1',
      })
    );
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).toHaveBeenCalledWith('acc-1', 'worker-1');
  });

  it('surfaces durable transport failure while retaining the deleting claim', async () => {
    const { useCase, deps } = buildUseCase({
      workerLifecycleQueueService: {
        publish: jest.fn(async () => {
          throw new Error('kafka unavailable');
        }),
      },
    });

    await expect(
      useCase.execute(jest.fn() as never, 'worker-1')
    ).rejects.toThrow('kafka unavailable');

    expect(deps.workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      deps.workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).not.toHaveBeenCalled();
    expect(deps.centrifugoService.publishSub).not.toHaveBeenCalled();
  });

  it('deletes official WhatsApp locally without lifecycle runtime work', async () => {
    const { useCase, deps } = buildUseCase({
      configService: {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.whatsapp,
          worker_status_id: EWorkerStatus.online,
          name: 'Official',
        })),
      },
    });

    await expect(useCase.execute(jest.fn() as never, 'worker-1')).resolves.toBe(
      true
    );

    expect(deps.configService.viewChannelBalancer).not.toHaveBeenCalled();
    expect(
      deps.workerLifecycleQueueService.preparePermanentDeletion
    ).not.toHaveBeenCalled();
    expect(deps.workerService.deleteWorkerById).toHaveBeenCalledWith(
      'acc-1',
      'worker-1'
    );
    expect(
      deps.inactivityAlertChannelDeactivator.deactivateByChannel
    ).toHaveBeenCalledWith('acc-1', 'worker-1');
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#acc-1',
      expect.objectContaining({
        event_type: 'status',
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.delete,
      })
    );
  });
});
