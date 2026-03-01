import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  listChatContacts,
  validateChatContact,
  type ListChatContactResult,
} from '../api/chatApi';
import { clearAuth, getPermissions, getUser } from '../storage/authStorage';
import { emitAuthUnauthorized } from '../utils/authEvents';
import { resolveImageUri } from '../utils/imageUri';
import {
  hasContactsModuleAccess,
  hasChatAccessPermission,
} from '../constants/chatAuthorization';
import {
  ContactAdvancedFilterModal,
  type ContactAdvancedFilterValues,
} from './ContactAdvancedFilterModal';
import { ContactFormModal } from './ContactFormModal';
import { ContactStartConversationModal } from './ContactStartConversationModal';
import type { ListChatsResult } from '../types/chat';
import { addChatSocketListener } from '../socket/chatSocket';

interface UserSidebarProps {
  visible: boolean;
  onClose: () => void;
  onLogout?: () => void;
  onOpenChatFromContact?: (chat: ListChatsResult) => void;
  onContactsChanged?: () => void;
}

const EMPTY_FILTERS: ContactAdvancedFilterValues = {
  filter_label_template_id: null,
  filter_phone_ddi: null,
  filter_phone: null,
  filter_name: null,
  filter_last_name: null,
  filter_nickname: null,
  filter_email: null,
  filter_birthday: null,
  filter_document: null,
  filter_user_id: null,
  sort_field: 'name',
  sort_order: 'asc',
};

function hasAnyContactFilter(values: ContactAdvancedFilterValues): boolean {
  return !!(
    values.filter_label_template_id ||
    values.filter_phone_ddi ||
    values.filter_phone ||
    values.filter_name ||
    values.filter_last_name ||
    values.filter_nickname ||
    values.filter_email ||
    values.filter_birthday ||
    values.filter_document ||
    values.filter_user_id
  );
}

function resolveUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const cast = user as { id?: unknown; user_id?: unknown };
  const idValue =
    typeof cast.id === 'string'
      ? cast.id.trim()
      : typeof cast.id === 'number'
        ? String(cast.id)
        : null;
  if (idValue && idValue.length > 0) return idValue;

  const userIdValue =
    typeof cast.user_id === 'string'
      ? cast.user_id.trim()
      : typeof cast.user_id === 'number'
        ? String(cast.user_id)
        : null;

  return userIdValue && userIdValue.length > 0 ? userIdValue : null;
}

function mergeUniqueContacts(
  previous: ListChatContactResult[],
  next: ListChatContactResult[]
): ListChatContactResult[] {
  if (next.length === 0) return previous;

  const map = new Map<string, ListChatContactResult>();
  for (let i = 0; i < previous.length; i++) {
    map.set(previous[i].contact_id, previous[i]);
  }
  for (let i = 0; i < next.length; i++) {
    map.set(next[i].contact_id, next[i]);
  }
  return Array.from(map.values());
}

function ContactRow({
  item,
  onPress,
  onValidate,
  onEdit,
  disabled,
}: {
  item: ListChatContactResult;
  onPress: () => void;
  onValidate: () => void;
  onEdit: () => void;
  disabled?: boolean;
}) {
  const displayName =
    item.name || item.last_name
      ? [item.name, item.last_name].filter(Boolean).join(' ')
      : item.phone_partial || item.contact_id;
  const phoneLabel = item.phone_partial ?? '';
  const photoUri = resolveImageUri(item.photo);
  const isValidated = !!item.is_valided;

  return (
    <Pressable
      style={[styles.contactRow, disabled && styles.contactRowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.contactAvatar}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.contactAvatarImage} />
        ) : (
          <Ionicons name="person" size={24} color={colors.grey500} />
        )}
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName} numberOfLines={1}>
          {displayName}
        </Text>
        {phoneLabel ? (
          <Text style={styles.contactPhone} numberOfLines={1}>
            {phoneLabel}
          </Text>
        ) : null}
      </View>
      <View style={styles.contactActionsInline}>
        {isValidated ? (
          <View style={[styles.validationChip, styles.validationChipOk]}>
            <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
          </View>
        ) : (
          <Pressable
            style={[styles.actionBtn, styles.validateActionBtn]}
            onPress={onValidate}
            hitSlop={8}
          >
            <Ionicons
              name="refresh-outline"
              size={16}
              color={colors.onPrimary}
            />
          </Pressable>
        )}
        <Pressable style={styles.actionBtn} onPress={onEdit} hitSlop={8}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

export function UserSidebar({
  visible,
  onClose,
  onLogout,
  onOpenChatFromContact,
  onContactsChanged,
}: UserSidebarProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [contacts, setContacts] = useState<ListChatContactResult[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [filters, setFilters] =
    useState<ContactAdvancedFilterValues>(EMPTY_FILTERS);
  const [selectedContactForConversation, setSelectedContactForConversation] =
    useState<ListChatContactResult | null>(null);
  const [hasContactAccess, setHasContactAccess] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasActiveFilters = useMemo(
    () => hasAnyContactFilter(filters),
    [filters]
  );

  const loadContacts = useCallback(
    async (page: number, append: boolean) => {
      if (!visible) return;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await listChatContacts(
          page,
          50,
          debouncedSearch || undefined,
          filters
        );

        const results = response?.results ?? [];
        setContacts((previous) =>
          append ? mergeUniqueContacts(previous, results) : results
        );
        setCurrentPage(response?.current_page ?? page);
        setTotalPages(response?.total_pages ?? 1);
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [debouncedSearch, filters, visible]
  );

  useEffect(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
    }
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => {
      if (searchTimer.current) {
        clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
    };
  }, [search]);

  useEffect(() => {
    if (!visible) return;
    setCurrentPage(1);
    setContacts([]);
    loadContacts(1, false);
  }, [visible, debouncedSearch, filters, loadContacts]);

  useEffect(() => {
    if (!visible) return;

    getPermissions()
      .then((permissions) => {
        setHasContactAccess(
          hasContactsModuleAccess(permissions) ||
            hasChatAccessPermission(permissions)
        );
      })
      .catch(() => setHasContactAccess(false));

    getUser()
      .then((user) => setCurrentUserId(resolveUserId(user)))
      .catch(() => setCurrentUserId(null));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const offChannelsUpdated = addChatSocketListener(
      'channelsUpdated',
      (payload) => {
        if (!currentUserId || payload.user_id !== currentUserId) {
          return;
        }
        setCurrentPage(1);
        setContacts([]);
        loadContacts(1, false);
      }
    );

    return () => {
      offChannelsUpdated();
    };
  }, [currentUserId, loadContacts, visible]);

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    if (currentPage >= totalPages) return;
    void loadContacts(currentPage + 1, true);
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    await clearAuth();
    emitAuthUnauthorized();
    setLogoutLoading(false);
    onClose();
    onLogout?.();
  };

  const handleOpenCreate = () => {
    setFormMode('create');
    setEditingContactId(null);
    setFormVisible(true);
  };

  const handleOpenEdit = (contactId: string) => {
    setFormMode('edit');
    setEditingContactId(contactId);
    setFormVisible(true);
  };

  const handleClearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const refreshContacts = () => {
    setCurrentPage(1);
    setContacts([]);
    void loadContacts(1, false);
  };

  const handleValidate = (contact: ListChatContactResult) => {
    Alert.alert(pt.validate_contact, pt.validate_contact_confirmation, [
      { text: pt.cancel, style: 'cancel' },
      {
        text: pt.validate,
        onPress: async () => {
          const ok = await validateChatContact(contact.contact_id);
          if (!ok) {
            Alert.alert(pt.error_title, pt.contact_validation_failed);
            return;
          }

          setContacts((prev) =>
            prev.map((item) =>
              item.contact_id === contact.contact_id
                ? { ...item, is_valided: true }
                : item
            )
          );
          Alert.alert(pt.success_title, pt.contact_validation_success);
        },
      },
    ]);
  };

  const handleContactPress = (contact: ListChatContactResult) => {
    if (!contact.phone_partial) {
      Alert.alert(pt.warning_title, pt.contact_phone_required);
      return;
    }

    if (!contact.is_valided) {
      Alert.alert(pt.warning_title, pt.contact_must_be_validated);
      return;
    }

    setSelectedContactForConversation(contact);
  };

  const handleConversationStarted = (chat: ListChatsResult) => {
    setSelectedContactForConversation(null);
    onClose();
    onOpenChatFromContact?.(chat);
    onContactsChanged?.();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>{pt.contacts}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          {!hasContactAccess ? (
            <View style={styles.permissionDeniedWrap}>
              <Text style={styles.permissionDeniedText}>
                {pt.chat_permission_denied}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.searchBarRow}>
                <View style={styles.searchWrap}>
                  <Ionicons
                    name="search"
                    size={20}
                    color={colors.grey500}
                    style={styles.searchIcon}
                  />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={pt.search_contacts}
                    placeholderTextColor={colors.grey500}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {search.trim().length > 0 ? (
                    <Pressable
                      style={styles.searchClearBtn}
                      onPress={handleClearSearch}
                      hitSlop={8}
                      accessibilityLabel={pt.clear_filter}
                    >
                      <Ionicons
                        name="close-circle"
                        size={18}
                        color={colors.grey500}
                      />
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => setFilterVisible(true)}
                  accessibilityLabel={pt.advanced_filters}
                >
                  <Ionicons name="filter" size={18} color={colors.onSurface} />
                </Pressable>
                {hasActiveFilters ? (
                  <Pressable
                    style={[styles.iconBtn, styles.clearFilterIconBtn]}
                    onPress={() => setFilters(EMPTY_FILTERS)}
                    accessibilityLabel={pt.clear_filters}
                  >
                    <Ionicons name="close" size={16} color={colors.onPrimary} />
                  </Pressable>
                ) : null}
                <Pressable style={styles.addBtn} onPress={handleOpenCreate}>
                  <Ionicons name="add" size={20} color={colors.onPrimary} />
                </Pressable>
              </View>

              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <FlatList
                  data={contacts}
                  keyExtractor={(item) => item.contact_id}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.3}
                  renderItem={({ item }) => (
                    <ContactRow
                      item={item}
                      onPress={() => handleContactPress(item)}
                      onValidate={() => handleValidate(item)}
                      onEdit={() => handleOpenEdit(item.contact_id)}
                    />
                  )}
                  style={styles.contactList}
                  contentContainerStyle={styles.contactListContent}
                  ListEmptyComponent={
                    !loading && contacts.length === 0 ? (
                      <View style={styles.empty}>
                        <Text style={styles.emptyText}>
                          {pt.no_contacts_found}
                        </Text>
                      </View>
                    ) : null
                  }
                  ListFooterComponent={
                    loadingMore ? (
                      <View style={styles.listFooterLoading}>
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      </View>
                    ) : null
                  }
                />
              )}
            </>
          )}

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.logoutBtn,
                logoutLoading && styles.logoutBtnDisabled,
              ]}
              onPress={handleLogout}
              disabled={logoutLoading}
            >
              {logoutLoading ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <>
                  <Ionicons
                    name="log-out-outline"
                    size={22}
                    color={colors.onPrimary}
                    style={styles.logoutIcon}
                  />
                  <Text style={styles.logoutText}>{pt.logout}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      <ContactAdvancedFilterModal
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        initialValues={filters}
        onApply={(values) => {
          setFilters(values);
          setFilterVisible(false);
        }}
      />

      <ContactFormModal
        visible={formVisible}
        mode={formMode}
        contactId={editingContactId}
        onClose={() => setFormVisible(false)}
        onSuccess={() => {
          setFormVisible(false);
          refreshContacts();
          onContactsChanged?.();
        }}
      />

      <ContactStartConversationModal
        visible={selectedContactForConversation !== null}
        contact={selectedContactForConversation}
        onClose={() => setSelectedContactForConversation(null)}
        onConversationStarted={handleConversationStarted}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sidebar: {
    width: 360,
    maxWidth: '88%',
    backgroundColor: colors.surface,
    ...(Platform.OS === 'web'
      ? { boxShadow: '-2px 0 8px rgba(0,0,0,0.15)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: -2, height: 0 },
          shadowOpacity: 0.15,
          shadowRadius: 8,
          elevation: 8,
        }),
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  sidebarTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  permissionDeniedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  permissionDeniedText: {
    color: colors.error,
    textAlign: 'center',
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    height: 44,
    backgroundColor: colors.grey100,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.onSurface,
    paddingVertical: 0,
  },
  searchClearBtn: {
    marginLeft: 6,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.surface,
  },
  clearFilterIconBtn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  contactList: {
    flex: 1,
  },
  contactListContent: {
    paddingBottom: 16,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
    gap: 10,
  },
  contactRowDisabled: {
    opacity: 0.7,
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.grey200,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  contactAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  contactInfo: {
    flex: 1,
    minWidth: 0,
  },
  contactName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  contactPhone: {
    fontSize: 12,
    color: colors.grey600,
    marginTop: 2,
  },
  contactActionsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 72,
    flexShrink: 0,
  },
  validationChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validationChipOk: {
    backgroundColor: colors.success,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.grey300,
    backgroundColor: colors.grey100,
  },
  validateActionBtn: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.grey600,
    textAlign: 'center',
  },
  listFooterLoading: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutBtnDisabled: {
    opacity: 0.7,
  },
  logoutIcon: {
    marginRight: 8,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onPrimary,
  },
});
