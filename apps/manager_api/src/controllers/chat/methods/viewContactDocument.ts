import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactDocumentViewerUseCase } from '@core/useCases/chat/ChatContactDocumentViewer.useCase';
import { ViewChatContactDocumentParams } from '@core/schema/chat/viewContactDocument/request.schema';

export const viewContactDocument = async (
  request: FastifyRequest<{
    Params: ViewChatContactDocumentParams;
  }>,
  reply: FastifyReply
) => {
  const chatContactDocumentViewerUseCase = container.resolve(
    ChatContactDocumentViewerUseCase
  );
  const { t } = request;

  try {
    const response = await chatContactDocumentViewerUseCase.execute(
      t,
      request.params.contact_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_document_view_successfully'),
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
