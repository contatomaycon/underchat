import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { ContactGroupCreatorUseCase } from '@core/useCases/contactGroup/ContactGroupCreator.useCase';

export const createContactGroup = async (
  request: FastifyRequest<{
    Body: CreateContactGroupRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupCreatorUseCase = container.resolve(
    ContactGroupCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactGroupCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_group_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
