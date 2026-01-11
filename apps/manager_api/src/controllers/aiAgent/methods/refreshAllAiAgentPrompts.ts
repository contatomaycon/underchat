import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RefreshAllAiAgentPromptsRequest } from '@core/schema/aiAgent/refreshAllAiAgentPrompts/request.schema';
import { AiAgentPromptRefresherAllUseCase } from '@core/useCases/aiAgent/AiAgentPromptRefresherAll.useCase';

export const refreshAllAiAgentPrompts = async (
  request: FastifyRequest<{
    Params: RefreshAllAiAgentPromptsRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptRefresherAllUseCase = container.resolve(
    AiAgentPromptRefresherAllUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptRefresherAllUseCase.execute(
      t,
      request.params.ai_agent_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_refresh_all_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_refresh_all_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
