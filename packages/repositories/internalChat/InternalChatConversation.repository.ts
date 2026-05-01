import * as schema from '@core/models';
import {
  internalChatConversation,
  internalChatConversationParticipant,
  permissionAssignment,
  permissionRole,
  sector,
  sectorUser,
  user,
  userInfo,
} from '@core/models';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  SQLWrapper,
  sql,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EInternalChatConversationParticipantRole } from '@core/common/enums/internalChat/EInternalChatConversationParticipantRole';
import { IInternalChatConversationBase } from '@core/common/interfaces/internalChat/IInternalChatConversationBase';
import { IInternalChatUserNamePhoto } from '@core/common/interfaces/internalChat/IInternalChatUserNamePhoto';
import {
  IInternalChatAddGroupMemberInput,
  IInternalChatApplyUnreadOnNewMessageInput,
  IInternalChatConversationParticipantView,
  IInternalChatCreateDirectConversationInput,
  IInternalChatCreateGroupConversationInput,
  IInternalChatIsUserParticipantInput,
  IInternalChatListOpenConversationsForUserInput,
  IInternalChatListOpenConversationsForUserResult,
  IInternalChatMarkConversationReadInput,
  IInternalChatParticipantState,
  IInternalChatTransferGroupLeaderInput,
  IInternalChatUpdateConversationLastMessageInput,
  IInternalChatUpdateGroupConversationInput,
} from '@core/common/interfaces/internalChat/IInternalChatConversationRepositoryContracts';

@injectable()
export class InternalChatConversationRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  buildDirectPairKey(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  async userBelongsToAccount(
    accountId: string,
    userId: string
  ): Promise<boolean> {
    const rows = await this.dbRo
      .select({ user_id: user.user_id })
      .from(user)
      .where(
        and(
          eq(user.user_id, userId),
          eq(user.account_id, accountId),
          isNull(user.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows.length > 0;
  }

  async findDirectConversationByPair(
    accountId: string,
    directPairKey: string
  ): Promise<string | null> {
    const rows = await this.dbRo
      .select({
        conversation_id: internalChatConversation.internal_chat_conversation_id,
      })
      .from(internalChatConversation)
      .where(
        and(
          eq(internalChatConversation.account_id, accountId),
          eq(
            internalChatConversation.type,
            EInternalChatConversationType.direct
          ),
          eq(internalChatConversation.direct_pair_key, directPairKey),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.conversation_id ?? null;
  }

  async createDirectConversation(
    input: IInternalChatCreateDirectConversationInput
  ): Promise<string> {
    const conversationId = uuidv7();

    await this.dbRw.insert(internalChatConversation).values({
      internal_chat_conversation_id: conversationId,
      account_id: input.accountId,
      type: EInternalChatConversationType.direct,
      direct_user_a_id: input.userAId,
      direct_user_b_id: input.userBId,
      direct_pair_key: input.directPairKey,
      created_by_user_id: input.createdByUserId,
      leader_user_id: input.createdByUserId,
      name: null,
      photo: null,
    });

    await Promise.all([
      this.ensureParticipant(
        conversationId,
        input.accountId,
        input.userAId,
        EInternalChatConversationParticipantRole.member
      ),
      this.ensureParticipant(
        conversationId,
        input.accountId,
        input.userBId,
        EInternalChatConversationParticipantRole.member
      ),
    ]);

    return conversationId;
  }

  async createGroupConversation(
    input: IInternalChatCreateGroupConversationInput
  ): Promise<string> {
    const conversationId = uuidv7();
    const now = new Date().toISOString();

    await this.dbRw.insert(internalChatConversation).values({
      internal_chat_conversation_id: conversationId,
      account_id: input.accountId,
      type: EInternalChatConversationType.group,
      name: input.name,
      photo: input.photo,
      created_by_user_id: input.createdByUserId,
      leader_user_id: input.createdByUserId,
      created_at: now,
      updated_at: now,
    });

    const uniqueMembers = Array.from(
      new Set([input.createdByUserId, ...input.memberUserIds])
    );

    await Promise.all(
      uniqueMembers.map((memberUserId) =>
        this.ensureParticipant(
          conversationId,
          input.accountId,
          memberUserId,
          memberUserId === input.createdByUserId
            ? EInternalChatConversationParticipantRole.leader
            : EInternalChatConversationParticipantRole.member
        )
      )
    );

    return conversationId;
  }

  async ensureParticipant(
    conversationId: string,
    accountId: string,
    userId: string,
    role: EInternalChatConversationParticipantRole
  ): Promise<void> {
    const participantId = await this.findParticipantId(conversationId, userId);

    if (participantId) {
      await this.reactivateParticipant(participantId, role);
      return;
    }

    await this.insertParticipant(conversationId, accountId, userId, role);
  }

  async isUserParticipant(
    input: IInternalChatIsUserParticipantInput
  ): Promise<boolean> {
    const rows = await this.dbRo
      .select({
        participant_id:
          internalChatConversationParticipant.internal_chat_conversation_participant_id,
      })
      .from(internalChatConversationParticipant)
      .innerJoin(
        internalChatConversation,
        eq(
          internalChatConversation.internal_chat_conversation_id,
          internalChatConversationParticipant.internal_chat_conversation_id
        )
      )
      .where(
        and(
          eq(internalChatConversationParticipant.user_id, input.userId),
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            input.conversationId
          ),
          eq(internalChatConversationParticipant.account_id, input.accountId),
          eq(internalChatConversation.account_id, input.accountId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows.length > 0;
  }

  async isGroupConversation(
    accountId: string,
    conversationId: string
  ): Promise<boolean> {
    const rows = await this.dbRo
      .select({
        conversation_id: internalChatConversation.internal_chat_conversation_id,
      })
      .from(internalChatConversation)
      .where(
        and(
          eq(internalChatConversation.account_id, accountId),
          eq(
            internalChatConversation.internal_chat_conversation_id,
            conversationId
          ),
          eq(
            internalChatConversation.type,
            EInternalChatConversationType.group
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows.length > 0;
  }

  async listOpenConversationsForUser(
    input: IInternalChatListOpenConversationsForUserInput
  ): Promise<IInternalChatListOpenConversationsForUserResult> {
    const filters = this.buildOpenConversationFilters(input);

    const [rows, totalRows] = await Promise.all([
      this.listOpenConversationRows(input, filters),
      this.countOpenConversationRows(filters),
    ]);

    return {
      conversationIds: rows.map((row) => row.conversation_id),
      total: Number(totalRows[0]?.total ?? 0),
    };
  }

  async getConversationById(
    accountId: string,
    conversationId: string
  ): Promise<IInternalChatConversationBase | null> {
    const rows = await this.dbRo
      .select({
        conversation_id: internalChatConversation.internal_chat_conversation_id,
        account_id: internalChatConversation.account_id,
        type: internalChatConversation.type,
        name: internalChatConversation.name,
        photo: internalChatConversation.photo,
        leader_user_id: internalChatConversation.leader_user_id,
        last_message_id: internalChatConversation.last_message_id,
        last_message_preview: internalChatConversation.last_message_preview,
        last_message_at: internalChatConversation.last_message_at,
        created_at: internalChatConversation.created_at,
        updated_at: internalChatConversation.updated_at,
      })
      .from(internalChatConversation)
      .where(
        and(
          eq(internalChatConversation.account_id, accountId),
          eq(
            internalChatConversation.internal_chat_conversation_id,
            conversationId
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!rows[0]) {
      return null;
    }

    return {
      conversation_id: rows[0].conversation_id,
      account_id: rows[0].account_id,
      type: rows[0].type as EInternalChatConversationType,
      name: rows[0].name ?? null,
      photo: rows[0].photo ?? null,
      leader_user_id: rows[0].leader_user_id ?? null,
      last_message_id: rows[0].last_message_id ?? null,
      last_message_preview: rows[0].last_message_preview ?? null,
      last_message_at: rows[0].last_message_at ?? null,
      created_at: rows[0].created_at ?? new Date().toISOString(),
      updated_at: rows[0].updated_at ?? new Date().toISOString(),
    };
  }

  async getParticipantState(
    conversationId: string,
    userId: string
  ): Promise<IInternalChatParticipantState | null> {
    const rows = await this.dbRo
      .select({
        role: internalChatConversationParticipant.role,
        unread_count: internalChatConversationParticipant.unread_count,
        closed_at: internalChatConversationParticipant.closed_at,
        last_read_message_id:
          internalChatConversationParticipant.last_read_message_id,
      })
      .from(internalChatConversationParticipant)
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          isNull(internalChatConversationParticipant.deleted_at),
          eq(internalChatConversationParticipant.is_active, true)
        )
      )
      .limit(1)
      .execute();

    if (!rows[0]) {
      return null;
    }

    return {
      role:
        (rows[0].role as EInternalChatConversationParticipantRole) ??
        EInternalChatConversationParticipantRole.member,
      unread_count: rows[0].unread_count ?? 0,
      closed_at: rows[0].closed_at ?? null,
      last_read_message_id: rows[0].last_read_message_id ?? null,
    };
  }

  async listParticipants(
    conversationId: string
  ): Promise<IInternalChatConversationParticipantView[]> {
    const rows = await this.dbRo
      .select({
        user_id: internalChatConversationParticipant.user_id,
        role: internalChatConversationParticipant.role,
        unread_count: internalChatConversationParticipant.unread_count,
        closed_at: internalChatConversationParticipant.closed_at,
        name: userInfo.name,
        photo: userInfo.photo,
        email: user.email_partial,
      })
      .from(internalChatConversationParticipant)
      .innerJoin(
        user,
        eq(user.user_id, internalChatConversationParticipant.user_id)
      )
      .innerJoin(
        userInfo,
        eq(userInfo.user_id, internalChatConversationParticipant.user_id)
      )
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .orderBy(asc(userInfo.name))
      .execute();

    const userIds = rows.map((row) => row.user_id);
    const [sectorRows, roleRows] =
      userIds.length > 0
        ? await Promise.all([
            this.dbRo
              .select({
                user_id: sectorUser.user_id,
                sector_name: sector.name,
              })
              .from(sectorUser)
              .innerJoin(sector, eq(sector.sector_id, sectorUser.sector_id))
              .where(
                and(
                  inArray(sectorUser.user_id, userIds),
                  isNull(sectorUser.deleted_at),
                  isNull(sector.deleted_at)
                )
              )
              .orderBy(asc(sector.name))
              .execute(),
            this.dbRo
              .select({
                user_id: permissionAssignment.user_id,
                role_name: permissionRole.name,
              })
              .from(permissionAssignment)
              .innerJoin(
                permissionRole,
                eq(
                  permissionRole.permission_role_id,
                  permissionAssignment.permission_role_id
                )
              )
              .where(
                and(
                  inArray(permissionAssignment.user_id, userIds),
                  isNull(permissionRole.deleted_at)
                )
              )
              .orderBy(asc(permissionRole.name))
              .execute(),
          ])
        : [[], []];

    const sectorByUserId = new Map<string, string[]>();
    for (const row of sectorRows) {
      const current = sectorByUserId.get(row.user_id) ?? [];
      current.push(row.sector_name);
      sectorByUserId.set(row.user_id, current);
    }

    const positionByUserId = new Map<string, string>();
    for (const row of roleRows) {
      if (!row.user_id || positionByUserId.has(row.user_id)) continue;
      positionByUserId.set(row.user_id, row.role_name);
    }

    return rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      photo: row.photo ?? null,
      email: row.email ?? null,
      sector: sectorByUserId.get(row.user_id)?.join(', ') ?? null,
      position: positionByUserId.get(row.user_id) ?? null,
      role:
        (row.role as EInternalChatConversationParticipantRole) ??
        EInternalChatConversationParticipantRole.member,
      unread_count: row.unread_count ?? 0,
      closed_at: row.closed_at ?? null,
    }));
  }

  async listParticipantIds(conversationId: string): Promise<string[]> {
    const rows = await this.dbRo
      .select({ user_id: internalChatConversationParticipant.user_id })
      .from(internalChatConversationParticipant)
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();

    return rows.map((row) => row.user_id);
  }

  async closeConversationForUser(
    conversationId: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  }

  async leaveGroupConversation(
    conversationId: string,
    userId: string
  ): Promise<boolean> {
    const now = new Date().toISOString();

    return this.dbRw.transaction(async (tx) => {
      const [participant] = await tx
        .select({
          role: internalChatConversationParticipant.role,
          leader_user_id: internalChatConversation.leader_user_id,
        })
        .from(internalChatConversationParticipant)
        .innerJoin(
          internalChatConversation,
          eq(
            internalChatConversation.internal_chat_conversation_id,
            internalChatConversationParticipant.internal_chat_conversation_id
          )
        )
        .where(
          and(
            eq(
              internalChatConversationParticipant.internal_chat_conversation_id,
              conversationId
            ),
            eq(internalChatConversationParticipant.user_id, userId),
            eq(internalChatConversationParticipant.is_active, true),
            isNull(internalChatConversationParticipant.deleted_at),
            eq(
              internalChatConversation.type,
              EInternalChatConversationType.group
            ),
            isNull(internalChatConversation.deleted_at)
          )
        )
        .limit(1)
        .execute();

      if (!participant) {
        return false;
      }

      const leftGroupResult = await tx
        .update(internalChatConversationParticipant)
        .set({
          is_active: false,
          deleted_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(
              internalChatConversationParticipant.internal_chat_conversation_id,
              conversationId
            ),
            eq(internalChatConversationParticipant.user_id, userId),
            eq(internalChatConversationParticipant.is_active, true),
            isNull(internalChatConversationParticipant.deleted_at)
          )
        )
        .execute();

      if ((leftGroupResult.rowCount ?? 0) === 0) {
        return false;
      }

      const isLeavingLeader =
        participant.role === EInternalChatConversationParticipantRole.leader ||
        participant.leader_user_id === userId;

      if (!isLeavingLeader) {
        return true;
      }

      const [nextLeader] = await tx
        .select({
          user_id: internalChatConversationParticipant.user_id,
        })
        .from(internalChatConversationParticipant)
        .where(
          and(
            eq(
              internalChatConversationParticipant.internal_chat_conversation_id,
              conversationId
            ),
            ne(internalChatConversationParticipant.user_id, userId),
            eq(internalChatConversationParticipant.is_active, true),
            isNull(internalChatConversationParticipant.deleted_at)
          )
        )
        .orderBy(
          asc(internalChatConversationParticipant.joined_at),
          asc(internalChatConversationParticipant.created_at),
          asc(
            internalChatConversationParticipant.internal_chat_conversation_participant_id
          )
        )
        .limit(1)
        .execute();

      if (!nextLeader) {
        const deletedGroupResult = await tx
          .update(internalChatConversation)
          .set({
            leader_user_id: null,
            deleted_at: now,
            updated_at: now,
          })
          .where(
            and(
              eq(
                internalChatConversation.internal_chat_conversation_id,
                conversationId
              ),
              eq(
                internalChatConversation.type,
                EInternalChatConversationType.group
              ),
              isNull(internalChatConversation.deleted_at)
            )
          )
          .execute();

        if ((deletedGroupResult.rowCount ?? 0) === 0) {
          throw new Error('chat_update_error');
        }

        return true;
      }

      await tx
        .update(internalChatConversationParticipant)
        .set({
          role: EInternalChatConversationParticipantRole.member,
          updated_at: now,
        })
        .where(
          and(
            eq(
              internalChatConversationParticipant.internal_chat_conversation_id,
              conversationId
            ),
            eq(internalChatConversationParticipant.is_active, true),
            isNull(internalChatConversationParticipant.deleted_at)
          )
        )
        .execute();

      const nextLeaderResult = await tx
        .update(internalChatConversationParticipant)
        .set({
          role: EInternalChatConversationParticipantRole.leader,
          updated_at: now,
        })
        .where(
          and(
            eq(
              internalChatConversationParticipant.internal_chat_conversation_id,
              conversationId
            ),
            eq(internalChatConversationParticipant.user_id, nextLeader.user_id),
            eq(internalChatConversationParticipant.is_active, true),
            isNull(internalChatConversationParticipant.deleted_at)
          )
        )
        .execute();

      if ((nextLeaderResult.rowCount ?? 0) === 0) {
        throw new Error('chat_update_error');
      }

      const transferResult = await tx
        .update(internalChatConversation)
        .set({
          leader_user_id: nextLeader.user_id,
          updated_at: now,
        })
        .where(
          and(
            eq(
              internalChatConversation.internal_chat_conversation_id,
              conversationId
            ),
            eq(
              internalChatConversation.type,
              EInternalChatConversationType.group
            ),
            isNull(internalChatConversation.deleted_at)
          )
        )
        .execute();

      if ((transferResult.rowCount ?? 0) === 0) {
        throw new Error('chat_update_error');
      }

      return true;
    });
  }

  async reopenConversationForUser(
    conversationId: string,
    userId: string
  ): Promise<void> {
    await this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        closed_at: null,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();
  }

  async markConversationRead(
    input: IInternalChatMarkConversationReadInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        unread_count: 0,
        closed_at: null,
        last_read_message_id: input.lastReadMessageId ?? null,
        last_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            input.conversationId
          ),
          eq(internalChatConversationParticipant.user_id, input.userId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  }

  async updateConversationLastMessage(
    input: IInternalChatUpdateConversationLastMessageInput
  ): Promise<void> {
    await this.dbRw
      .update(internalChatConversation)
      .set({
        last_message_id: input.lastMessageId,
        last_message_preview: input.lastMessagePreview,
        last_message_at: input.lastMessageAt,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversation.internal_chat_conversation_id,
            input.conversationId
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .execute();
  }

  async applyUnreadOnNewMessage(
    input: IInternalChatApplyUnreadOnNewMessageInput
  ): Promise<void> {
    await Promise.all([
      this.incrementUnreadForRecipients(input),
      this.markSenderAsReadForMessage(input),
    ]);
  }

  async addGroupMember(input: IInternalChatAddGroupMemberInput): Promise<void> {
    await this.ensureParticipant(
      input.conversationId,
      input.accountId,
      input.userId,
      EInternalChatConversationParticipantRole.member
    );
  }

  async removeGroupMember(
    conversationId: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        is_active: false,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  }

  async updateGroupConversation(
    input: IInternalChatUpdateGroupConversationInput
  ): Promise<boolean> {
    const updateData: Partial<typeof internalChatConversation.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.photo !== undefined) {
      updateData.photo = input.photo;
    }

    const result = await this.dbRw
      .update(internalChatConversation)
      .set(updateData)
      .where(
        and(
          eq(
            internalChatConversation.internal_chat_conversation_id,
            input.conversationId
          ),
          eq(internalChatConversation.account_id, input.accountId),
          eq(
            internalChatConversation.type,
            EInternalChatConversationType.group
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  }

  async transferGroupLeader(
    input: IInternalChatTransferGroupLeaderInput
  ): Promise<boolean> {
    const now = new Date().toISOString();

    await this.updateAllParticipantsToMember(input.conversationId, now);

    const [, conversationResult] = await Promise.all([
      this.updateParticipantToLeader(input.conversationId, input.userId, now),
      this.updateConversationLeader(input.conversationId, input.userId, now),
    ]);

    return (conversationResult.rowCount ?? 0) > 0;
  }

  async listUsersByIds(
    userIds: string[]
  ): Promise<IInternalChatUserNamePhoto[]> {
    if (userIds.length === 0) {
      return [];
    }

    const rows = await this.dbRo
      .select({
        user_id: user.user_id,
        name: userInfo.name,
        photo: userInfo.photo,
      })
      .from(user)
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .where(
        and(
          inArray(user.user_id, userIds),
          isNull(user.deleted_at),
          isNull(userInfo.deleted_at)
        )
      )
      .execute();

    return rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      photo: row.photo ?? null,
    }));
  }

  async getConversationLeaderUserId(
    conversationId: string
  ): Promise<string | null> {
    const rows = await this.dbRo
      .select({
        leader_user_id: internalChatConversation.leader_user_id,
      })
      .from(internalChatConversation)
      .where(
        and(
          eq(
            internalChatConversation.internal_chat_conversation_id,
            conversationId
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.leader_user_id ?? null;
  }

  async countActiveParticipants(conversationId: string): Promise<number> {
    const rows = await this.dbRo
      .select({
        total: count(),
      })
      .from(internalChatConversationParticipant)
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();

    return Number(rows[0]?.total ?? 0);
  }

  private buildOpenConversationFilters(
    input: IInternalChatListOpenConversationsForUserInput
  ): SQLWrapper[] {
    const filters: SQLWrapper[] = [
      eq(internalChatConversationParticipant.user_id, input.userId),
      eq(internalChatConversationParticipant.account_id, input.accountId),
      eq(internalChatConversationParticipant.is_active, true),
      isNull(internalChatConversationParticipant.deleted_at),
      isNull(internalChatConversationParticipant.closed_at),
      eq(internalChatConversation.account_id, input.accountId),
      isNull(internalChatConversation.deleted_at),
    ];

    if (input.type) {
      filters.push(eq(internalChatConversation.type, input.type));
    }

    const search = input.search?.trim();
    if (search) {
      const searchPattern = `%${search}%`;
      const searchCondition = or(
        ilike(internalChatConversation.name, searchPattern),
        sql`EXISTS (
          SELECT 1
          FROM internal_chat_conversation_participant p2
          INNER JOIN user_info ui ON ui.user_id = p2.user_id
          WHERE p2.internal_chat_conversation_id = ${internalChatConversation.internal_chat_conversation_id}
            AND p2.deleted_at IS NULL
            AND p2.is_active = true
            AND ui.deleted_at IS NULL
            AND ui.name ILIKE ${searchPattern}
        )`
      );

      if (searchCondition) {
        filters.push(searchCondition);
      }
    }

    return filters;
  }

  private listOpenConversationRows(
    input: IInternalChatListOpenConversationsForUserInput,
    filters: SQLWrapper[]
  ) {
    const where = and(...filters);

    return this.dbRo
      .selectDistinct({
        conversation_id: internalChatConversation.internal_chat_conversation_id,
        last_message_at: internalChatConversation.last_message_at,
        updated_at: internalChatConversation.updated_at,
      })
      .from(internalChatConversationParticipant)
      .innerJoin(
        internalChatConversation,
        eq(
          internalChatConversation.internal_chat_conversation_id,
          internalChatConversationParticipant.internal_chat_conversation_id
        )
      )
      .where(where)
      .orderBy(
        sql`${internalChatConversation.last_message_at} DESC NULLS LAST`,
        desc(internalChatConversation.updated_at)
      )
      .limit(input.perPage)
      .offset((input.currentPage - 1) * input.perPage)
      .execute();
  }

  private countOpenConversationRows(filters: SQLWrapper[]) {
    const where = and(...filters);

    return this.dbRo
      .select({
        total: sql<number>`count(distinct ${internalChatConversation.internal_chat_conversation_id})`,
      })
      .from(internalChatConversationParticipant)
      .innerJoin(
        internalChatConversation,
        eq(
          internalChatConversation.internal_chat_conversation_id,
          internalChatConversationParticipant.internal_chat_conversation_id
        )
      )
      .where(where)
      .execute();
  }

  private incrementUnreadForRecipients(
    input: IInternalChatApplyUnreadOnNewMessageInput
  ) {
    return this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        unread_count: sql`${internalChatConversationParticipant.unread_count} + 1`,
        closed_at: null,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            input.conversationId
          ),
          ne(internalChatConversationParticipant.user_id, input.senderUserId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();
  }

  private markSenderAsReadForMessage(
    input: IInternalChatApplyUnreadOnNewMessageInput
  ) {
    return this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        unread_count: 0,
        closed_at: null,
        last_read_message_id: input.messageId,
        last_read_at: input.messageDate,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            input.conversationId
          ),
          eq(internalChatConversationParticipant.user_id, input.senderUserId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();
  }

  private updateAllParticipantsToMember(conversationId: string, now: string) {
    return this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        role: EInternalChatConversationParticipantRole.member,
        updated_at: now,
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();
  }

  private updateParticipantToLeader(
    conversationId: string,
    userId: string,
    now: string
  ) {
    return this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        role: EInternalChatConversationParticipantRole.leader,
        updated_at: now,
      })
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          eq(internalChatConversationParticipant.is_active, true),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .execute();
  }

  private updateConversationLeader(
    conversationId: string,
    userId: string,
    now: string
  ) {
    return this.dbRw
      .update(internalChatConversation)
      .set({
        leader_user_id: userId,
        updated_at: now,
      })
      .where(
        and(
          eq(
            internalChatConversation.internal_chat_conversation_id,
            conversationId
          ),
          isNull(internalChatConversation.deleted_at)
        )
      )
      .execute();
  }

  private async findParticipantId(
    conversationId: string,
    userId: string
  ): Promise<string | null> {
    const rows = await this.dbRw
      .select({
        participant_id:
          internalChatConversationParticipant.internal_chat_conversation_participant_id,
      })
      .from(internalChatConversationParticipant)
      .where(
        and(
          eq(
            internalChatConversationParticipant.internal_chat_conversation_id,
            conversationId
          ),
          eq(internalChatConversationParticipant.user_id, userId),
          isNull(internalChatConversationParticipant.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return rows[0]?.participant_id ?? null;
  }

  private async reactivateParticipant(
    participantId: string,
    role: EInternalChatConversationParticipantRole
  ): Promise<void> {
    await this.dbRw
      .update(internalChatConversationParticipant)
      .set({
        role,
        is_active: true,
        closed_at: null,
        updated_at: new Date().toISOString(),
      })
      .where(
        eq(
          internalChatConversationParticipant.internal_chat_conversation_participant_id,
          participantId
        )
      )
      .execute();
  }

  private async insertParticipant(
    conversationId: string,
    accountId: string,
    userId: string,
    role: EInternalChatConversationParticipantRole
  ): Promise<void> {
    await this.dbRw
      .insert(internalChatConversationParticipant)
      .values({
        internal_chat_conversation_participant_id: uuidv7(),
        internal_chat_conversation_id: conversationId,
        account_id: accountId,
        user_id: userId,
        role,
        is_active: true,
      })
      .execute();
  }
}
