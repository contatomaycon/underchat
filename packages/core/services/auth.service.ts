import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';

@injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly encryptService: EncryptService
  ) {}

  authenticate = async (login: string, password: string) => {
    const passwordEncrypted = this.encryptService.encrypt(password);
    const loginEncrypted = this.encryptService.encrypt(login);

    return this.authRepository.authenticate(loginEncrypted, passwordEncrypted);
  };
}
