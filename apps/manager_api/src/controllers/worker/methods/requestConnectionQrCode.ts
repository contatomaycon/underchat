import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionQrCodeRequesterUseCase } from '@core/useCases/worker/WorkerConnectionQrCodeRequester.useCase';
import { WorkerConnectionQrCodeRequest } from '@core/schema/worker/connectionQrCode/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

export const requestConnectionQrCode = async (
  request: FastifyRequest<{
    Params: WorkerConnectionQrCodeRequest;
  }>,
  reply: FastifyReply
) => {
  const workerConnectionQrCodeRequesterUseCase = container.resolve(
    WorkerConnectionQrCodeRequesterUseCase
  );
  const { t, tokenJwtData } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    logConnectionFlowConsole('manager.http.connection_qr.received', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      trace_id: debugTraceId,
      source: 'authenticated',
    });
    const response = await workerConnectionQrCodeRequesterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      'manager',
      debugTraceId
    );
    logConnectionFlowConsole('manager.http.connection_qr.accepted', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      trace_id: response.debug_trace_id ?? debugTraceId,
      connection_attempt_id: response.connection_attempt_id,
      status: response.status,
      code: response.code,
      has_qr: Boolean(response.qrcode),
      has_passkey_public_key: Boolean(response.passkey_public_key),
      has_passkey_confirmation_code: Boolean(
        response.passkey_confirmation_code
      ),
      source: 'authenticated',
    });

    return sendResponse(reply, {
      message: t('worker_external_connection_qrcode_success'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    logConnectionFlowConsole('manager.http.connection_qr.error', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      trace_id: debugTraceId,
      source: 'authenticated',
      reason: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
        [t('worker_not_found')]: EHTTPStatusCode.not_found,
        [t('worker_qrcode_not_ready')]: EHTTPStatusCode.service_unavailable,
      };
      const httpStatusCode = statusCodeByMessage[error.message];
      if (httpStatusCode) {
        return sendResponse(reply, {
          message: error.message,
          httpStatusCode,
        });
      }
    }
    handleControllerError(error, reply, t);
  }
};
