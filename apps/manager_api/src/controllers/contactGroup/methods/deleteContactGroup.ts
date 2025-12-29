import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteContactGroupRequest } from '@core/schema/contactGroup/deleteContactGroup/request.schema';
import { ContactGroupDeleterUseCase } from '@core/useCases/contactGroup/ContactGroupDeleter.useCase';

export const deleteContactGroup = async (
  request: FastifyRequest<{
    Params: DeleteContactGroupRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupDeleterUseCase = container.resolve(
    ContactGroupDeleterUseCase
  );
  const { t } = request;

  try {
    const response = await contactGroupDeleterUseCase.execute(
      t,
      request.params.contact_group_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('contact_group_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
