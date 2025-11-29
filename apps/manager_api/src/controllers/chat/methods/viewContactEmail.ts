import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactEmailViewerUseCase } from '@core/useCases/chat/ChatContactEmailViewer.useCase';
import { ViewChatContactEmailParams } from '@core/schema/chat/viewContactEmail/request.schema';

export const viewContactEmail = async (
  request: FastifyRequest<{
    Params: ViewChatContactEmailParams;
  }>,
  reply: FastifyReply
) => {
  const chatContactEmailViewerUseCase = container.resolve(
    ChatContactEmailViewerUseCase
  );
  const { t } = request;

  try {
    const response = await chatContactEmailViewerUseCase.execute(
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
