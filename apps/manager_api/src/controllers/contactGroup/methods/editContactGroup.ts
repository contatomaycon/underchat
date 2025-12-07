import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  EditContactGroupParamsRequest,
  UpdateContactGroupRequest,
} from '@core/schema/contactGroup/editContactGroup/request.schema';
import { ContactGroupUpdaterUseCase } from '@core/useCases/contactGroup/ContactGroupUpdater.useCase';

export const editContactGroup = async (
  request: FastifyRequest<{
    Params: EditContactGroupParamsRequest;
    Body: UpdateContactGroupRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupUpdaterUseCase = container.resolve(
    ContactGroupUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await contactGroupUpdaterUseCase.execute(
      t,
      request.params.contact_group_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('contact_group_update_error'),
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
