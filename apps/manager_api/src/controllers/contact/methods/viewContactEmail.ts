import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactEmailRequest } from '@core/schema/contact/viewContactEmail/request.schema';
import { ContactService } from '@core/services/contact.service';

export const viewContactEmail = async (
  request: FastifyRequest<{
    Params: ViewContactEmailRequest;
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
      message: t('contact_email_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        email: sensitiveData.email,
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
