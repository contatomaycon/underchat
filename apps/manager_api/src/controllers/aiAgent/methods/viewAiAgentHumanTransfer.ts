import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAiAgentHumanTransferParams } from '@core/schema/aiAgent/viewAiAgentHumanTransfer/request.schema';
import { AiAgentHumanTransferViewerUseCase } from '@core/useCases/aiAgent/AiAgentHumanTransferViewer.useCase';

export const viewAiAgentHumanTransfer = async (
  request: FastifyRequest<{
    Params: ViewAiAgentHumanTransferParams;
  }>,
  reply: FastifyReply
) => {
  const aiAgentHumanTransferViewerUseCase = container.resolve(
    AiAgentHumanTransferViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentHumanTransferViewerUseCase.execute(
      t,
      request.params.ai_agent_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('ai_agent_human_transfer_view_successfully'),
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
