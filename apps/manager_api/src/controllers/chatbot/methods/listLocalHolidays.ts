import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LocalHolidaysListerUseCase } from '@core/useCases/chatbot/LocalHolidaysLister.useCase';

export const listLocalHolidays = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const localHolidaysListerUseCase = container.resolve(
    LocalHolidaysListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await localHolidaysListerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_holiday_local_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
