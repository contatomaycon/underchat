import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotSectorsListerUseCase } from '@core/useCases/chatbot/ChatbotSectorsLister.useCase';

export const listSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotSectorsListerUseCase = container.resolve(
    ChatbotSectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotSectorsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
