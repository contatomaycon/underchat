import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewReleaseParamsRequest } from '@core/schema/release/viewRelease/request.schema';
import { ReleaseViewerUseCase } from '@core/useCases/release/ReleaseViewer.useCase';

export const viewRelease = async (
  request: FastifyRequest<{
    Params: ViewReleaseParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const releaseViewerUseCase = container.resolve(ReleaseViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await releaseViewerUseCase.execute(
      t,
      request.params.release_id,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('release_viewed_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('release_not_found'),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
