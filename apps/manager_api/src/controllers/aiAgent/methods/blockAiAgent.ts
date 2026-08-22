import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockAiAgentRequest } from '@core/schema/aiAgent/blockAiAgent/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

export const blockAiAgent = async (
  request: FastifyRequest<{
    Params: BlockAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await planLimitEnforcementService.blockAiAgent(
      tokenJwtData.account_id,
      request.params.ai_agent_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
