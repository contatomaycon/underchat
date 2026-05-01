import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ViewInternalChatLinkPreviewBody } from '@core/schema/internalChat/viewLinkPreview/request.schema';
import { InternalChatLinkPreviewViewerUseCase } from '@core/useCases/internalChat/InternalChatLinkPreviewViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewLinkPreview = async (
  request: FastifyRequest<{
    Body: ViewInternalChatLinkPreviewBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatLinkPreviewViewerUseCase);
  const { t } = request;

  try {
    const response = await useCase.execute(t, request.body);

    return sendResponse(reply, {
      message: t('chat_link_preview_found'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
