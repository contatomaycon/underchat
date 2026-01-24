import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { ReleaseCreatorUseCase } from '@core/useCases/release/ReleaseCreator.useCase';
import { CreateReleaseResponse } from '@core/schema/release/createRelease/response.schema';

export const createRelease = async (
  request: FastifyRequest<{
    Body: CreateReleaseRequest;
  }>,
  reply: FastifyReply
) => {
  const releaseCreatorUseCase = container.resolve(ReleaseCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const releaseId = await releaseCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.actions
    );

    const response: CreateReleaseResponse = {
      release_id: releaseId,
    };

    return sendResponse(reply, {
      message: t('release_create_success'),
      httpStatusCode: EHTTPStatusCode.created,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
