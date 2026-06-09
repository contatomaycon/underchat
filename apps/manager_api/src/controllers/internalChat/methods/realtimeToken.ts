import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { centrifugoEnvironment } from '@core/config/environments';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';

const generateToken = (accountId: string, userId: string): string => {
  const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return jwt.sign(
    {
      sub: accountId,
      user: userId,
      exp,
      params: {
        userID: userId,
      },
    },
    centrifugoEnvironment.centrifugoHmacSecretKey,
    { algorithm: 'HS256' }
  );
};

export const realtimeToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t, tokenJwtData } = request;

  try {
    const token = generateToken(tokenJwtData.account_id, tokenJwtData.user_id);

    return sendResponse(reply, {
      message: t('centrifugo_token_generation_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        token,
        url: centrifugoEnvironment.centrifugoPublicWsUrl,
      },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
