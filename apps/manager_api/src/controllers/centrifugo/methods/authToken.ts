import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { centrifugoEnvironment } from '@core/config/environments';
import { UnauthorizedError } from 'centrifuge';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

const generateToken = async (accountId: string): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60;
  return jwt.sign(
    { sub: accountId, exp },
    centrifugoEnvironment.centrifugoHmacSecretKey,
    { algorithm: 'HS256' }
  );
};

export const authToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t, tokenJwtData } = request;

  try {
    const token = await generateToken(tokenJwtData.account_id);

    if (token) {
      return sendResponse(reply, {
        message: t('centrifugo_token_generation_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          token,
          url: centrifugoEnvironment.centrifugoWsUrl,
        },
      });
    }

    return sendResponse(reply, {
      message: t('centrifugo_token_generation_failed'),
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

    if (error instanceof UnauthorizedError) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
