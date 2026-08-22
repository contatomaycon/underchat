import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatSectorsListerUseCase } from '@core/useCases/chat/ChatSectorsLister.useCase';

export const listChatSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatSectorsListerUseCase = container.resolve(ChatSectorsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatSectorsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
