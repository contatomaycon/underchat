import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteReleaseRequest } from '@core/schema/release/deleteRelease/request.schema';
import { ReleaseDeleterUseCase } from '@core/useCases/release/ReleaseDeleter.useCase';

export const deleteRelease = async (
  request: FastifyRequest<{
    Params: DeleteReleaseRequest;
  }>,
  reply: FastifyReply
) => {
  const releaseDeleterUseCase = container.resolve(ReleaseDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const result = await releaseDeleterUseCase.execute(
      t,
      request.params.release_id,
      tokenJwtData.user_id
    );

    if (result === 'not_found') {
      return sendResponse(reply, {
        message: t('release_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    if (result === 'forbidden') {
      return sendResponse(reply, {
        message: t('release_delete_forbidden'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    return sendResponse(reply, {
      message: t('release_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
