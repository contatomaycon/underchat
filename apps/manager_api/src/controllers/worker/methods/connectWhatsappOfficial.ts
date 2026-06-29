import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappOfficialConnectorUseCase } from '@core/useCases/worker/WhatsappOfficialConnector.useCase';
import { ConnectWhatsappOfficialParams } from '@core/schema/worker/connectWhatsappOfficial/params.schema';
import { ConnectWhatsappOfficialRequest } from '@core/schema/worker/connectWhatsappOfficial/request.schema';

export const connectWhatsappOfficial = async (
  request: FastifyRequest<{
    Params: ConnectWhatsappOfficialParams;
    Body: ConnectWhatsappOfficialRequest;
  }>,
  reply: FastifyReply
) => {
  const whatsappOfficialConnectorUseCase = container.resolve(
    WhatsappOfficialConnectorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await whatsappOfficialConnectorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('whatsapp_official_reconnect_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
