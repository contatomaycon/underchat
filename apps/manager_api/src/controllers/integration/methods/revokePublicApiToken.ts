import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { PublicApiTokenRevokerUseCase } from '@core/useCases/integration/PublicApiTokenRevoker.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const revokePublicApiToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const publicApiTokenRevokerUseCase = container.resolve(
    PublicApiTokenRevokerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await publicApiTokenRevokerUseCase.execute(
      tokenJwtData.account_id
    );
    reply.header('Cache-Control', 'no-store');

    return sendResponse(reply, {
      message: t('public_api_token_revoked_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
