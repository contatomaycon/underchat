import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { ContactGroupAssignmentCreatorUseCase } from '@core/useCases/contactGroup/ContactGroupAssignmentCreator.useCase';

export const createContactGroupAssignment = async (
  request: FastifyRequest<{
    Body: CreateContactGroupAssignmentRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupAssignmentCreatorUseCase = container.resolve(
    ContactGroupAssignmentCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactGroupAssignmentCreatorUseCase.execute(
      t,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_assignment_create_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('contact_group_assignment_create_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
