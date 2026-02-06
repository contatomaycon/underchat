import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

export const createContact = async (
  request: FastifyRequest<{
    Body: CreateContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactCreatorUseCase = container.resolve(ContactCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const allowedChannelIds = tokenJwtData.channels?.map((c) => c.id) ?? [];
    const response = await contactCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id,
      allowedChannelIds
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
