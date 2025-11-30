import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListReportConversationHistoryRequest } from '@core/schema/reportConversationHistory/listReportConversationHistory/request.schema';
import { ReportConversationHistoryListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryLister.useCase';

export const listReportConversationHistory = async (
  request: FastifyRequest<{
    Querystring: ListReportConversationHistoryRequest;
  }>,
  reply: FastifyReply
) => {
  const reportConversationHistoryListerUseCase = container.resolve(
    ReportConversationHistoryListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportConversationHistoryListerUseCase.execute(
      tokenJwtData.account_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('report_conversation_history_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
