import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAiAgentRequest } from '@core/schema/aiAgent/viewAiAgent/request.schema';
import { AiAgentViewerUseCase } from '@core/useCases/aiAgent/AiAgentViewer.useCase';

export const viewAiAgent = async (
  request: FastifyRequest<{
    Params: ViewAiAgentRequest;
  }>,
  reply: FastifyReply
) => {
  const aiAgentViewerUseCase = container.resolve(AiAgentViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentViewerUseCase.execute(
      t,
      request.params.ai_agent_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
