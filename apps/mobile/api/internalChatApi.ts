import { Platform } from 'react-native';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchForm,
  apiPost,
  apiPostForm,
  apiPostFormWithMessage,
  apiPut,
  type ApiFormRequestOptions,
} from './client';
import type {
  InternalChatActivityState,
  InternalChatContact,
  InternalChatContactFilters,
  InternalChatContactPhone,
  InternalChatConversation,
  InternalChatConversationType,
  InternalChatCreateGroupPayload,
  InternalChatCreateMessagePayload,
  InternalChatMessage,
  InternalChatMessageHistoryItem,
  InternalChatNotificationSettings,
  InternalChatNotificationSettingsPayload,
  InternalChatPagedResponse,
  InternalChatParticipant,
  InternalChatSearchMessageResult,
  InternalChatUpdateGroupPayload,
  InternalChatUploadFile,
  InternalChatUser,
} from '../types/internalChat';
import type { MessageContentLinkPreview } from '../types/chat';
import { serializeContactFilters } from '../utils/contactFilters';

type RawPaging = {
  current_page?: number;
  total_pages?: number;
  per_page?: number;
  count?: number;
  total?: number;
};

type RawPagedResponse<T> = {
  results?: T[];
  pagings?: RawPaging;
  current_page?: number;
  total_pages?: number;
  per_page?: number;
  count?: number;
  total?: number;
};

function normalizePagedResponse<T>(
  data: RawPagedResponse<T> | null | undefined,
  page: number,
  perPage: number
): InternalChatPagedResponse<T> {
  const pagings = data?.pagings ?? data ?? {};
  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    results,
    current_page:
      typeof pagings.current_page === 'number' ? pagings.current_page : page,
    total_pages:
      typeof pagings.total_pages === 'number' ? pagings.total_pages : 1,
    per_page: typeof pagings.per_page === 'number' ? pagings.per_page : perPage,
    count: typeof pagings.count === 'number' ? pagings.count : results.length,
    total: typeof pagings.total === 'number' ? pagings.total : results.length,
  };
}

async function appendFileToFormData(
  formData: FormData,
  fieldName: string,
  file: InternalChatUploadFile
): Promise<void> {
  if (Platform.OS === 'web') {
    const response = await fetch(file.uri);
    const blob = await response.blob();
    formData.append(fieldName, blob, file.name);
    return;
  }

  formData.append(fieldName, {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
}

function appendJsonArray(
  formData: FormData,
  fieldName: string,
  value: string[]
) {
  formData.append(fieldName, JSON.stringify(value));
}

async function buildGroupFormData(
  payload: InternalChatCreateGroupPayload | InternalChatUpdateGroupPayload
): Promise<FormData> {
  const formData = new FormData();
  if ('name' in payload && payload.name !== undefined) {
    formData.append('name', payload.name);
  }
  if ('member_user_ids' in payload) {
    appendJsonArray(formData, 'member_user_ids', payload.member_user_ids);
  }
  if (payload.photoUri && payload.photoName && payload.photoMimeType) {
    await appendFileToFormData(formData, 'photo', {
      uri: payload.photoUri,
      name: payload.photoName,
      mimeType: payload.photoMimeType,
    });
  }
  return formData;
}

export async function listInternalChatConversations(options?: {
  currentPage?: number;
  perPage?: number;
  search?: string | null;
  type?: InternalChatConversationType | null;
}): Promise<InternalChatPagedResponse<InternalChatConversation>> {
  const page = options?.currentPage ?? 1;
  const perPage = options?.perPage ?? 20;
  const res = await apiGet<RawPagedResponse<InternalChatConversation>>(
    '/internal-chat/conversations',
    {
      current_page: page,
      per_page: perPage,
      search: options?.search?.trim() || undefined,
      type: options?.type ?? undefined,
    }
  );

  return normalizePagedResponse(res?.data, page, perPage);
}

export async function listInternalChatUsers(options?: {
  currentPage?: number;
  perPage?: number;
  search?: string | null;
}): Promise<InternalChatPagedResponse<InternalChatUser>> {
  const page = options?.currentPage ?? 1;
  const perPage = options?.perPage ?? 20;
  const res = await apiGet<RawPagedResponse<InternalChatUser>>(
    '/internal-chat/users',
    {
      current_page: page,
      per_page: perPage,
      search: options?.search?.trim() || undefined,
    }
  );

  return normalizePagedResponse(res?.data, page, perPage);
}

export async function listInternalChatContacts(options?: {
  currentPage?: number;
  perPage?: number;
  search?: string | null;
  filters?: InternalChatContactFilters | null;
}): Promise<InternalChatPagedResponse<InternalChatContact>> {
  const page = options?.currentPage ?? 1;
  const perPage = options?.perPage ?? 20;
  const res = await apiGet<RawPagedResponse<InternalChatContact>>(
    '/internal-chat/contacts',
    {
      current_page: page,
      per_page: perPage,
      search: options?.search?.trim() || undefined,
      ...serializeContactFilters(options?.filters ?? null),
    }
  );

  return normalizePagedResponse(res?.data, page, perPage);
}

export async function viewInternalChatContactPhone(
  contactId: string
): Promise<InternalChatContactPhone | null> {
  if (!contactId.trim()) return null;
  const res = await apiGet<InternalChatContactPhone>(
    `/internal-chat/contacts/${contactId}/phone`
  );
  return res?.data ?? null;
}

export async function openInternalDirectConversation(
  targetUserId: string
): Promise<InternalChatConversation | null> {
  if (!targetUserId.trim()) return null;
  const res = await apiPost<InternalChatConversation>(
    '/internal-chat/open-direct',
    {
      target_user_id: targetUserId,
    }
  );
  return res?.data ?? null;
}

export async function viewInternalChatConversation(
  conversationId: string
): Promise<InternalChatConversation | null> {
  if (!conversationId.trim()) return null;
  const res = await apiGet<InternalChatConversation>(
    `/internal-chat/${conversationId}`
  );
  return res?.data ?? null;
}

export async function getInternalChatNotificationSettings(): Promise<InternalChatNotificationSettings | null> {
  const res = await apiGet<InternalChatNotificationSettings>(
    '/internal-chat/notification-settings'
  );
  return res?.data ?? null;
}

export async function updateInternalChatNotificationSettings(
  payload: InternalChatNotificationSettingsPayload
): Promise<InternalChatNotificationSettings | null> {
  const res = await apiPut<InternalChatNotificationSettings>(
    '/internal-chat/notification-settings',
    payload
  );
  return res?.data ?? null;
}

export async function closeInternalChatConversation(
  conversationId: string
): Promise<boolean> {
  if (!conversationId.trim()) return false;
  const res = await apiPost<null>(`/internal-chat/${conversationId}/close`, {});
  return !!res?.status;
}

export async function markInternalChatRead(
  conversationId: string,
  lastReadMessageId?: string | null
): Promise<boolean> {
  if (!conversationId.trim()) return false;
  const res = await apiPost<boolean>(
    `/internal-chat/${conversationId}/mark-read`,
    {
      last_read_message_id: lastReadMessageId ?? null,
    }
  );
  return !!res?.status;
}

export async function listInternalChatMessages(
  conversationId: string,
  options?: {
    currentPage?: number;
    perPage?: number;
  }
): Promise<InternalChatPagedResponse<InternalChatMessage>> {
  const page = options?.currentPage ?? 1;
  const perPage = options?.perPage ?? 20;
  if (!conversationId.trim())
    return normalizePagedResponse(null, page, perPage);

  const res = await apiGet<RawPagedResponse<InternalChatMessage>>(
    `/internal-chat/${conversationId}/messages`,
    {
      current_page: page,
      per_page: perPage,
    }
  );

  return normalizePagedResponse(res?.data, page, perPage);
}

export async function createInternalChatMessage(
  conversationId: string,
  payload: InternalChatCreateMessagePayload
): Promise<{ ok: boolean; message: InternalChatMessage | null }> {
  if (!conversationId.trim()) return { ok: false, message: null };
  const res = await apiPost<InternalChatMessage | null>(
    `/internal-chat/${conversationId}/messages`,
    payload
  );
  return { ok: !!res?.status, message: res?.data ?? null };
}

export async function createInternalChatMessageWithFormData(
  conversationId: string,
  formData: FormData,
  options?: ApiFormRequestOptions
): Promise<{
  ok: boolean;
  message: InternalChatMessage | null;
  error: string | null;
}> {
  if (!conversationId.trim()) {
    return { ok: false, message: null, error: null };
  }
  const res = await apiPostFormWithMessage<InternalChatMessage | null>(
    `/internal-chat/${conversationId}/messages`,
    formData,
    options
  );
  if (!res) {
    return { ok: false, message: null, error: null };
  }
  return {
    ok: !!res.status,
    message: res.data ?? null,
    error: res.status ? null : (res.message ?? null),
  };
}

export async function appendInternalChatFile(
  formData: FormData,
  fieldName: 'images' | 'videos' | 'documents' | 'audios',
  file: InternalChatUploadFile
): Promise<void> {
  await appendFileToFormData(formData, fieldName, file);
}

export async function generateInternalChatLinkPreview(
  url: string
): Promise<MessageContentLinkPreview | null> {
  const normalized = url.trim();
  if (!normalized) return null;
  const res = await apiPost<MessageContentLinkPreview>(
    '/internal-chat/link-preview',
    {
      url: normalized,
    }
  );
  return res?.data ?? null;
}

export async function reactInternalChatMessage(
  conversationId: string,
  messageId: string,
  emoji: string | null
): Promise<boolean> {
  if (!conversationId.trim() || !messageId.trim()) return false;
  const res = await apiPost<boolean>(
    `/internal-chat/${conversationId}/messages/${messageId}/react`,
    { emoji: emoji?.trim() || null }
  );
  return !!res?.status;
}

export async function editInternalChatMessage(
  conversationId: string,
  messageId: string,
  message: string
): Promise<boolean> {
  if (!conversationId.trim() || !messageId.trim() || !message.trim()) {
    return false;
  }
  const res = await apiPost<boolean>(
    `/internal-chat/${conversationId}/messages/${messageId}/edit`,
    { message: message.trim() }
  );
  return !!res?.status;
}

export async function deleteInternalChatMessage(
  conversationId: string,
  messageId: string
): Promise<boolean> {
  if (!conversationId.trim() || !messageId.trim()) return false;
  const res = await apiPost<boolean>(
    `/internal-chat/${conversationId}/messages/${messageId}/delete`,
    {}
  );
  return !!res?.status;
}

export async function viewInternalChatMessageHistory(
  conversationId: string,
  messageId: string
): Promise<InternalChatMessageHistoryItem[]> {
  if (!conversationId.trim() || !messageId.trim()) return [];
  const res = await apiGet<{ results?: InternalChatMessageHistoryItem[] }>(
    `/internal-chat/${conversationId}/messages/${messageId}/history`
  );
  return res?.data?.results ?? [];
}

export async function searchInternalChatMessages(
  conversationId: string,
  search: string,
  options?: {
    currentPage?: number;
    perPage?: number;
  }
): Promise<InternalChatPagedResponse<InternalChatSearchMessageResult>> {
  const page = options?.currentPage ?? 1;
  const perPage = options?.perPage ?? 20;
  if (!conversationId.trim() || !search.trim()) {
    return normalizePagedResponse(null, page, perPage);
  }
  const res = await apiGet<RawPagedResponse<InternalChatSearchMessageResult>>(
    `/internal-chat/${conversationId}/search`,
    {
      search: search.trim(),
      current_page: page,
      per_page: perPage,
    }
  );
  return normalizePagedResponse(res?.data, page, perPage);
}

export async function publishInternalChatActivity(
  conversationId: string,
  state: InternalChatActivityState
): Promise<void> {
  if (!conversationId.trim()) return;
  await apiPost<null>('/internal-chat/activity', {
    conversation_id: conversationId,
    state,
  }).catch(() => null);
}

export async function createInternalChatGroup(
  payload: InternalChatCreateGroupPayload
): Promise<InternalChatConversation | null> {
  if (!payload.name.trim() || payload.member_user_ids.length === 0) return null;
  if (payload.photoUri) {
    const formData = await buildGroupFormData(payload);
    const res = await apiPostForm<InternalChatConversation>(
      '/internal-chat/groups',
      formData
    );
    return res?.data ?? null;
  }

  const res = await apiPost<InternalChatConversation>('/internal-chat/groups', {
    name: payload.name.trim(),
    member_user_ids: payload.member_user_ids,
    photo: null,
  });
  return res?.data ?? null;
}

export async function updateInternalChatGroup(
  conversationId: string,
  payload: InternalChatUpdateGroupPayload
): Promise<InternalChatConversation | null> {
  if (!conversationId.trim()) return null;

  if (payload.photoUri) {
    const formData = await buildGroupFormData(payload);
    const res = await apiPatchForm<InternalChatConversation>(
      `/internal-chat/groups/${conversationId}`,
      formData
    );
    return res?.data ?? null;
  }

  const body: { name?: string; photo?: string | null } = {};
  if (payload.name !== undefined) body.name = payload.name.trim();
  if (payload.photoUri === null) body.photo = null;

  const res = await apiPatch<InternalChatConversation>(
    `/internal-chat/groups/${conversationId}`,
    body
  );
  return res?.data ?? null;
}

export async function listInternalChatGroupMembers(
  conversationId: string
): Promise<InternalChatParticipant[]> {
  if (!conversationId.trim()) return [];
  const res = await apiGet<InternalChatParticipant[]>(
    `/internal-chat/groups/${conversationId}/members`
  );
  return res?.data ?? [];
}

export async function addInternalChatGroupMember(
  conversationId: string,
  userId: string
): Promise<InternalChatConversation | null> {
  if (!conversationId.trim() || !userId.trim()) return null;
  const res = await apiPost<InternalChatConversation>(
    `/internal-chat/groups/${conversationId}/members`,
    { user_id: userId }
  );
  return res?.data ?? null;
}

export async function removeInternalChatGroupMember(
  conversationId: string,
  userId: string
): Promise<boolean> {
  if (!conversationId.trim() || !userId.trim()) return false;
  const res = await apiDelete<null>(
    `/internal-chat/groups/${conversationId}/members/${userId}`
  );
  return !!res?.status;
}

export async function transferInternalChatGroupLeader(
  conversationId: string,
  userId: string
): Promise<InternalChatConversation | null> {
  if (!conversationId.trim() || !userId.trim()) return null;
  const res = await apiPatch<InternalChatConversation>(
    `/internal-chat/groups/${conversationId}/leader`,
    { user_id: userId }
  );
  return res?.data ?? null;
}
