import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { ContactGroupAssignmentCreatorUseCase } from '@core/useCases/contactGroup/ContactGroupAssignmentCreator.useCase';
import { v7 as uuidv7 } from 'uuid';

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
    const importSessionId = uuidv7();

    setImmediate(async () => {
      try {
        await contactGroupAssignmentCreatorUseCase.execute(
          t,
          request.body,
          tokenJwtData.account_id,
          tokenJwtData.user_id,
          importSessionId
        );
      } catch (error) {
        console.error('Error processing contact import in background:', error);
      }
    });

    return sendResponse(reply, {
      message: t('contact_import_started'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { import_session_id: importSessionId },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
