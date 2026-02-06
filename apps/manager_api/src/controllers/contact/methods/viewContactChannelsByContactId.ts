import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactService } from '@core/services/contact.service';
import { ViewContactChannelsByContactIdParamsRequest } from '@core/schema/contact/viewContactChannelsByContactId/request.schema';

export const viewContactChannelsByContactId = async (
  request: FastifyRequest<{
    Params: ViewContactChannelsByContactIdParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const contactService = container.resolve(ContactService);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactService.listContactChannelsByContactId(
      tokenJwtData.account_id,
      request.params.contact_id
    );

    return sendResponse(reply, {
      message: t('contact_channels_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
