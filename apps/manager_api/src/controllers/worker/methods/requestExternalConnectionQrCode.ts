import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerExternalConnectionQrCodeRequester.useCase';
import { WorkerExternalConnectionRequest } from '@core/schema/worker/externalConnection/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

export const requestExternalConnectionQrCode = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionRequest;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionQrCodeRequesterUseCase = container.resolve(
    WorkerExternalConnectionQrCodeRequesterUseCase
  );
  const { t } = request;

  try {
    logConnectionFlowConsole('manager.http.connection_qr.received', {
      layer: 'manager.http',
      source: 'external',
      external_token_present: Boolean(request.params.token),
      external_token_len: request.params.token?.length ?? 0,
    });
    const response =
      await workerExternalConnectionQrCodeRequesterUseCase.execute(
        t,
        request.params.token
      );
    logConnectionFlowConsole('manager.http.connection_qr.accepted', {
      layer: 'manager.http',
      source: 'external',
      worker_id: response.worker_id,
      account_id: response.account_id,
      worker_type_id: response.worker_type_id,
      connection_attempt_id: response.connection_attempt_id,
      trace_id: response.debug_trace_id,
      status: response.status,
      code: response.code,
      has_qr: Boolean(response.qrcode),
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
    logConnectionFlowConsole('manager.http.connection_qr.error', {
      layer: 'manager.http',
      source: 'external',
      external_token_present: Boolean(request.params.token),
      external_token_len: request.params.token?.length ?? 0,
      reason: error instanceof Error ? error.message : String(error),
    });
    handleExternalConnectionError(error, reply, t);
  }
};
