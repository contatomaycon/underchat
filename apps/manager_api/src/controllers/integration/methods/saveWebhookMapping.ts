import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SaveWebhookMappingRequest } from '@core/schema/integration/saveWebhookMapping/request.schema';
import { WebhookMappingSaverUseCase } from '@core/useCases/integration/WebhookMappingSaver.useCase';
import { WebhookMappingValidationError } from '@core/common/exceptions/WebhookMappingValidationError';

export const saveWebhookMapping = async (
  request: FastifyRequest<{
    Body: SaveWebhookMappingRequest;
  }>,
  reply: FastifyReply
) => {
  const webhookMappingSaverUseCase = container.resolve(
    WebhookMappingSaverUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const success = await webhookMappingSaverUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body.api_key_id,
      request.body.mapping
    );

    return sendResponse(reply, {
      message: t('webhook_mapping_saved_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success },
    });
  } catch (error) {
    if (error instanceof WebhookMappingValidationError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    handleControllerError(error, reply, t);
  }
};
