import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockAiAgentRequest } from '@core/schema/aiAgent/unblockAiAgent/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const unblockAiAgent = async (
  request: FastifyRequest<{
    Params: UnblockAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.unblockAiAgent(
      t,
      tokenJwtData.account_id,
      request.params.ai_agent_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
