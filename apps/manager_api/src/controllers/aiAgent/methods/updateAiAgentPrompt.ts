import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateAiAgentPromptParams,
  UpdateAiAgentPromptBody,
} from '@core/schema/aiAgent/updateAiAgentPrompt/request.schema';
import { AiAgentPromptUpdaterUseCase } from '@core/useCases/aiAgent/AiAgentPromptUpdater.useCase';

export const updateAiAgentPrompt = async (
  request: FastifyRequest<{
    Params: UpdateAiAgentPromptParams;
    Body: UpdateAiAgentPromptBody;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptUpdaterUseCase = container.resolve(
    AiAgentPromptUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptUpdaterUseCase.execute(
      t,
      request.params.ai_agent_prompt_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
