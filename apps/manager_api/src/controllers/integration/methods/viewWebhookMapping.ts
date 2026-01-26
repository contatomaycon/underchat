import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WebhookMappingViewerUseCase } from '@core/useCases/integration/WebhookMappingViewer.useCase';

export const viewWebhookMapping = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const webhookMappingViewerUseCase = container.resolve(
    WebhookMappingViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await webhookMappingViewerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('webhook_mapping_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
