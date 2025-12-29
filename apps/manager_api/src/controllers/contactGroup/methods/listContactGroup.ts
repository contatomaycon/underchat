import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListContactGroupRequest } from '@core/schema/contactGroup/listContactGroup/request.schema';
import { ContactGroupListerUseCase } from '@core/useCases/contactGroup/ContactGroupLister.useCase';

export const listContactGroup = async (
  request: FastifyRequest<{
    Querystring: ListContactGroupRequest;
  }>,
  reply: FastifyReply
) => {
  const contactGroupListerUseCase = container.resolve(
    ContactGroupListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactGroupListerUseCase.execute(
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('contact_group_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
