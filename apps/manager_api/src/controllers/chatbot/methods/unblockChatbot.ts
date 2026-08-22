import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockChatbotRequest } from '@core/schema/chatbot/unblockChatbot/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const unblockChatbot = async (
  request: FastifyRequest<{
    Params: UnblockChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.unblockChatbot(
      t,
      tokenJwtData.account_id,
      request.params.chatbot_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
