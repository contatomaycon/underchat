import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappEmbeddedConfigUpdaterUseCase } from '@core/useCases/config/WhatsappEmbeddedConfigUpdater.useCase';
import { UpdateWhatsappEmbeddedConfigRequest } from '@core/schema/config/updateWhatsappEmbeddedConfig/request.schema';

export const updateWhatsappEmbeddedConfig = async (
  request: FastifyRequest<{ Body: UpdateWhatsappEmbeddedConfigRequest }>,
  reply: FastifyReply
) => {
  const whatsappEmbeddedConfigUpdaterUseCase = container.resolve(
    WhatsappEmbeddedConfigUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await whatsappEmbeddedConfigUpdaterUseCase.execute(
      t,
      request.body
    );

    return sendResponse(reply, {
      message: t('whatsapp_embedded_config_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
