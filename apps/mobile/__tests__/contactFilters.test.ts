import { serializeContactFilters } from '../utils/contactFilters';

describe('serializeContactFilters', () => {
  it('returns empty object when filters are null', () => {
    expect(serializeContactFilters(null)).toEqual({});
  });

  it('ignores null and blank values', () => {
    const query = serializeContactFilters({
      filter_name: '   ',
      filter_phone: null,
      filter_email: '',
      sort_field: null,
      sort_order: null,
    });

    expect(query).toEqual({});
  });

  it('serializes all supported filters', () => {
    const query = serializeContactFilters({
      filter_label_template_id: 'label-1',
      filter_phone_ddi: '55',
      filter_phone: '62999999999',
      filter_name: 'Maycon',
      filter_last_name: 'Douglas',
      filter_nickname: 'May',
      filter_email: 'mail@example.com',
      filter_birthday: '2026-02-20',
      filter_document: '12345678901',
      filter_user_id: 'user-1',
      sort_field: 'name',
      sort_order: 'asc',
    });

    expect(query).toEqual({
      filter_label_template_id: 'label-1',
      filter_phone_ddi: '55',
      filter_phone: '62999999999',
      filter_name: 'Maycon',
      filter_last_name: 'Douglas',
      filter_nickname: 'May',
      filter_email: 'mail@example.com',
      filter_birthday: '2026-02-20',
      filter_document: '12345678901',
      filter_user_id: 'user-1',
      sort_field: 'name',
      sort_order: 'asc',
    });
  });
});
