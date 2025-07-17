import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';
import { ETypeSanetize } from '@core/common/enums/ETypeSanetize';

@injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly encryptService: EncryptService
  ) {}

  authenticate = async (login: string, password: string) => {
    const passwordEncrypted = this.encryptService.encrypt(password);

    console.log(
      'sanitized:',
      this.encryptService.sanitize('Quadra 14 Casa 04', ETypeSanetize.other)
    );

    console.log('encrypt:', this.encryptService.encrypt('Quadra 14 Casa 04'));

    return this.authRepository.authenticate(login, passwordEncrypted);
  };
}
