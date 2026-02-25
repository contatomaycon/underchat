import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  ListRandomMessageItemParamsRequest,
  ListRandomMessageItemQueryRequest,
} from '@core/schema/randomMessage/listRandomMessageItem/request.schema';
import { RandomMessageItemListerUseCase } from '@core/useCases/randomMessage/RandomMessageItemLister.useCase';

export const listRandomMessageItem = async (
  request: FastifyRequest<{
    Params: ListRandomMessageItemParamsRequest;
    Querystring: ListRandomMessageItemQueryRequest;
  }>,
  reply: FastifyReply
) => {
  const randomMessageItemListerUseCase = container.resolve(
    RandomMessageItemListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await randomMessageItemListerUseCase.execute(
      t,
      request.params.random_message_id,
      request.query,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('random_message_item_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('random_message_item_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
