import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReportConversationHistorySectorsListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistorySectorsLister.useCase';

export const listReportConversationHistorySectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const reportConversationHistorySectorsListerUseCase = container.resolve(
    ReportConversationHistorySectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response =
      await reportConversationHistorySectorsListerUseCase.execute(
        t,
        tokenJwtData.account_id
      );

    return sendResponse(reply, {
      message: t('report_conversation_history_sectors_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
