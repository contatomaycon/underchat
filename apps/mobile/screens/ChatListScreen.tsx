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
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import type { ListChatsResult } from '../types/chat';
import {
  listMyChats,
  listQueueChats,
  listChats,
  searchChats,
  clearChatSummary,
} from '../api/chatApi';
import {
  getUser,
  getPermissions,
  getSectors,
  getChannels,
  type UserChannel,
} from '../storage/authStorage';
import {
  canUseUserAndSectorFilters as checkUserSectorFilters,
  canPickQueueChat,
  canViewChat,
  canListAllChatsWithoutSectorLimit,
} from '../constants/chatAuthorization';
import { AdvancedFilterModal } from '../components/AdvancedFilterModal';
import type { AdvancedFilterValues } from '../components/AdvancedFilterModal';
import { UserSidebar } from '../components/UserSidebar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  useChatFilter,
  type ChatbotFilterStatus,
} from '../context/ChatFilterContext';
import { resolveImageUri } from '../utils/imageUri';
import {
  addChatSocketListener,
  type SocketChatPayload,
  type SocketChannelsUpdatedPayload,
} from '../socket/chatSocket';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;

const CHAT_STATUS = {
  all: 'my_chats' as const,
  queue: 'queue' as const,
  in_chat: 'in_chat' as const,
  chatbot: 'ura' as const,
};

const CHATBOT_FILTER_OPTIONS: Array<{
  value: ChatbotFilterStatus;
  label: string;
}> = [
  { value: 'ura', label: pt.chatbot_type_input },
  { value: 'ura_output', label: pt.chatbot_type_output },
  { value: 'ura_schedule', label: pt.chatbot_type_schedule },
  { value: 'ura_webhook', label: pt.chatbot_type_webhook },
];

function isDefaultChatbotFilterSelection(
  filters: ChatbotFilterStatus[]
): boolean {
  return filters.length === 1 && filters[0] === 'ura';
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  const parsed = readString(value);
  return parsed ? parsed.toLowerCase() : null;
}

function resolveUserId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as { id?: unknown; user_id?: unknown };
  return readIdentifier(user.id) ?? readIdentifier(user.user_id);
}

function resolveSocketChatId(data: SocketChatPayload): string | null {
  return readString((data as { chat_id?: unknown }).chat_id);
}

function resolveSocketChatUserId(data: SocketChatPayload): string | null {
  const user = (data as { user?: unknown }).user;
  return resolveUserId(user);
}

function resolveSocketChatSectorId(data: SocketChatPayload): string | null {
  const sector = (data as { sector?: unknown }).sector;
  if (!sector || typeof sector !== 'object') return null;
  return readString((sector as { id?: unknown }).id);
}

function resolveSocketChatWorkerId(data: SocketChatPayload): string | null {
  const worker = (data as { worker?: unknown }).worker;
  if (!worker || typeof worker !== 'object') return null;
  return readString((worker as { id?: unknown }).id);
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

function hasAdvancedFilterValues(values: AdvancedFilterValues): boolean {
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
  disabled = false,
  chatbotTypeLabel,
}: {
  item: ListChatsResult;
  onPress: () => void;
  disabled?: boolean;
  chatbotTypeLabel?: string | null;
}) {
  const name = item.name ?? item.contact?.name ?? item.phone ?? item.chat_id;
  const lastMsg = item.summary?.last_message ?? '';
  const lastDate = formatDate(item.summary?.last_date ?? item.date);
  const unread = item.summary?.unread_count ?? 0;
  const photo = item.photo ?? item.contact?.photo ?? null;
  const photoUri = resolveImageUri(photo);

  return (
    <Pressable
      style={[styles.chatRow, disabled && styles.chatRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityLabel={disabled ? pt.action_unavailable_by_permission : name}
    >
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
        {item.contact || chatbotTypeLabel ? (
          <View style={styles.tagRow}>
            {item.contact ? (
              <View style={styles.tag}>
                <Text style={styles.tagText}>{pt.contact}</Text>
              </View>
            ) : null}
            {chatbotTypeLabel ? (
              <View style={styles.chatbotTypeTag}>
                <Text style={styles.chatbotTypeTagText}>
                  {chatbotTypeLabel}
                </Text>
              </View>
            ) : null}
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
        <Animated.View style={[styles.skeletonSectionTitle, { opacity }]} />
      </View>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={styles.chatRow}>
          <Animated.View style={[styles.skeletonAvatar, { opacity }]} />
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
  const isFocused = useIsFocused();
  const {
    setHasAppliedAdvancedFilters,
    advancedFilterValues,
    setAdvancedFilterValues,
    inChatScope,
    setInChatScope,
    chatbotFilters,
    toggleChatbotFilter,
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
  const [socketPermissions, setSocketPermissions] = useState<string[]>([]);
  const [userSectors, setUserSectors] = useState<string[]>([]);
  const [userChannels, setUserChannels] = useState<UserChannel[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [canPickAnyQueueChat, setCanPickAnyQueueChat] = useState(false);
  const [profileSidebarVisible, setProfileSidebarVisible] = useState(false);
  const [isUserResolved, setIsUserResolved] = useState(false);
  const [isPermissionsResolved, setIsPermissionsResolved] = useState(false);
  const [isSectorsResolved, setIsSectorsResolved] = useState(false);
  const [isChannelsResolved, setIsChannelsResolved] = useState(false);
  const locallyClearedSummaryChatIdsRef = useRef<Set<string>>(new Set());
  const realtimeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const applyLocallyClearedUnreadOverrides = useCallback(
    (items: ListChatsResult[]): ListChatsResult[] => {
      if (items.length === 0) return items;

      const cleared = locallyClearedSummaryChatIdsRef.current;
      if (cleared.size === 0) return items;

      return items.map((item) => {
        if (!cleared.has(item.chat_id) || !item.summary) {
          return item;
        }

        if (item.summary.unread_count <= 0) {
          cleared.delete(item.chat_id);
          return item;
        }

        return {
          ...item,
          summary: {
            ...item.summary,
            unread_count: 0,
          },
        };
      });
    },
    []
  );

  const filterAuthorizedChats = useCallback(
    (items: ListChatsResult[]): ListChatsResult[] => {
      return items.filter((chat) =>
        canViewChat(chat, {
          permissions: socketPermissions,
          userId: currentUserId,
          userSectors,
          userChannels,
        })
      );
    },
    [currentUserId, socketPermissions, userSectors, userChannels]
  );

  useEffect(() => {
    getUser()
      .then((user) => {
        const info =
          user && typeof user === 'object'
            ? (user as { info?: { photo?: string | null } }).info
            : undefined;
        const photo = info && info.photo ? String(info.photo) : null;
        setUserPhoto(photo && photo !== 'null' ? photo : null);
        const userId =
          user && typeof user === 'object' ? resolveUserId(user) : null;
        setCurrentUserId(userId);
      })
      .finally(() => {
        setIsUserResolved(true);
      });
  }, []);

  useEffect(() => {
    getPermissions()
      .then((permissions) => {
        setCanUseUserAndSectorFilters(checkUserSectorFilters(permissions));
        setSocketPermissions(permissions);
        setCanPickAnyQueueChat(canPickQueueChat(permissions));
      })
      .finally(() => {
        setIsPermissionsResolved(true);
      });
  }, []);

  useEffect(() => {
    getSectors()
      .then((sectors) => {
        setUserSectors(sectors);
      })
      .finally(() => {
        setIsSectorsResolved(true);
      });
  }, []);

  useEffect(() => {
    getChannels()
      .then((channels) => {
        setUserChannels((prev) =>
          areChannelsEqual(prev, channels) ? prev : channels
        );
      })
      .finally(() => {
        setIsChannelsResolved(true);
      });
  }, []);

  const isAuthContextResolved =
    isUserResolved &&
    isPermissionsResolved &&
    isSectorsResolved &&
    isChannelsResolved;

  const load = useCallback(async () => {
    setLoading(true);
    const chatbotStatuses =
      chatbotFilters.length > 0 ? chatbotFilters : ['ura'];
    const status = tab === 'chatbot' ? chatbotStatuses : CHAT_STATUS[tab];
    const hasFilters = hasAdvancedFilterValues(advancedFilterValues);
    const hasSearchText = (search ?? '').trim().length > 0;
    const useSearch = hasFilters || hasSearchText;
    const inChatFilterUserId =
      tab === 'in_chat' && inChatScope === 'mine'
        ? currentUserId
        : advancedFilterValues.filter_user_id;
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
          filter_user_id: inChatFilterUserId,
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
          const visibleResults = filterAuthorizedChats(results);
          const resolvedResults =
            applyLocallyClearedUnreadOverrides(visibleResults);
          if (tab === 'queue') {
            setQueue(resolvedResults);
            setInChat([]);
            setCounts((c) => ({ ...c, queue: res.counts?.queue ?? 0 }));
          } else if (tab === 'in_chat') {
            setInChat(resolvedResults);
            setQueue([]);
            setCounts((c) => ({ ...c, in_chat: res.counts?.in_chat ?? 0 }));
          } else {
            setInChat(resolvedResults);
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
          const visibleResults = filterAuthorizedChats(res.results);
          const inChatList = visibleResults.filter(
            (c) => c.status === 'in_chat'
          );
          const queueList = visibleResults.filter((c) => c.status === 'queue');
          setInChat(applyLocallyClearedUnreadOverrides(inChatList));
          setQueue(applyLocallyClearedUnreadOverrides(queueList));
          setCounts({
            queue: res.counts?.queue ?? 0,
            in_chat: res.counts?.in_chat ?? 0,
          });
        }
      } else if (tab === 'queue') {
        const res = await listQueueChats(1, 50);
        if (res) {
          const visibleResults = filterAuthorizedChats(res.results);
          setQueue(applyLocallyClearedUnreadOverrides(visibleResults));
          setCounts((c) => ({ ...c, queue: res.counts?.queue ?? 0 }));
          setInChat([]);
        }
      } else if (tab === 'in_chat') {
        const res = await listChats({
          status: 'in_chat',
          current_page: 1,
          per_page: 50,
          filter_user_id: inChatScope === 'mine' ? currentUserId : undefined,
        });
        if (res) {
          const visibleResults = filterAuthorizedChats(res.results);
          setInChat(applyLocallyClearedUnreadOverrides(visibleResults));
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
          const visibleResults = filterAuthorizedChats(res.results);
          setInChat(applyLocallyClearedUnreadOverrides(visibleResults));
          setQueue([]);
        }
      }
    } catch {
      setQueue([]);
      setInChat([]);
    } finally {
      setLoading(false);
    }
  }, [
    tab,
    search,
    advancedFilterValues,
    chatbotFilters,
    inChatScope,
    currentUserId,
    applyLocallyClearedUnreadOverrides,
    filterAuthorizedChats,
  ]);

  const canReceiveChatNotification = useCallback(
    (chatData: SocketChatPayload): boolean => {
      const chatId = resolveSocketChatId(chatData);
      if (!chatId) return false;

      const chatExistsInList =
        queue.some((c) => c.chat_id === chatId) ||
        inChat.some((c) => c.chat_id === chatId);

      if (userChannels.length > 0 && !chatExistsInList) {
        const workerId = resolveSocketChatWorkerId(chatData);
        if (!workerId) {
          return false;
        }

        const userChannelIds = new Set(
          userChannels.map((channel) => channel.id)
        );
        if (!userChannelIds.has(workerId)) {
          return false;
        }
      }

      if (canListAllChatsWithoutSectorLimit(socketPermissions)) {
        return true;
      }

      if (chatExistsInList) {
        return true;
      }

      const chatUserId = resolveSocketChatUserId(chatData);
      if (chatUserId && currentUserId && chatUserId === currentUserId) {
        return true;
      }

      const status = readString((chatData as { status?: unknown }).status);
      const sectorId = resolveSocketChatSectorId(chatData);

      if (status === 'queue' && !sectorId && !chatUserId) {
        return true;
      }

      if (userSectors.length === 0) {
        return !sectorId;
      }

      if (!sectorId) {
        return false;
      }

      return userSectors.includes(sectorId);
    },
    [socketPermissions, queue, inChat, currentUserId, userSectors, userChannels]
  );

  const scheduleRealtimeReload = useCallback(() => {
    if (realtimeReloadTimer.current) {
      return;
    }
    realtimeReloadTimer.current = setTimeout(() => {
      realtimeReloadTimer.current = null;
      load();
    }, 250);
  }, [load]);

  useEffect(() => {
    if (!isFocused || !isAuthContextResolved) {
      if (!isAuthContextResolved) {
        setLoading(true);
      }
      return;
    }

    load();
  }, [isFocused, isAuthContextResolved, load]);

  useFocusEffect(
    useCallback(() => {
      const offMessage = addChatSocketListener('message', (payload) => {
        locallyClearedSummaryChatIdsRef.current.delete(payload.chat_id);
        scheduleRealtimeReload();
      });

      const offChatUpdate = addChatSocketListener('chatUpdate', (chatData) => {
        if (!canReceiveChatNotification(chatData)) {
          return;
        }
        scheduleRealtimeReload();
      });
      const offRecoveryFailed = addChatSocketListener('recoveryFailed', () => {
        scheduleRealtimeReload();
      });
      const offChannelsUpdated = addChatSocketListener(
        'channelsUpdated',
        (payload: SocketChannelsUpdatedPayload) => {
          if (!currentUserId) return;
          if (readIdentifier(payload.user_id) !== currentUserId) {
            return;
          }

          setUserChannels((prev) =>
            areChannelsEqual(prev, payload.channels) ? prev : payload.channels
          );
          scheduleRealtimeReload();
        }
      );

      return () => {
        offMessage();
        offChatUpdate();
        offRecoveryFailed();
        offChannelsUpdated();
        if (realtimeReloadTimer.current) {
          clearTimeout(realtimeReloadTimer.current);
          realtimeReloadTimer.current = null;
        }
      };
    }, [canReceiveChatNotification, currentUserId, scheduleRealtimeReload])
  );

  const openChat = (
    chat: ListChatsResult,
    queueIndex: number | null = null
  ) => {
    const canOpenByVisibility = canViewChat(chat, {
      permissions: socketPermissions,
      userId: currentUserId,
      userSectors,
      userChannels,
    });
    if (!canOpenByVisibility) {
      return;
    }

    if (
      chat.status === 'queue' &&
      !canPickAnyQueueChat &&
      queueIndex !== null &&
      queueIndex !== 0
    ) {
      return;
    }

    const chatUserId = resolveUserId(chat.user);
    const shouldClearSummary =
      chat.status === 'in_chat' &&
      !!currentUserId &&
      chatUserId === currentUserId;

    if (shouldClearSummary) {
      locallyClearedSummaryChatIdsRef.current.add(chat.chat_id);
      setQueue((prev) =>
        prev.map((item) =>
          item.chat_id === chat.chat_id && item.summary
            ? {
                ...item,
                summary: {
                  ...item.summary,
                  unread_count: 0,
                },
              }
            : item
        )
      );
      setInChat((prev) =>
        prev.map((item) =>
          item.chat_id === chat.chat_id && item.summary
            ? {
                ...item,
                summary: {
                  ...item.summary,
                  unread_count: 0,
                },
              }
            : item
        )
      );
      void clearChatSummary(chat.chat_id);
    }

    navigation.push('ChatRoom', { chat });
  };

  const chatbotTypeLabelByStatus = useCallback(
    (status: ListChatsResult['status']): string | null => {
      if (status === 'ura') return pt.chatbot_type_input;
      if (status === 'ura_output') return pt.chatbot_type_output;
      if (status === 'ura_schedule') return pt.chatbot_type_schedule;
      if (status === 'ura_webhook') return pt.chatbot_type_webhook;
      return null;
    },
    []
  );

  const sections: { title: string; data: ListChatsResult[] }[] = [];
  if (tab === 'chatbot') {
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
    sections.push({ title: emptyTitle, data: [] });
  }

  const hasAdvancedFiltersApplied =
    hasAdvancedFilterValues(advancedFilterValues);

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.avatarPlaceholder}
          onPress={() => setProfileSidebarVisible(true)}
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
        {hasAdvancedFiltersApplied ? (
          <Pressable
            style={styles.clearFilterBtn}
            onPress={() => {
              clearAdvancedFilters();
            }}
            accessibilityLabel={pt.clear_filters}
          >
            <Ionicons name="close" size={16} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>
      {tab === 'in_chat' ? (
        <View style={styles.quickFilterRow}>
          <Pressable
            style={[
              styles.quickFilterChip,
              inChatScope === 'all' && styles.quickFilterChipActive,
            ]}
            onPress={() => setInChatScope('all')}
          >
            <Text
              style={[
                styles.quickFilterChipText,
                inChatScope === 'all' && styles.quickFilterChipTextActive,
              ]}
            >
              {pt.all_attendances}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.quickFilterChip,
              inChatScope === 'mine' && styles.quickFilterChipActive,
            ]}
            onPress={() => setInChatScope('mine')}
          >
            <Text
              style={[
                styles.quickFilterChipText,
                inChatScope === 'mine' && styles.quickFilterChipTextActive,
              ]}
            >
              {pt.my_attendances}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {tab === 'chatbot' ? (
        <View style={styles.quickFilterRowWrap}>
          {CHATBOT_FILTER_OPTIONS.map((option) => {
            const active = chatbotFilters.includes(option.value);
            return (
              <Pressable
                key={option.value}
                style={[
                  styles.quickFilterChip,
                  active && styles.quickFilterChipActive,
                ]}
                onPress={() => toggleChatbotFilter(option.value)}
              >
                <Text
                  style={[
                    styles.quickFilterChipText,
                    active && styles.quickFilterChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <UserSidebar
        visible={profileSidebarVisible}
        onClose={() => setProfileSidebarVisible(false)}
        onProfileUpdated={(nextPhoto) => setUserPhoto(nextPhoto)}
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
          setHasAppliedAdvancedFilters(hasAdvancedFilterValues(values));
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
            <Text style={styles.emptyText}>{pt.no_conversations_found}</Text>
          </View>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.chat_id}
          renderItem={({ item, index }) => {
            const isQueueItemLocked =
              item.status === 'queue' && !canPickAnyQueueChat && index !== 0;
            const canOpenByVisibility = canViewChat(item, {
              permissions: socketPermissions,
              userId: currentUserId,
              userSectors,
              userChannels,
            });

            return (
              <ChatRow
                item={item}
                chatbotTypeLabel={
                  tab === 'chatbot'
                    ? chatbotTypeLabelByStatus(item.status)
                    : null
                }
                disabled={isQueueItemLocked || !canOpenByVisibility}
                onPress={() =>
                  openChat(item, item.status === 'queue' ? index : null)
                }
              />
            );
          }}
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
  quickFilterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  quickFilterRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  quickFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickFilterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickFilterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.onSurface,
  },
  quickFilterChipTextActive: {
    color: colors.onPrimary,
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
  chatRowDisabled: {
    opacity: 0.55,
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
  chatbotTypeTag: {
    backgroundColor: colors.grey100,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  chatbotTypeTagText: {
    fontSize: 11,
    color: colors.grey700,
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
