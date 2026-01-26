import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationKeyGeneratorUseCase } from '@core/useCases/integration/IntegrationKeyGenerator.useCase';

export const generateIntegrationKey = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationKeyGeneratorUseCase = container.resolve(
    IntegrationKeyGeneratorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const key = await integrationKeyGeneratorUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('integration_key_generated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { key },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
