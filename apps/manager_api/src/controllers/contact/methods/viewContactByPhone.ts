import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewContactByPhoneRequest } from '@core/schema/contact/viewContactByPhone/request.schema';
import { ContactByPhoneViewerUseCase } from '@core/useCases/contact/ContactByPhoneViewer.useCase';

export const viewContactByPhone = async (
  request: FastifyRequest<{
    Querystring: ViewContactByPhoneRequest;
  }>,
  reply: FastifyReply
) => {
  const contactByPhoneViewerUseCase = container.resolve(
    ContactByPhoneViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactByPhoneViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query.phone,
      request.query.phone_ddi ?? null
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_not_found'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: null,
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
