import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAiAgentPromptRequest } from '@core/schema/aiAgent/viewAiAgentPrompt/request.schema';
import { AiAgentPromptViewerUseCase } from '@core/useCases/aiAgent/AiAgentPromptViewer.useCase';

export const viewAiAgentPrompt = async (
  request: FastifyRequest<{
    Params: ViewAiAgentPromptRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptViewerUseCase = container.resolve(
    AiAgentPromptViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptViewerUseCase.execute(
      t,
      request.params.ai_agent_prompt_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_not_found'),
      httpStatusCode: EHTTPStatusCode.not_found,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
