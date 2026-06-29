import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappEmbeddedConfigViewerUseCase } from '@core/useCases/worker/WhatsappEmbeddedConfigViewer.useCase';

export const viewWhatsappEmbeddedConfig = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const whatsappEmbeddedConfigViewerUseCase = container.resolve(
    WhatsappEmbeddedConfigViewerUseCase
  );
  const { t } = request;

  try {
    const response = await whatsappEmbeddedConfigViewerUseCase.execute();

    return sendResponse(reply, {
      message: t('whatsapp_embedded_config_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
