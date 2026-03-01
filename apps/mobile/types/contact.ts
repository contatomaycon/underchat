export const CONTACT_DOCUMENT_TYPE = {
  cpf: '019a930d-c6f5-75af-82a5-94b2a24a317c',
  cnpj: '019a930d-c6f5-75af-82a5-99f4ec242bb6',
} as const;

export type ContactDocumentTypeId =
  (typeof CONTACT_DOCUMENT_TYPE)[keyof typeof CONTACT_DOCUMENT_TYPE];

export const CONTACT_IGNORE = {
  not_ignore: 'not_ignore',
  ignore_automation: 'ignore_automation',
  ignore_totally: 'ignore_totally',
} as const;

export type ContactIgnore =
  (typeof CONTACT_IGNORE)[keyof typeof CONTACT_IGNORE];

export type ContactSortField =
  | 'name'
  | 'last_name'
  | 'nickname'
  | 'email'
  | 'phone'
  | 'label'
  | 'birthday';

export type ContactSortOrder = 'asc' | 'desc';

export interface ContactListFilters {
  filter_label_template_id?: string | null;
  filter_phone_ddi?: string | null;
  filter_phone?: string | null;
  filter_name?: string | null;
  filter_last_name?: string | null;
  filter_nickname?: string | null;
  filter_email?: string | null;
  filter_birthday?: string | null;
  filter_document?: string | null;
  filter_user_id?: string | null;
  sort_field?: ContactSortField | null;
  sort_order?: ContactSortOrder | null;
}

export interface ContactLabelTemplate {
  label_template_id: string;
  label: string;
  color: string;
}

export interface ChatContactChannelsItem {
  channel_id: string;
  name: string;
  number: string | null;
}

export interface ChatContactListItem {
  contact_id: string;
  name: string;
  last_name?: string | null;
  email_partial?: string | null;
  phone_partial?: string | null;
  photo?: string | null;
  is_valided?: boolean | null;
  label_templates: ContactLabelTemplate[];
}

export interface ChatContactListResponse {
  results: ChatContactListItem[];
  current_page: number;
  total_pages: number;
  per_page: number;
  count: number;
  total: number;
}

export interface ChatContactUser {
  user_id: string;
  name: string | null;
  photo: string | null;
}

export interface ChatContactDocumentType {
  contact_document_type_id: string;
  name: string;
}

export interface ChatContactViewResponse {
  contact_id: string;
  name: string;
  last_name?: string | null;
  email_partial?: string | null;
  phone_ddi?: string | null;
  phone_partial?: string | null;
  nickname?: string | null;
  birthday?: string | null;
  notes?: string | null;
  document?: string | null;
  document_partial?: string | null;
  photo?: string | null;
  is_valided?: boolean | null;
  label_templates: ContactLabelTemplate[];
  contact_document_type?: ChatContactDocumentType | null;
  user?: ChatContactUser | null;
  ignore?: ContactIgnore | null;
  channel_ids?: string[];
}

export interface CreateChatContactPayload {
  label_template_ids?: string[] | null;
  channel_ids?: string[] | null;
  name: string;
  last_name?: string | null;
  email?: string | null;
  phone_ddi: string;
  phone: string;
  nickname?: string | null;
  birthday?: string | null;
  notes?: string | null;
  contact_document_type_id?: ContactDocumentTypeId | string | null;
  document?: string | null;
  chat_id?: string | null;
  user_id?: string | null;
  ignore?: ContactIgnore | null;
  image_url?: string | null;
}

export interface UpdateChatContactPayload {
  contact_id: string;
  label_template_ids?: string[] | null;
  channel_ids?: string[] | null;
  name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_ddi?: string | null;
  phone?: string | null;
  nickname?: string | null;
  birthday?: string | null;
  notes?: string | null;
  contact_document_type_id?: ContactDocumentTypeId | string | null;
  document?: string | null;
  user_id?: string | null;
  ignore?: ContactIgnore | null;
  image_url?: string | null;
}

export interface TransferWorker {
  id: string;
  name: string;
  number: string | null;
  status: {
    id: string;
  } | null;
}

export interface TransferSector {
  sector_id: string;
  name: string;
  color: string;
  sector_status: {
    id: string;
  } | null;
}

export interface WorkerConfigForChat {
  show_worker_name: boolean;
  show_attendee_name: boolean;
  show_protocol_in_chat: boolean;
  allow_attendance_only_online: boolean;
  simultaneous_attendance: number | null;
  simultaneous_attendance_enabled: boolean;
  has_ura_output: boolean;
}
