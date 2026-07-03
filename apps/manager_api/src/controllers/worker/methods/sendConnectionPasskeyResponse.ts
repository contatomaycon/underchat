import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerConnectionPasskeyUseCase } from '@core/useCases/worker/WorkerConnectionPasskey.useCase';
import { WorkerConnectionQrCodeRequest } from '@core/schema/worker/connectionQrCode/request.schema';
import { extractConnectionLifecycleDebugTraceIdFromHeaders } from '@core/services/connectionLifecycleDebug.service';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

export interface PasskeyResponseBody {
  connection_attempt_id?: string;
  passkey_response: unknown;
}

export const sendConnectionPasskeyResponse = async (
  request: FastifyRequest<{
    Params: WorkerConnectionQrCodeRequest;
    Body: PasskeyResponseBody;
  }>,
  reply: FastifyReply
) => {
  const workerConnectionPasskeyUseCase = container.resolve(
    WorkerConnectionPasskeyUseCase
  );
  const { t, tokenJwtData } = request;
  const debugTraceId = extractConnectionLifecycleDebugTraceIdFromHeaders(
    request.headers as Record<string, string | string[] | undefined>
  );

  try {
    logConnectionFlowConsole('manager.http.passkey_response.received', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      connection_attempt_id: request.body.connection_attempt_id,
      trace_id: debugTraceId,
      source: 'authenticated',
      passkey_response: request.body.passkey_response,
    });
    const response = await workerConnectionPasskeyUseCase.sendResponse(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      {
        connection_attempt_id: request.body.connection_attempt_id,
        passkey_response: request.body.passkey_response,
        debug_trace_id: debugTraceId,
      }
    );
    logConnectionFlowConsole('manager.http.passkey_response.accepted', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: response.account_id ?? tokenJwtData.account_id,
      worker_type_id: response.worker_type_id,
      connection_attempt_id:
        response.connection_attempt_id ?? request.body.connection_attempt_id,
      trace_id: response.debug_trace_id ?? debugTraceId,
      status: response.status,
      code: response.code,
      reason: response.reason,
      source: 'authenticated',
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
    logConnectionFlowConsole('manager.http.passkey_response.error', {
      layer: 'manager.http',
      worker_id: request.params.worker_id,
      account_id: tokenJwtData.account_id,
      connection_attempt_id: request.body.connection_attempt_id,
      trace_id: debugTraceId,
      source: 'authenticated',
      reason: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error) {
      const statusCodeByMessage: Record<string, EHTTPStatusCode> = {
        [t('worker_not_found')]: EHTTPStatusCode.not_found,
        [t('worker_type_invalid')]: EHTTPStatusCode.bad_request,
        [t('worker_passkey_response_invalid')]: EHTTPStatusCode.bad_request,
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
