import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappMessageTemplateService } from '@core/services/whatsappMessageTemplate.service';
import {
  CreateWhatsappTemplateRequest,
  WhatsappTemplateParams,
} from '@core/schema/worker/whatsappOfficialTemplate';

export const createWhatsappTemplate = async (
  request: FastifyRequest<{
    Params: WhatsappTemplateParams;
    Body: CreateWhatsappTemplateRequest;
  }>,
  reply: FastifyReply
) => {
  const service = container.resolve(WhatsappMessageTemplateService);
  const { t, tokenJwtData } = request;

  try {
    const response = await service.create(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('whatsapp_template_create_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
