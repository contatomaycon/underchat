import * as schema from '@core/models';
import {
  account,
  planAccount,
  publicApiToken,
  user,
  userInfo,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';
import { EUserStatus } from '@core/common/enums/EUserStatus';

export interface PublicApiTokenRecord {
  public_api_token_id: string;
  account_id: string;
  actor_user_id: string;
  actor_user_name: string | null;
  token_hash: string;
  token_encrypted: string;
  token_preview: string;
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuthenticatedPublicApiTokenRecord extends PublicApiTokenRecord {
  plan_is_active: boolean;
}

export interface RotatePublicApiTokenInput {
  public_api_token_id: string;
  account_id: string;
  actor_user_id: string;
  token_hash: string;
  token_encrypted: string;
  token_preview: string;
}

@injectable()
export class PublicApiTokenRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private selectToken() {
    return this.dbRw
      .select({
        public_api_token_id: publicApiToken.public_api_token_id,
        account_id: publicApiToken.account_id,
        actor_user_id: publicApiToken.actor_user_id,
        actor_user_name: sql<
          string | null
        >`NULLIF(TRIM(CONCAT(COALESCE(${userInfo.name}, ''), ' ', COALESCE(${userInfo.last_name}, ''))), '')`,
        token_hash: publicApiToken.token_hash,
        token_encrypted: publicApiToken.token_encrypted,
        token_preview: publicApiToken.token_preview,
        created_at: publicApiToken.created_at,
        updated_at: publicApiToken.updated_at,
        rotated_at: publicApiToken.rotated_at,
        last_used_at: publicApiToken.last_used_at,
        revoked_at: publicApiToken.revoked_at,
      })
      .from(publicApiToken)
      .leftJoin(
        userInfo,
        and(
          eq(userInfo.user_id, publicApiToken.actor_user_id),
          isNull(userInfo.deleted_at)
        )
      );
  }

  findActiveByAccount = async (
    accountId: string
  ): Promise<PublicApiTokenRecord | null> => {
    const result = await this.selectToken()
      .where(
        and(
          eq(publicApiToken.account_id, accountId),
          isNull(publicApiToken.revoked_at)
        )
      )
      .limit(1)
      .execute();

    return result[0] ?? null;
  };

  findActiveByHash = async (
    tokenHash: string
  ): Promise<AuthenticatedPublicApiTokenRecord | null> => {
    const result = await this.dbRw
      .select({
        public_api_token_id: publicApiToken.public_api_token_id,
        account_id: publicApiToken.account_id,
        actor_user_id: publicApiToken.actor_user_id,
        actor_user_name: sql<
          string | null
        >`NULLIF(TRIM(CONCAT(COALESCE(${userInfo.name}, ''), ' ', COALESCE(${userInfo.last_name}, ''))), '')`,
        token_hash: publicApiToken.token_hash,
        token_encrypted: publicApiToken.token_encrypted,
        token_preview: publicApiToken.token_preview,
        created_at: publicApiToken.created_at,
        updated_at: publicApiToken.updated_at,
        rotated_at: publicApiToken.rotated_at,
        last_used_at: publicApiToken.last_used_at,
        revoked_at: publicApiToken.revoked_at,
        plan_is_active: sql<boolean>`CASE
          WHEN ${account.account_status_id} = ${EAccountStatus.blocked} THEN FALSE
          WHEN ${account.account_status_id} NOT IN (${EAccountStatus.active}, ${EAccountStatus.inactive}) THEN FALSE
          ELSE COALESCE((
            SELECT ${planAccount.next_payment_date} > NOW()
            FROM ${planAccount}
            WHERE ${planAccount.account_id} = ${publicApiToken.account_id}
            ORDER BY ${planAccount.created_at} DESC
            LIMIT 1
          ), FALSE)
        END`,
      })
      .from(publicApiToken)
      .leftJoin(
        userInfo,
        and(
          eq(userInfo.user_id, publicApiToken.actor_user_id),
          isNull(userInfo.deleted_at)
        )
      )
      .innerJoin(
        account,
        and(
          eq(account.account_id, publicApiToken.account_id),
          isNull(account.deleted_at)
        )
      )
      .where(
        and(
          eq(publicApiToken.token_hash, tokenHash),
          isNull(publicApiToken.revoked_at)
        )
      )
      .limit(1)
      .execute();

    return result[0] ?? null;
  };

  findById = async (
    accountId: string,
    tokenId: string
  ): Promise<PublicApiTokenRecord | null> => {
    const result = await this.selectToken()
      .where(
        and(
          eq(publicApiToken.account_id, accountId),
          eq(publicApiToken.public_api_token_id, tokenId)
        )
      )
      .limit(1)
      .execute();

    return result[0] ?? null;
  };

  rotate = async (
    input: RotatePublicApiTokenInput
  ): Promise<PublicApiTokenRecord> => {
    const tokenId = await this.dbRw.transaction(async (tx) => {
      const accountLock = await tx
        .select({ account_id: account.account_id })
        .from(account)
        .where(eq(account.account_id, input.account_id))
        .for('update')
        .limit(1)
        .execute();

      if (!accountLock[0]) {
        throw new Error('public_api_token_account_not_found');
      }

      const activeActor = await tx
        .select({ user_id: user.user_id })
        .from(user)
        .where(
          and(
            eq(user.user_id, input.actor_user_id),
            eq(user.account_id, input.account_id),
            eq(user.user_status_id, EUserStatus.active),
            isNull(user.deleted_at)
          )
        )
        .limit(1)
        .execute();

      if (!activeActor[0]) {
        throw new Error('public_api_token_actor_not_active');
      }

      const now = new Date().toISOString();
      const revokedTokens = await tx
        .update(publicApiToken)
        .set({
          revoked_at: now,
          rotated_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(publicApiToken.account_id, input.account_id),
            isNull(publicApiToken.revoked_at)
          )
        )
        .returning({
          public_api_token_id: publicApiToken.public_api_token_id,
        })
        .execute();

      await tx
        .insert(publicApiToken)
        .values({
          ...input,
          created_at: now,
          updated_at: now,
          rotated_at: revokedTokens.length > 0 ? now : null,
        })
        .execute();

      return input.public_api_token_id;
    });

    const token = await this.findById(input.account_id, tokenId);
    if (!token) {
      throw new Error('public_api_token_creation_error');
    }

    return token;
  };

  revoke = async (accountId: string): Promise<PublicApiTokenRecord | null> => {
    const revokedTokenId = await this.dbRw.transaction(async (tx) => {
      const accountLock = await tx
        .select({ account_id: account.account_id })
        .from(account)
        .where(eq(account.account_id, accountId))
        .for('update')
        .limit(1)
        .execute();

      if (!accountLock[0]) {
        return null;
      }

      const now = new Date().toISOString();
      const result = await tx
        .update(publicApiToken)
        .set({
          revoked_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(publicApiToken.account_id, accountId),
            isNull(publicApiToken.revoked_at)
          )
        )
        .returning({
          public_api_token_id: publicApiToken.public_api_token_id,
        })
        .execute();

      return result[0]?.public_api_token_id ?? null;
    });

    if (!revokedTokenId) {
      return null;
    }

    return this.findById(accountId, revokedTokenId);
  };

  touchLastUsed = async (tokenId: string): Promise<void> => {
    const now = new Date().toISOString();

    await this.dbRw
      .update(publicApiToken)
      .set({ last_used_at: now })
      .where(
        and(
          eq(publicApiToken.public_api_token_id, tokenId),
          isNull(publicApiToken.revoked_at),
          or(
            isNull(publicApiToken.last_used_at),
            sql`${publicApiToken.last_used_at} < NOW() - INTERVAL '30 seconds'`
          )
        )
      )
      .execute();
  };
}
