import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { MessageTemplateChannelsListerUseCase } from '@core/useCases/messageTemplate/MessageTemplateChannelsLister.useCase';

export const listMessageTemplateChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const messageTemplateChannelsListerUseCase = container.resolve(
    MessageTemplateChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await messageTemplateChannelsListerUseCase.execute(
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
