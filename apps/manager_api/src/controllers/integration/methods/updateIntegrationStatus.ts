import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateIntegrationStatusRequest } from '@core/schema/integration/updateIntegrationStatus/request.schema';
import { IntegrationStatusUpdaterUseCase } from '@core/useCases/integration/IntegrationStatusUpdater.useCase';

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
    await integrationStatusUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body.status
    );

    return sendResponse(reply, {
      message: t('integration_status_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
