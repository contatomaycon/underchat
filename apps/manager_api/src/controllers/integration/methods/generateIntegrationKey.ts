import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationKeyGeneratorUseCase } from '@core/useCases/integration/IntegrationKeyGenerator.useCase';
import { GenerateIntegrationKeyRequest } from '@core/schema/integration/generateIntegrationKey/request.schema';

export const generateIntegrationKey = async (
  request: FastifyRequest<{
    Querystring: GenerateIntegrationKeyRequest;
  }>,
  reply: FastifyReply
) => {
  const integrationKeyGeneratorUseCase = container.resolve(
    IntegrationKeyGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const key = await integrationKeyGeneratorUseCase.execute(
      tokenJwtData.account_id,
      request.query.api_key_id
    );

    if (!key) {
      return sendResponse(reply, {
        message: t('integration_key_generation_error'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('integration_key_generated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { key },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
