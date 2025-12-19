import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';
import { IAuthenticate } from '@core/common/interfaces/IAuthenticate';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';

@injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly encryptService: EncryptService
  ) {}

  authenticate = async (login: string, password: string) => {
    const passwordEncrypted = this.encryptService.encrypt(password);
    const loginEncrypted = this.encryptService.encrypt(login);

    const input: IAuthenticate = {
      email: loginEncrypted,
      password: passwordEncrypted,
    };

    return this.authRepository.authenticate(input);
  };

  authenticateByUserId = async (
    userId: string,
    accountId: string
  ): Promise<AuthUserResponse | null> => {
    return this.authRepository.authenticateByUserId(userId, accountId);
  };
}
