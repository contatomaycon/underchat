import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationUsersListerUseCase } from '@core/useCases/integration/IntegrationUsersLister.useCase';

export const listUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationUsersListerUseCase = container.resolve(
    IntegrationUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationUsersListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
