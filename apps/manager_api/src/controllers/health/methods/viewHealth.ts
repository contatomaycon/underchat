import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';

export const viewHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.ok,
  });
};
