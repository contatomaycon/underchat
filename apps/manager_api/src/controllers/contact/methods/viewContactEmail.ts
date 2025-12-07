import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactEmailRequest } from '@core/schema/contact/viewContactEmail/request.schema';
import { ContactEmailViewerUseCase } from '@core/useCases/contact/ContactEmailViewer.useCase';

export const viewContactEmail = async (
  request: FastifyRequest<{
    Params: ViewContactEmailRequest;
  }>,
  reply: FastifyReply
) => {
  const contactEmailViewerUseCase = container.resolve(
    ContactEmailViewerUseCase
  );
  const { t } = request;

  try {
    const response = await contactEmailViewerUseCase.execute(
      t,
      request.params.contact_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_email_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
