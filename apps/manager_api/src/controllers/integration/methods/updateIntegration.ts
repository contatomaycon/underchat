import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationUpdaterUseCase } from '@core/useCases/integration/IntegrationUpdater.useCase';
import { UpdateIntegrationRequest } from '@core/schema/integration/updateIntegration/request.schema';

export const updateIntegration = async (
  request: FastifyRequest<{
    Querystring: { api_key_id: string };
    Body: UpdateIntegrationRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationUpdaterUseCase = container.resolve(
    IntegrationUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const success = await integrationUpdaterUseCase.execute(
      tokenJwtData.account_id,
      request.query.api_key_id,
      request.body
    );

    if (!success) {
      return sendResponse(reply, {
        message: t('integration_update_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('integration_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
