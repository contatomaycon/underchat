import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  listChatContacts,
  validateChatContact,
  type ChatUserStatus,
  type ListChatContactResult,
} from '../api/chatApi';
import {
  getPermissions,
  getUser,
  type UserChannel,
  getChannels,
} from '../storage/authStorage';
import {
  hasContactsModuleAccess,
  hasChatAccessPermission,
} from '../constants/chatAuthorization';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  ContactAdvancedFilterModal,
  type ContactAdvancedFilterValues,
} from '../components/ContactAdvancedFilterModal';
import { ContactFormModal } from '../components/ContactFormModal';
import { ContactStartConversationModal } from '../components/ContactStartConversationModal';
import { UserSidebar } from '../components/UserSidebar';
import { addChatSocketListener } from '../socket/chatSocket';
import type { ListChatsResult } from '../types/chat';
import type { ChatStackParamList } from '../navigation/types';
import { AppAvatar } from '../components/AppAvatar';
import {
  getChatUserStatusColor,
  normalizeChatUserStatus,
  readChatUserStatus,
} from '../utils/chatUserStatus';

type Props = NativeStackScreenProps<ChatStackParamList, 'Contacts'>;

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

function areChannelsEqual(left: UserChannel[], right: UserChannel[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i]?.id !== right[i]?.id || left[i]?.name !== right[i]?.name) {
      return false;
    }
  }
  return true;
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
  const isValidated = !!item.is_valided;

  return (
    <Pressable
      style={[styles.contactRow, disabled && styles.contactRowDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <AppAvatar
        uri={item.photo}
        size={42}
        style={styles.contactAvatar}
        iconName="person"
        iconColor={colors.grey500}
      />
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

export function ContactListScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<ChatUserStatus>('offline');
  const [contacts, setContacts] = useState<ListChatContactResult[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const [userChannels, setUserChannels] = useState<UserChannel[]>([]);
  const [profileSidebarVisible, setProfileSidebarVisible] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileSidebarReopenTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const hasActiveFilters = useMemo(
    () => hasAnyContactFilter(filters),
    [filters]
  );

  const loadContacts = useCallback(
    async (page: number, append: boolean) => {
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
    [debouncedSearch, filters]
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
    return () => {
      if (profileSidebarReopenTimerRef.current) {
        clearTimeout(profileSidebarReopenTimerRef.current);
        profileSidebarReopenTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    getUser()
      .then((user) => {
        const info =
          user && typeof user === 'object'
            ? (user as { info?: { photo?: string | null } }).info
            : undefined;
        const photo = info && info.photo ? String(info.photo) : null;
        setUserPhoto(photo && photo !== 'null' ? photo : null);
        setUserStatus(readChatUserStatus(user));
      })
      .catch(() => setUserPhoto(null));

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

    getChannels()
      .then((channels) => {
        setUserChannels((prev) =>
          areChannelsEqual(prev, channels) ? prev : channels
        );
      })
      .catch(() => setUserChannels([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      setCurrentPage(1);
      setContacts([]);
      void loadContacts(1, false);
    }, [debouncedSearch, filters, loadContacts])
  );

  useFocusEffect(
    useCallback(() => {
      const offChannelsUpdated = addChatSocketListener(
        'channelsUpdated',
        (payload) => {
          if (!currentUserId || payload.user_id !== currentUserId) {
            return;
          }

          if (!areChannelsEqual(userChannels, payload.channels)) {
            setUserChannels(payload.channels);
          }

          setCurrentPage(1);
          setContacts([]);
          void loadContacts(1, false);
        }
      );
      const offUserPresence = addChatSocketListener(
        'userPresence',
        (payload) => {
          if (!currentUserId || payload.user_id !== currentUserId) {
            return;
          }

          setUserStatus(normalizeChatUserStatus(payload.status));
        }
      );

      return () => {
        offChannelsUpdated();
        offUserPresence();
      };
    }, [currentUserId, loadContacts, userChannels])
  );

  const handleCloseProfileSidebar = useCallback(() => {
    if (profileSidebarReopenTimerRef.current) {
      clearTimeout(profileSidebarReopenTimerRef.current);
      profileSidebarReopenTimerRef.current = null;
    }
    setProfileSidebarVisible(false);
  }, []);

  const handleOpenProfileSidebar = useCallback(() => {
    if (profileSidebarReopenTimerRef.current) {
      clearTimeout(profileSidebarReopenTimerRef.current);
      profileSidebarReopenTimerRef.current = null;
    }

    if (!profileSidebarVisible) {
      setProfileSidebarVisible(true);
      return;
    }

    setProfileSidebarVisible(false);
    profileSidebarReopenTimerRef.current = setTimeout(() => {
      setProfileSidebarVisible(true);
      profileSidebarReopenTimerRef.current = null;
    }, 40);
  }, [profileSidebarVisible]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        handleCloseProfileSidebar();
      };
    }, [handleCloseProfileSidebar])
  );

  const handleLoadMore = () => {
    if (loading || loadingMore) return;
    if (currentPage >= totalPages) return;
    void loadContacts(currentPage + 1, true);
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

  const refreshContacts = useCallback(() => {
    setCurrentPage(1);
    setContacts([]);
    void loadContacts(1, false);
  }, [loadContacts]);

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
    refreshContacts();
    navigation.push('ChatRoom', { chat });
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.avatarPlaceholder}
          onPress={handleOpenProfileSidebar}
        >
          <View style={styles.headerAvatarWrap}>
            <AppAvatar
              uri={userPhoto}
              size={40}
              style={styles.headerAvatarImage}
              iconName="person-circle-outline"
              iconSize={40}
              iconColor={colors.grey400}
            />
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getChatUserStatusColor(userStatus) },
              ]}
            />
          </View>
        </Pressable>
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
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setFilterVisible(true)}
          accessibilityLabel={pt.advanced_filters}
        >
          <Ionicons name="filter" size={22} color={colors.onSurface} />
        </Pressable>
        {hasActiveFilters ? (
          <Pressable
            style={styles.clearFilterBtn}
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
      <UserSidebar
        visible={profileSidebarVisible}
        onClose={handleCloseProfileSidebar}
        onProfileUpdated={(nextPhoto) => setUserPhoto(nextPhoto)}
        onStatusUpdated={setUserStatus}
      />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{pt.contacts}</Text>
      </View>

      {!hasContactAccess ? (
        <View style={styles.permissionDeniedWrap}>
          <Text style={styles.permissionDeniedText}>
            {pt.chat_permission_denied}
          </Text>
        </View>
      ) : (
        <>
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
                    <Text style={styles.emptyText}>{pt.no_contacts_found}</Text>
                  </View>
                ) : null
              }
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.listFooterLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null
              }
            />
          )}
        </>
      )}

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
        }}
      />

      <ContactStartConversationModal
        visible={selectedContactForConversation !== null}
        contact={selectedContactForConversation}
        onClose={() => setSelectedContactForConversation(null)}
        onConversationStarted={handleConversationStarted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.grey100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerAvatarWrap: {
    position: 'relative',
    width: 40,
    height: 40,
  },
  headerAvatarImage: {
    backgroundColor: 'transparent',
  },
  statusBadge: {
    position: 'absolute',
    right: 1,
    bottom: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.surface,
    zIndex: 2,
  },
  filterBtn: {
    padding: 8,
  },
  clearFilterBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.grey50,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  permissionDeniedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    padding: 20,
  },
  permissionDeniedText: {
    color: colors.error,
    textAlign: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    height: 40,
    backgroundColor: colors.inputBg,
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
});
