import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationListerUseCase } from '@core/useCases/integration/IntegrationLister.useCase';
import { ListIntegrationsRequest } from '@core/schema/integration/listIntegrations/request.schema';

export const listIntegrations = async (
  request: FastifyRequest<{
    Querystring: ListIntegrationsRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationListerUseCase = container.resolve(IntegrationListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationListerUseCase.execute(
      tokenJwtData.account_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('integrations_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
