import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappMessageTemplateService } from '@core/services/whatsappMessageTemplate.service';
import { WhatsappTemplateParams } from '@core/schema/worker/whatsappOfficialTemplate';

export const listWhatsappTemplateMetaApps = async (
  request: FastifyRequest<{
    Params: WhatsappTemplateParams;
  }>,
  reply: FastifyReply
) => {
  const service = container.resolve(WhatsappMessageTemplateService);
  const { t, tokenJwtData } = request;

  try {
    const response = await service.listMetaApps(
      t,
      tokenJwtData.account_id,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('whatsapp_template_meta_apps_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
