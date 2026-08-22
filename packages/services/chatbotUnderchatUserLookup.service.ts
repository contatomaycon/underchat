import {
  createEmptyChatbotUnderchatLookupOutput,
  type ChatbotUnderchatLookupInput,
  type ChatbotUnderchatLookupOutput,
} from '@core/common/interfaces/IChatbotUnderchatLookup';
import { validateCpf } from '@core/common/functions/validateCpf';
import {
  formatCnpj,
  normalizeCnpj,
  validateCnpj,
} from '@core/common/functions/validateCnpj';
import { ChatbotUnderchatUserLookupRepository } from '@core/repositories/user/ChatbotUnderchatUserLookup.repository';
import { inject, injectable } from 'tsyringe';
import { EncryptService } from './encrypt.service';
import { PasswordEncryptorService } from './passwordEncryptor.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const formatCpf = (value: string): string =>
  `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9, 11)}`;

@injectable()
export class ChatbotUnderchatUserLookupService {
  constructor(
    @inject(ChatbotUnderchatUserLookupRepository)
    private readonly repository: ChatbotUnderchatUserLookupRepository,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  public lookup = async (
    input: ChatbotUnderchatLookupInput
  ): Promise<ChatbotUnderchatLookupOutput> => {
    const normalizedValues = this.getCompatibleIdentityValues(
      input.lookupType,
      input.value
    );
    if (normalizedValues.length === 0) {
      return createEmptyChatbotUnderchatLookupOutput();
    }

    const identityHashes = normalizedValues.map((value) =>
      this.encryptService.encrypt(value)
    );
    const matchedUser = await this.repository.findNewestUser({
      lookupType: input.lookupType,
      identityHashes,
    });
    if (!matchedUser) {
      return createEmptyChatbotUnderchatLookupOutput();
    }

    const [
      userInfo,
      encryptedDocument,
      accessGroup,
      sectors,
      channels,
      planData,
      paidPayment,
    ] = await Promise.all([
      this.repository.findLatestUserInfo(matchedUser.userId),
      this.repository.findLatestDocument({
        userId: matchedUser.userId,
        preferredHashes:
          input.lookupType === 'document' ? identityHashes : undefined,
      }),
      this.repository.findAccessGroup(matchedUser.userId),
      this.repository.listSectors(matchedUser.userId),
      this.repository.listChannels({
        accountId: matchedUser.accountId,
        userId: matchedUser.userId,
      }),
      this.repository.findCurrentOrRecentPlan(matchedUser.accountId),
      this.repository.findLatestPaidPayment(matchedUser.accountId),
    ]);
    const availableChannels =
      channels.length > 0
        ? channels
        : await this.repository.listAllAccountChannels(matchedUser.accountId);

    const fullName = [userInfo?.name, userInfo?.lastName]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim())
      .join(' ');
    const paidAmount = paidPayment ? Number(paidPayment.amount) : Number.NaN;
    const decryptedPhone = this.decryptSensitiveValue(userInfo?.encryptedPhone);

    return {
      found: true,
      user: {
        email: this.decryptSensitiveValue(matchedUser.encryptedEmail),
        name: fullName || null,
        status: matchedUser.userStatus,
        document: this.decryptSensitiveValue(encryptedDocument),
        phone: this.composeInternationalPhone(
          userInfo?.phoneDdi,
          decryptedPhone
        ),
        access_group: accessGroup,
        sectors,
        channels: availableChannels,
      },
      account: {
        id: matchedUser.accountId,
        name: matchedUser.accountName,
        status: matchedUser.accountStatus,
        plan: planData?.planName ?? null,
        billing_period: planData?.billingPeriod ?? null,
        last_payment_at: this.getIsoDate(paidPayment?.paidAt),
        next_renewal_at: this.getFutureDate(planData?.nextPaymentAt),
        last_paid_amount: Number.isFinite(paidAmount) ? paidAmount : null,
      },
    };
  };

  private getCompatibleIdentityValues(
    lookupType: ChatbotUnderchatLookupInput['lookupType'],
    rawValue: string
  ): string[] {
    const trimmed = rawValue.trim();
    if (!trimmed) return [];

    if (lookupType === 'email') {
      const normalized = trimmed.toLowerCase();
      if (!EMAIL_PATTERN.test(normalized)) return [];
      return [...new Set([normalized, trimmed])];
    }

    const digits = trimmed.replaceAll(/\D/gu, '');
    const normalizedCnpj = normalizeCnpj(trimmed);
    const isCpf = digits.length === 11 && validateCpf(digits);
    const isCnpj = validateCnpj(normalizedCnpj);
    if (!isCpf && !isCnpj) return [];

    const candidates = isCpf
      ? [digits, formatCpf(digits), trimmed]
      : [normalizedCnpj, formatCnpj(normalizedCnpj), trimmed];
    return [...new Set(candidates.map((value) => value.trim()))];
  }

  private decryptSensitiveValue(
    encryptedValue: string | null | undefined
  ): string | null {
    if (!encryptedValue || encryptedValue.includes('*')) return null;
    if (encryptedValue.split(':').length !== 3) {
      throw new Error('Underchat lookup sensitive data is malformed');
    }

    try {
      return this.passwordEncryptorService.decrypt(encryptedValue);
    } catch {
      throw new Error('Underchat lookup sensitive data decryption failed');
    }
  }

  private composeInternationalPhone(
    phoneDdi: string | null | undefined,
    phone: string | null
  ): string | null {
    if (!phone) return null;
    const phoneDigits = phone.replaceAll(/\D/gu, '');
    const ddiDigits = phoneDdi?.replaceAll(/\D/gu, '') ?? '';
    if (!phoneDigits || !ddiDigits) return phone;
    if (phone.trim().startsWith('+') || phoneDigits.startsWith(ddiDigits)) {
      return `+${phoneDigits}`;
    }
    return `+${ddiDigits}${phoneDigits}`;
  }

  private getFutureDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.getTime() > Date.now()
      ? date.toISOString()
      : null;
  }

  private getIsoDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
}
