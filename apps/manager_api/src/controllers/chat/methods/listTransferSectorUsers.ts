import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatTransferSectorUsersListerUseCase } from '@core/useCases/chat/ChatTransferSectorUsersLister.useCase';
import { ListTransferSectorUsersParams } from '@core/schema/chat/listTransferSectorUsers/request.schema';

export const listTransferSectorUsers = async (
  request: FastifyRequest<{
    Params: ListTransferSectorUsersParams;
  }>,
  reply: FastifyReply
) => {
  const chatTransferSectorUsersListerUseCase = container.resolve(
    ChatTransferSectorUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatTransferSectorUsersListerUseCase.execute(
      tokenJwtData.account_id,
      request.params.sector_id
    );

    return sendResponse(reply, {
      message: t('transfer_sector_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
