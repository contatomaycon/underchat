import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
