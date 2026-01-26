import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationSectorUsersListerUseCase } from '@core/useCases/integration/IntegrationSectorUsersLister.useCase';
import { ListIntegrationSectorUsersParams } from '@core/schema/integration/listSectorUsers/request.schema';

export const listSectorUsers = async (
  request: FastifyRequest<{
    Params: ListIntegrationSectorUsersParams;
  }>,
  reply: FastifyReply
) => {
  const integrationSectorUsersListerUseCase = container.resolve(
    IntegrationSectorUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationSectorUsersListerUseCase.execute(
      tokenJwtData.account_id,
      request.params.sector_id
    );

    return sendResponse(reply, {
      message: t('sector_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
