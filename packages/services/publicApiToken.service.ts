import { createHash, randomBytes } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import {
  AuthenticatedPublicApiTokenRecord,
  PublicApiTokenRecord,
  PublicApiTokenRepository,
} from '@core/repositories/publicApiToken/PublicApiToken.repository';
import { PublicApiTokenResponse } from '@core/schema/integration/apiToken/response.schema';

const PUBLIC_API_TOKEN_PREFIX = 'uc_live_';
const PUBLIC_API_TOKEN_RANDOM_BYTES = 32;
const PUBLIC_API_TOKEN_PATTERN = /^uc_live_[A-Za-z0-9_-]{43}$/;

export function generatePublicApiTokenValue(): string {
  return `${PUBLIC_API_TOKEN_PREFIX}${randomBytes(
    PUBLIC_API_TOKEN_RANDOM_BYTES
  ).toString('base64url')}`;
}

export function hashPublicApiToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function previewPublicApiToken(value: string): string {
  return `${PUBLIC_API_TOKEN_PREFIX}...${value.slice(-8)}`;
}

export function isPublicApiTokenFormat(value: string): boolean {
  return PUBLIC_API_TOKEN_PATTERN.test(value);
}

function buildEmptyPublicApiTokenResponse(): PublicApiTokenResponse {
  return {
    configured: false,
    token_id: null,
    status: 'not_configured',
    token: null,
    token_preview: null,
    actor_user_id: null,
    actor_user_name: null,
    created_at: null,
    updated_at: null,
    rotated_at: null,
    last_used_at: null,
    revoked_at: null,
  };
}

@injectable()
export class PublicApiTokenService {
  constructor(
    @inject(PublicApiTokenRepository)
    private readonly publicApiTokenRepository: PublicApiTokenRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService
  ) {}

  private toResponse(
    token: PublicApiTokenRecord,
    plainToken: string | null
  ): PublicApiTokenResponse {
    const isRevoked = token.revoked_at !== null;

    return {
      configured: !isRevoked,
      token_id: token.public_api_token_id,
      status: isRevoked ? 'revoked' : 'active',
      token: plainToken,
      token_preview: token.token_preview,
      actor_user_id: token.actor_user_id,
      actor_user_name: token.actor_user_name,
      created_at: token.created_at,
      updated_at: token.updated_at,
      rotated_at: token.rotated_at,
      last_used_at: token.last_used_at,
      revoked_at: token.revoked_at,
    };
  }

  view = async (accountId: string): Promise<PublicApiTokenResponse> => {
    const token =
      await this.publicApiTokenRepository.findActiveByAccount(accountId);

    if (!token) {
      return buildEmptyPublicApiTokenResponse();
    }

    const plainToken = this.passwordEncryptorService.decrypt(
      token.token_encrypted
    );

    return this.toResponse(token, plainToken);
  };

  generate = async (
    accountId: string,
    actorUserId: string
  ): Promise<PublicApiTokenResponse> => {
    const plainToken = generatePublicApiTokenValue();
    const token = await this.publicApiTokenRepository.rotate({
      public_api_token_id: uuidv7(),
      account_id: accountId,
      actor_user_id: actorUserId,
      token_hash: hashPublicApiToken(plainToken),
      token_encrypted: this.passwordEncryptorService.encrypt(plainToken),
      token_preview: previewPublicApiToken(plainToken),
    });

    return this.toResponse(token, plainToken);
  };

  revoke = async (accountId: string): Promise<PublicApiTokenResponse> => {
    const token = await this.publicApiTokenRepository.revoke(accountId);

    if (!token) {
      return buildEmptyPublicApiTokenResponse();
    }

    return this.toResponse(token, null);
  };

  findActiveByValue = async (
    plainToken: string
  ): Promise<AuthenticatedPublicApiTokenRecord | null> => {
    if (!isPublicApiTokenFormat(plainToken)) {
      return null;
    }

    return this.publicApiTokenRepository.findActiveByHash(
      hashPublicApiToken(plainToken)
    );
  };

  touchLastUsed = async (tokenId: string): Promise<void> => {
    await this.publicApiTokenRepository.touchLastUsed(tokenId);
  };
}
