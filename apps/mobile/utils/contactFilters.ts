import type { ContactListFilters } from '../types/contact';

export function appendQueryField(
  target: Record<string, string | number | string[] | number[]>,
  key: string,
  value: string | number | null | undefined
): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' && value.trim() === '') return;
  target[key] = typeof value === 'string' ? value.trim() : value;
}

export function serializeContactFilters(
  filters: ContactListFilters | null | undefined
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (!filters) return query;

  appendQueryField(
    query,
    'filter_label_template_id',
    filters.filter_label_template_id
  );
  appendQueryField(query, 'filter_channel_id', filters.filter_channel_id);
  appendQueryField(query, 'filter_is_valided', filters.filter_is_valided);
  appendQueryField(query, 'filter_phone_ddi', filters.filter_phone_ddi);
  appendQueryField(query, 'filter_phone', filters.filter_phone);
  appendQueryField(query, 'filter_name', filters.filter_name);
  appendQueryField(query, 'filter_last_name', filters.filter_last_name);
  appendQueryField(query, 'filter_nickname', filters.filter_nickname);
  appendQueryField(query, 'filter_email', filters.filter_email);
  appendQueryField(query, 'filter_birthday', filters.filter_birthday);
  appendQueryField(query, 'filter_document', filters.filter_document);
  appendQueryField(query, 'filter_user_id', filters.filter_user_id);
  appendQueryField(query, 'sort_field', filters.sort_field);
  appendQueryField(query, 'sort_order', filters.sort_order);

  return query;
}
