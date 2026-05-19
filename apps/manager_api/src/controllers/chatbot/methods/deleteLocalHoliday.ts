import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LocalHolidayDeleterUseCase } from '@core/useCases/chatbot/LocalHolidayDeleter.useCase';
import { DeleteLocalHolidayRequest } from '@core/schema/chatbot/deleteLocalHoliday/request.schema';

export const deleteLocalHoliday = async (
  request: FastifyRequest<{
    Params: DeleteLocalHolidayRequest;
  }>,
  reply: FastifyReply
) => {
  const localHolidayDeleterUseCase = container.resolve(
    LocalHolidayDeleterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await localHolidayDeleterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.chatbot_holiday_id
    );

    return sendResponse(reply, {
      message: t('chatbot_holiday_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
