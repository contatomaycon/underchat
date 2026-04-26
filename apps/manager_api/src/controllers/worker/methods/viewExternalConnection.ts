import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WorkerExternalConnectionViewerUseCase } from '@core/useCases/worker/WorkerExternalConnectionViewer.useCase';
import { WorkerExternalConnectionRequest } from '@core/schema/worker/externalConnection/request.schema';
import { handleExternalConnectionError } from './handleExternalConnectionError';

export const viewExternalConnection = async (
  request: FastifyRequest<{
    Params: WorkerExternalConnectionRequest;
  }>,
  reply: FastifyReply
) => {
  const workerExternalConnectionViewerUseCase = container.resolve(
    WorkerExternalConnectionViewerUseCase
  );
  const { t } = request;

  try {
    const response = await workerExternalConnectionViewerUseCase.execute(
      t,
      request.params.token
    );

    return sendResponse(reply, {
      message: t('worker_external_connection_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleExternalConnectionError(error, reply, t);
  }
};
