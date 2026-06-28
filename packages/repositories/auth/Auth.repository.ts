import { EUserStatus } from '@core/common/enums/EUserStatus';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import * as schema from '@core/models';
import {
  user,
  userStatus,
  userInfo,
  userDocument,
  userDocumentType,
  userAddress,
  permissionAssignment,
  permissionRole,
  chatUser,
  zipcodeCity,
  zipcodeState,
} from '@core/models';
import { AuthUserResponse } from '@core/schema/auth/login/response.schema';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { PresenceService } from '@core/services/presence.service';
import type { IAuthenticate } from '@core/common/interfaces/IAuthenticate';

@injectable()
export class AuthRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject(PresenceService)
    private readonly presenceService: PresenceService
  ) {}

  authenticate = async (
    input: IAuthenticate
  ): Promise<AuthUserResponse | null> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        account_id: user.account_id,
        email_partial: user.email_partial,
        status: {
          status_id: userStatus.user_status_id,
          name: userStatus.name,
        },
        info: {
          user_info_id: userInfo.user_info_id,
          name: userInfo.name,
          last_name: userInfo.last_name,
          phone_partial: userInfo.phone_partial,
          photo: userInfo.photo,
          birth_date: userInfo.birth_date,
        },
        type: {
          user_type_id: permissionRole.permission_role_id,
          name: permissionRole.name,
        },
        document: {
          user_document_id: userDocument.user_document_id,
          document_partial: userDocument.document_partial,
          document_type: userDocumentType.name,
        },
        address: {
          user_address_id: userAddress.user_address_id,
          zip_code: userAddress.zip_code,
          address1_partial: userAddress.address1_partial,
          address2_partial: userAddress.address2_partial,
          city: zipcodeCity.city,
          state: zipcodeState.state,
          district: userAddress.district,
        },
        chat_user: {
          chat_user_id: chatUser.chat_user_id,
          about: chatUser.about,
          notifications: chatUser.notifications,
          notifications_sound: chatUser.notifications_sound,
          notifications_vibrate: chatUser.notifications_vibrate,
          notifications_toast: chatUser.notifications_toast,
          notifications_browser: chatUser.notifications_browser,
          notifications_push: chatUser.notifications_push,
          notifications_message_queue: chatUser.notifications_message_queue,
          notifications_message_in_chat: chatUser.notifications_message_in_chat,
          notifications_message_chatbot: chatUser.notifications_message_chatbot,
          notifications_transfer: chatUser.notifications_transfer,
          notifications_internal_chat: chatUser.notifications_internal_chat,
          notifications_internal_chat_direct:
            chatUser.notifications_internal_chat_direct,
          notifications_internal_chat_group:
            chatUser.notifications_internal_chat_group,
          notifications_internal_chat_sound:
            chatUser.notifications_internal_chat_sound,
          notifications_internal_chat_vibrate:
            chatUser.notifications_internal_chat_vibrate,
          notifications_internal_chat_toast:
            chatUser.notifications_internal_chat_toast,
          notifications_internal_chat_browser:
            chatUser.notifications_internal_chat_browser,
          notifications_internal_chat_push:
            chatUser.notifications_internal_chat_push,
          sort_by_chat_order: chatUser.sort_by_chat_order,
          sort_in_chat_order: chatUser.sort_in_chat_order,
          sort_by_my_chats_order: chatUser.sort_by_my_chats_order,
          sort_my_chats_order: chatUser.sort_my_chats_order,
          sort_by_queue_order: chatUser.sort_by_queue_order,
          sort_queue_order: chatUser.sort_queue_order,
          sort_by_chatbot_order: chatUser.sort_by_chatbot_order,
          sort_chatbot_order: chatUser.sort_chatbot_order,
        },
      })
      .from(user)
      .innerJoin(userStatus, eq(userStatus.user_status_id, user.user_status_id))
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .innerJoin(
        permissionAssignment,
        eq(permissionAssignment.user_id, user.user_id)
      )
      .innerJoin(
        permissionRole,
        eq(
          permissionRole.permission_role_id,
          permissionAssignment.permission_role_id
        )
      )
      .leftJoin(userDocument, eq(userDocument.user_id, user.user_id))
      .leftJoin(
        userDocumentType,
        eq(
          userDocumentType.user_document_type_id,
          userDocument.user_document_type_id
        )
      )
      .leftJoin(userAddress, eq(userAddress.user_id, user.user_id))
      .leftJoin(
        zipcodeCity,
        eq(userAddress.city_fiscal_code, zipcodeCity.fiscal_code)
      )
      .leftJoin(
        zipcodeState,
        eq(userAddress.state_fiscal_code, zipcodeState.fiscal_code)
      )
      .leftJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(
        and(
          eq(user.email_c, input.email),
          eq(user.password, input.password),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .execute();

    if (!result.length) {
      return null;
    }

    const userData = result[0] as AuthUserResponse;
    if (userData.address && !userData.address.user_address_id) {
      userData.address = null;
    }

    if (userData.chat_user) {
      const status = await this.presenceService.getStatus(userData.user_id);
      userData.chat_user.status = status ?? EChatUserStatus.offline;
    }

    return userData as AuthUserResponse;
  };

  hasValidCredentials = async (input: IAuthenticate): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
      })
      .from(user)
      .where(
        and(
          eq(user.email_c, input.email),
          eq(user.password, input.password),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .limit(1)
      .execute();

    return result.length > 0;
  };

  findUserById = async (userId: string): Promise<AuthUserResponse | null> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        account_id: user.account_id,
        email_partial: user.email_partial,
        status: {
          status_id: userStatus.user_status_id,
          name: userStatus.name,
        },
        info: {
          user_info_id: userInfo.user_info_id,
          name: userInfo.name,
          last_name: userInfo.last_name,
          phone_partial: userInfo.phone_partial,
          photo: userInfo.photo,
          birth_date: userInfo.birth_date,
        },
        type: {
          user_type_id: permissionRole.permission_role_id,
          name: permissionRole.name,
        },
        document: {
          user_document_id: userDocument.user_document_id,
          document_partial: userDocument.document_partial,
          document_type: userDocumentType.name,
        },
        address: {
          user_address_id: userAddress.user_address_id,
          zip_code: userAddress.zip_code,
          address1_partial: userAddress.address1_partial,
          address2_partial: userAddress.address2_partial,
          city: zipcodeCity.city,
          state: zipcodeState.state,
          district: userAddress.district,
        },
        chat_user: {
          chat_user_id: chatUser.chat_user_id,
          about: chatUser.about,
          notifications: chatUser.notifications,
          notifications_sound: chatUser.notifications_sound,
          notifications_vibrate: chatUser.notifications_vibrate,
          notifications_toast: chatUser.notifications_toast,
          notifications_browser: chatUser.notifications_browser,
          notifications_push: chatUser.notifications_push,
          notifications_message_queue: chatUser.notifications_message_queue,
          notifications_message_in_chat: chatUser.notifications_message_in_chat,
          notifications_message_chatbot: chatUser.notifications_message_chatbot,
          notifications_transfer: chatUser.notifications_transfer,
          notifications_internal_chat: chatUser.notifications_internal_chat,
          notifications_internal_chat_direct:
            chatUser.notifications_internal_chat_direct,
          notifications_internal_chat_group:
            chatUser.notifications_internal_chat_group,
          notifications_internal_chat_sound:
            chatUser.notifications_internal_chat_sound,
          notifications_internal_chat_vibrate:
            chatUser.notifications_internal_chat_vibrate,
          notifications_internal_chat_toast:
            chatUser.notifications_internal_chat_toast,
          notifications_internal_chat_browser:
            chatUser.notifications_internal_chat_browser,
          notifications_internal_chat_push:
            chatUser.notifications_internal_chat_push,
          sort_in_chat_order: chatUser.sort_in_chat_order,
          sort_my_chats_order: chatUser.sort_my_chats_order,
          sort_queue_order: chatUser.sort_queue_order,
          sort_chatbot_order: chatUser.sort_chatbot_order,
        },
      })
      .from(user)
      .innerJoin(userStatus, eq(userStatus.user_status_id, user.user_status_id))
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .innerJoin(
        permissionAssignment,
        eq(permissionAssignment.user_id, user.user_id)
      )
      .innerJoin(
        permissionRole,
        eq(
          permissionRole.permission_role_id,
          permissionAssignment.permission_role_id
        )
      )
      .leftJoin(userDocument, eq(userDocument.user_id, user.user_id))
      .leftJoin(
        userDocumentType,
        eq(
          userDocumentType.user_document_type_id,
          userDocument.user_document_type_id
        )
      )
      .leftJoin(userAddress, eq(userAddress.user_id, user.user_id))
      .leftJoin(
        zipcodeCity,
        eq(userAddress.city_fiscal_code, zipcodeCity.fiscal_code)
      )
      .leftJoin(
        zipcodeState,
        eq(userAddress.state_fiscal_code, zipcodeState.fiscal_code)
      )
      .leftJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(and(eq(user.user_id, userId), isNull(user.deleted_at)))
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    const userData = result[0] as AuthUserResponse;
    if (userData.address && !userData.address.user_address_id) {
      userData.address = null;
    }

    if (userData.chat_user) {
      const status = await this.presenceService.getStatus(userData.user_id);
      userData.chat_user.status = status ?? EChatUserStatus.offline;
    }

    return userData as AuthUserResponse;
  };

  authenticateByUserId = async (
    userId: string,
    accountId: string
  ): Promise<AuthUserResponse | null> => {
    const result = await this.dbRo
      .select({
        user_id: user.user_id,
        account_id: user.account_id,
        email_partial: user.email_partial,
        status: {
          status_id: userStatus.user_status_id,
          name: userStatus.name,
        },
        info: {
          user_info_id: userInfo.user_info_id,
          name: userInfo.name,
          last_name: userInfo.last_name,
          phone_partial: userInfo.phone_partial,
          photo: userInfo.photo,
          birth_date: userInfo.birth_date,
        },
        type: {
          user_type_id: permissionRole.permission_role_id,
          name: permissionRole.name,
        },
        document: {
          user_document_id: userDocument.user_document_id,
          document_partial: userDocument.document_partial,
          document_type: userDocumentType.name,
        },
        address: {
          user_address_id: userAddress.user_address_id,
          zip_code: userAddress.zip_code,
          address1_partial: userAddress.address1_partial,
          address2_partial: userAddress.address2_partial,
          city: zipcodeCity.city,
          state: zipcodeState.state,
          district: userAddress.district,
        },
        chat_user: {
          chat_user_id: chatUser.chat_user_id,
          about: chatUser.about,
          notifications: chatUser.notifications,
          notifications_sound: chatUser.notifications_sound,
          notifications_vibrate: chatUser.notifications_vibrate,
          notifications_toast: chatUser.notifications_toast,
          notifications_browser: chatUser.notifications_browser,
          notifications_push: chatUser.notifications_push,
          notifications_message_queue: chatUser.notifications_message_queue,
          notifications_message_in_chat: chatUser.notifications_message_in_chat,
          notifications_message_chatbot: chatUser.notifications_message_chatbot,
          notifications_transfer: chatUser.notifications_transfer,
          notifications_internal_chat: chatUser.notifications_internal_chat,
          notifications_internal_chat_direct:
            chatUser.notifications_internal_chat_direct,
          notifications_internal_chat_group:
            chatUser.notifications_internal_chat_group,
          notifications_internal_chat_sound:
            chatUser.notifications_internal_chat_sound,
          notifications_internal_chat_vibrate:
            chatUser.notifications_internal_chat_vibrate,
          notifications_internal_chat_toast:
            chatUser.notifications_internal_chat_toast,
          notifications_internal_chat_browser:
            chatUser.notifications_internal_chat_browser,
          notifications_internal_chat_push:
            chatUser.notifications_internal_chat_push,
          sort_in_chat_order: chatUser.sort_in_chat_order,
          sort_my_chats_order: chatUser.sort_my_chats_order,
          sort_queue_order: chatUser.sort_queue_order,
          sort_chatbot_order: chatUser.sort_chatbot_order,
        },
      })
      .from(user)
      .innerJoin(userStatus, eq(userStatus.user_status_id, user.user_status_id))
      .innerJoin(userInfo, eq(userInfo.user_id, user.user_id))
      .innerJoin(
        permissionAssignment,
        eq(permissionAssignment.user_id, user.user_id)
      )
      .innerJoin(
        permissionRole,
        eq(
          permissionRole.permission_role_id,
          permissionAssignment.permission_role_id
        )
      )
      .leftJoin(userDocument, eq(userDocument.user_id, user.user_id))
      .leftJoin(
        userDocumentType,
        eq(
          userDocumentType.user_document_type_id,
          userDocument.user_document_type_id
        )
      )
      .leftJoin(userAddress, eq(userAddress.user_id, user.user_id))
      .leftJoin(
        zipcodeCity,
        eq(userAddress.city_fiscal_code, zipcodeCity.fiscal_code)
      )
      .leftJoin(
        zipcodeState,
        eq(userAddress.state_fiscal_code, zipcodeState.fiscal_code)
      )
      .leftJoin(chatUser, eq(chatUser.user_id, user.user_id))
      .where(
        and(
          eq(user.user_id, userId),
          eq(user.account_id, accountId),
          eq(user.user_status_id, EUserStatus.active),
          isNull(user.deleted_at)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    const userData = result[0] as AuthUserResponse;
    if (userData.address && !userData.address.user_address_id) {
      userData.address = null;
    }

    if (userData.chat_user) {
      const status = await this.presenceService.getStatus(userData.user_id);
      userData.chat_user.status = status ?? EChatUserStatus.offline;
    }

    return userData as AuthUserResponse;
  };
}
