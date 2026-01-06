import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { centrifugoEnvironment } from '@core/config/environments';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';

const generateToken = async (
  accountId: string,
  userId: string
): Promise<string> => {
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

export const authToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { t, tokenJwtData } = request;

  try {
    const token = await generateToken(
      tokenJwtData.account_id,
      tokenJwtData.user_id
    );

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
    handleControllerError(error, reply, t);
  }
};
