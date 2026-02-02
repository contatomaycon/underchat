import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpsertAiAgentHumanTransferParams,
  UpsertAiAgentHumanTransferBody,
} from '@core/schema/aiAgent/upsertAiAgentHumanTransfer/request.schema';
import { AiAgentHumanTransferUpserterUseCase } from '@core/useCases/aiAgent/AiAgentHumanTransferUpserter.useCase';

export const upsertAiAgentHumanTransfer = async (
  request: FastifyRequest<{
    Params: UpsertAiAgentHumanTransferParams;
    Body: UpsertAiAgentHumanTransferBody;
  }>,
  reply: FastifyReply
) => {
  const aiAgentHumanTransferUpserterUseCase = container.resolve(
    AiAgentHumanTransferUpserterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentHumanTransferUpserterUseCase.execute(
      t,
      request.params.ai_agent_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_human_transfer_upsert_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: { success: true },
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
