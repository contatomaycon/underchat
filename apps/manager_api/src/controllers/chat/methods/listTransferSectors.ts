import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatTransferSectorsListerUseCase } from '@core/useCases/chat/ChatTransferSectorsLister.useCase';

export const listTransferSectors = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatTransferSectorsListerUseCase = container.resolve(
    ChatTransferSectorsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatTransferSectorsListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    return sendResponse(reply, {
      message: t('transfer_sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

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
