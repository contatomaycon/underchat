import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactUsersListerUseCase } from '@core/useCases/contact/ContactUsersLister.useCase';

export const listUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const contactUsersListerUseCase = container.resolve(
    ContactUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactUsersListerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('contact_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
