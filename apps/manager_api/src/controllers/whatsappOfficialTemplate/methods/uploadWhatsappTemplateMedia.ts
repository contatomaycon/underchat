import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WhatsappMessageTemplateService } from '@core/services/whatsappMessageTemplate.service';
import { UploadFileRequest } from '@core/schema/upload/request.schema';
import { WhatsappTemplateParams } from '@core/schema/worker/whatsappOfficialTemplate';

export interface UploadWhatsappTemplateMediaBody {
  file: UploadFileRequest;
}

export const uploadWhatsappTemplateMedia = async (
  request: FastifyRequest<{
    Params: WhatsappTemplateParams;
    Body: UploadWhatsappTemplateMediaBody;
  }>,
  reply: FastifyReply
) => {
  const service = container.resolve(WhatsappMessageTemplateService);
  const { t, tokenJwtData } = request;

  try {
    const response = await service.uploadMedia(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body.file
    );

    return sendResponse(reply, {
      message: t('whatsapp_template_media_upload_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
