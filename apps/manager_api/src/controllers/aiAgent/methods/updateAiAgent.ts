import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateAiAgentParams,
  UpdateAiAgentBody,
} from '@core/schema/aiAgent/updateAiAgent/request.schema';
import { AiAgentUpdaterUseCase } from '@core/useCases/aiAgent/AiAgentUpdater.useCase';

export const updateAiAgent = async (
  request: FastifyRequest<{
    Params: UpdateAiAgentParams;
    Body: UpdateAiAgentBody;
  }>,
  reply: FastifyReply
) => {
  const aiAgentUpdaterUseCase = container.resolve(AiAgentUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentUpdaterUseCase.execute(
      t,
      request.params.ai_agent_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('ai_agent_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
