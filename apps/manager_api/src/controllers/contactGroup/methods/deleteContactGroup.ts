import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

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
