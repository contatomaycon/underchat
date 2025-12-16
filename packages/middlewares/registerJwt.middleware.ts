import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { generalEnvironment } from '@core/config/environments';
import { TwoFactorViewerRepository } from '@core/repositories/auth/TwoFactorViewer.repository';
import { container } from 'tsyringe';
import { IRegisterJwtPayload } from '@core/common/interfaces/IRegisterJwtPayload';

async function authenticateRegisterJwt(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;

  try {
    const decoded = (await request.jwtVerify({
      verify: {
        key: generalEnvironment.jwtSecret,
      },
      decode: {
        complete: true,
      },
    })) as IRegisterJwtPayload;

    if (!decoded || !decoded.token || !decoded.email_c || !decoded.phone_c) {
      return sendResponse(reply, {
        message: t('register_token_invalid'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const twoFactorViewerRepository = container.resolve(
      TwoFactorViewerRepository
    );

    const twoFactorData =
      await twoFactorViewerRepository.findTwoFactorByTokenAndEmailPhone({
        token: decoded.token,
        emailC: decoded.email_c,
        phoneC: decoded.phone_c,
      });

    if (!twoFactorData) {
      return sendResponse(reply, {
        message: t('register_token_invalid'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (twoFactorData.deleted_at) {
      return sendResponse(reply, {
        message: t('register_token_invalid'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    if (!twoFactorData.created_at) {
      return sendResponse(reply, {
        message: t('register_token_invalid'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    const createdAt = new Date(twoFactorData.created_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    if (diffMinutes > 30) {
      return sendResponse(reply, {
        message: t('register_token_expired'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    request.registerJwtData = {
      token: decoded.token,
      email_c: decoded.email_c,
      phone_c: decoded.phone_c,
      two_factor_id: twoFactorData.two_factor_id,
    };

    return;
  } catch (error) {
    return sendResponse(reply, {
      message: t('register_token_invalid'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }
}

export default fp(async (fastify) => {
  fastify.decorate(
    'authenticateRegisterJwt',
    async (request: FastifyRequest, reply: FastifyReply) =>
      authenticateRegisterJwt(request, reply)
  );
});
