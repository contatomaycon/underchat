import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BaileysService } from '@core/services/baileys';

export const teste = async (request: FastifyRequest, reply: FastifyReply) => {
  const baileysService = container.resolve(BaileysService);

  try {
    const connect = await baileysService.connect();

    return sendResponse(reply, {
      httpStatusCode: EHTTPStatusCode.ok,
      data: connect,
    });
  } catch (error) {
    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
