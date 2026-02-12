import { apiGet, apiPost } from './client';
import {
  MY_CHATS_STATUS,
  type ListChatsResponse,
  type ListMessageResponse,
  type ListMessageResult,
} from '../types/chat';

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

export interface ChatSector {
  id: string;
  name: string;
  color?: string | null;
}

export type ListChatsParams = {
  status: string;
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
    status: params.status,
    current_page: params.current_page ?? 1,
    per_page: params.per_page ?? 25,
  };
  if (
    params.filter_label_template_id !== null &&
    params.filter_label_template_id !== undefined &&
    params.filter_label_template_id !== ''
  )
    q.filter_label_template_id = params.filter_label_template_id;
  if (
    params.filter_worker_id !== null &&
    params.filter_worker_id !== undefined &&
    params.filter_worker_id !== ''
  )
    q.filter_worker_id = params.filter_worker_id;
  if (
    params.filter_user_id !== null &&
    params.filter_user_id !== undefined &&
    params.filter_user_id !== ''
  )
    q.filter_user_id = params.filter_user_id;
  if (
    params.filter_sector_id !== null &&
    params.filter_sector_id !== undefined &&
    params.filter_sector_id !== ''
  )
    q.filter_sector_id = params.filter_sector_id;
  if (
    params.filter_name !== null &&
    params.filter_name !== undefined &&
    params.filter_name !== ''
  )
    q.filter_name = params.filter_name;
  if (
    params.filter_phone !== null &&
    params.filter_phone !== undefined &&
    params.filter_phone !== ''
  )
    q.filter_phone = params.filter_phone;
  if (
    params.filter_protocol !== null &&
    params.filter_protocol !== undefined &&
    params.filter_protocol !== ''
  )
    q.filter_protocol = params.filter_protocol;
  if (
    params.filter_date_start !== null &&
    params.filter_date_start !== undefined &&
    params.filter_date_start !== ''
  )
    q.filter_date_start = params.filter_date_start;
  if (
    params.filter_date_end !== null &&
    params.filter_date_end !== undefined &&
    params.filter_date_end !== ''
  )
    q.filter_date_end = params.filter_date_end;
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

export async function clearChatSummary(chatId: string): Promise<boolean> {
  if (!chatId || chatId.trim().length === 0) return false;

  const res = await apiPost<{ success?: boolean }>(
    `/chat/${chatId}/clear-summary`,
    {}
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
  counts: ListChatsResponse['counts'];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export async function searchChats(
  params: SearchChatsParams
): Promise<SearchChatsResponse | null> {
  const q: Record<string, string | number> = {
    search: params.search ?? '',
    current_page: params.current_page ?? 1,
    per_page: params.per_page ?? 50,
  };
  if (params.status !== null && params.status !== undefined)
    q.status = Array.isArray(params.status)
      ? params.status.join(',')
      : params.status;
  if (
    params.filter_label_template_id !== null &&
    params.filter_label_template_id !== undefined &&
    params.filter_label_template_id !== ''
  )
    q.filter_label_template_id = params.filter_label_template_id;
  if (
    params.filter_worker_id !== null &&
    params.filter_worker_id !== undefined &&
    params.filter_worker_id !== ''
  )
    q.filter_worker_id = params.filter_worker_id;
  if (
    params.filter_user_id !== null &&
    params.filter_user_id !== undefined &&
    params.filter_user_id !== ''
  )
    q.filter_user_id = params.filter_user_id;
  if (
    params.filter_sector_id !== null &&
    params.filter_sector_id !== undefined &&
    params.filter_sector_id !== ''
  )
    q.filter_sector_id = params.filter_sector_id;
  if (
    params.filter_name !== null &&
    params.filter_name !== undefined &&
    params.filter_name !== ''
  )
    q.filter_name = params.filter_name;
  if (
    params.filter_phone !== null &&
    params.filter_phone !== undefined &&
    params.filter_phone !== ''
  )
    q.filter_phone = params.filter_phone;
  if (
    params.filter_protocol !== null &&
    params.filter_protocol !== undefined &&
    params.filter_protocol !== ''
  )
    q.filter_protocol = params.filter_protocol;
  if (
    params.filter_date_start !== null &&
    params.filter_date_start !== undefined &&
    params.filter_date_start !== ''
  )
    q.filter_date_start = params.filter_date_start;
  if (
    params.filter_date_end !== null &&
    params.filter_date_end !== undefined &&
    params.filter_date_end !== ''
  )
    q.filter_date_end = params.filter_date_end;
  if (
    params.sort_field !== null &&
    params.sort_field !== undefined &&
    params.sort_field !== ''
  )
    q.sort_field = params.sort_field;
  if (
    params.sort_order !== null &&
    params.sort_order !== undefined &&
    params.sort_order !== ''
  )
    q.sort_order = params.sort_order;
  const res = await apiGet<SearchChatsResponse>('/chat/search', q);
  return res?.data ?? null;
}

export interface ListChatContactResult {
  contact_id: string;
  name: string;
  last_name?: string | null;
  email_partial?: string | null;
  phone_partial?: string | null;
  photo?: string | null;
  is_valided?: boolean | null;
  label_templates: Array<{
    label_template_id: string;
    label: string;
    color: string;
  }>;
}

export interface ListChatContactsResponse {
  results: ListChatContactResult[];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export async function listChatContacts(
  page = 1,
  perPage = 50,
  search?: string | null
): Promise<ListChatContactsResponse | null> {
  const params: Record<string, string | number> = {
    current_page: page,
    per_page: perPage,
  };
  if (search !== undefined && search !== null && search.trim() !== '') {
    params.search = search.trim();
  }
  const res = await apiGet<ListChatContactsResponse>('/chat/contacts', params);
  return res?.data ?? null;
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

export async function getChatContactById(
  contactId: string
): Promise<ChatContactLookupResult | null> {
  if (!contactId || contactId.trim().length === 0) return null;
  const res = await apiGet<ChatContactLookupResult>(
    `/chat/contacts/${contactId}`
  );
  return res?.data ?? null;
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
