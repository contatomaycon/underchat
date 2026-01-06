import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListAiAgentRequest } from '@core/schema/aiAgent/listAiAgent/request.schema';
import { AiAgentListerUseCase } from '@core/useCases/aiAgent/AiAgentLister.useCase';

export const listAiAgent = async (
  request: FastifyRequest<{
    Querystring: ListAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentListerUseCase = container.resolve(AiAgentListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentListerUseCase.execute(
      t,
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
