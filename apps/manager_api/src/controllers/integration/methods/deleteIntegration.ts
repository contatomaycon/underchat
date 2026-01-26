import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationDeleterUseCase } from '@core/useCases/integration/IntegrationDeleter.useCase';
import { DeleteIntegrationRequest } from '@core/schema/integration/deleteIntegration/request.schema';

export const deleteIntegration = async (
  request: FastifyRequest<{
    Querystring: DeleteIntegrationRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationDeleterUseCase = container.resolve(
    IntegrationDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const success = await integrationDeleterUseCase.execute(
      tokenJwtData.account_id,
      request.query.api_key_id
    );

    if (!success) {
      return sendResponse(reply, {
        message: t('integration_deletion_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('integration_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
