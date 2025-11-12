import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ContactGroupAllListerUseCase } from '@core/useCases/contactGroup/ContactGroupAllLister.useCase';

export const listContactGroupAll = async (
  request: FastifyRequest<{}>,
  reply: FastifyReply
) => {
  const contactGroupAllListerUseCase = container.resolve(
    ContactGroupAllListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await contactGroupAllListerUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('contact_group_list_all_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('contact_group_list_all_not_found'),
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
