import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { ReleaseListerUseCase } from '@core/useCases/release/ReleaseLister.useCase';

export const listRelease = async (
  request: FastifyRequest<{
    Querystring: ListReleaseRequest;
  }>,
  reply: FastifyReply
) => {
  const releaseListerUseCase = container.resolve(ReleaseListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await releaseListerUseCase.execute(
      request.query,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.permission_role_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('release_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('release_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
