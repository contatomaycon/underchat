import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteAiAgentRequest } from '@core/schema/aiAgent/deleteAiAgent/request.schema';
import { AiAgentDeleterUseCase } from '@core/useCases/aiAgent/AiAgentDeleter.useCase';

export const deleteAiAgent = async (
  request: FastifyRequest<{
    Params: DeleteAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentDeleterUseCase = container.resolve(AiAgentDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentDeleterUseCase.execute(
      t,
      request.params.ai_agent_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
