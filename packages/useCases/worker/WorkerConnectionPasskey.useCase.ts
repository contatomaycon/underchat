import { inject, injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { WorkerBaileysGrpcClientService } from '@core/services/workerBaileysGrpcClient.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

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
    logConnectionFlowConsole('manager.passkey.use_case.response_start', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: input.connection_attempt_id,
      trace_id: input.debug_trace_id,
      passkey_response: input.passkey_response,
    });
    const worker = await this.resolvePasskeyWorker(t, accountId, workerId);
    const passkeyResponse = this.serializePasskeyResponse(
      t,
      input.passkey_response
    );

    logConnectionFlowConsole('manager.passkey.use_case.response_validated', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: worker.type?.id,
      connection_attempt_id: input.connection_attempt_id,
      trace_id: input.debug_trace_id,
      passkey_response: passkeyResponse,
    });

    const response =
      await this.workerBaileysGrpcClientService.sendPasskeyResponse(
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

    logConnectionFlowConsole('manager.passkey.use_case.response_done', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: response.account_id ?? accountId,
      worker_type_id: response.worker_type_id ?? worker.type?.id,
      connection_attempt_id:
        response.connection_attempt_id ?? input.connection_attempt_id,
      trace_id: response.debug_trace_id ?? input.debug_trace_id,
      status: response.status,
      code: response.code,
      reason: response.reason,
      has_passkey_public_key: Boolean(response.passkey_public_key),
      has_passkey_confirmation_code: Boolean(
        response.passkey_confirmation_code
      ),
    });
    return response;
  }

  async confirm(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    input: WorkerConnectionPasskeyConfirmationInput
  ): Promise<IBaileysConnectionState> {
    logConnectionFlowConsole('manager.passkey.use_case.confirm_start', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: input.connection_attempt_id,
      trace_id: input.debug_trace_id,
    });
    const worker = await this.resolvePasskeyWorker(t, accountId, workerId);

    const response = await this.workerBaileysGrpcClientService.confirmPasskey(
      workerId,
      {
        worker_id: workerId,
        account_id: accountId,
        connection_attempt_id: input.connection_attempt_id,
        debug_trace_id: input.debug_trace_id,
      },
      worker.type?.id as EWorkerType
    );

    logConnectionFlowConsole('manager.passkey.use_case.confirm_done', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: response.account_id ?? accountId,
      worker_type_id: response.worker_type_id ?? worker.type?.id,
      connection_attempt_id:
        response.connection_attempt_id ?? input.connection_attempt_id,
      trace_id: response.debug_trace_id ?? input.debug_trace_id,
      status: response.status,
      code: response.code,
      reason: response.reason,
      has_passkey_public_key: Boolean(response.passkey_public_key),
      has_passkey_confirmation_code: Boolean(
        response.passkey_confirmation_code
      ),
    });
    return response;
  }

  private async resolvePasskeyWorker(
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

    if (
      worker.type?.id !== EWorkerType.whatsmeow &&
      worker.type?.id !== EWorkerType.baileys
    ) {
      logConnectionFlowConsole('manager.passkey.use_case.worker_invalid', {
        layer: 'manager.use_case',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: worker.type?.id,
      });
      throw new Error(t('worker_type_invalid'));
    }

    logConnectionFlowConsole('manager.passkey.use_case.worker_resolved', {
      layer: 'manager.use_case',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: worker.type?.id,
    });
    return worker;
  }

  private serializePasskeyResponse(
    t: TFunction<'translation', undefined>,
    passkeyResponse: unknown
  ): string {
    if (typeof passkeyResponse === 'string') {
      const trimmed = passkeyResponse.trim();
      if (trimmed) {
        this.assertValidPasskeyResponse(
          t,
          this.parsePasskeyResponse(t, trimmed)
        );
        return trimmed;
      }
    }

    if (passkeyResponse && typeof passkeyResponse === 'object') {
      this.assertValidPasskeyResponse(t, passkeyResponse);
      return JSON.stringify(passkeyResponse);
    }

    throw new Error(t('worker_passkey_response_invalid'));
  }

  private parsePasskeyResponse(
    t: TFunction<'translation', undefined>,
    passkeyResponse: string
  ): unknown {
    try {
      return JSON.parse(passkeyResponse);
    } catch {
      throw new Error(t('worker_passkey_response_invalid'));
    }
  }

  private assertValidPasskeyResponse(
    t: TFunction<'translation', undefined>,
    passkeyResponse: unknown
  ): void {
    if (!passkeyResponse || typeof passkeyResponse !== 'object') {
      throw new Error(t('worker_passkey_response_invalid'));
    }

    const response = passkeyResponse as {
      id?: unknown;
      rawId?: unknown;
      type?: unknown;
      response?: {
        clientDataJSON?: unknown;
        authenticatorData?: unknown;
        signature?: unknown;
      };
    };

    if (
      !this.isNonEmptyString(response.id) ||
      !this.isNonEmptyString(response.rawId) ||
      !this.isNonEmptyString(response.type) ||
      !response.response ||
      typeof response.response !== 'object' ||
      !this.isNonEmptyString(response.response.clientDataJSON) ||
      !this.isNonEmptyString(response.response.authenticatorData) ||
      !this.isNonEmptyString(response.response.signature)
    ) {
      throw new Error(t('worker_passkey_response_invalid'));
    }
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
