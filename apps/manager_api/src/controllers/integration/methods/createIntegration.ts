import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationCreatorUseCase } from '@core/useCases/integration/IntegrationCreator.useCase';
import { CreateIntegrationRequest } from '@core/schema/integration/createIntegration/request.schema';

export const createIntegration = async (
  request: FastifyRequest<{
    Body: CreateIntegrationRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationCreatorUseCase = container.resolve(
    IntegrationCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationCreatorUseCase.execute(
      tokenJwtData.account_id,
      request.body
    );

    if (!result) {
      return sendResponse(reply, {
        message: t('integration_creation_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('integration_created_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
