import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    return sendResponse(reply, {
      message: t('transfer_options_listed_successfully'),
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
