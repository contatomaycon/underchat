import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LocalHolidayUpdaterUseCase } from '@core/useCases/chatbot/LocalHolidayUpdater.useCase';
import {
  UpdateLocalHolidayParamsRequest,
  UpdateLocalHolidayRequest,
} from '@core/schema/chatbot/updateLocalHoliday/request.schema';

export const updateLocalHoliday = async (
  request: FastifyRequest<{
    Params: UpdateLocalHolidayParamsRequest;
    Body: UpdateLocalHolidayRequest;
  }>,
  reply: FastifyReply
) => {
  const localHolidayUpdaterUseCase = container.resolve(
    LocalHolidayUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await localHolidayUpdaterUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.chatbot_holiday_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chatbot_holiday_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
