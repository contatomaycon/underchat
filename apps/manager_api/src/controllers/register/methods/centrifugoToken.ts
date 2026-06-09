import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { centrifugoEnvironment } from '@core/config/environments';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { RegisterCentrifugoTokenRequest } from '@core/schema/register/centrifugoToken/request.schema';

const generateToken = async (accountId: string): Promise<string> => {
  const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  return jwt.sign(
    {
      sub: accountId,
      user: accountId,
      exp,
      params: {
        userID: accountId,
      },
    },
    centrifugoEnvironment.centrifugoHmacSecretKey,
    { algorithm: 'HS256' }
  );
};

export const centrifugoToken = async (
  request: FastifyRequest<{
    Body: RegisterCentrifugoTokenRequest;
  }>,
  reply: FastifyReply
) => {
  const { t } = request;

  try {
    const { account_id } = request.body;

    const token = await generateToken(account_id);

    if (token) {
      return sendResponse(reply, {
        message: t('centrifugo_token_generation_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          token,
          url: centrifugoEnvironment.centrifugoPublicWsUrl,
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
