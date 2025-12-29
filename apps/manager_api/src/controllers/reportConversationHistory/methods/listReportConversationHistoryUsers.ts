import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReportConversationHistoryUsersListerUseCase } from '@core/useCases/reportConversationHistory/ReportConversationHistoryUsersLister.useCase';

export const listReportConversationHistoryUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const reportConversationHistoryUsersListerUseCase = container.resolve(
    ReportConversationHistoryUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await reportConversationHistoryUsersListerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('report_conversation_history_users_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
