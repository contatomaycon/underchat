import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatWorkersListerUseCase } from '@core/useCases/chat/ChatWorkersLister.useCase';

export const listChatWorkers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatWorkersListerUseCase = container.resolve(ChatWorkersListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatWorkersListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('workers_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
