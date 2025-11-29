import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactPhoneViewerUseCase } from '@core/useCases/chat/ChatContactPhoneViewer.useCase';
import { ViewChatContactPhoneParams } from '@core/schema/chat/viewContactPhone/request.schema';

export const viewContactPhone = async (
  request: FastifyRequest<{
    Params: ViewChatContactPhoneParams;
  }>,
  reply: FastifyReply
) => {
  const chatContactPhoneViewerUseCase = container.resolve(
    ChatContactPhoneViewerUseCase
  );
  const { t } = request;

  try {
    const response = await chatContactPhoneViewerUseCase.execute(
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
