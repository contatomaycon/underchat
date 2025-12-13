import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DownloadReportConversationHistoryPdfParams } from '@core/schema/reportConversationHistory/downloadReportConversationHistoryPdf/request.schema';
import { ReportConversationHistoryPdfViewerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryPdfViewer.useCase';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

export const downloadReportConversationHistoryPdf = async (
  request: FastifyRequest<{
    Params: DownloadReportConversationHistoryPdfParams;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryPdfViewerUseCase = container.resolve(
    ReportConversationHistoryPdfViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const pdf = await reportConversationHistoryPdfViewerUseCase.execute(
      tokenJwtData.account_id,
      request.params.chat_id
    );

    if (
      !pdf ||
      pdf.status !== EReportConversationHistoryPdfStatus.done ||
      !pdf.url_pdf
    ) {
      return sendResponse(reply, {
        message: t('report_conversation_history_pdf_not_ready'),
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    return reply.redirect(pdf.url_pdf);
  } catch (error) {
    console.error(error);

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
