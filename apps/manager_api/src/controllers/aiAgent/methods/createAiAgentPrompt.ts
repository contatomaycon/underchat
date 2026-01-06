import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateAiAgentPromptRequest } from '@core/schema/aiAgent/createAiAgentPrompt/request.schema';
import { AiAgentPromptCreatorUseCase } from '@core/useCases/aiAgent/AiAgentPromptCreator.useCase';

export const createAiAgentPrompt = async (
  request: FastifyRequest<{
    Body: CreateAiAgentPromptRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentPromptCreatorUseCase = container.resolve(
    AiAgentPromptCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentPromptCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_prompt_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { ai_agent_prompt_id: response },
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_prompt_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
