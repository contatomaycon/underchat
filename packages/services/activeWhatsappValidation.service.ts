import { inject, injectable } from 'tsyringe';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { TwoFactorService } from '@core/services/twoFactor.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { AuthRepository } from '@core/repositories/auth/Auth.repository';
import { AccountService } from '@core/services/account.service';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { registerValidationCentrifugo } from '@core/common/functions/centrifugoQueue';
import {
  ActiveWhatsappValidationContext,
  IActiveWhatsappValidationPublication,
} from '@core/common/interfaces/IActiveWhatsappValidation';
import { ITwoFactorData } from '@core/common/interfaces/ITwoFactorData';
import { generalEnvironment } from '@core/config/environments';
import { ERouteModule } from '@core/common/enums/ERouteModule';

type ActiveValidationReason =
  | 'code_expired'
  | 'phone_mismatch'
  | 'invalid_context'
  | 'user_not_found'
  | 'account_blocked';

@injectable()
export class ActiveWhatsappValidationService {
  private readonly codeRegex = /([A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}-UNDERCHAT)/;

  constructor(
    @inject(TwoFactorService)
    private readonly twoFactorService: TwoFactorService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(AuthRepository)
    private readonly authRepository: AuthRepository,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  parseValidationText(text: string | null | undefined): string | null {
    if (!text) return null;

    const match = text.match(this.codeRegex);
    return match?.[1] ?? null;
  }

  async handleIncomingMessage(input: {
    workerId: string;
    fromPhone: string;
    messageText: string | null | undefined;
  }): Promise<boolean> {
    const code = this.parseValidationText(input.messageText);
    if (!code) return false;

    const validation =
      await this.twoFactorService.findActiveValidationByCodeAndWorkerId(
        code,
        input.workerId
      );

    if (!validation) {
      return false;
    }

    if (this.isExpired(validation)) {
      await this.reject(validation, 'code_expired');
      await this.twoFactorService.updateDeletedAt(
        validation.two_factor_id,
        new Date().toISOString()
      );
      return true;
    }

    const expectedPhone = this.decryptNullable(validation.phone);
    const expectedEmail = this.decryptNullable(validation.email);
    const phoneDdi = onlyDigits(validation.phone_ddi ?? '');

    if (!expectedPhone || !expectedEmail || !phoneDdi) {
      await this.reject(validation, 'phone_mismatch');
      return true;
    }

    if (!this.isSamePhone(expectedPhone, phoneDdi, input.fromPhone)) {
      await this.reject(validation, 'phone_mismatch');
      return true;
    }

    const context = this.normalizeContext(validation.validation_context);
    if (!context) {
      await this.reject(validation, 'invalid_context');
      return true;
    }

    const token = await this.validateAndBuildToken({
      validation,
      context,
      phone: expectedPhone,
      email: expectedEmail,
      phoneDdi,
    });

    if (!token) {
      return true;
    }

    await this.twoFactorService.updateValidatedAt(
      validation.two_factor_id,
      new Date().toISOString()
    );

    await this.publish(validation.two_factor_id, {
      status: 'validated',
      context,
      token,
    });

    return true;
  }

  private async validateAndBuildToken(input: {
    validation: ITwoFactorData;
    context: ActiveWhatsappValidationContext;
    phone: string;
    email: string;
    phoneDdi: string;
  }): Promise<string | null> {
    if (input.context === 'register') {
      return this.validateRegisterAndBuildToken(input);
    }

    if (input.context === 'forgot_password') {
      return this.buildForgotPasswordToken(input.validation);
    }

    await this.reject(input.validation, 'invalid_context');
    return null;
  }

  private async validateRegisterAndBuildToken(input: {
    validation: ITwoFactorData;
    phone: string;
    email: string;
    phoneDdi: string;
  }): Promise<string | null> {
    return this.signRegisterToken(input.validation);
  }

  private async buildForgotPasswordToken(
    validation: ITwoFactorData
  ): Promise<string | null> {
    if (!validation.user_id) {
      await this.reject(validation, 'user_not_found');
      return null;
    }

    const userResult = await this.authRepository.findUserById(
      validation.user_id
    );

    if (!userResult) {
      await this.reject(validation, 'user_not_found');
      return null;
    }

    const isAccountBlocked = await this.accountService.isAccountBlocked(
      userResult.account_id
    );

    if (isAccountBlocked) {
      await this.reject(validation, 'account_blocked');
      return null;
    }

    return jwt.sign(
      {
        user_id: userResult.user_id,
        module: ERouteModule.manager,
        account_id: userResult.account_id,
        forgot_password: true,
      },
      generalEnvironment.jwtSecret,
      {
        expiresIn:
          generalEnvironment.jwtSecretExpiresIn as SignOptions['expiresIn'],
      }
    );
  }

  private signRegisterToken(validation: ITwoFactorData): string {
    return jwt.sign(
      {
        token: validation.token,
        email_c: validation.email_c,
        phone_c: validation.phone_c,
        two_factor_id: validation.two_factor_id,
      },
      generalEnvironment.jwtSecret,
      { expiresIn: '30m' }
    );
  }

  private async reject(
    validation: ITwoFactorData,
    reason: ActiveValidationReason
  ): Promise<void> {
    const context = this.normalizeContext(validation.validation_context);
    if (!context) return;

    await this.publish(validation.two_factor_id, {
      status: 'rejected',
      context,
      reason,
    });
  }

  private publish(
    validationId: string,
    payload: IActiveWhatsappValidationPublication
  ) {
    return this.centrifugoService.publishSub(
      registerValidationCentrifugo(validationId),
      payload
    );
  }

  private isExpired(validation: ITwoFactorData): boolean {
    if (!validation.created_at) return true;

    const createdAt = new Date(validation.created_at);
    const diffMinutes = (Date.now() - createdAt.getTime()) / (1000 * 60);

    return !Number.isFinite(diffMinutes) || diffMinutes > 30;
  }

  private isSamePhone(
    expectedPhone: string,
    phoneDdi: string,
    incomingPhone: string
  ): boolean {
    const expectedCandidates = buildCandidatesWithDdi(expectedPhone, phoneDdi, {
      order: 'input_first',
    });
    const incomingLocalPhone = this.stripDdi(incomingPhone, phoneDdi);
    const incomingCandidates = buildCandidatesWithDdi(
      incomingLocalPhone,
      phoneDdi,
      { order: 'input_first' }
    );
    const incomingSet = new Set(incomingCandidates);

    return expectedCandidates.some((candidate) => incomingSet.has(candidate));
  }

  private stripDdi(phone: string, phoneDdi: string): string {
    const normalizedPhone = onlyDigits(phone);
    const normalizedDdi = onlyDigits(phoneDdi);

    if (
      normalizedDdi &&
      normalizedPhone.startsWith(normalizedDdi) &&
      normalizedPhone.length > normalizedDdi.length
    ) {
      return normalizedPhone.slice(normalizedDdi.length);
    }

    return normalizedPhone;
  }

  private decryptNullable(encrypted: string | null | undefined): string | null {
    if (!encrypted) return null;

    try {
      return this.passwordEncryptorService.decrypt(encrypted);
    } catch {
      return null;
    }
  }

  private normalizeContext(
    context: string | null | undefined
  ): ActiveWhatsappValidationContext | null {
    if (context === 'register' || context === 'forgot_password') {
      return context;
    }

    return null;
  }
}
