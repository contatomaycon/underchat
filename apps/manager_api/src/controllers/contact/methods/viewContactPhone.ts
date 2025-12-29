import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactPhoneRequest } from '@core/schema/contact/viewContactPhone/request.schema';
import { ContactPhoneViewerUseCase } from '@core/useCases/contact/ContactPhoneViewer.useCase';

export const viewContactPhone = async (
  request: FastifyRequest<{
    Params: ViewContactPhoneRequest;
  }>,
  reply: FastifyReply
) => {
  const contactPhoneViewerUseCase = container.resolve(
    ContactPhoneViewerUseCase
  );
  const { t } = request;

  try {
    const response = await contactPhoneViewerUseCase.execute(
      t,
      request.params.contact_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_phone_view_successfully'),
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
