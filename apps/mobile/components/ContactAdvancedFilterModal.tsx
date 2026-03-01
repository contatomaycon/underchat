import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { getCountryDialCodeOptions } from '../constants/countryCodes';
import {
  formatDocumentByType,
  getDocumentMaskMaxLength,
} from '../utils/contactDocument';
import {
  listChatUsers,
  listLabelTemplates,
  type ChatUser,
  type LabelTemplate,
} from '../api/chatApi';
import type {
  ContactListFilters,
  ContactSortField,
  ContactSortOrder,
} from '../types/contact';

type PickerKind =
  | 'label'
  | 'phoneDdi'
  | 'user'
  | 'sortField'
  | 'sortOrder'
  | null;

const SORT_FIELD_OPTIONS: Array<{ value: ContactSortField; label: string }> = [
  { value: 'name', label: pt.name },
  { value: 'last_name', label: pt.last_name },
  { value: 'nickname', label: pt.nickname },
  { value: 'email', label: pt.email },
  { value: 'phone', label: pt.phone },
  { value: 'label', label: pt.filter_by_tag },
  { value: 'birthday', label: pt.birthday },
];

const SORT_ORDER_OPTIONS: Array<{ value: ContactSortOrder; label: string }> = [
  { value: 'asc', label: pt.ascending },
  { value: 'desc', label: pt.descending },
];

const DEFAULT_SORT_FIELD: ContactSortField = 'name';
const DEFAULT_SORT_ORDER: ContactSortOrder = 'asc';

export type ContactAdvancedFilterValues = ContactListFilters;

interface ContactAdvancedFilterModalProps {
  visible: boolean;
  onClose: () => void;
  initialValues: ContactAdvancedFilterValues;
  onApply: (values: ContactAdvancedFilterValues) => void;
}

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

function normalizeDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function cleanValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function cleanDigitsValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function ContactAdvancedFilterModal({
  visible,
  onClose,
  initialValues,
  onApply,
}: ContactAdvancedFilterModalProps) {
  const [labels, setLabels] = useState<LabelTemplate[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [saving, setSaving] = useState(false);

  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [filterPhoneDdi, setFilterPhoneDdi] = useState<string | null>(null);
  const [filterPhone, setFilterPhone] = useState<string | null>(null);
  const [filterName, setFilterName] = useState<string | null>(null);
  const [filterLastName, setFilterLastName] = useState<string | null>(null);
  const [filterNickname, setFilterNickname] = useState<string | null>(null);
  const [filterEmail, setFilterEmail] = useState<string | null>(null);
  const [filterBirthday, setFilterBirthday] = useState<string | null>(null);
  const [filterDocument, setFilterDocument] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<ContactSortField | null>(
    DEFAULT_SORT_FIELD
  );
  const [sortOrder, setSortOrder] = useState<ContactSortOrder | null>(
    DEFAULT_SORT_ORDER
  );
  const countryCodeOptions = useMemo(
    () => getCountryDialCodeOptions('pt-BR'),
    []
  );
  const documentMaskMaxLength = useMemo(
    () => getDocumentMaskMaxLength(null),
    []
  );

  useEffect(() => {
    if (!visible) return;

    setFilterLabel(initialValues.filter_label_template_id ?? null);
    setFilterPhoneDdi(initialValues.filter_phone_ddi ?? null);
    setFilterPhone(
      initialValues.filter_phone
        ? formatPhone(initialValues.filter_phone)
        : null
    );
    setFilterName(initialValues.filter_name ?? null);
    setFilterLastName(initialValues.filter_last_name ?? null);
    setFilterNickname(initialValues.filter_nickname ?? null);
    setFilterEmail(initialValues.filter_email ?? null);
    setFilterBirthday(initialValues.filter_birthday ?? null);
    setFilterDocument(
      initialValues.filter_document
        ? formatDocumentByType(initialValues.filter_document, null)
        : null
    );
    setFilterUserId(initialValues.filter_user_id ?? null);
    setSortField(initialValues.sort_field ?? DEFAULT_SORT_FIELD);
    setSortOrder(initialValues.sort_order ?? DEFAULT_SORT_ORDER);
  }, [visible, initialValues]);

  useEffect(() => {
    if (!visible) return;

    setLoadingLabels(true);
    listLabelTemplates()
      .then((data) => setLabels(data ?? []))
      .finally(() => setLoadingLabels(false));

    setLoadingUsers(true);
    listChatUsers()
      .then((data) => setUsers(data ?? []))
      .finally(() => setLoadingUsers(false));
  }, [visible]);

  const pickerItems = useMemo(() => {
    if (pickerKind === 'label') {
      return labels.map((item) => ({
        value: item.label_template_id,
        label: item.label,
      }));
    }
    if (pickerKind === 'user') {
      return users.map((item) => ({
        value: item.user_id,
        label: item.name ?? item.user_id,
      }));
    }
    if (pickerKind === 'phoneDdi') {
      return countryCodeOptions;
    }
    if (pickerKind === 'sortField') {
      return SORT_FIELD_OPTIONS.map((item) => ({
        value: item.value,
        label: item.label,
      }));
    }
    if (pickerKind === 'sortOrder') {
      return SORT_ORDER_OPTIONS.map((item) => ({
        value: item.value,
        label: item.label,
      }));
    }
    return [];
  }, [countryCodeOptions, labels, pickerKind, users]);

  const currentPickerLabel = useMemo(() => {
    if (pickerKind === 'label') return pt.filter_by_tag;
    if (pickerKind === 'phoneDdi') return pt.phone_ddi;
    if (pickerKind === 'user') return pt.filter_by_attendant;
    if (pickerKind === 'sortField') return pt.sort_by;
    if (pickerKind === 'sortOrder') return pt.sort_order;
    return '';
  }, [pickerKind]);

  const clearPickerValue = () => {
    if (pickerKind === 'label') setFilterLabel(null);
    if (pickerKind === 'phoneDdi') setFilterPhoneDdi(null);
    if (pickerKind === 'user') setFilterUserId(null);
    if (pickerKind === 'sortField') setSortField(DEFAULT_SORT_FIELD);
    if (pickerKind === 'sortOrder') setSortOrder(DEFAULT_SORT_ORDER);
    setPickerKind(null);
  };

  const selectPickerValue = (value: string) => {
    if (pickerKind === 'label') setFilterLabel(value);
    if (pickerKind === 'phoneDdi') setFilterPhoneDdi(value);
    if (pickerKind === 'user') setFilterUserId(value);
    if (pickerKind === 'sortField') setSortField(value as ContactSortField);
    if (pickerKind === 'sortOrder') setSortOrder(value as ContactSortOrder);
    setPickerKind(null);
  };

  const handleApply = () => {
    setSaving(true);
    onApply({
      filter_label_template_id: cleanValue(filterLabel),
      filter_phone_ddi: cleanValue(filterPhoneDdi),
      filter_phone: cleanDigitsValue(filterPhone),
      filter_name: cleanValue(filterName),
      filter_last_name: cleanValue(filterLastName),
      filter_nickname: cleanValue(filterNickname),
      filter_email: cleanValue(filterEmail),
      filter_birthday: cleanValue(filterBirthday),
      filter_document: cleanDigitsValue(filterDocument),
      filter_user_id: cleanValue(filterUserId),
      sort_field: sortField ?? DEFAULT_SORT_FIELD,
      sort_order: sortOrder ?? DEFAULT_SORT_ORDER,
    });
    setSaving(false);
    onClose();
  };

  const selectedLabelName =
    labels.find((item) => item.label_template_id === filterLabel)?.label ??
    pt.select_tag_filter;
  const selectedUserName =
    users.find((item) => item.user_id === filterUserId)?.name ??
    users.find((item) => item.user_id === filterUserId)?.user_id ??
    pt.select_attendant_filter;
  const selectedSortFieldName =
    SORT_FIELD_OPTIONS.find((item) => item.value === sortField)?.label ??
    pt.select_sort_field;
  const selectedSortOrderName =
    SORT_ORDER_OPTIONS.find((item) => item.value === sortOrder)?.label ??
    pt.select_sort_order;
  const selectedPhoneDdiName =
    countryCodeOptions.find((item) => item.value === filterPhoneDdi)?.label ??
    (filterPhoneDdi ? `+${filterPhoneDdi}` : pt.select_phone_ddi);

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.title}>{pt.advanced_filters}</Text>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.field}>
                <Text style={styles.label}>{pt.filter_by_tag}</Text>
                {loadingLabels ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <Pressable
                    style={styles.selector}
                    onPress={() => setPickerKind('label')}
                  >
                    <Text numberOfLines={1} style={styles.selectorText}>
                      {selectedLabelName}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                )}
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.phone_ddi}</Text>
                  <Pressable
                    style={styles.selector}
                    onPress={() => setPickerKind('phoneDdi')}
                  >
                    <Text numberOfLines={1} style={styles.selectorText}>
                      {selectedPhoneDdiName}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.phone}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterPhone ?? ''}
                    onChangeText={(value) =>
                      setFilterPhone(formatPhone(value) || null)
                    }
                    keyboardType="phone-pad"
                    maxLength={15}
                    placeholder={pt.filter_by_phone_placeholder}
                    placeholderTextColor={colors.grey500}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.name}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterName ?? ''}
                    onChangeText={(value) => setFilterName(value || null)}
                    placeholder={pt.name}
                    placeholderTextColor={colors.grey500}
                  />
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.last_name}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterLastName ?? ''}
                    onChangeText={(value) => setFilterLastName(value || null)}
                    placeholder={pt.last_name}
                    placeholderTextColor={colors.grey500}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.nickname}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterNickname ?? ''}
                    onChangeText={(value) => setFilterNickname(value || null)}
                    placeholder={pt.nickname}
                    placeholderTextColor={colors.grey500}
                  />
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.email}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterEmail ?? ''}
                    onChangeText={(value) => setFilterEmail(value || null)}
                    placeholder={pt.email}
                    placeholderTextColor={colors.grey500}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.birthday}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterBirthday ?? ''}
                    onChangeText={(value) =>
                      setFilterBirthday(normalizeDateInput(value) || null)
                    }
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.grey500}
                  />
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.document}</Text>
                  <TextInput
                    style={styles.input}
                    value={filterDocument ?? ''}
                    onChangeText={(value) =>
                      setFilterDocument(
                        formatDocumentByType(value, null) || null
                      )
                    }
                    maxLength={documentMaskMaxLength}
                    placeholder={pt.document}
                    placeholderTextColor={colors.grey500}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{pt.filter_by_attendant}</Text>
                {loadingUsers ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <Pressable
                    style={styles.selector}
                    onPress={() => setPickerKind('user')}
                  >
                    <Text numberOfLines={1} style={styles.selectorText}>
                      {selectedUserName}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                )}
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.sort_by}</Text>
                  <Pressable
                    style={styles.selector}
                    onPress={() => setPickerKind('sortField')}
                  >
                    <Text numberOfLines={1} style={styles.selectorText}>
                      {selectedSortFieldName}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                </View>
                <View style={[styles.field, styles.half]}>
                  <Text style={styles.label}>{pt.sort_order}</Text>
                  <Pressable
                    style={styles.selector}
                    onPress={() => setPickerKind('sortOrder')}
                  >
                    <Text numberOfLines={1} style={styles.selectorText}>
                      {selectedSortOrderName}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                </View>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <Pressable style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.applyButton, saving && styles.disabledButton]}
                onPress={handleApply}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.applyButtonText}>{pt.filter}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={pickerKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerKind(null)}
      >
        <Pressable
          style={styles.pickerOverlay}
          onPress={() => setPickerKind(null)}
        >
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{currentPickerLabel}</Text>
              <Pressable style={styles.clearButton} onPress={clearPickerValue}>
                <Text style={styles.clearButtonText}>{pt.clear_filter}</Text>
              </Pressable>
            </View>
            <FlatList
              data={pickerItems}
              keyExtractor={(item, index) => `${item.value}-${index}`}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => selectPickerValue(item.value)}
                >
                  <Text style={styles.pickerRowText}>{item.label}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 20,
  },
  field: {
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  half: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    color: colors.grey700,
    marginBottom: 4,
  },
  loadingWrap: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selector: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  selectorText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    marginRight: 8,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: colors.onSurface,
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: colors.primary,
    fontWeight: '500',
  },
  applyButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  applyButtonText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.7,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    maxHeight: 360,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
  pickerRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  pickerRowText: {
    color: colors.onSurface,
    fontSize: 14,
  },
});
