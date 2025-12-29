import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewReportConversationHistoryPdfParams } from '@core/schema/reportConversationHistory/viewReportConversationHistoryPdf/request.schema';
import { ReportConversationHistoryPdfViewerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryPdfViewer.useCase';

export const viewReportConversationHistoryPdf = async (
  request: FastifyRequest<{
    Params: ViewReportConversationHistoryPdfParams;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryPdfViewerUseCase = container.resolve(
    ReportConversationHistoryPdfViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportConversationHistoryPdfViewerUseCase.execute(
      tokenJwtData.account_id,
      request.params.chat_id
    );

    if (!response) {
      return sendResponse(reply, {
        message: t('report_conversation_history_pdf_not_found'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    return sendResponse(reply, {
      message: t('report_conversation_history_pdf_view_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
