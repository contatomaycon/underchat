import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WwebjsService } from '@core/services/wwebjs';

export const viewConnectionHealth = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  const wwebjsService = container.resolve(WwebjsService);
  const isConnected = wwebjsService.isConnected();

  if (isConnected) {
    return sendResponse(reply, {
      httpStatusCode: EHTTPStatusCode.ok,
    });
  }

  return sendResponse(reply, {
    httpStatusCode: EHTTPStatusCode.service_unavailable,
  });
};
