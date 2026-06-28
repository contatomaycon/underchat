import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppAvatar } from '../components/AppAvatar';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { OpeningConversationModal } from '../components/OpeningConversationModal';
import { useInternalChat } from '../context/InternalChatContext';
import { getPermissions, getUser, patchUser } from '../storage/authStorage';
import { canCreateInternalChatGroup } from '../constants/chatAuthorization';
import type { InternalChatStackParamList } from '../navigation/types';
import type {
  InternalChatConversation,
  InternalChatNotificationSettings,
  InternalChatNotificationSettingsPayload,
  InternalChatTab,
  InternalChatUser,
} from '../types/internalChat';
import {
  getInternalChatNotificationSettings,
  updateInternalChatNotificationSettings,
} from '../api/internalChatApi';
import {
  disableMobilePushNotifications,
  enableMobilePushNotifications,
  isAnyMobilePushPreferenceEnabled,
} from '../services/pushNotifications';
import {
  INTERNAL_CHAT_CONVERSATION_TYPE,
  INTERNAL_CHAT_TAB,
} from '../types/internalChat';
import { colors } from '../theme/colors';
import { pt } from '../locales/pt';
import {
  ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET,
  dismissKeyboard,
  dismissKeyboardAnd,
  getModalKeyboardVerticalOffset,
  keyboardAvoidingBehavior,
  modalKeyboardAvoidingBehavior,
} from '../utils/keyboard';
import { resolveInternalChatTextTag } from '../utils/internalChatText';
import { addSessionUpdatedListener } from '../utils/appResumeBus';

type Navigation = NativeStackNavigationProp<InternalChatStackParamList>;

const OPTIONS: Array<{
  tab: InternalChatTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { tab: INTERNAL_CHAT_TAB.users, label: 'Nova conversa', icon: 'add' },
  { tab: INTERNAL_CHAT_TAB.all, label: 'Todos', icon: 'list' },
  {
    tab: INTERNAL_CHAT_TAB.direct,
    label: 'Diretas',
    icon: 'chatbubble-outline',
  },
  { tab: INTERNAL_CHAT_TAB.group, label: 'Grupos', icon: 'people-outline' },
];

function formatConversationDate(date: string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  if (parsed.toDateString() === now.toDateString()) {
    return parsed.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (parsed.toDateString() === yesterday.toDateString()) {
    return 'Ontem';
  }
  return parsed.toLocaleDateString('pt-BR');
}

function resolveConversationTitle(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string {
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) {
    return conversation.name?.trim() || 'Grupo';
  }
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.name || conversation.name || 'Conversa';
}

function resolveConversationPhoto(
  conversation: InternalChatConversation,
  currentUserId: string | null
): string | null {
  if (conversation.photo) return conversation.photo;
  if (conversation.type === INTERNAL_CHAT_CONVERSATION_TYPE.group) return null;
  const otherParticipant =
    conversation.participants.find((item) => item.user_id !== currentUserId) ??
    conversation.participants[0];
  return otherParticipant?.photo ?? null;
}

function resolveAssetName(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName && asset.fileName.trim()) return asset.fileName;
  const extension = asset.mimeType?.split('/')[1] || 'jpg';
  return `grupo-${Date.now()}.${extension}`;
}

const DEFAULT_INTERNAL_CHAT_NOTIFICATION_SETTINGS: InternalChatNotificationSettings =
  {
    notifications_internal_chat: true,
    notifications_internal_chat_direct: true,
    notifications_internal_chat_group: true,
    notifications_internal_chat_sound: true,
    notifications_internal_chat_toast: true,
    notifications_internal_chat_browser: true,
    notifications_internal_chat_push: true,
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readBooleanDefaultTrue(value: unknown): boolean {
  return value !== false;
}

function readInternalChatNotificationSettingsFromUser(
  user: unknown
): InternalChatNotificationSettings {
  const chatUser =
    isRecord(user) && isRecord(user.chat_user) ? user.chat_user : {};

  return {
    chat_user_id:
      typeof chatUser.chat_user_id === 'string'
        ? chatUser.chat_user_id
        : undefined,
    notifications_internal_chat: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat
    ),
    notifications_internal_chat_direct: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_direct
    ),
    notifications_internal_chat_group: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_group
    ),
    notifications_internal_chat_sound: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_sound
    ),
    notifications_internal_chat_toast: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_toast
    ),
    notifications_internal_chat_browser: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_browser
    ),
    notifications_internal_chat_push: readBooleanDefaultTrue(
      chatUser.notifications_internal_chat_push
    ),
  };
}

function shouldUseInternalChatPush(
  settings: InternalChatNotificationSettingsPayload
): boolean {
  return (
    settings.notifications_internal_chat !== false &&
    settings.notifications_internal_chat_push !== false
  );
}

type InternalChatNotificationSettingKey = Exclude<
  keyof InternalChatNotificationSettings,
  'chat_user_id'
>;

function InternalChatNotificationSettingsSheet({
  visible,
  settings,
  loading,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  settings: InternalChatNotificationSettings;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (settings: InternalChatNotificationSettingsPayload) => void;
}) {
  const [draft, setDraft] = useState<InternalChatNotificationSettings>(
    DEFAULT_INTERNAL_CHAT_NOTIFICATION_SETTINGS
  );

  useEffect(() => {
    if (visible) {
      setDraft(settings);
    }
  }, [settings, visible]);

  const updateDraft = useCallback(
    (key: InternalChatNotificationSettingKey, value: boolean) => {
      setDraft((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const renderOption = (
    key: InternalChatNotificationSettingKey,
    title: string,
    description: string,
    icon: keyof typeof Ionicons.glyphMap,
    disabled = false
  ) => {
    const enabled = draft[key] !== false;
    return (
      <Pressable
        key={key}
        style={[styles.notificationOption, disabled && styles.optionDisabled]}
        onPress={() => {
          if (!disabled && !saving && !loading) {
            updateDraft(key, !enabled);
          }
        }}
        disabled={disabled || saving || loading}
      >
        <View style={styles.notificationOptionIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <View style={styles.notificationOptionText}>
          <Text style={styles.notificationOptionTitle}>{title}</Text>
          <Text style={styles.notificationOptionDescription}>
            {description}
          </Text>
        </View>
        <View
          style={[
            styles.notificationSwitch,
            enabled && styles.notificationSwitchOn,
          ]}
        >
          <View
            style={[
              styles.notificationSwitchThumb,
              enabled && styles.notificationSwitchThumbOn,
            ]}
          />
        </View>
      </Pressable>
    );
  };

  const childOptionsDisabled =
    saving || loading || draft.notifications_internal_chat === false;

  return (
    <BottomSheetModal
      visible={visible}
      onClose={onClose}
      title="Notificações"
      footer={
        <>
          <Pressable
            style={styles.sheetCancelBtn}
            onPress={onClose}
            disabled={saving}
          >
            <Text style={styles.sheetCancelText}>{pt.cancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.sheetSaveBtn, saving && styles.primaryBtnDisabled]}
            onPress={() => onSave(draft)}
            disabled={saving || loading}
          >
            {saving ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.sheetSaveText}>{pt.save}</Text>
            )}
          </Pressable>
        </>
      }
    >
      {loading ? (
        <View style={styles.notificationLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.notificationLoadingText}>
            Carregando configurações...
          </Text>
        </View>
      ) : (
        <View style={styles.notificationContent}>
          {renderOption(
            'notifications_internal_chat',
            'Habilitar notificações',
            'Controla todos os avisos do Chat Interno.',
            'notifications-outline'
          )}

          <Text style={styles.notificationSectionTitle}>Conversas</Text>
          {renderOption(
            'notifications_internal_chat_direct',
            'Mensagens diretas',
            'Receber avisos de conversas individuais.',
            'chatbubble-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_internal_chat_group',
            'Grupos',
            'Receber avisos de mensagens em grupos.',
            'people-outline',
            childOptionsDisabled
          )}

          <Text style={styles.notificationSectionTitle}>Entrega</Text>
          {renderOption(
            'notifications_internal_chat_sound',
            'Som',
            'Tocar alerta sonoro quando disponível.',
            'volume-high-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_internal_chat_toast',
            'Alerta na tela',
            'Mostrar aviso enquanto o app estiver aberto.',
            'albums-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_internal_chat_push',
            'Push em segundo plano',
            'Receber notificação quando o app estiver fechado.',
            'phone-portrait-outline',
            childOptionsDisabled
          )}
        </View>
      )}
    </BottomSheetModal>
  );
}

function useSkeletonOpacity() {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 600,
          useNativeDriver,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function InternalChatListSkeleton({ rows = 8 }: { rows?: number }) {
  const opacity = useSkeletonOpacity();

  return (
    <View style={styles.skeletonList}>
      {Array.from({ length: rows }, (_, index) => (
        <View key={`internal-list-skeleton-${index}`} style={styles.row}>
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

function InternalChatLoadMoreSkeleton() {
  const opacity = useSkeletonOpacity();

  return (
    <View style={styles.loadMoreSkeletonList}>
      {Array.from({ length: 3 }, (_, index) => (
        <View key={`internal-load-more-skeleton-${index}`} style={styles.row}>
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

function InternalChatMemberSkeleton({ rows = 5 }: { rows?: number }) {
  const opacity = useSkeletonOpacity();

  return (
    <View style={styles.memberSkeletonList}>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={`internal-member-skeleton-${index}`}
          style={styles.memberRow}
        >
          <Animated.View style={[styles.memberSkeletonAvatar, { opacity }]} />
          <View style={styles.skeletonContent}>
            <Animated.View
              style={[
                styles.skeletonLine,
                styles.memberSkeletonName,
                { opacity },
              ]}
            />
            <Animated.View
              style={[
                styles.skeletonLine,
                styles.memberSkeletonSub,
                { opacity },
              ]}
            />
          </View>
          <Animated.View style={[styles.memberSkeletonIcon, { opacity }]} />
        </View>
      ))}
    </View>
  );
}

export function InternalChatListScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const {
    currentUserId,
    state,
    loadingConversations,
    loadingUsers,
    totalUnread,
    loadConversations,
    loadUsers,
    openConversation,
    openDirect,
    createGroup,
  } = useInternalChat();

  const [activeTab, setActiveTab] = useState<InternalChatTab>(
    INTERNAL_CHAT_TAB.all
  );
  const [search, setSearch] = useState('');
  const [canCreateGroup, setCanCreateGroup] = useState(false);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupPhoto, setGroupPhoto] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [notificationSheetVisible, setNotificationSheetVisible] =
    useState(false);
  const [notificationSettings, setNotificationSettings] =
    useState<InternalChatNotificationSettings>(
      DEFAULT_INTERNAL_CHAT_NOTIFICATION_SETTINGS
    );
  const [notificationSettingsLoading, setNotificationSettingsLoading] =
    useState(false);
  const [notificationSettingsSaving, setNotificationSettingsSaving] =
    useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [openingConversationId, setOpeningConversationId] = useState<
    string | null
  >(null);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [listLoadMode, setListLoadMode] = useState<'full' | 'page' | null>(
    'full'
  );
  const listLoadTokenRef = useRef(0);

  const openingChat = !!openingConversationId || !!openingUserId;

  useEffect(() => {
    let cancelled = false;
    void getPermissions().then((permissions) => {
      if (!cancelled) {
        setCanCreateGroup(canCreateInternalChatGroup(permissions));
      }
    });
    void getUser().then((user) => {
      if (!cancelled) {
        setNotificationSettings(
          readInternalChatNotificationSettingsFromUser(user)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return addSessionUpdatedListener(() => {
      void getPermissions().then((permissions) => {
        setCanCreateGroup(canCreateInternalChatGroup(permissions));
      });
      void getUser().then((user) => {
        setNotificationSettings(
          readInternalChatNotificationSettingsFromUser(user)
        );
      });
    });
  }, []);

  useEffect(() => {
    const token = ++listLoadTokenRef.current;
    setListLoadMode('full');

    const timer = setTimeout(() => {
      const run = async () => {
        try {
          if (activeTab === INTERNAL_CHAT_TAB.users) {
            await loadUsers({ search, page: 1, append: false });
            return;
          }
          await loadConversations({
            tab: activeTab,
            search,
            page: 1,
            append: false,
          });
        } finally {
          if (listLoadTokenRef.current === token) {
            setListLoadMode(null);
          }
        }
      };

      void run().catch(() => undefined);
    }, 250);

    return () => clearTimeout(timer);
  }, [activeTab, loadConversations, loadUsers, search]);

  const conversations = state.conversations;
  const users = state.users;
  const showingUsers = activeTab === INTERNAL_CHAT_TAB.users;
  const listLoading = showingUsers ? loadingUsers : loadingConversations;
  const listItemsCount = showingUsers ? users.length : conversations.length;
  const showListSkeleton =
    listLoadMode === 'full' ||
    (listLoading && listItemsCount === 0 && listLoadMode !== 'page');
  const showListFooterSkeleton = listLoadMode === 'page';

  const optionTitle = useMemo(() => {
    return OPTIONS.find((item) => item.tab === activeTab)?.label ?? 'Todos';
  }, [activeTab]);

  const startFullListLoading = useCallback(() => {
    listLoadTokenRef.current += 1;
    setListLoadMode('full');
  }, []);

  const handleTabChange = useCallback(
    (tab: InternalChatTab) => {
      if (tab === activeTab) return;
      startFullListLoading();
      setActiveTab(tab);
    },
    [activeTab, startFullListLoading]
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      startFullListLoading();
      setSearch(value);
    },
    [startFullListLoading]
  );

  const clearSearch = useCallback(() => {
    if (!search) return;
    startFullListLoading();
    setSearch('');
  }, [search, startFullListLoading]);

  const handleOpenConversation = useCallback(
    async (conversation: InternalChatConversation) => {
      if (openingChat) return;
      setOpeningConversationId(conversation.conversation_id);
      try {
        const opened = await openConversation(conversation.conversation_id);
        if (opened) {
          navigation.navigate('InternalChatRoom', { conversation: opened });
          return;
        }
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } catch {
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } finally {
        setOpeningConversationId(null);
      }
    },
    [navigation, openConversation, openingChat]
  );

  const handleOpenDirect = useCallback(
    async (user: InternalChatUser) => {
      if (openingChat) return;
      setOpeningUserId(user.user_id);
      try {
        const conversation = await openDirect(user.user_id);
        if (conversation) {
          navigation.navigate('InternalChatRoom', { conversation });
          return;
        }
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } catch {
        Alert.alert(pt.error_title, 'Não foi possível abrir a conversa.');
      } finally {
        setOpeningUserId(null);
      }
    },
    [navigation, openDirect, openingChat]
  );

  const loadMoreConversations = useCallback(() => {
    if (loadingConversations || listLoadMode !== null) return;
    const paging = state.conversationsPaging;
    if (paging.current_page >= paging.total_pages) return;
    const token = ++listLoadTokenRef.current;
    setListLoadMode('page');
    void loadConversations({
      tab: activeTab,
      search,
      page: paging.current_page + 1,
      append: true,
    })
      .catch(() => undefined)
      .finally(() => {
        if (listLoadTokenRef.current === token) {
          setListLoadMode(null);
        }
      });
  }, [
    activeTab,
    listLoadMode,
    loadConversations,
    loadingConversations,
    search,
    state.conversationsPaging,
  ]);

  const loadMoreUsers = useCallback(() => {
    if (loadingUsers || listLoadMode !== null) return;
    const paging = state.usersPaging;
    if (paging.current_page >= paging.total_pages) return;
    const token = ++listLoadTokenRef.current;
    setListLoadMode('page');
    void loadUsers({
      search,
      page: paging.current_page + 1,
      append: true,
    })
      .catch(() => undefined)
      .finally(() => {
        if (listLoadTokenRef.current === token) {
          setListLoadMode(null);
        }
      });
  }, [listLoadMode, loadUsers, loadingUsers, search, state.usersPaging]);

  const toggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((current) =>
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId]
    );
  }, []);

  const pickGroupPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    setGroupPhoto({
      uri: asset.uri,
      name: resolveAssetName(asset),
      mimeType: asset.mimeType || 'image/jpeg',
    });
  }, []);

  const closeGroupModal = useCallback(() => {
    if (creatingGroup) return;
    setGroupModalVisible(false);
    setGroupName('');
    setSelectedMemberIds([]);
    setGroupPhoto(null);
  }, [creatingGroup]);

  const openNotificationSheet = useCallback(() => {
    setNotificationSheetVisible(true);
    setNotificationSettingsLoading(true);

    void getInternalChatNotificationSettings()
      .then((settings) => {
        if (settings) {
          setNotificationSettings(settings);
          void patchUser({ chat_user: settings });
        }
      })
      .catch(() => {
        Alert.alert(pt.error_title, 'Não foi possível carregar notificações.');
      })
      .finally(() => {
        setNotificationSettingsLoading(false);
      });
  }, []);

  const closeNotificationSheet = useCallback(() => {
    if (notificationSettingsSaving) return;
    setNotificationSheetVisible(false);
  }, [notificationSettingsSaving]);

  const saveNotificationSettings = useCallback(
    async (nextSettings: InternalChatNotificationSettingsPayload) => {
      if (notificationSettingsSaving) return;

      setNotificationSettingsSaving(true);

      try {
        if (shouldUseInternalChatPush(nextSettings)) {
          const result = await enableMobilePushNotifications();

          if (!result.ok) {
            Alert.alert(
              pt.warning_title,
              result.reason === 'permission_denied'
                ? pt.notification_permission_denied
                : pt.notification_enable_error
            );
            return;
          }
        }

        const updated =
          await updateInternalChatNotificationSettings(nextSettings);

        if (!updated) {
          Alert.alert(
            pt.error_title,
            'Não foi possível salvar as notificações.'
          );
          return;
        }

        setNotificationSettings(updated);
        await patchUser({ chat_user: updated });

        const userAfterUpdate = await getUser().catch(() => null);
        if (!isAnyMobilePushPreferenceEnabled(userAfterUpdate)) {
          await disableMobilePushNotifications().catch(() => false);
        }

        setNotificationSheetVisible(false);
      } finally {
        setNotificationSettingsSaving(false);
      }
    },
    [notificationSettingsSaving]
  );

  const submitCreateGroup = useCallback(async () => {
    const normalizedName = groupName.trim();
    if (!normalizedName) {
      Alert.alert(pt.warning_title, 'Informe o nome do grupo.');
      return;
    }
    if (selectedMemberIds.length === 0) {
      Alert.alert(pt.warning_title, 'Selecione pelo menos um membro.');
      return;
    }
    setCreatingGroup(true);
    try {
      const conversation = await createGroup({
        name: normalizedName,
        member_user_ids: selectedMemberIds,
        photoUri: groupPhoto?.uri ?? null,
        photoName: groupPhoto?.name ?? null,
        photoMimeType: groupPhoto?.mimeType ?? null,
      });
      if (!conversation) {
        Alert.alert(pt.error_title, 'Não foi possível criar o grupo.');
        return;
      }
      closeGroupModal();
      navigation.navigate('InternalChatRoom', { conversation });
    } finally {
      setCreatingGroup(false);
    }
  }, [
    closeGroupModal,
    createGroup,
    groupName,
    groupPhoto,
    navigation,
    selectedMemberIds,
  ]);

  const renderConversation: ListRenderItem<InternalChatConversation> =
    useCallback(
      ({ item }) => {
        const title = resolveConversationTitle(item, currentUserId);
        const photo = resolveConversationPhoto(item, currentUserId);
        const opening = openingConversationId === item.conversation_id;
        const preview =
          resolveInternalChatTextTag(item.last_message_preview) ||
          (item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group
            ? 'Atualização do grupo'
            : 'Conversa direta');

        return (
          <Pressable
            style={[styles.row, opening && styles.rowOpening]}
            onPress={() => void handleOpenConversation(item)}
            disabled={openingChat}
          >
            <AppAvatar
              uri={photo}
              size={48}
              iconName={
                item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group
                  ? 'people'
                  : 'person'
              }
            />
            <View style={styles.rowContent}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.rowDate}>
                  {formatConversationDate(item.last_message_at)}
                </Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewText} numberOfLines={1}>
                  {preview}
                </Text>
                {item.type === INTERNAL_CHAT_CONVERSATION_TYPE.group ? (
                  <View style={styles.groupBadge}>
                    <Ionicons
                      name="people-outline"
                      size={11}
                      color={colors.primary}
                    />
                    <Text style={styles.groupBadgeText}>Grupo</Text>
                  </View>
                ) : null}
              </View>
            </View>
            {opening ? (
              <ActivityIndicator color={colors.primary} />
            ) : item.unread_count > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>
                  {item.unread_count > 99 ? '99+' : item.unread_count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      },
      [
        currentUserId,
        handleOpenConversation,
        openingChat,
        openingConversationId,
      ]
    );

  const renderUser: ListRenderItem<InternalChatUser> = useCallback(
    ({ item }) => {
      const opening = openingUserId === item.user_id;

      return (
        <Pressable
          style={[styles.row, opening && styles.rowOpening]}
          onPress={() => void handleOpenDirect(item)}
          disabled={openingChat}
        >
          <AppAvatar uri={item.photo} size={48} />
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {item.email || item.sector || item.position ? (
              <Text style={styles.previewText} numberOfLines={1}>
                {[item.email, item.sector, item.position]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
            ) : null}
          </View>
          {opening ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons
              name="chatbubble-outline"
              size={22}
              color={colors.primary}
            />
          )}
        </Pressable>
      );
    },
    [handleOpenDirect, openingChat, openingUserId]
  );

  const listEmpty = (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyIcon}>
        <Ionicons
          name={
            activeTab === INTERNAL_CHAT_TAB.users
              ? 'person-add-outline'
              : 'chatbubbles-outline'
          }
          size={28}
          color={colors.primary}
        />
      </View>
      <Text style={styles.emptyText}>
        {activeTab === INTERNAL_CHAT_TAB.users
          ? 'Nenhum usuário encontrado'
          : activeTab === INTERNAL_CHAT_TAB.direct
            ? 'Nenhuma conversa direta'
            : activeTab === INTERNAL_CHAT_TAB.group
              ? 'Nenhum grupo encontrado'
              : 'Nenhuma conversa encontrada'}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={keyboardAvoidingBehavior}
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerTitleIcon}>
            <Ionicons name="people" size={20} color={colors.primary} />
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Chat Interno</Text>
            <Text style={styles.headerSubtitle}>
              {totalUnread > 0
                ? `${totalUnread} não lida${totalUnread > 1 ? 's' : ''}`
                : optionTitle}
            </Text>
          </View>
          <Pressable
            style={styles.headerAction}
            onPress={openNotificationSheet}
            accessibilityLabel="Configurar notificações"
          >
            <Ionicons
              name={
                notificationSettings.notifications_internal_chat !== false
                  ? 'notifications-outline'
                  : 'notifications-off-outline'
              }
              size={20}
              color={colors.primary}
            />
          </Pressable>
          {canCreateGroup ? (
            <Pressable
              style={styles.headerAction}
              onPress={() => {
                setGroupModalVisible(true);
                void loadUsers({ page: 1, append: false });
              }}
              accessibilityLabel="Criar grupo"
            >
              <Ionicons
                name="person-add-outline"
                size={20}
                color={colors.primary}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.grey500} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={handleSearchChange}
            placeholder={
              activeTab === INTERNAL_CHAT_TAB.users
                ? 'Pesquisar usuários'
                : 'Pesquisar conversas'
            }
            placeholderTextColor={colors.grey500}
            returnKeyType="search"
          />
          {search.trim() ? (
            <Pressable onPress={clearSearch} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={colors.grey500} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.optionsGrid}>
          {OPTIONS.map((option) => {
            const active = option.tab === activeTab;
            return (
              <Pressable
                key={option.tab}
                style={[styles.optionBtn, active && styles.optionBtnActive]}
                onPress={() => handleTabChange(option.tab)}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={active ? colors.onPrimary : colors.primary}
                />
                <Text
                  style={[styles.optionText, active && styles.optionTextActive]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {showListSkeleton ? (
        <InternalChatListSkeleton />
      ) : activeTab === INTERNAL_CHAT_TAB.users ? (
        <FlatList
          data={users}
          keyExtractor={(item) => item.user_id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreUsers}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={!loadingUsers ? listEmpty : null}
          ListFooterComponent={
            showListFooterSkeleton ? <InternalChatLoadMoreSkeleton /> : null
          }
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.conversation_id}
          renderItem={renderConversation}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={loadMoreConversations}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={!loadingConversations ? listEmpty : null}
          ListFooterComponent={
            showListFooterSkeleton ? <InternalChatLoadMoreSkeleton /> : null
          }
        />
      )}

      <OpeningConversationModal visible={openingChat} variant="internal" />

      <InternalChatNotificationSettingsSheet
        visible={notificationSheetVisible}
        settings={notificationSettings}
        loading={notificationSettingsLoading}
        saving={notificationSettingsSaving}
        onClose={closeNotificationSheet}
        onSave={saveNotificationSettings}
      />

      <Modal
        visible={groupModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeGroupModal}
      >
        <View style={[styles.modalOverlay, { paddingBottom: insets.bottom }]}>
          <Pressable style={styles.backdrop} onPress={dismissKeyboard} />
          <KeyboardAvoidingView
            behavior={modalKeyboardAvoidingBehavior}
            keyboardVerticalOffset={getModalKeyboardVerticalOffset(
              8,
              ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET
            )}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Novo grupo</Text>
              <Pressable onPress={closeGroupModal} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.grey700} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Pressable style={styles.photoPicker} onPress={pickGroupPhoto}>
                <AppAvatar
                  uri={groupPhoto?.uri ?? null}
                  size={58}
                  iconName="people"
                />
                <Text style={styles.photoPickerText}>
                  {groupPhoto ? 'Alterar foto' : 'Selecionar foto'}
                </Text>
              </Pressable>
              <Text style={styles.inputLabel}>Nome do grupo</Text>
              <TextInput
                style={styles.input}
                value={groupName}
                onChangeText={setGroupName}
                placeholder="Digite o nome"
                placeholderTextColor={colors.grey500}
              />
              <View style={styles.membersHeader}>
                <Text style={styles.inputLabel}>Membros</Text>
                <Text style={styles.membersCount}>
                  {selectedMemberIds.length} selecionado
                  {selectedMemberIds.length === 1 ? '' : 's'}
                </Text>
              </View>
              {loadingUsers && users.length === 0 ? (
                <InternalChatMemberSkeleton />
              ) : (
                users.map((user) => {
                  const selected = selectedMemberIds.includes(user.user_id);
                  return (
                    <Pressable
                      key={user.user_id}
                      style={styles.memberRow}
                      onPress={() => toggleMember(user.user_id)}
                    >
                      <AppAvatar uri={user.photo} size={40} />
                      <Text style={styles.memberName} numberOfLines={1}>
                        {user.name}
                      </Text>
                      <Ionicons
                        name={selected ? 'checkbox' : 'square-outline'}
                        size={24}
                        color={selected ? colors.primary : colors.grey500}
                      />
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={closeGroupModal}>
                <Text style={styles.cancelText}>{pt.cancel}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.primaryBtn,
                  creatingGroup && styles.primaryBtnDisabled,
                ]}
                onPress={dismissKeyboardAnd(submitCreateGroup)}
                disabled={creatingGroup}
              >
                {creatingGroup ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.primaryText}>Criar grupo</Text>
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  headerTitleIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF2FF',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onSurface,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.grey600,
    marginTop: 2,
  },
  headerAction: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF2FF',
    borderWidth: 1,
    borderColor: '#D6E6FF',
  },
  searchRow: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.inputBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    paddingVertical: 8,
  },
  optionsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 3,
    backgroundColor: '#EEF5FF',
  },
  optionBtnActive: {
    backgroundColor: colors.primary,
  },
  optionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  optionTextActive: {
    color: colors.onPrimary,
  },
  listContent: {
    paddingVertical: 8,
    backgroundColor: colors.surface,
    flexGrow: 1,
  },
  row: {
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey100,
    backgroundColor: colors.surface,
  },
  rowOpening: {
    opacity: 0.72,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: '800',
  },
  rowDate: {
    color: colors.grey500,
    fontSize: 12,
  },
  previewRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  previewText: {
    flex: 1,
    color: colors.grey600,
    fontSize: 13,
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.tagBg,
  },
  groupBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },
  unreadText: {
    color: colors.onError,
    fontSize: 11,
    fontWeight: '800',
  },
  skeletonList: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 8,
  },
  loadMoreSkeletonList: {
    backgroundColor: colors.surface,
    paddingBottom: 8,
  },
  skeletonAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.grey300,
  },
  skeletonContent: {
    flex: 1,
    minWidth: 0,
  },
  skeletonRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  skeletonLine: {
    backgroundColor: colors.grey300,
    borderRadius: 4,
  },
  skeletonName: {
    height: 14,
    width: '56%',
  },
  skeletonDate: {
    height: 12,
    width: 58,
  },
  skeletonMessage: {
    height: 12,
    width: '78%',
  },
  emptyWrap: {
    flex: 1,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyText: {
    color: colors.grey600,
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 14,
  },
  modalHeader: {
    minHeight: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  modalTitle: {
    color: colors.onSurface,
    fontSize: 17,
    fontWeight: '800',
  },
  photoPicker: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  photoPickerText: {
    color: colors.primary,
    fontWeight: '800',
  },
  inputLabel: {
    paddingHorizontal: 18,
    color: colors.grey700,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    marginHorizontal: 18,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    color: colors.onSurface,
    marginBottom: 14,
  },
  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  membersCount: {
    paddingHorizontal: 18,
    color: colors.grey500,
    fontSize: 12,
  },
  memberRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
  },
  memberSkeletonList: {
    paddingTop: 2,
  },
  memberSkeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.grey300,
  },
  memberSkeletonName: {
    height: 13,
    width: '46%',
    marginBottom: 7,
  },
  memberSkeletonSub: {
    height: 11,
    width: '66%',
  },
  memberSkeletonIcon: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: colors.grey300,
  },
  memberName: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '700',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  cancelText: {
    color: colors.grey700,
    fontWeight: '800',
  },
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryBtnDisabled: {
    opacity: 0.65,
  },
  primaryText: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
  notificationContent: {
    gap: 10,
  },
  notificationLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  notificationLoadingText: {
    color: colors.grey600,
    fontSize: 13,
  },
  notificationSectionTitle: {
    marginTop: 8,
    color: colors.grey600,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  notificationOption: {
    minHeight: 68,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.grey200,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
  },
  optionDisabled: {
    opacity: 0.55,
  },
  notificationOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF2FF',
  },
  notificationOptionText: {
    flex: 1,
    minWidth: 0,
  },
  notificationOptionTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: '800',
  },
  notificationOptionDescription: {
    marginTop: 3,
    color: colors.grey600,
    fontSize: 12,
    lineHeight: 16,
  },
  notificationSwitch: {
    width: 42,
    height: 24,
    borderRadius: 12,
    padding: 2,
    backgroundColor: colors.grey300,
    justifyContent: 'center',
  },
  notificationSwitchOn: {
    backgroundColor: colors.primary,
  },
  notificationSwitchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  notificationSwitchThumbOn: {
    transform: [{ translateX: 18 }],
  },
  sheetCancelBtn: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  sheetCancelText: {
    color: colors.grey700,
    fontWeight: '800',
  },
  sheetSaveBtn: {
    minHeight: 42,
    minWidth: 104,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sheetSaveText: {
    color: colors.onPrimary,
    fontWeight: '800',
  },
});
