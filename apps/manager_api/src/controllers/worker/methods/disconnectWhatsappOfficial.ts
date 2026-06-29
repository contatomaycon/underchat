import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DisconnectWhatsappOfficialRequest } from '@core/schema/worker/disconnectWhatsappOfficial/request.schema';
import { WhatsappOfficialDisconnecterUseCase } from '@core/useCases/worker/WhatsappOfficialDisconnecter.useCase';

export const disconnectWhatsappOfficial = async (
  request: FastifyRequest<{
    Params: DisconnectWhatsappOfficialRequest;
  }>,
  reply: FastifyReply
) => {
  const whatsappOfficialDisconnecterUseCase = container.resolve(
    WhatsappOfficialDisconnecterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await whatsappOfficialDisconnecterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: response.meta_warning
        ? t('whatsapp_official_disconnect_partial_success')
        : t('whatsapp_official_disconnect_success'),
      data: response,
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
