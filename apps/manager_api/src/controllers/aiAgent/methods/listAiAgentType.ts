import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentTypeListerUseCase } from '@core/useCases/aiAgent/AiAgentTypeLister.useCase';

export const listAiAgentType = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const aiAgentTypeListerUseCase = container.resolve(AiAgentTypeListerUseCase);
  const { t } = request;

  try {
    const response = await aiAgentTypeListerUseCase.execute();

    return sendResponse(reply, {
      message: t('ai_agent_type_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
