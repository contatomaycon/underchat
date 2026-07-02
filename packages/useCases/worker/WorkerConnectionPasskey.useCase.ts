import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { WorkerBaileysGrpcClientService } from '@core/services/workerBaileysGrpcClient.service';

export interface WorkerConnectionPasskeyResponseInput {
  connection_attempt_id?: string;
  passkey_response: unknown;
  debug_trace_id?: string;
}

export interface WorkerConnectionPasskeyConfirmationInput {
  connection_attempt_id?: string;
  debug_trace_id?: string;
}

@injectable()
export class WorkerConnectionPasskeyUseCase {
  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerBaileysGrpcClientService)
    private readonly workerBaileysGrpcClientService: WorkerBaileysGrpcClientService
  ) {}

  async sendResponse(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    input: WorkerConnectionPasskeyResponseInput
  ): Promise<IBaileysConnectionState> {
    const worker = await this.resolveWhatsmeowWorker(t, accountId, workerId);
    const passkeyResponse = this.serializePasskeyResponse(
      t,
      input.passkey_response
    );

    return this.workerBaileysGrpcClientService.sendPasskeyResponse(
      workerId,
      {
        worker_id: workerId,
        account_id: accountId,
        connection_attempt_id: input.connection_attempt_id,
        passkey_response: passkeyResponse,
        debug_trace_id: input.debug_trace_id,
      },
      worker.type?.id as EWorkerType
    );
  }

  async confirm(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    input: WorkerConnectionPasskeyConfirmationInput
  ): Promise<IBaileysConnectionState> {
    const worker = await this.resolveWhatsmeowWorker(t, accountId, workerId);

    return this.workerBaileysGrpcClientService.confirmPasskey(
      workerId,
      {
        worker_id: workerId,
        account_id: accountId,
        connection_attempt_id: input.connection_attempt_id,
        debug_trace_id: input.debug_trace_id,
      },
      worker.type?.id as EWorkerType
    );
  }

  private async resolveWhatsmeowWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string
  ) {
    const exists = await this.workerService.existsWorkerById(
      accountId,
      workerId
    );

    if (!exists) {
      throw new Error(t('worker_not_found'));
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);
    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    if (worker.type?.id !== EWorkerType.whatsmeow) {
      throw new Error(t('worker_type_invalid'));
    }

    return worker;
  }

  private serializePasskeyResponse(
    t: TFunction<'translation', undefined>,
    passkeyResponse: unknown
  ): string {
    if (typeof passkeyResponse === 'string') {
      const trimmed = passkeyResponse.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    if (passkeyResponse && typeof passkeyResponse === 'object') {
      return JSON.stringify(passkeyResponse);
    }

    throw new Error(t('worker_passkey_response_invalid'));
  }
}
