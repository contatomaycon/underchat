import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';
import { IAuthenticate } from '@core/common/interfaces/IAuthenticate';

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
      username: login,
      email: loginEncrypted,
      password: passwordEncrypted,
    };

    return this.authRepository.authenticate(input);
  };
}
