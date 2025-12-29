import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ValidateContactRequest } from '@core/schema/contact/validateContact/request.schema';
import { ContactValidatorUseCase } from '@core/useCases/contact/ContactValidator.useCase';

export const validateContact = async (
  request: FastifyRequest<{
    Params: ValidateContactRequest;
  }>,
  reply: FastifyReply
) => {
  const contactValidatorUseCase = container.resolve(ContactValidatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await contactValidatorUseCase.execute(
      t,
      request.params.contact_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_validation_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('contact_validation_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
