import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { GenerateReportConversationHistoryPdfParams } from '@core/schema/reportConversationHistory/generateReportConversationHistoryPdf/request.schema';
import { ReportConversationHistoryPdfGeneratorUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryPdfGenerator.useCase';

export const generateReportConversationHistoryPdf = async (
  request: FastifyRequest<{
    Params: GenerateReportConversationHistoryPdfParams;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryPdfGeneratorUseCase = container.resolve(
    ReportConversationHistoryPdfGeneratorUseCase
  );
  const { t, tokenJwtData } = request;
  const language = request.languageData?.code || 'pt';

  try {
    const response = await reportConversationHistoryPdfGeneratorUseCase.execute(
      tokenJwtData.account_id,
      request.params.chat_id,
      language
    );

    return sendResponse(reply, {
      message: t('report_conversation_history_pdf_generation_started'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
