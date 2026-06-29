import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappEmbeddedConnectorUseCase } from '@core/useCases/worker/WhatsappEmbeddedConnector.useCase';
import { ConnectWhatsappEmbeddedRequest } from '@core/schema/worker/connectWhatsappEmbedded/request.schema';

export const connectWhatsappEmbedded = async (
  request: FastifyRequest<{ Body: ConnectWhatsappEmbeddedRequest }>,
  reply: FastifyReply
) => {
  const whatsappEmbeddedConnectorUseCase = container.resolve(
    WhatsappEmbeddedConnectorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await whatsappEmbeddedConnectorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('whatsapp_official_connect_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
