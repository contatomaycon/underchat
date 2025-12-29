import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('transfer_sectors_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
