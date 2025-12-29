import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactViewerUseCase } from '@core/useCases/chat/ChatContactViewer.useCase';
import { ViewReportConversationHistoryContactParams } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContact/request.schema';

export const viewContact = async (
  request: FastifyRequest<{
    Params: ViewReportConversationHistoryContactParams;
  }>,
  reply: FastifyReply
) => {
  const chatContactViewerUseCase = container.resolve(ChatContactViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatContactViewerUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id
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
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
