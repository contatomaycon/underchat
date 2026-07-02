import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappOfficialHealthViewerUseCase } from '@core/useCases/worker/WhatsappOfficialHealthViewer.useCase';
import { WhatsappOfficialHealthParams } from '@core/schema/worker/whatsappOfficialHealth/params.schema';

export const viewWhatsappOfficialHealth = async (
  request: FastifyRequest<{
    Params: WhatsappOfficialHealthParams;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(WhatsappOfficialHealthViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('whatsapp_official_health_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
