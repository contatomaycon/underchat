import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DeleteServerBuildRequest } from '@core/schema/server/deleteServerBuild/request.schema';
import { ServerBuildDeleterUseCase } from '@core/useCases/server/ServerBuildDeleter.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const deleteServerBuild = async (
  request: FastifyRequest<{
    Params: DeleteServerBuildRequest;
  }>,
  reply: FastifyReply
) => {
  const { t } = request;
  const serverBuildDeleterUseCase = container.resolve(
    ServerBuildDeleterUseCase
  );

  try {
    const response = await serverBuildDeleterUseCase.execute(
      t,
      request.params.server_build_job_id
    );

    if (response.status === 'not_found') {
      return sendResponse(reply, {
        message: t('server_build_delete_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    if (response.status === 'conflict_active') {
      return sendResponse(reply, {
        message: t('server_build_delete_active_conflict'),
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    if (response.status === 'conflict_default') {
      return sendResponse(reply, {
        message: t('server_build_delete_default_conflict'),
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_delete_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response.data,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
