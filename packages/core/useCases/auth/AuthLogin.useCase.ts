import { AuthService } from '@core/services/auth.service';
import { injectable } from 'tsyringe';
import { AuthLoginResponse } from '@core/schema/auth/login/response.schema';
import { AuthLoginRequest } from '@core/schema/auth/login/request.schema';
import { FastifyReply } from 'fastify';
import { TFunction } from 'i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { generalEnvironment } from '@core/config/environments';
import { PermissionService } from '@core/services/permission.service';

@injectable()
export class AuthLoginUseCase {
  constructor(
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    reply: FastifyReply,
    module: ERouteModule,
    input: AuthLoginRequest
  ): Promise<AuthLoginResponse | null> {
    const result = await this.authService.authenticate(
      input.login,
      input.password
    );

    if (!result) {
      throw new Error(t('login_invalid'));
    }

    const token = await reply.jwtSign(
      {
        user_id: result.user_id,
        module,
      },
      {
        sign: {
          expiresIn: generalEnvironment.jwtSecretExpiresIn,
          key: generalEnvironment.jwtSecret,
        },
      }
    );

    const permission = await this.permissionService.viewPermissionByUserId(
      result.user_id
    );

    return {
      user: result,
      token,
      permission,
    };
  }
}
