import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactChannelsListerUseCase } from '@core/useCases/contact/ContactChannelsLister.useCase';

export const listContactChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const contactChannelsListerUseCase = container.resolve(
    ContactChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactChannelsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('contact_channels_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
