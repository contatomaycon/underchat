import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  TextInput,
  Image,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import type { ListChatsResult } from '../types/chat';
import {
  listMyChats,
  listQueueChats,
  listInChatChats,
  listChats,
  searchChats,
} from '../api/chatApi';
import { getUser, getPermissions } from '../storage/authStorage';
import { canUseUserAndSectorFilters as checkUserSectorFilters } from '../constants/permissions';
import { AdvancedFilterModal } from '../components/AdvancedFilterModal';
import type { AdvancedFilterValues } from '../components/AdvancedFilterModal';
import { UserSidebar } from '../components/UserSidebar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { useChatFilter } from '../context/ChatFilterContext';
import { resolveImageUri } from '../utils/imageUri';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;

const CHAT_STATUS = {
  all: 'my_chats' as const,
  queue: 'queue' as const,
  in_chat: 'in_chat' as const,
  closed: 'closed' as const,
  chatbot: 'ura' as const,
};

const EMPTY_FILTER_VALUES: AdvancedFilterValues = {
  filter_label_template_id: null,
  filter_worker_id: null,
  filter_user_id: null,
  filter_sector_id: null,
  filter_name: null,
  filter_phone: null,
  filter_protocol: null,
  filter_date_start: null,
  filter_date_end: null,
  sort_field: null,
  sort_order: null,
};

function hasAppliedAdvancedFilters(values: AdvancedFilterValues): boolean {
  if (values.filter_label_template_id) return true;
  if (values.filter_worker_id) return true;
  if (values.filter_user_id) return true;
  if (values.filter_sector_id) return true;
  if (values.filter_name?.trim()) return true;
  if (values.filter_phone?.trim()) return true;
  if (values.filter_protocol?.trim()) return true;
  if (values.filter_date_start) return true;
  if (values.filter_date_end) return true;
  return false;
}

function toNextDay(dateStr: string | null): string | null {
  if (!dateStr || dateStr.trim() === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const date = new Date(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10) - 1,
    Number.parseInt(match[3], 10)
  );
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + 1);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000)
    return d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  if (diff < 604800000) {
    const days = [
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ];
    return days[d.getDay()];
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function ChatRow({
  item,
  onPress,
}: {
  item: ListChatsResult;
  onPress: () => void;
}) {
  const name = item.name ?? item.contact?.name ?? item.phone ?? item.chat_id;
  const lastMsg = item.summary?.last_message ?? '';
  const lastDate = formatDate(item.summary?.last_date ?? item.date);
  const unread = item.summary?.unread_count ?? 0;
  const photo = item.photo ?? item.contact?.photo ?? null;
  const photoUri = resolveImageUri(photo);

  return (
    <Pressable style={styles.chatRow} onPress={onPress}>
      <View style={styles.chatAvatar}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.chatAvatarImage} />
        ) : (
          <View style={styles.chatAvatarPlaceholder}>
            <Ionicons name="person" size={24} color={colors.grey600} />
          </View>
        )}
      </View>
      <View style={styles.chatRowContent}>
        <View style={styles.chatRowTop}>
          <Text style={styles.chatName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.chatDate}>{lastDate}</Text>
        </View>
        <View style={styles.chatRowBottom}>
          <Text style={styles.chatLastMessage} numberOfLines={1}>
            {lastMsg || ' '}
          </Text>
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unread > 99 ? '99+' : unread}
              </Text>
            </View>
          ) : null}
        </View>
        {item.contact ? (
          <View style={styles.tagRow}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{pt.contact}</Text>
            </View>
          </View>
        ) : null}
      </View>
      {item.user?.name ? (
        <View style={styles.workerLabel}>
          <View style={styles.workerLabelInner}>
            <Text style={styles.workerLabelText} numberOfLines={1}>
              {item.user.name}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function ChatListSkeleton() {
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
    <View style={styles.skeletonList}>
      <View style={styles.sectionHeader}>
        <Animated.View
          style={[styles.skeletonSectionTitle, { opacity }]}
        />
      </View>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={styles.chatRow}>
          <Animated.View
            style={[styles.skeletonAvatar, { opacity }]}
          />
          <View style={styles.skeletonContent}>
            <View style={styles.skeletonRowTop}>
              <Animated.View
                style={[styles.skeletonLine, styles.skeletonName, { opacity }]}
              />
              <Animated.View
                style={[styles.skeletonLine, styles.skeletonDate, { opacity }]}
              />
            </View>
            <Animated.View
              style={[styles.skeletonLine, styles.skeletonMessage, { opacity }]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChatListScreen({ route, navigation }: Props) {
  const { tab } = route.params;
  const {
    setHasAppliedAdvancedFilters,
    advancedFilterValues,
    setAdvancedFilterValues,
    clearAdvancedFilters,
  } = useChatFilter();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [queue, setQueue] = useState<ListChatsResult[]>([]);
  const [inChat, setInChat] = useState<ListChatsResult[]>([]);
  const [counts, setCounts] = useState<{ queue: number; in_chat: number }>({
    queue: 0,
    in_chat: 0,
  });
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [canUseUserAndSectorFilters, setCanUseUserAndSectorFilters] =
    useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(false);

  useEffect(() => {
    getUser().then((user) => {
      const info =
        user && typeof user === 'object'
          ? (user as { info?: { photo?: string | null } }).info
          : undefined;
      const photo = info && info.photo ? String(info.photo) : null;
      setUserPhoto(photo && photo !== 'null' ? photo : null);
    });
  }, []);

  useEffect(() => {
    getPermissions().then((permissions) => {
      setCanUseUserAndSectorFilters(checkUserSectorFilters(permissions));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const status = CHAT_STATUS[tab];
    const hasFilters = hasAppliedAdvancedFilters(advancedFilterValues);
    const hasSearchText = (search ?? '').trim().length > 0;
    const useSearch = hasFilters || hasSearchText;
    try {
      if (useSearch) {
        const res = await searchChats({
          search: search || '',
          status,
          current_page: 1,
          per_page: 50,
          filter_label_template_id:
            advancedFilterValues.filter_label_template_id,
          filter_worker_id: advancedFilterValues.filter_worker_id,
          filter_user_id: advancedFilterValues.filter_user_id,
          filter_sector_id: advancedFilterValues.filter_sector_id,
          filter_name: advancedFilterValues.filter_name,
          filter_phone: advancedFilterValues.filter_phone,
          filter_protocol: advancedFilterValues.filter_protocol,
          filter_date_start: advancedFilterValues.filter_date_start,
          filter_date_end: toNextDay(advancedFilterValues.filter_date_end),
          sort_field: advancedFilterValues.sort_field,
          sort_order: advancedFilterValues.sort_order,
        });
        if (res) {
          const results = res.results.filter(
            (r) => r.chat_id && r.chat_id.trim().length > 0
          );
          if (tab === 'queue') {
            setQueue(results);
            setInChat([]);
            setCounts((c) => ({ ...c, queue: res.counts?.queue ?? 0 }));
          } else if (tab === 'in_chat') {
            setInChat(results);
            setQueue([]);
            setCounts((c) => ({ ...c, in_chat: res.counts?.in_chat ?? 0 }));
          } else if (tab === 'closed') {
            setQueue(results);
            setInChat([]);
          } else {
            setInChat(results);
            setQueue([]);
          }
        } else {
          setQueue([]);
          setInChat([]);
        }
        setLoading(false);
        return;
      }
      if (tab === 'all') {
        const res = await listMyChats(1, 50, search || undefined);
        if (res) {
          const inChatList = res.results.filter((c) => c.status === 'in_chat');
          const queueList = res.results.filter((c) => c.status === 'queue');
          setInChat(inChatList);
          setQueue(queueList);
          setCounts({
            queue: res.counts?.queue ?? 0,
            in_chat: res.counts?.in_chat ?? 0,
          });
        }
      } else if (tab === 'queue') {
        const res = await listQueueChats(1, 50);
        if (res) {
          setQueue(res.results);
          setCounts((c) => ({ ...c, queue: res.counts?.queue ?? 0 }));
          setInChat([]);
        }
      } else if (tab === 'in_chat') {
        const res = await listInChatChats(1, 50);
        if (res) {
          setInChat(res.results);
          setCounts((c) => ({ ...c, in_chat: res.counts?.in_chat ?? 0 }));
          setQueue([]);
        }
      } else {
        const res = await listChats({
          status,
          current_page: 1,
          per_page: 50,
        });
        if (res) {
          if (tab === 'closed') {
            setQueue(res.results);
            setInChat([]);
          } else {
            setInChat(res.results);
            setQueue([]);
          }
        }
      }
    } catch {
      setQueue([]);
      setInChat([]);
    } finally {
      setLoading(false);
    }
  }, [tab, search, advancedFilterValues]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openChat = (chat: ListChatsResult) => {
    navigation.navigate('ChatRoom', { chat });
  };

  const sections: { title: string; data: ListChatsResult[] }[] = [];
  if (tab === 'closed') {
    sections.push({ title: pt.closed, data: queue });
  } else if (tab === 'chatbot') {
    sections.push({ title: pt.chatbot, data: inChat });
  } else {
    if (inChat.length > 0)
      sections.push({ title: pt.in_service, data: inChat });
    if (queue.length > 0)
      sections.push({ title: pt.awaiting_service, data: queue });
  }
  if (sections.length === 0) {
    let emptyTitle = pt.chatbot;
    if (tab === 'queue') emptyTitle = pt.awaiting_service;
    if (tab === 'in_chat') emptyTitle = pt.in_service;
    if (tab === 'closed') emptyTitle = pt.closed;
    sections.push({ title: emptyTitle, data: [] });
  }

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.avatarPlaceholder}
          onPress={() => setSidebarVisible(true)}
        >
          {(() => {
            const uri = resolveImageUri(userPhoto);
            return uri ? (
              <Image
                source={{ uri }}
                style={styles.headerAvatarImage}
                resizeMode="cover"
              />
            ) : (
            <Ionicons
              name="person-circle-outline"
              size={40}
              color={colors.grey400}
            />
          );
          })()}
        </Pressable>
        <TextInput
          style={styles.searchInput}
          placeholder={pt.search_service}
          placeholderTextColor={colors.grey500}
          value={search}
          onChangeText={setSearch}
        />
        <Pressable
          style={styles.filterBtn}
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons name="filter" size={22} color={colors.onSurface} />
        </Pressable>
        {hasAppliedAdvancedFilters(advancedFilterValues) ? (
          <Pressable
            style={styles.clearFilterBtn}
            onPress={() => {
              if (tab === 'closed') {
                (
                  navigation.getParent() as { navigate: (n: string) => void }
                )?.navigate('InChat');
              }
              clearAdvancedFilters();
            }}
            accessibilityLabel={pt.clear_filters}
          >
            <Ionicons name="close" size={16} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>
      <UserSidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />
      <AdvancedFilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        initialValues={{
          ...advancedFilterValues,
          filter_date_start: advancedFilterValues.filter_date_start ?? null,
          filter_date_end: advancedFilterValues.filter_date_end ?? null,
        }}
        onApply={(values) => {
          setAdvancedFilterValues(values);
          setHasAppliedAdvancedFilters(true);
          setFilterModalVisible(false);
        }}
        canUseUserAndSectorFilters={canUseUserAndSectorFilters}
      />
      {loading ? (
        <ChatListSkeleton />
      ) : sections.every((s) => s.data.length === 0) ? (
        <View style={styles.empty}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {sections[0]?.title ?? pt.chatbot}
            </Text>
          </View>
          <View style={styles.emptyContent}>
            <Ionicons
              name="chatbubbles-outline"
              size={64}
              color={colors.grey400}
              style={styles.emptyIcon}
            />
            <Text style={styles.emptyText}>
              {pt.no_conversations_found}
            </Text>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.chat_id}
          renderItem={({ item }) => (
            <ChatRow item={item} onPress={() => openChat(item)} />
          )}
          renderSectionHeader={({ section }) => (
            <SectionHeader title={section.title} />
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
        />
      )}
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
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.onSurface,
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
  skeletonList: {
    flex: 1,
    paddingBottom: 24,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.grey300,
    marginRight: 12,
  },
  skeletonContent: {
    flex: 1,
    minWidth: 0,
  },
  skeletonRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  skeletonLine: {
    backgroundColor: colors.grey300,
    borderRadius: 4,
  },
  skeletonName: {
    height: 14,
    width: '55%',
  },
  skeletonDate: {
    height: 12,
    width: 60,
  },
  skeletonMessage: {
    height: 12,
    width: '80%',
  },
  skeletonSectionTitle: {
    height: 16,
    width: 140,
    borderRadius: 4,
    backgroundColor: colors.grey300,
  },
  listContent: {
    paddingBottom: 24,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.grey50,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  chatAvatar: {
    marginRight: 12,
  },
  chatAvatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  chatAvatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.grey300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatRowContent: {
    flex: 1,
    minWidth: 0,
  },
  chatRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
    flex: 1,
  },
  chatDate: {
    fontSize: 12,
    color: colors.grey600,
  },
  chatRowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatLastMessage: {
    fontSize: 13,
    color: colors.grey600,
    flex: 1,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onError,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  tag: {
    backgroundColor: colors.tagBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    color: colors.tagText,
  },
  workerLabel: {
    width: 28,
    marginLeft: 8,
    marginRight: -12,
    marginBottom: -10,
    marginTop: -10,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(47, 43, 61, 0.06)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(47, 43, 61, 0.12)',
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerLabelInner: {
    transform: [{ rotate: '-90deg' }],
    width: 100,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerLabelText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.onSurface,
  },
  empty: {
    flex: 1,
  },
  emptyContent: {
    flex: 1,
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: colors.grey600,
    textAlign: 'center',
  },
});
