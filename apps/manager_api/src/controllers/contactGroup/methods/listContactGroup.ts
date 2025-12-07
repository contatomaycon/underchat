import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      t,
      request.query,
      tokenJwtData.is_administrator,
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
