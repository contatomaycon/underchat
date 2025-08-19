import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewLinkPreviewBody } from '@core/schema/chat/viewLinkPreview/request.schema';
import { ChatLinkPreviewViewerUseCase } from '@core/useCases/chat/ChatLinkPreviewViewer.useCase';

export const viewChatLinkPreview = async (
  request: FastifyRequest<{
    Body: ViewLinkPreviewBody;
  }>,
  reply: FastifyReply
) => {
  const chatLinkPreviewViewerUseCase = container.resolve(
    ChatLinkPreviewViewerUseCase
  );
  const { t } = request;

  try {
    const response = await chatLinkPreviewViewerUseCase.execute(
      t,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_link_preview_found'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_link_preview_not_found'),
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
