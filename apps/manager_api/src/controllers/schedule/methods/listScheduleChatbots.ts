import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ScheduleChatbotsListerUseCase } from '@core/useCases/schedule/ScheduleChatbotsLister.useCase';

export const listScheduleChatbots = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const scheduleChatbotsListerUseCase = container.resolve(
    ScheduleChatbotsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await scheduleChatbotsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('schedule_chatbots_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
