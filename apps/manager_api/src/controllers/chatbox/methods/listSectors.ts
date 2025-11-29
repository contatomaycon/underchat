import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatboxSectorsListerUseCase } from '@core/useCases/chatbox/ChatboxSectorsLister.useCase';

export const listSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatboxSectorsListerUseCase = container.resolve(
    ChatboxSectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatboxSectorsListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    return sendResponse(reply, {
      message: t('chatbox_sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
