import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactPhoneRequest } from '@core/schema/contact/viewContactPhone/request.schema';
import { ContactService } from '@core/services/contact.service';

export const viewContactPhone = async (
  request: FastifyRequest<{
    Params: ViewContactPhoneRequest;
  }>,
  reply: FastifyReply
) => {
  const contactService = container.resolve(ContactService);
  const { t } = request;

  try {
    const sensitiveData = await contactService.getContactSensitiveDataDecrypted(
      request.params.contact_id
    );

    if (!sensitiveData) {
      return sendResponse(reply, {
        message: t('contact_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('contact_phone_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        phone: sensitiveData.phone,
      },
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
