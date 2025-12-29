import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatTransferOptionsListerUseCase } from '@core/useCases/chat/ChatTransferOptionsLister.useCase';

export const listTransferOptions = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatTransferOptionsListerUseCase = container.resolve(
    ChatTransferOptionsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatTransferOptionsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('transfer_options_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
