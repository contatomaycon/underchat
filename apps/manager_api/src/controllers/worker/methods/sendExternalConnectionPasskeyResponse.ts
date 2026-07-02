import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionPasskeyUseCase } from '@core/useCases/worker/WorkerExternalConnectionPasskey.useCase';
import { WorkerExternalConnectionRequest } from '@core/schema/worker/externalConnection/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';

export interface PasskeyResponseBody {
  connection_attempt_id?: string;
  passkey_response: unknown;
}

export const sendExternalConnectionPasskeyResponse = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionRequest;
    Body: PasskeyResponseBody;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionPasskeyUseCase = container.resolve(
    WorkerExternalConnectionPasskeyUseCase
  );
  const { t } = request;

  try {
    const response = await workerExternalConnectionPasskeyUseCase.sendResponse(
      t,
      request.params.token,
      {
        connection_attempt_id: request.body.connection_attempt_id,
        passkey_response: request.body.passkey_response,
      }
    );

    return sendResponse(reply, {
      message: t('worker_external_connection_qrcode_success'),
      httpStatusCode: EHTTPStatusCode.accepted,
      data: response,
    });
  } catch (error) {
    handleExternalConnectionError(error, reply, t);
  }
};
