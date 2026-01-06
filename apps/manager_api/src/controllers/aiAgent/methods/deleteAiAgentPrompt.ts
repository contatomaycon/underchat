import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteAiAgentPromptRequest } from '@core/schema/aiAgent/deleteAiAgentPrompt/request.schema';
import { AiAgentPromptDeleterUseCase } from '@core/useCases/aiAgent/AiAgentPromptDeleter.useCase';

export const deleteAiAgentPrompt = async (
  request: FastifyRequest<{
    Params: DeleteAiAgentPromptRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptDeleterUseCase = container.resolve(
    AiAgentPromptDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptDeleterUseCase.execute(
      t,
      request.params.ai_agent_prompt_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
