import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionPasskeyUseCase } from '@core/useCases/worker/WorkerExternalConnectionPasskey.useCase';
import { WorkerExternalConnectionRequest } from '@core/schema/worker/externalConnection/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

export interface PasskeyConfirmationBody {
  connection_attempt_id?: string;
}

export const confirmExternalConnectionPasskey = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionRequest;
    Body: PasskeyConfirmationBody;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionPasskeyUseCase = container.resolve(
    WorkerExternalConnectionPasskeyUseCase
  );
  const { t } = request;

  try {
    logConnectionFlowConsole('manager.http.passkey_confirmation.received', {
      layer: 'manager.http',
      source: 'external',
      external_token_present: Boolean(request.params.token),
      external_token_len: request.params.token?.length ?? 0,
      connection_attempt_id: request.body.connection_attempt_id,
    });
    const response = await workerExternalConnectionPasskeyUseCase.confirm(
      t,
      request.params.token,
      {
        connection_attempt_id: request.body.connection_attempt_id,
      }
    );
    logConnectionFlowConsole('manager.http.passkey_confirmation.accepted', {
      layer: 'manager.http',
      source: 'external',
      worker_id: response.worker_id,
      account_id: response.account_id,
      worker_type_id: response.worker_type_id,
      connection_attempt_id:
        response.connection_attempt_id ?? request.body.connection_attempt_id,
      trace_id: response.debug_trace_id,
      status: response.status,
      code: response.code,
      reason: response.reason,
      has_passkey_public_key: Boolean(response.passkey_public_key),
      has_passkey_confirmation_code: Boolean(
        response.passkey_confirmation_code
      ),
    });

    return sendResponse(reply, {
      message: t('worker_external_connection_qrcode_success'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    logConnectionFlowConsole('manager.http.passkey_confirmation.error', {
      layer: 'manager.http',
      source: 'external',
      external_token_present: Boolean(request.params.token),
      external_token_len: request.params.token?.length ?? 0,
      connection_attempt_id: request.body.connection_attempt_id,
      reason: error instanceof Error ? error.message : String(error),
    });
    handleExternalConnectionError(error, reply, t);
  }
};
