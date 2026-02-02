import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AiAgentHumanTransferSectorsListerUseCase } from '@core/useCases/aiAgent/AiAgentHumanTransferSectorsLister.useCase';

export const listAiAgentHumanTransferSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const aiAgentHumanTransferSectorsListerUseCase = container.resolve(
    AiAgentHumanTransferSectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await aiAgentHumanTransferSectorsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('ai_agent_human_transfer_sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
