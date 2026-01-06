import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAiAgentPromptRequest } from '@core/schema/aiAgent/listAiAgentPrompt/request.schema';
import { AiAgentPromptListerUseCase } from '@core/useCases/aiAgent/AiAgentPromptLister.useCase';

export const listAiAgentPrompt = async (
  request: FastifyRequest<{
    Params: ListAiAgentPromptRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptListerUseCase = container.resolve(
    AiAgentPromptListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptListerUseCase.execute(
      t,
      request.params,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('ai_agent_prompt_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
