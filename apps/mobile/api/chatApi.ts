import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchWithMessage,
  apiPatchForm,
  apiPost,
  apiPostForm,
  apiPut,
} from './client';
import {
  MY_CHATS_STATUS,
  type ChatListCounts,
  type ListChatsResponse,
  type ListMessageResponse,
  type ListMessageResult,
  type ListChatsResult,
} from '../types/chat';
import type {
  ChatContactChannelsItem,
  ChatContactListItem,
  ChatContactListResponse,
  ChatContactViewResponse,
  ContactListFilters,
  ContactSortField,
  ContactSortOrder,
  CreateChatContactPayload,
  TransferSector,
  TransferWorker,
  UpdateChatContactPayload,
  WorkerConfigForChat,
} from '../types/contact';
import {
  appendQueryField,
  serializeContactFilters,
} from '../utils/contactFilters';

export interface LabelTemplate {
  label_template_id: string;
  label: string;
  color: string;
}

export interface ChatWorker {
  id: string;
  name: string;
  number: string | null;
}

export interface ChatUser {
  user_id: string;
  name: string | null;
  photo?: string | null;
}

export type ChatUserStatus =
  | 'online'
  | 'busy'
  | 'do_not_disturb'
  | 'away'
  | 'offline';

export type UpdateChatUserPayload = {
  about?: string | null;
  status?: ChatUserStatus;
  notifications: boolean;
  sort_by_chat_order?: string | null;
  sort_in_chat_order?: string | null;
  sort_by_my_chats_order?: string | null;
  sort_my_chats_order?: string | null;
  sort_by_queue_order?: string | null;
  sort_queue_order?: string | null;
  sort_by_chatbot_order?: string | null;
  sort_chatbot_order?: string | null;
};

export interface ChatSector {
  id: string;
  name: string;
  color?: string | null;
}

export interface TransferChatPayload {
  worker_id?: string;
  user_id?: string | null;
  sector_id?: string | null;
  annotation?: string | null;
}

export interface TransferUserOption {
  id: string;
  name: string;
  last_name?: string | null;
  nickname?: string | null;
  photo?: string | null;
  status?: ChatUserStatus | null;
}

export interface TransferSectorOption {
  id: string;
  name: string;
  color?: string | null;
}

export interface SearchMessagesResult {
  message_id: string;
  date: string;
  message?: string | null;
}

export interface SearchMessagesResponse {
  results: SearchMessagesResult[];
  pagings: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
}

export type ListChatsParams = {
  status: string | string[];
  current_page?: number;
  per_page?: number;
  filter_label_template_id?: string | null;
  filter_worker_id?: string | null;
  filter_user_id?: string | null;
  filter_sector_id?: string | null;
  filter_name?: string | null;
  filter_phone?: string | null;
  filter_protocol?: string | null;
  filter_date_start?: string | null;
  filter_date_end?: string | null;
};

function buildChatQuery(
  params: ListChatsParams
): Record<string, string | number> {
  const q: Record<string, string | number> = {
    status: Array.isArray(params.status)
      ? params.status.join(',')
      : params.status,
    current_page: params.current_page ?? 1,
    per_page: params.per_page ?? 25,
  };

  appendQueryField(
    q,
    'filter_label_template_id',
    params.filter_label_template_id
  );
  appendQueryField(q, 'filter_worker_id', params.filter_worker_id);
  appendQueryField(q, 'filter_user_id', params.filter_user_id);
  appendQueryField(q, 'filter_sector_id', params.filter_sector_id);
  appendQueryField(q, 'filter_name', params.filter_name);
  appendQueryField(q, 'filter_phone', params.filter_phone);
  appendQueryField(q, 'filter_protocol', params.filter_protocol);
  appendQueryField(q, 'filter_date_start', params.filter_date_start);
  appendQueryField(q, 'filter_date_end', params.filter_date_end);

  return q;
}

export async function listChats(
  params: ListChatsParams
): Promise<ListChatsResponse | null> {
  const q = buildChatQuery(params);
  const res = await apiGet<ListChatsResponse>('/chat', q);
  return res?.data ?? null;
}

export async function listMyChats(
  page = 1,
  perPage = 25,
  search?: string
): Promise<ListChatsResponse | null> {
  return listChats({
    status: MY_CHATS_STATUS,
    current_page: page,
    per_page: perPage,
    filter_name: search || undefined,
    filter_phone: search || undefined,
  });
}

export async function listQueueChats(
  page = 1,
  perPage = 25
): Promise<ListChatsResponse | null> {
  return listChats({
    status: 'queue',
    current_page: page,
    per_page: perPage,
  });
}

export async function listInChatChats(
  page = 1,
  perPage = 25
): Promise<ListChatsResponse | null> {
  return listChats({
    status: 'in_chat',
    current_page: page,
    per_page: perPage,
  });
}

interface ApiListMessageResponse {
  pagings?: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  results?: ListMessageResult[];
}

export async function listMessages(
  chatId: string,
  page = 1,
  perPage = 50
): Promise<ListMessageResponse | null> {
  const res = await apiGet<ApiListMessageResponse>(`/chat/${chatId}`, {
    current_page: page,
    per_page: perPage,
  });
  const data = res?.data;
  if (!data) return null;
  const pagings = data.pagings ?? {
    current_page: page,
    total_pages: 1,
    per_page: perPage,
    count: (data.results ?? []).length,
    total: (data.results ?? []).length,
  };
  const results = data.results ?? [];
  return {
    results,
    current_page: pagings.current_page,
    total_pages: pagings.total_pages,
    per_page: pagings.per_page,
    count: pagings.count,
    total: pagings.total,
  };
}

export async function createMessage(
  chatId: string,
  type: string,
  message?: string
): Promise<ListMessageResult | null> {
  const res = await apiPost<ListMessageResult>(`/chat/${chatId}`, {
    type,
    message: message ?? '',
  });
  return res?.data ?? null;
}

export async function createMessageWithFormData(
  chatId: string,
  formData: FormData
): Promise<{ ok: boolean; message: ListMessageResult | null }> {
  const res = await apiPostForm<ListMessageResult | null>(
    `/chat/${chatId}`,
    formData
  );
  if (!res) {
    return { ok: false, message: null };
  }
  return { ok: true, message: res.data ?? null };
}

export async function clearChatSummary(chatId: string): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;

  const res = await apiPost<{ success?: boolean }>(
    `/chat/${chatId}/clear-summary`,
    {}
  );

  return !!res?.status;
}

export async function updateChatStatus(
  chatId: string,
  status: string
): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;
  const res = await apiPatch<ListChatsResult>(`/chat/${chatId}/status`, {
    status,
  });
  return !!res?.status;
}

export type UpdateChatStatusDetailedResult = {
  ok: boolean;
  message: string | null;
  data: ListChatsResult | null;
};

export async function updateChatStatusDetailed(
  chatId: string,
  status: string
): Promise<UpdateChatStatusDetailedResult> {
  if (!chatId || chatId.trim().length === 0) {
    return {
      ok: false,
      message: null,
      data: null,
    };
  }
  const res = await apiPatchWithMessage<ListChatsResult>(
    `/chat/${chatId}/status`,
    {
      status,
    }
  );

  if (!res) {
    return {
      ok: false,
      message: null,
      data: null,
    };
  }

  return {
    ok: res.status === true,
    message: res.message,
    data: res.data ?? null,
  };
}

export async function transferChat(
  chatId: string,
  payload: TransferChatPayload
): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;

  const body: TransferChatPayload = {
    worker_id: payload.worker_id,
    user_id: payload.user_id ?? undefined,
    sector_id: payload.sector_id ?? undefined,
    annotation: payload.annotation?.trim() || undefined,
  };

  const res = await apiPost<{ chat_id: string; status: boolean }>(
    `/chat/${chatId}/transfer`,
    body
  );

  return !!res?.status;
}

type SearchMessagesRawResponse = {
  results?: SearchMessagesResult[];
  pagings?: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  current_page?: number;
  total_pages?: number;
  per_page?: number;
  count?: number;
  total?: number;
};

export async function searchMessages(
  chatId: string,
  search: string,
  currentPage = 1,
  perPage = 50
): Promise<SearchMessagesResponse> {
  if (!chatId || chatId.trim().length === 0) {
    return {
      results: [],
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: perPage,
        count: 0,
        total: 0,
      },
    };
  }

  const res = await apiGet<SearchMessagesRawResponse>(
    `/chat/${chatId}/search`,
    {
      search,
      current_page: currentPage,
      per_page: perPage,
    }
  );

  const data = res?.data;
  if (!data) {
    return {
      results: [],
      pagings: {
        current_page: 1,
        total_pages: 0,
        per_page: perPage,
        count: 0,
        total: 0,
      },
    };
  }

  const pagings = data.pagings ?? {
    current_page: data.current_page ?? currentPage,
    total_pages: data.total_pages ?? 1,
    per_page: data.per_page ?? perPage,
    count: data.count ?? (data.results ?? []).length,
    total: data.total ?? (data.results ?? []).length,
  };

  return {
    results: data.results ?? [],
    pagings,
  };
}

export async function updateChatLabel(
  chatId: string,
  labelTemplateIds?: string[] | null
): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;

  const body: {
    label_template_ids?:
      | Array<{ value: string }>
      | { value: string | null }
      | undefined;
  } = {};

  if (labelTemplateIds === null || labelTemplateIds === undefined) {
    body.label_template_ids = { value: null };
  } else if (labelTemplateIds.length === 0) {
    body.label_template_ids = { value: null };
  } else {
    body.label_template_ids = labelTemplateIds.map((id) => ({ value: id }));
  }

  const res = await apiPatch<{ success: boolean }>(
    `/chat/${chatId}/label`,
    body
  );
  return !!res?.status;
}

export async function updateForwardToOutputChatbot(
  chatId: string,
  enabled: boolean
): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;
  const res = await apiPatch<{ success: boolean }>(
    `/chat/${chatId}/forward-to-output-chatbot`,
    {
      forward_to_output_chatbot: enabled,
    }
  );
  return !!res?.status;
}

export async function listLabelTemplates(): Promise<LabelTemplate[] | null> {
  const res = await apiGet<LabelTemplate[]>('/chat/label-templates');
  return res?.data ?? null;
}

export async function listChatWorkers(): Promise<ChatWorker[] | null> {
  const res = await apiGet<ChatWorker[]>('/chat/workers');
  return res?.data ?? null;
}

export async function listChatUsers(): Promise<ChatUser[] | null> {
  const res = await apiGet<ChatUser[]>('/chat/users');
  return res?.data ?? null;
}

export async function updateChatUser(
  payload: UpdateChatUserPayload
): Promise<boolean> {
  const res = await apiPut<null>('/chat/user', payload);
  return !!res?.status;
}

export async function uploadUserPhoto(
  userId: string,
  photoFile: File | Blob
): Promise<{ photo: string | null } | null> {
  if (!userId || userId.trim().length === 0) return null;

  const formData = new FormData();
  formData.append('photo', photoFile);

  const res = await apiPostForm<{ photo: string | null }>(
    `/user/${userId}/photo`,
    formData
  );
  return res?.data ?? null;
}

export async function removeUserPhoto(
  userId: string
): Promise<{ photo: string | null } | null> {
  if (!userId || userId.trim().length === 0) return null;
  const res = await apiDelete<{ photo: string | null }>(
    `/user/${userId}/photo`
  );
  return res?.data ?? null;
}

export async function listChatSectors(): Promise<ChatSector[] | null> {
  const res = await apiGet<ChatSector[]>('/chat/sectors');
  return res?.data ?? null;
}

export interface SearchChatsParams {
  search: string;
  status?: string | string[];
  current_page?: number;
  per_page?: number;
  filter_label_template_id?: string | null;
  filter_worker_id?: string | null;
  filter_user_id?: string | null;
  filter_sector_id?: string | null;
  filter_name?: string | null;
  filter_phone?: string | null;
  filter_protocol?: string | null;
  filter_date_start?: string | null;
  filter_date_end?: string | null;
  sort_field?: string | null;
  sort_order?: string | null;
}

export interface SearchChatsResponse {
  results: ListChatsResponse['results'];
  counts: ChatListCounts;
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
  pagings: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
}

type SearchChatsRawResponse = {
  results?: ListChatsResponse['results'];
  counts?: ChatListCounts;
  pagings?: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  current_page?: number;
  total_pages?: number;
  per_page?: number;
  count?: number;
  total?: number;
};

function normalizeSearchChatsResponse(
  data: SearchChatsRawResponse,
  page: number,
  perPage: number
): SearchChatsResponse {
  const pagings = data.pagings ?? {
    current_page: data.current_page ?? page,
    total_pages: data.total_pages ?? 1,
    per_page: data.per_page ?? perPage,
    count: data.count ?? (data.results ?? []).length,
    total: data.total ?? (data.results ?? []).length,
  };

  const rawCounts = data.counts;

  return {
    results: data.results ?? [],
    counts: rawCounts ?? {
      total: pagings.total ?? 0,
      queue: 0,
      in_chat: 0,
      chatbot: 0,
      schedule: 0,
      my_chats: 0,
      closed: 0,
      in_chat_mine: 0,
      chatbot_input: 0,
      chatbot_output: 0,
      chatbot_schedule: 0,
      chatbot_webhook: 0,
    },
    current_page: pagings.current_page,
    total_pages: pagings.total_pages,
    per_page: pagings.per_page,
    count: pagings.count,
    total: pagings.total,
    pagings,
  };
}

export async function searchChats(
  params: SearchChatsParams
): Promise<SearchChatsResponse | null> {
  const currentPage = params.current_page ?? 1;
  const perPage = params.per_page ?? 50;
  const q: Record<string, string | number> = {
    search: params.search ?? '',
    current_page: currentPage,
    per_page: perPage,
  };

  if (params.status !== null && params.status !== undefined) {
    q.status = Array.isArray(params.status)
      ? params.status.join(',')
      : params.status;
  }

  appendQueryField(
    q,
    'filter_label_template_id',
    params.filter_label_template_id
  );
  appendQueryField(q, 'filter_worker_id', params.filter_worker_id);
  appendQueryField(q, 'filter_user_id', params.filter_user_id);
  appendQueryField(q, 'filter_sector_id', params.filter_sector_id);
  appendQueryField(q, 'filter_name', params.filter_name);
  appendQueryField(q, 'filter_phone', params.filter_phone);
  appendQueryField(q, 'filter_protocol', params.filter_protocol);
  appendQueryField(q, 'filter_date_start', params.filter_date_start);
  appendQueryField(q, 'filter_date_end', params.filter_date_end);
  appendQueryField(q, 'sort_field', params.sort_field);
  appendQueryField(q, 'sort_order', params.sort_order);

  const res = await apiGet<SearchChatsRawResponse>('/chat/search', q);
  if (!res?.data) return null;
  return normalizeSearchChatsResponse(res.data, currentPage, perPage);
}

export type ListChatContactResult = ChatContactListItem;
export type ListChatContactsResponse = ChatContactListResponse;

type ListChatContactsRawResponse = {
  results?: ChatContactListItem[];
  pagings?: {
    current_page: number;
    total_pages: number;
    per_page: number;
    count: number;
    total: number;
  };
  current_page?: number;
  total_pages?: number;
  per_page?: number;
  count?: number;
  total?: number;
};

function normalizeListChatContactsResponse(
  data: ListChatContactsRawResponse,
  page: number,
  perPage: number
): ChatContactListResponse {
  const pagings = data.pagings;

  return {
    results: data.results ?? [],
    current_page: pagings?.current_page ?? data.current_page ?? page,
    total_pages: pagings?.total_pages ?? data.total_pages ?? 1,
    per_page: pagings?.per_page ?? data.per_page ?? perPage,
    count: pagings?.count ?? data.count ?? (data.results ?? []).length,
    total: pagings?.total ?? data.total ?? (data.results ?? []).length,
  };
}

export async function listChatContacts(
  page = 1,
  perPage = 50,
  search?: string | null,
  filters?: ContactListFilters | null
): Promise<ChatContactListResponse | null> {
  const params: Record<string, string | number> = {
    current_page: page,
    per_page: perPage,
    ...serializeContactFilters(filters),
  };

  if (search !== undefined && search !== null && search.trim() !== '') {
    params.search = search.trim();
  }

  const res = await apiGet<ListChatContactsRawResponse>(
    '/chat/contacts',
    params
  );
  if (!res?.data) return null;

  return normalizeListChatContactsResponse(res.data, page, perPage);
}

export interface ChatContactLookupResult {
  contact_id?: string | null;
  name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  phone_partial?: string | null;
  phone_ddi?: string | null;
  photo?: string | null;
}

export async function viewChatContact(
  contactId: string
): Promise<ChatContactViewResponse | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<ChatContactViewResponse>(
    `/chat/contacts/${contactId}`
  );
  return res?.data ?? null;
}

export async function getChatContactById(
  contactId: string
): Promise<ChatContactLookupResult | null> {
  const data = await viewChatContact(contactId);
  if (!data) return null;

  return {
    contact_id: data.contact_id,
    name: data.name,
    last_name: data.last_name ?? null,
    phone_partial: data.phone_partial ?? null,
    phone_ddi: data.phone_ddi ?? null,
    photo: data.photo ?? null,
  };
}

export async function getChatContactByPhone(
  phone: string,
  phoneDdi: string
): Promise<ChatContactLookupResult | null> {
  if (!phone || phone.trim().length === 0) return null;
  const res = await apiGet<ChatContactLookupResult>('/chat/contacts/by-phone', {
    phone,
    phone_ddi: phoneDdi,
  });
  return res?.data ?? null;
}

function appendFormValue(
  formData: FormData,
  key: string,
  value: string | null | undefined
): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  formData.append(key, value);
}

function appendArrayValues(
  formData: FormData,
  key: string,
  values: string[] | null | undefined,
  appendEmptyWhenPresent = false
): void {
  if (values === undefined) {
    return;
  }

  if (!values || values.length === 0) {
    if (appendEmptyWhenPresent) {
      formData.append(key, '');
    }
    return;
  }

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!value || value.trim() === '') continue;
    formData.append(`${key}[${i}]`, value.trim());
  }
}

function normalizePhoneValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export async function createChatContact(
  payload: CreateChatContactPayload,
  photoFile?: File | Blob | null
): Promise<boolean> {
  const formData = new FormData();

  appendArrayValues(formData, 'channel_ids', payload.channel_ids);
  appendArrayValues(formData, 'label_template_ids', payload.label_template_ids);
  appendFormValue(formData, 'name', payload.name?.trim());
  appendFormValue(formData, 'last_name', payload.last_name?.trim() ?? null);
  appendFormValue(formData, 'email', payload.email?.trim() ?? null);
  appendFormValue(formData, 'phone_ddi', payload.phone_ddi?.trim());
  appendFormValue(formData, 'phone', normalizePhoneValue(payload.phone));
  appendFormValue(formData, 'nickname', payload.nickname?.trim() ?? null);
  appendFormValue(formData, 'birthday', payload.birthday?.trim() ?? null);
  appendFormValue(formData, 'notes', payload.notes ?? null);
  appendFormValue(
    formData,
    'contact_document_type_id',
    payload.contact_document_type_id ?? null
  );
  appendFormValue(
    formData,
    'document',
    payload.document ? payload.document.replace(/\D/g, '') : null
  );

  if (payload.image_url) {
    appendFormValue(formData, 'image_url', payload.image_url);
  } else if (photoFile) {
    formData.append('photo', photoFile);
  }

  appendFormValue(formData, 'chat_id', payload.chat_id ?? null);

  if (payload.user_id !== undefined) {
    if (payload.user_id === null || payload.user_id.trim() === '') {
      formData.append('user_id', '');
    } else {
      formData.append('user_id', payload.user_id.trim());
    }
  }

  if (payload.ignore) {
    formData.append('ignore', payload.ignore);
  }

  const res = await apiPostForm<boolean>('/chat/contacts', formData);
  return !!res?.status;
}

export async function updateChatContact(
  payload: UpdateChatContactPayload,
  photoFile?: File | Blob | null
): Promise<boolean> {
  if (!payload.contact_id || payload.contact_id.trim().length === 0) {
    return false;
  }

  const formData = new FormData();

  appendArrayValues(formData, 'channel_ids', payload.channel_ids, true);
  appendArrayValues(
    formData,
    'label_template_ids',
    payload.label_template_ids,
    true
  );

  if (payload.name !== undefined) {
    appendFormValue(formData, 'name', payload.name?.trim() ?? null);
  }
  if (payload.last_name !== undefined) {
    appendFormValue(formData, 'last_name', payload.last_name?.trim() ?? null);
  }
  if (payload.email !== undefined) {
    appendFormValue(formData, 'email', payload.email?.trim() ?? null);
  }
  if (payload.phone_ddi !== undefined) {
    appendFormValue(formData, 'phone_ddi', payload.phone_ddi?.trim() ?? null);
  }
  if (payload.phone !== undefined) {
    appendFormValue(formData, 'phone', normalizePhoneValue(payload.phone));
  }
  if (payload.nickname !== undefined) {
    appendFormValue(formData, 'nickname', payload.nickname?.trim() ?? null);
  }
  if (payload.birthday !== undefined) {
    appendFormValue(formData, 'birthday', payload.birthday?.trim() ?? null);
  }
  if (payload.notes !== undefined) {
    appendFormValue(formData, 'notes', payload.notes ?? null);
  }
  if (payload.contact_document_type_id !== undefined) {
    if (payload.contact_document_type_id === null) {
      formData.append('contact_document_type_id', '');
    } else {
      formData.append(
        'contact_document_type_id',
        payload.contact_document_type_id
      );
    }
  }
  if (payload.document !== undefined) {
    if (payload.document === null) {
      formData.append('document', '');
    } else {
      appendFormValue(
        formData,
        'document',
        payload.document.replace(/\D/g, '')
      );
    }
  }

  if (payload.image_url) {
    appendFormValue(formData, 'image_url', payload.image_url);
  } else if (photoFile) {
    formData.append('photo', photoFile);
  }

  if (payload.user_id !== undefined) {
    if (payload.user_id === null || payload.user_id.trim() === '') {
      formData.append('user_id', '');
    } else {
      formData.append('user_id', payload.user_id.trim());
    }
  }

  if (payload.ignore !== undefined) {
    if (payload.ignore === null) {
      formData.append('ignore', '');
    } else {
      formData.append('ignore', payload.ignore);
    }
  }

  const res = await apiPatchForm<boolean>(
    `/chat/contacts/${payload.contact_id}`,
    formData
  );

  return !!res?.status;
}

export async function validateChatContact(contactId: string): Promise<boolean> {
  if (!contactId || contactId.trim().length === 0) return false;
  const res = await apiPost<boolean>(
    `/chat/contacts/${contactId}/validate`,
    {}
  );
  return !!res?.status;
}

export async function deleteChatContactPhoto(
  contactId: string
): Promise<boolean> {
  if (!contactId || contactId.trim().length === 0) return false;
  const res = await apiDelete<boolean>(`/chat/contacts/${contactId}/photo`);
  return !!res?.status;
}

export async function removeChatContactLabelTemplate(
  contactId: string,
  labelTemplateId: string
): Promise<boolean> {
  if (!contactId || !labelTemplateId) return false;
  const res = await apiDelete<boolean>(
    `/chat/contacts/${contactId}/labels/${labelTemplateId}`
  );
  return !!res?.status;
}

export async function getChatContactEmailDecrypted(
  contactId: string
): Promise<string | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<{ email: string | null }>(
    `/chat/contacts/${contactId}/email`
  );
  return res?.data?.email ?? null;
}

export async function getChatContactPhoneDecrypted(
  contactId: string
): Promise<string | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<{ phone: string | null }>(
    `/chat/contacts/${contactId}/phone`
  );
  return res?.data?.phone ?? null;
}

export async function getChatContactDocumentDecrypted(
  contactId: string
): Promise<string | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<{ document: string }>(
    `/chat/contacts/${contactId}/document`
  );
  return res?.data?.document ?? null;
}

export async function listContactChannels(): Promise<
  ChatContactChannelsItem[] | null
> {
  const res = await apiGet<ChatContactChannelsItem[]>('/chat/contact-channels');
  return res?.data ?? null;
}

export async function viewContactChannelsByContactId(
  contactId: string
): Promise<string[] | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<string[]>(`/chat/contacts/${contactId}/channels`);
  return res?.data ?? null;
}

export async function listTransferOptions(): Promise<{
  workers: TransferWorker[];
  sectors: TransferSector[];
} | null> {
  const res = await apiGet<{
    workers: TransferWorker[];
    sectors: TransferSector[];
  }>('/chat/transfer-options');
  return res?.data ?? null;
}

export async function listTransferUsers(
  chatId?: string,
  channelId?: string
): Promise<TransferUserOption[]> {
  const params: Record<string, string> = {};
  if (chatId && chatId.trim().length > 0) {
    params.chat_id = chatId;
  }
  if (channelId && channelId.trim().length > 0) {
    params.channel_id = channelId;
  }

  const res = await apiGet<TransferUserOption[]>(
    '/chat/transfer/users',
    params
  );
  return res?.data ?? [];
}

export async function listTransferSectors(): Promise<TransferSectorOption[]> {
  const res = await apiGet<TransferSectorOption[]>('/chat/transfer/sectors');
  return res?.data ?? [];
}

export async function listTransferSectorUsers(
  sectorId: string,
  chatId?: string,
  channelId?: string
): Promise<TransferUserOption[]> {
  if (!sectorId || sectorId.trim().length === 0) {
    return [];
  }

  const params: Record<string, string> = {};
  if (chatId && chatId.trim().length > 0) {
    params.chat_id = chatId;
  }
  if (channelId && channelId.trim().length > 0) {
    params.channel_id = channelId;
  }

  const res = await apiGet<TransferUserOption[]>(
    `/chat/transfer/sectors/${sectorId}/users`,
    params
  );
  return res?.data ?? [];
}

export async function viewWorkerConfigForChat(
  workerId: string
): Promise<WorkerConfigForChat | null> {
  if (!workerId || workerId.trim().length === 0) return null;
  const res = await apiGet<WorkerConfigForChat | null>(
    `/chat/worker/${workerId}/config`
  );
  return res?.data ?? null;
}

export async function startChatWithContact(
  contactId: string,
  workerId: string,
  sectorId?: string | null
): Promise<ListChatsResult | null> {
  if (!contactId || !workerId) return null;

  const body: {
    contact_id: string;
    worker_id: string;
    sector_id?: string;
  } = {
    contact_id: contactId,
    worker_id: workerId,
  };

  if (sectorId) {
    body.sector_id = sectorId;
  }

  const res = await apiPost<ListChatsResult>('/chat/start-with-contact', body);
  return res?.data ?? null;
}

export type {
  ContactListFilters,
  ContactSortField,
  ContactSortOrder,
  CreateChatContactPayload,
  UpdateChatContactPayload,
  TransferWorker,
  TransferSector,
  WorkerConfigForChat,
  ChatContactChannelsItem,
  ChatContactViewResponse,
};
export { serializeContactFilters };
