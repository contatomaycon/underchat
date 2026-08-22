import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { DeleteServerBuildVersionRequest } from '@core/schema/server/deleteServerBuildVersion/request.schema';
import { ServerBuildVersionDeleterUseCase } from '@core/useCases/server/ServerBuildVersionDeleter.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const deleteServerBuildVersion = async (
  request: FastifyRequest<{
    Params: DeleteServerBuildVersionRequest;
  }>,
  reply: FastifyReply
) => {
  const { t } = request;
  const serverBuildVersionDeleterUseCase = container.resolve(
    ServerBuildVersionDeleterUseCase
  );

  try {
    const response = await serverBuildVersionDeleterUseCase.execute(
      t,
      request.params.server_build_version_id
    );

    if (response.status === 'not_found') {
      return sendResponse(reply, {
        message: t('server_build_version_delete_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    if (response.status === 'conflict_active') {
      return sendResponse(reply, {
        message: t('server_build_version_delete_active_conflict'),
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    if (response.status === 'conflict_default') {
      return sendResponse(reply, {
        message: t('server_build_version_delete_default_conflict'),
        httpStatusCode: EHTTPStatusCode.conflict,
      });
    }

    return sendResponse(reply, {
      message: t('server_build_version_delete_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response.data,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
