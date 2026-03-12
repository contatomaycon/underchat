import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable, inject } from 'tsyringe';
import { EncryptService } from './encrypt.service';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import type { IAuthenticate } from '@core/common/interfaces/IAuthenticate';

@injectable()
export class AuthService {
  constructor(
    @inject(AuthRepository)
    private readonly authRepository: AuthRepository,
    @inject(EncryptService)
    private readonly encryptService: EncryptService
  ) {}

  private buildAuthenticateInput(login: string, password: string): IAuthenticate {
    const passwordEncrypted = this.encryptService.encrypt(password);
    const loginEncrypted = this.encryptService.encrypt(login);

    return {
      email: loginEncrypted,
      password: passwordEncrypted,
    };
  }

  authenticate = async (login: string, password: string) => {
    const input = this.buildAuthenticateInput(login, password);

    return this.authRepository.authenticate(input);
  };

  hasValidCredentials = async (
    login: string,
    password: string
  ): Promise<boolean> => {
    const input = this.buildAuthenticateInput(login, password);

    return this.authRepository.hasValidCredentials(input);
  };

  authenticateByUserId = async (
    userId: string,
    accountId: string
  ): Promise<AuthUserResponse | null> => {
    return this.authRepository.authenticateByUserId(userId, accountId);
  };
}
