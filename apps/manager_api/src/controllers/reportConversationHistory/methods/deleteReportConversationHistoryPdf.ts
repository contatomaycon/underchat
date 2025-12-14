import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteReportConversationHistoryPdfParams } from '@core/schema/reportConversationHistory/deleteReportConversationHistoryPdf/request.schema';
import { ReportConversationHistoryPdfDeleterUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryPdfDeleter.useCase';

export const deleteReportConversationHistoryPdf = async (
  request: FastifyRequest<{
    Params: DeleteReportConversationHistoryPdfParams;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryPdfDeleterUseCase = container.resolve(
    ReportConversationHistoryPdfDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportConversationHistoryPdfDeleterUseCase.execute(
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
      message: t('report_conversation_history_pdf_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
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
