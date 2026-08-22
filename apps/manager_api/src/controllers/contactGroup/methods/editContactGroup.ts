import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      request.body,
      request.tokenJwtData.account_id,
      request.tokenJwtData.user_id
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
    handleControllerError(error, reply, t);
  }
};
