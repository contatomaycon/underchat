import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NationalHolidaysListerUseCase } from '@core/useCases/chatbot/NationalHolidaysLister.useCase';
import { ListNationalHolidaysRequest } from '@core/schema/chatbot/listNationalHolidays/request.schema';

export const listNationalHolidays = async (
  request: FastifyRequest<{
    Querystring: ListNationalHolidaysRequest;
  }>,
  reply: FastifyReply
) => {
  const nationalHolidaysListerUseCase = container.resolve(
    NationalHolidaysListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await nationalHolidaysListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query.year
    );

    return sendResponse(reply, {
      message: t('chatbot_holiday_national_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
