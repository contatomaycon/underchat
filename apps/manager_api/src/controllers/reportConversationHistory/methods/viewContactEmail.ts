import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatContactEmailViewerUseCase } from '@core/useCases/chat/ChatContactEmailViewer.useCase';
import { ViewReportConversationHistoryContactEmailParams } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContactEmail/request.schema';

export const viewContactEmail = async (
  request: FastifyRequest<{
    Params: ViewReportConversationHistoryContactEmailParams;
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
    handleControllerError(error, reply, t);
  }
};
