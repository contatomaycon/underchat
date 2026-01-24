import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditReleaseParamsRequest,
  EditReleaseBodyRequest,
} from '@core/schema/release/editRelease/request.schema';
import { ReleaseUpdaterUseCase } from '@core/useCases/release/ReleaseUpdater.useCase';

export const editRelease = async (
  request: FastifyRequest<{
    Params: EditReleaseParamsRequest;
    Body: EditReleaseBodyRequest;
  }>,
  reply: FastifyReply
) => {
  const releaseUpdaterUseCase = container.resolve(ReleaseUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const result = await releaseUpdaterUseCase.execute(
      request.params.release_id,
      tokenJwtData.user_id,
      request.body
    );

    if (result === 'not_found') {
      return sendResponse(reply, {
        message: t('release_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    if (result === 'forbidden') {
      return sendResponse(reply, {
        message: t('release_edit_forbidden'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    return sendResponse(reply, {
      message: t('release_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
