import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappMessageTemplateService } from '@core/services/whatsappMessageTemplate.service';
import {
  UpdateWhatsappTemplateRequest,
  WhatsappTemplateIdParams,
} from '@core/schema/worker/whatsappOfficialTemplate';

export const updateWhatsappTemplate = async (
  request: FastifyRequest<{
    Params: WhatsappTemplateIdParams;
    Body: UpdateWhatsappTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const service = container.resolve(WhatsappMessageTemplateService);
  const { t, tokenJwtData } = request;

  try {
    const response = await service.update(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.params.template_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('whatsapp_template_update_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
