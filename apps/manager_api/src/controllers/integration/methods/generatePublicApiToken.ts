import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { PublicApiTokenGeneratorUseCase } from '@core/useCases/integration/PublicApiTokenGenerator.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const generatePublicApiToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const publicApiTokenGeneratorUseCase = container.resolve(
    PublicApiTokenGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await publicApiTokenGeneratorUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id
    );
    reply.header('Cache-Control', 'no-store');

    return sendResponse(reply, {
      message: t('public_api_token_generated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
