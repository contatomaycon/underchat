import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationViewerByIdUseCase } from '@core/useCases/integration/IntegrationViewerById.useCase';
import { ViewIntegrationByIdRequest } from '@core/schema/integration/viewIntegrationById/request.schema';

export const viewIntegrationById = async (
  request: FastifyRequest<{
    Querystring: ViewIntegrationByIdRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationViewerByIdUseCase = container.resolve(
    IntegrationViewerByIdUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationViewerByIdUseCase.execute(
      tokenJwtData.account_id,
      request.query.api_key_id
    );

    return sendResponse(reply, {
      message: t('integration_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
