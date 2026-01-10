import AuthController from '@/controllers/auth';
import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { loginSchema } from '@core/schema/auth/login';
import { refreshTokenSchema } from '@core/schema/auth/refrehToken';
import { forgotPasswordSendCodeSchema } from '@core/schema/auth/forgotPassword/sendCode';
import { forgotPasswordVerifyCodeSchema } from '@core/schema/auth/forgotPassword/verifyCode';
import { forgotPasswordResetPasswordSchema } from '@core/schema/auth/forgotPassword/resetPassword';

export default function authRoutes(server: FastifyInstance) {
  const authController = container.resolve(AuthController);

  server.post('/auth/login', {
    schema: loginSchema,
    handler: authController.login,
  });

  server.post('/auth/refresh-token', {
    schema: refreshTokenSchema,
    handler: authController.refreshToken,
  });

  server.post('/auth/forgot-password/send-code', {
    schema: forgotPasswordSendCodeSchema,
    handler: authController.forgotPasswordSendCode,
  });

  server.post('/auth/forgot-password/verify-code', {
    schema: forgotPasswordVerifyCodeSchema,
    handler: authController.forgotPasswordVerifyCode,
  });

  server.post('/auth/forgot-password/reset-password', {
    schema: forgotPasswordResetPasswordSchema,
    handler: authController.forgotPasswordResetPassword,
  });
}
