import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { LocalHolidayCreatorUseCase } from '@core/useCases/chatbot/LocalHolidayCreator.useCase';
import { CreateLocalHolidayRequest } from '@core/schema/chatbot/createLocalHoliday/request.schema';

export const createLocalHoliday = async (
  request: FastifyRequest<{
    Body: CreateLocalHolidayRequest;
  }>,
  reply: FastifyReply
) => {
  const localHolidayCreatorUseCase = container.resolve(
    LocalHolidayCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const chatbotHolidayId = await localHolidayCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chatbot_holiday_created_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        chatbot_holiday_id: chatbotHolidayId,
      },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
