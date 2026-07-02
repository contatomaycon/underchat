import 'reflect-metadata';

import { WorkerConnectionPasskeyUseCase } from '@core/useCases/worker/WorkerConnectionPasskey.useCase';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerType } from '@core/common/enums/EWorkerType';

const t = ((key: string) => {
  const messages: Record<string, string> = {
    worker_not_found: 'Worker not found!',
    worker_type_invalid: 'Worker type invalid!',
    worker_passkey_response_invalid: 'Invalid passkey response.',
  };
  return messages[key] ?? key;
}) as never;

const validPasskeyResponse = {
  id: 'credential-id',
  rawId: 'Y3JlZGVudGlhbC1pZA',
  type: 'public-key',
  response: {
    clientDataJSON: 'Y2xpZW50LWRhdGE',
    authenticatorData: 'YXV0aGVudGljYXRvci1kYXRh',
    signature: 'c2lnbmF0dXJl',
    userHandle: null,
  },
};

function makeUseCase(workerTypeId: EWorkerType = EWorkerType.baileys) {
  const workerService = {
    existsWorkerById: jest.fn(async () => true),
    viewWorker: jest.fn(async () => ({
      id: 'worker-1',
      type: { id: workerTypeId },
    })),
  };
  const workerBaileysGrpcClientService = {
    sendPasskeyResponse: jest.fn(async () => ({
      code: ECodeMessage.pairingInProgress,
      status: EBaileysConnectionStatus.connecting,
      worker_id: 'worker-1',
      account_id: 'account-1',
      worker_type_id: workerTypeId,
    })),
    confirmPasskey: jest.fn(),
  };
  const useCase = new WorkerConnectionPasskeyUseCase(
    workerService as never,
    workerBaileysGrpcClientService as never
  );

  return { useCase, workerBaileysGrpcClientService };
}

describe('WorkerConnectionPasskeyUseCase', () => {
  it('serializes a valid passkey response object before calling gRPC', async () => {
    const deps = makeUseCase();

    await deps.useCase.sendResponse(t, 'account-1', 'worker-1', {
      connection_attempt_id: 'attempt-1',
      passkey_response: validPasskeyResponse,
      debug_trace_id: 'trace-1',
    });

    expect(
      deps.workerBaileysGrpcClientService.sendPasskeyResponse
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        account_id: 'account-1',
        connection_attempt_id: 'attempt-1',
        passkey_response: JSON.stringify(validPasskeyResponse),
        debug_trace_id: 'trace-1',
      }),
      EWorkerType.baileys
    );
  });

  it('accepts a valid JSON string response', async () => {
    const deps = makeUseCase(EWorkerType.whatsmeow);
    const serialized = JSON.stringify(validPasskeyResponse);

    await deps.useCase.sendResponse(t, 'account-1', 'worker-1', {
      passkey_response: serialized,
    });

    expect(
      deps.workerBaileysGrpcClientService.sendPasskeyResponse
    ).toHaveBeenCalledWith(
      'worker-1',
      expect.objectContaining({
        passkey_response: serialized,
      }),
      EWorkerType.whatsmeow
    );
  });

  it('rejects invalid passkey response payloads before calling gRPC', async () => {
    const deps = makeUseCase();

    await expect(
      deps.useCase.sendResponse(t, 'account-1', 'worker-1', {
        passkey_response: '{}',
      })
    ).rejects.toThrow('Invalid passkey response.');

    expect(
      deps.workerBaileysGrpcClientService.sendPasskeyResponse
    ).not.toHaveBeenCalled();
  });
});
