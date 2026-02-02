import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentHumanTransferSectorUsersListerUseCase } from '@core/useCases/aiAgent/AiAgentHumanTransferSectorUsersLister.useCase';
import { ListAiAgentHumanTransferSectorUsersParams } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/request.schema';

export const listAiAgentHumanTransferSectorUsers = async (
  request: FastifyRequest<{
    Params: ListAiAgentHumanTransferSectorUsersParams;
  }>,
  reply: FastifyReply
) => {
  const aiAgentHumanTransferSectorUsersListerUseCase = container.resolve(
    AiAgentHumanTransferSectorUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentHumanTransferSectorUsersListerUseCase.execute(
      tokenJwtData.account_id,
      request.params.sector_id
    );

    return sendResponse(reply, {
      message: t('ai_agent_human_transfer_sector_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
