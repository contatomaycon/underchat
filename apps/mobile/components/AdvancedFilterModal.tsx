import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableWithoutFeedback,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pt } from '../locales/pt';
import {
  listLabelTemplates,
  listChatWorkers,
  listChatUsers,
  listChatSectors,
  type LabelTemplate,
  type ChatWorker,
  type ChatUser,
  type ChatSector,
} from '../api/chatApi';
import { colors } from '../theme/colors';
import {
  dismissKeyboard,
  dismissKeyboardAnd,
  getKeyboardVerticalOffset,
  keyboardAvoidingBehavior,
} from '../utils/keyboard';
import { SelectField, SelectSheet, type SelectOption } from './select';

export interface AdvancedFilterValues {
  filter_label_template_id: string | null;
  filter_worker_id: string | null;
  filter_user_id: string | null;
  filter_sector_id: string | null;
  filter_name: string | null;
  filter_phone: string | null;
  filter_protocol: string | null;
  filter_date_start: string | null;
  filter_date_end: string | null;
  sort_field: string | null;
  sort_order: string | null;
}

const SORT_FIELD_OPTIONS: { value: string; title: string }[] = [
  { value: 'summary.last_message', title: pt.last_message },
  { value: 'account.name', title: pt.account },
  { value: 'worker.name', title: pt.channel },
  { value: 'name', title: pt.name },
  { value: 'phone', title: pt.phone },
  { value: 'status', title: pt.status },
  { value: 'date', title: pt.date },
  { value: 'user.name', title: pt.attendant },
  { value: 'sector.name', title: pt.sector },
  { value: 'started_at', title: pt.started_at },
  { value: 'closed_at', title: pt.closed_at },
];

const SORT_ORDER_OPTIONS: { value: string; title: string }[] = [
  { value: 'asc', title: pt.ascending },
  { value: 'desc', title: pt.descending },
];

function formatDateForApi(
  dateStr: string | null,
  isEndDate: boolean
): string | null {
  if (!dateStr || dateStr.trim() === '') return null;
  const trimmed = dateStr.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = Number.parseInt(match[1], 10);
  const m = Number.parseInt(match[2], 10);
  const d = Number.parseInt(match[3], 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  if (isEndDate) {
    date.setDate(date.getDate() + 1);
  }
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const useNative = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver: useNative,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: useNative,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <View style={styles.skeletonWrap}>
      <Animated.View style={[styles.skeletonBar, { opacity }]} />
    </View>
  );
}

interface AdvancedFilterModalProps {
  visible: boolean;
  onClose: () => void;
  initialValues: AdvancedFilterValues;
  onApply: (values: AdvancedFilterValues) => void;
  canUseUserAndSectorFilters: boolean;
}

type PickerKind =
  | 'tag'
  | 'worker'
  | 'user'
  | 'sector'
  | 'sort_field'
  | 'sort_order'
  | null;

export function AdvancedFilterModal({
  visible,
  onClose,
  initialValues,
  onApply,
  canUseUserAndSectorFilters,
}: AdvancedFilterModalProps) {
  const insets = useSafeAreaInsets();
  const [tags, setTags] = useState<LabelTemplate[]>([]);
  const [workers, setWorkers] = useState<ChatWorker[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [sectors, setSectors] = useState<ChatSector[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingSectors, setLoadingSectors] = useState(false);

  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [filterWorker, setFilterWorker] = useState<string | null>(null);
  const [filterUser, setFilterUser] = useState<string | null>(null);
  const [filterSector, setFilterSector] = useState<string | null>(null);
  const [filterName, setFilterName] = useState<string | null>(null);
  const [filterPhone, setFilterPhone] = useState<string | null>(null);
  const [filterProtocol, setFilterProtocol] = useState<string | null>(null);
  const [filterDateStart, setFilterDateStart] = useState<string>('');
  const [filterDateEnd, setFilterDateEnd] = useState<string>('');
  const [sortField, setSortField] = useState<string | null>(
    'summary.last_message'
  );
  const [sortOrder, setSortOrder] = useState<string | null>('desc');

  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFilterLabel(initialValues.filter_label_template_id ?? null);
    setFilterWorker(initialValues.filter_worker_id ?? null);
    setFilterUser(initialValues.filter_user_id ?? null);
    setFilterSector(initialValues.filter_sector_id ?? null);
    setFilterName(initialValues.filter_name ?? null);
    setFilterPhone(initialValues.filter_phone ?? null);
    setFilterProtocol(initialValues.filter_protocol ?? null);
    setFilterDateStart(initialValues.filter_date_start ?? '');
    setFilterDateEnd(initialValues.filter_date_end ?? '');
    setSortField(initialValues.sort_field ?? 'summary.last_message');
    setSortOrder(initialValues.sort_order ?? 'desc');
  }, [visible, initialValues]);

  useEffect(() => {
    if (!visible) return;
    setLoadingTags(true);
    listLabelTemplates()
      .then((data) => setTags(data ?? []))
      .finally(() => setLoadingTags(false));
    setLoadingWorkers(true);
    listChatWorkers()
      .then((data) => setWorkers(data ?? []))
      .finally(() => setLoadingWorkers(false));
    if (canUseUserAndSectorFilters) {
      setLoadingUsers(true);
      listChatUsers()
        .then((data) => setUsers(data ?? []))
        .finally(() => setLoadingUsers(false));
      setLoadingSectors(true);
      listChatSectors()
        .then((data) => setSectors(data ?? []))
        .finally(() => setLoadingSectors(false));
    }
  }, [visible, canUseUserAndSectorFilters]);

  useEffect(() => {
    if (!visible) {
      setPickerKind(null);
    }
  }, [visible]);

  const handleApply = () => {
    setSaving(true);
    onApply({
      filter_label_template_id: filterLabel || null,
      filter_worker_id: filterWorker || null,
      filter_user_id: canUseUserAndSectorFilters ? filterUser || null : null,
      filter_sector_id: canUseUserAndSectorFilters
        ? filterSector || null
        : null,
      filter_name: filterName?.trim() || null,
      filter_phone: filterPhone?.trim() || null,
      filter_protocol: filterProtocol?.trim() || null,
      filter_date_start: formatDateForApi(filterDateStart, false),
      filter_date_end: formatDateForApi(filterDateEnd, false),
      sort_field: sortField || null,
      sort_order: sortOrder || null,
    });
    setSaving(false);
    onClose();
  };

  const pickerOptions: SelectOption[] = (() => {
    if (pickerKind === 'tag') {
      return tags.map((tag) => ({
        value: tag.label_template_id,
        label: tag.label,
      }));
    }
    if (pickerKind === 'worker') {
      return workers.map((worker) => ({
        value: worker.id,
        label: worker.name,
      }));
    }
    if (pickerKind === 'user') {
      return users.map((user) => ({
        value: user.user_id,
        label: user.name ?? user.user_id,
      }));
    }
    if (pickerKind === 'sector') {
      return sectors.map((sector) => ({
        value: sector.id,
        label: sector.name,
      }));
    }
    if (pickerKind === 'sort_field') {
      return SORT_FIELD_OPTIONS.map((option) => ({
        value: option.value,
        label: option.title,
      }));
    }
    if (pickerKind === 'sort_order') {
      return SORT_ORDER_OPTIONS.map((option) => ({
        value: option.value,
        label: option.title,
      }));
    }
    return [];
  })();

  const getCurrentLabel = (): string => {
    if (pickerKind === 'tag') {
      const t = tags.find((x) => x.label_template_id === filterLabel);
      return t ? t.label : pt.select_tag_filter;
    }
    if (pickerKind === 'worker') {
      const w = workers.find((x) => x.id === filterWorker);
      return w ? w.name : pt.select_channel_filter;
    }
    if (pickerKind === 'user') {
      const u = users.find((x) => x.user_id === filterUser);
      return u ? (u.name ?? u.user_id) : pt.select_attendant_filter;
    }
    if (pickerKind === 'sector') {
      const s = sectors.find((x) => x.id === filterSector);
      return s ? s.name : pt.select_sector_filter;
    }
    if (pickerKind === 'sort_field') {
      const o = SORT_FIELD_OPTIONS.find((x) => x.value === sortField);
      return o ? o.title : pt.select_sort_field;
    }
    if (pickerKind === 'sort_order') {
      const o = SORT_ORDER_OPTIONS.find((x) => x.value === sortOrder);
      return o ? o.title : pt.select_sort_order;
    }
    return '';
  };

  const selectedPickerValue = (() => {
    if (pickerKind === 'tag') return filterLabel;
    if (pickerKind === 'worker') return filterWorker;
    if (pickerKind === 'user') return filterUser;
    if (pickerKind === 'sector') return filterSector;
    if (pickerKind === 'sort_field') return sortField;
    if (pickerKind === 'sort_order') return sortOrder;
    return null;
  })();

  const selectPickerValue = (value: string) => {
    if (pickerKind === 'tag') setFilterLabel(value);
    if (pickerKind === 'worker') setFilterWorker(value);
    if (pickerKind === 'user') setFilterUser(value);
    if (pickerKind === 'sector') setFilterSector(value);
    if (pickerKind === 'sort_field') setSortField(value);
    if (pickerKind === 'sort_order') setSortOrder(value);
    setPickerKind(null);
  };

  const clearPickerValue = () => {
    if (pickerKind === 'tag') setFilterLabel(null);
    if (pickerKind === 'worker') setFilterWorker(null);
    if (pickerKind === 'user') setFilterUser(null);
    if (pickerKind === 'sector') setFilterSector(null);
    if (pickerKind === 'sort_field') setSortField(null);
    if (pickerKind === 'sort_order') setSortOrder(null);
    setPickerKind(null);
  };

  const openPicker = (kind: Exclude<PickerKind, null>) => {
    dismissKeyboard();
    setPickerKind(kind);
  };

  const closePicker = () => {
    setPickerKind(null);
  };

  const handleRequestClose = () => {
    if (pickerKind !== null) {
      closePicker();
      return;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleRequestClose}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={keyboardAvoidingBehavior}
        keyboardVerticalOffset={getKeyboardVerticalOffset(8)}
      >
        <View style={[styles.modalOverlay, { paddingBottom: insets.bottom }]}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={dismissKeyboardAnd(handleRequestClose)}
          />
          <TouchableWithoutFeedback
            onPress={dismissKeyboard}
            accessible={false}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{pt.advanced_filters}</Text>
                <Pressable
                  onPress={dismissKeyboardAnd(onClose)}
                  hitSlop={12}
                  style={styles.closeBtn}
                >
                  <Ionicons name="close" size={24} color={colors.onSurface} />
                </Pressable>
              </View>
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
              >
                <View style={styles.field}>
                  {loadingTags ? (
                    <SkeletonRow />
                  ) : (
                    <SelectField
                      label={pt.filter_by_tag}
                      valueLabel={
                        tags.find((x) => x.label_template_id === filterLabel)
                          ?.label ?? null
                      }
                      placeholder={pt.select_tag_filter}
                      onPress={() => openPicker('tag')}
                    />
                  )}
                </View>

                {canUseUserAndSectorFilters ? (
                  <View style={styles.field}>
                    {loadingSectors ? (
                      <SkeletonRow />
                    ) : (
                      <SelectField
                        label={pt.filter_by_sector}
                        valueLabel={
                          sectors.find((x) => x.id === filterSector)?.name ??
                          null
                        }
                        placeholder={pt.select_sector_filter}
                        onPress={() => openPicker('sector')}
                      />
                    )}
                  </View>
                ) : null}

                <View style={styles.field}>
                  {loadingWorkers ? (
                    <SkeletonRow />
                  ) : (
                    <SelectField
                      label={pt.filter_by_channel}
                      valueLabel={
                        workers.find((x) => x.id === filterWorker)?.name ?? null
                      }
                      placeholder={pt.select_channel_filter}
                      onPress={() => openPicker('worker')}
                    />
                  )}
                </View>

                {canUseUserAndSectorFilters ? (
                  <View style={styles.field}>
                    {loadingUsers ? (
                      <SkeletonRow />
                    ) : (
                      <SelectField
                        label={pt.filter_by_attendant}
                        valueLabel={
                          users.find((x) => x.user_id === filterUser)?.name ??
                          users.find((x) => x.user_id === filterUser)
                            ?.user_id ??
                          null
                        }
                        placeholder={pt.select_attendant_filter}
                        onPress={() => openPicker('user')}
                      />
                    )}
                  </View>
                ) : null}

                <View style={styles.field}>
                  <Text style={styles.label}>{pt.filter_by_name}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={pt.filter_by_name_placeholder}
                    placeholderTextColor={colors.grey500}
                    value={filterName ?? ''}
                    onChangeText={(t) => setFilterName(t || null)}
                  />
                </View>
                <View style={styles.row}>
                  <View style={[styles.field, styles.half]}>
                    <Text style={styles.label}>{pt.filter_by_phone}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={pt.filter_by_phone_placeholder}
                      placeholderTextColor={colors.grey500}
                      value={filterPhone ?? ''}
                      onChangeText={(t) => setFilterPhone(t || null)}
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={[styles.field, styles.half]}>
                    <Text style={styles.label}>{pt.filter_by_protocol}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={pt.filter_by_protocol_placeholder}
                      placeholderTextColor={colors.grey500}
                      value={filterProtocol ?? ''}
                      onChangeText={(t) => setFilterProtocol(t || null)}
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={[styles.field, styles.half]}>
                    <Text style={styles.label}>{pt.filter_date_start}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={pt.select_date}
                      placeholderTextColor={colors.grey500}
                      value={filterDateStart}
                      onChangeText={setFilterDateStart}
                    />
                  </View>
                  <View style={[styles.field, styles.half]}>
                    <Text style={styles.label}>{pt.filter_date_end}</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={pt.select_date}
                      placeholderTextColor={colors.grey500}
                      value={filterDateEnd}
                      onChangeText={setFilterDateEnd}
                    />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={[styles.field, styles.half]}>
                    <SelectField
                      label={pt.sort_by}
                      valueLabel={
                        SORT_FIELD_OPTIONS.find((x) => x.value === sortField)
                          ?.title ?? null
                      }
                      placeholder={pt.select_sort_field}
                      onPress={() => openPicker('sort_field')}
                    />
                  </View>
                  <View style={[styles.field, styles.half]}>
                    <SelectField
                      label={pt.sort_order}
                      valueLabel={
                        SORT_ORDER_OPTIONS.find((x) => x.value === sortOrder)
                          ?.title ?? null
                      }
                      placeholder={pt.select_sort_order}
                      onPress={() => openPicker('sort_order')}
                    />
                  </View>
                </View>
              </ScrollView>
              <View style={styles.footer}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={dismissKeyboardAnd(onClose)}
                >
                  <Text style={styles.cancelBtnText}>{pt.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.filterBtn, saving && styles.filterBtnDisabled]}
                  onPress={dismissKeyboardAnd(handleApply)}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.filterBtnText}>{pt.filter}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>

          <SelectSheet
            visible={pickerKind !== null}
            title={getCurrentLabel()}
            options={pickerOptions}
            selectedValue={selectedPickerValue}
            emptyText={pt.no_results_found}
            searchPlaceholder={pt.select_search_placeholder}
            showClear
            clearLabel={pt.clear_filter}
            onClear={clearPickerValue}
            onRequestClose={closePicker}
            onSelectValue={selectPickerValue}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: 400,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  half: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    color: colors.grey600,
    marginBottom: 4,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.onSurface,
  },
  skeletonWrap: {
    height: 44,
    justifyContent: 'center',
  },
  skeletonBar: {
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.grey300,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  cancelBtnText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  filterBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: colors.primary,
    minWidth: 100,
    alignItems: 'center',
  },
  filterBtnDisabled: {
    opacity: 0.7,
  },
  filterBtnText: {
    fontSize: 14,
    color: colors.onPrimary,
    fontWeight: '600',
  },
});
