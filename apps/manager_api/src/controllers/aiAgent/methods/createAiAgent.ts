import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateAiAgentRequest } from '@core/schema/aiAgent/createAiAgent/request.schema';
import { AiAgentCreatorUseCase } from '@core/useCases/aiAgent/AiAgentCreator.useCase';

export const createAiAgent = async (
  request: FastifyRequest<{
    Body: CreateAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentCreatorUseCase = container.resolve(AiAgentCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          ai_agent_id: response,
        },
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
