import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionLinkCreatorUseCase } from '@core/useCases/worker/WorkerExternalConnectionLinkCreator.useCase';
import { WorkerExternalConnectionLinkRequest } from '@core/schema/worker/externalConnectionLink/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';

export const createExternalConnectionLink = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionLinkRequest;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionLinkCreatorUseCase = container.resolve(
    WorkerExternalConnectionLinkCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const origin = Array.isArray(request.headers.origin)
      ? request.headers.origin[0]
      : request.headers.origin;
    const response = await workerExternalConnectionLinkCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      origin
    );

    return sendResponse(reply, {
      message: t('worker_external_connection_link_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleExternalConnectionError(error, reply, t);
  }
};
