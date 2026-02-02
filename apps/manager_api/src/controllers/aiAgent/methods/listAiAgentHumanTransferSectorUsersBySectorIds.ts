import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentHumanTransferSectorUsersBySectorIdsListerUseCase } from '@core/useCases/aiAgent/AiAgentHumanTransferSectorUsersBySectorIdsLister.useCase';
import { ListAiAgentHumanTransferSectorUsersBySectorIdsQuery } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsersBySectorIds/request.schema';

export const listAiAgentHumanTransferSectorUsersBySectorIds = async (
  request: FastifyRequest<{
    Querystring: ListAiAgentHumanTransferSectorUsersBySectorIdsQuery;
  }>,
  reply: FastifyReply
) => {
  const aiAgentHumanTransferSectorUsersBySectorIdsListerUseCase =
    container.resolve(AiAgentHumanTransferSectorUsersBySectorIdsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response =
      await aiAgentHumanTransferSectorUsersBySectorIdsListerUseCase.execute(
        tokenJwtData.account_id,
        request.query.sector_ids
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
