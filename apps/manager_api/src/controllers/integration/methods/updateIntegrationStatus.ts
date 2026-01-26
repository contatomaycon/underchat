import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateIntegrationStatusRequest } from '@core/schema/integration/updateIntegrationStatus/request.schema';
import { IntegrationStatusUpdaterUseCase } from '@core/useCases/integration/IntegrationStatusUpdater.useCase';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const updateIntegrationStatus = async (
  request: FastifyRequest<{
    Body: UpdateIntegrationStatusRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationStatusUpdaterUseCase = container.resolve(
    IntegrationStatusUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const success = await integrationStatusUpdaterUseCase.execute(
      tokenJwtData.account_id,
      request.body.api_key_id,
      request.body.status as EStatusApiKey
    );

    if (!success) {
      return sendResponse(reply, {
        message: t('integration_status_update_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('integration_status_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
