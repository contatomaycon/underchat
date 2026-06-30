import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappMessageTemplateService } from '@core/services/whatsappMessageTemplate.service';
import { WhatsappTemplateIdParams } from '@core/schema/worker/whatsappOfficialTemplate';

export const deleteWhatsappTemplate = async (
  request: FastifyRequest<{
    Params: WhatsappTemplateIdParams;
  }>,
  reply: FastifyReply
) => {
  const service = container.resolve(WhatsappMessageTemplateService);
  const { t, tokenJwtData } = request;

  try {
    const response = await service.delete(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.params.template_id
    );

    return sendResponse(reply, {
      message: t('whatsapp_template_delete_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
