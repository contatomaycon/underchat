import 'reflect-metadata';

jest.mock('@core/services/chat.service', () => ({
  ChatService: class {},
}));

import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { WhatsappOfficialDisconnecterUseCase } from '@core/useCases/worker/WhatsappOfficialDisconnecter.useCase';

const t = ((key: string, options?: { count?: number }) =>
  options?.count ? `${key}:${options.count}` : key) as never;

const connection = {
  worker_whatsapp_official_connection_id: 'connection-1',
  worker_id: 'worker-1',
  waba_id: 'waba-1',
  phone_number_id: 'phone-1',
  access_token_encrypted: 'encrypted-token',
  api_version: 'v24.0',
};

function buildDeps() {
  return {
    workerService: {
      viewWorker: jest.fn(async () => ({
        id: 'worker-1',
        name: 'Maycon',
        type: { id: EWorkerType.whatsapp },
      })),
      viewWorkerBalancer: jest.fn(async () => ({
        worker_id: 'worker-1',
        server_id: 'server-1',
        account_id: 'account-1',
      })),
      deleteWorkerById: jest.fn(async () => true),
    },
    chatService: {
      countOpenChatsByWorkerId: jest.fn(async () => 0),
    },
    centrifugoService: {
      publishSub: jest.fn(async () => undefined),
    },
    officialConnectionRepository: {
      findActiveByWorkerId: jest.fn(async () => connection),
      countActiveByWabaIdExceptWorkerId: jest.fn(async () => 0),
      softDeleteByWorkerId: jest.fn(async () => true),
      disconnectPreservingWorker: jest.fn(async () => true),
    },
    metaWhatsappEmbeddedService: {
      unsubscribeWabaApp: jest.fn(async () => true),
    },
    passwordEncryptorService: {
      decrypt: jest.fn(() => 'plain-token'),
    },
  };
}

function buildUseCase(deps = buildDeps()) {
  return new WhatsappOfficialDisconnecterUseCase(
    deps.workerService as never,
    deps.chatService as never,
    deps.centrifugoService as never,
    deps.officialConnectionRepository as never,
    deps.metaWhatsappEmbeddedService as never,
    deps.passwordEncryptorService as never
  );
}

describe('WhatsappOfficialDisconnecterUseCase', () => {
  it('disconnects official WhatsApp locally and unsubscribes Meta when it is the last WABA connection', async () => {
    const deps = buildDeps();
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toEqual({
      worker_id: 'worker-1',
      disconnected: true,
      meta_unsubscribed: true,
      meta_warning: null,
    });

    expect(
      deps.officialConnectionRepository.disconnectPreservingWorker
    ).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
    });
    expect(deps.centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#account-1',
      expect.objectContaining({
        code: ECodeMessage.loggedOut,
        status: EBaileysConnectionStatus.disconnected,
        worker_id: 'worker-1',
        worker_name: 'Maycon',
        account_id: 'account-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.offline,
        disconnected_user: true,
        session_ready: false,
      })
    );
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.softDeleteByWorkerId
    ).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.countActiveByWabaIdExceptWorkerId
    ).toHaveBeenCalledWith('waba-1', 'worker-1');
    expect(deps.passwordEncryptorService.decrypt).toHaveBeenCalledWith(
      'encrypted-token'
    );
    expect(
      deps.metaWhatsappEmbeddedService.unsubscribeWabaApp
    ).toHaveBeenCalledWith({
      apiVersion: 'v24.0',
      accessToken: 'plain-token',
      wabaId: 'waba-1',
    });
  });

  it('does not unsubscribe Meta when another active channel uses the same WABA', async () => {
    const deps = buildDeps();
    deps.officialConnectionRepository.countActiveByWabaIdExceptWorkerId.mockResolvedValue(
      1
    );
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toEqual({
      worker_id: 'worker-1',
      disconnected: true,
      meta_unsubscribed: false,
      meta_warning: null,
    });

    expect(deps.passwordEncryptorService.decrypt).not.toHaveBeenCalled();
    expect(
      deps.metaWhatsappEmbeddedService.unsubscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('keeps local disconnect complete when Meta returns permission error', async () => {
    const deps = buildDeps();
    deps.metaWhatsappEmbeddedService.unsubscribeWabaApp.mockRejectedValue(
      new Error('(#200) Permissions error')
    );
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toEqual({
      worker_id: 'worker-1',
      disconnected: true,
      meta_unsubscribed: false,
      meta_warning: 'whatsapp_official_disconnect_meta_permission_warning',
    });

    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.disconnectPreservingWorker
    ).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
    });
  });

  it('is idempotent when the official worker has no active connection', async () => {
    const deps = buildDeps();
    deps.officialConnectionRepository.findActiveByWorkerId.mockResolvedValue(
      null as never
    );
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).resolves.toEqual({
      worker_id: 'worker-1',
      disconnected: true,
      meta_unsubscribed: false,
      meta_warning: null,
    });

    expect(
      deps.officialConnectionRepository.disconnectPreservingWorker
    ).toHaveBeenCalledWith({
      accountId: 'account-1',
      workerId: 'worker-1',
    });
    expect(
      deps.officialConnectionRepository.countActiveByWabaIdExceptWorkerId
    ).not.toHaveBeenCalled();
    expect(
      deps.metaWhatsappEmbeddedService.unsubscribeWabaApp
    ).not.toHaveBeenCalled();
  });

  it('rejects non-official workers', async () => {
    const deps = buildDeps();
    deps.workerService.viewWorker.mockResolvedValue({
      id: 'worker-1',
      name: 'Maycon',
      type: { id: EWorkerType.baileys },
    });
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'whatsapp_official_disconnect_only_official'
    );
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.disconnectPreservingWorker
    ).not.toHaveBeenCalled();
  });

  it('rejects official workers with open conversations', async () => {
    const deps = buildDeps();
    deps.chatService.countOpenChatsByWorkerId.mockResolvedValue(2);
    const useCase = buildUseCase(deps);

    await expect(useCase.execute(t, 'account-1', 'worker-1')).rejects.toThrow(
      'channel_delete_has_open_conversations:2'
    );
    expect(deps.workerService.deleteWorkerById).not.toHaveBeenCalled();
    expect(
      deps.officialConnectionRepository.disconnectPreservingWorker
    ).not.toHaveBeenCalled();
  });
});
