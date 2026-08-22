import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockChatbotRequest } from '@core/schema/chatbot/blockChatbot/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const blockChatbot = async (
  request: FastifyRequest<{
    Params: BlockChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.blockChatbot(
      tokenJwtData.account_id,
      request.params.chatbot_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
