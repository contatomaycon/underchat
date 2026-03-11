import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RetryServerBuildRequest } from '@core/schema/server/retryServerBuild/request.schema';
import { ServerBuildRetryItemUseCase } from '@core/useCases/server/ServerBuildRetryItem.useCase';

export const retryServerBuild = async (
  request: FastifyRequest<{
    Body: RetryServerBuildRequest;
  }>,
  reply: FastifyReply
) => {
  const serverBuildRetryItemUseCase = container.resolve(
    ServerBuildRetryItemUseCase
  );
  const { t } = request;

  try {
    const response = await serverBuildRetryItemUseCase.execute(
      t,
      request.body.server_build_job_id,
      request.body.build_type
    );

    if (!response) {
      return sendResponse(reply, {
        message: t('server_build_retry_not_allowed'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_retry_success'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
