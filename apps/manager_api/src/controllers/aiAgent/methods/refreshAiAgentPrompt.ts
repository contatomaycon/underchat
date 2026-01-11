import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RefreshAiAgentPromptRequest } from '@core/schema/aiAgent/refreshAiAgentPrompt/request.schema';
import { AiAgentPromptRefresherUseCase } from '@core/useCases/aiAgent/AiAgentPromptRefresher.useCase';

export const refreshAiAgentPrompt = async (
  request: FastifyRequest<{
    Params: RefreshAiAgentPromptRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptRefresherUseCase = container.resolve(
    AiAgentPromptRefresherUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptRefresherUseCase.execute(
      t,
      request.params.ai_agent_prompt_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_refresh_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_refresh_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
