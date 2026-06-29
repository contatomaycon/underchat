import {
  createRef,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import {
  Alert,
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  RefreshControl,
  Pressable,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Animated,
  Platform,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/types';
import type { ChatListCounts, ListChatsResult } from '../types/chat';
import {
  listMyChats,
  listQueueChats,
  listChats,
  listPinnedChats,
  pinChat as pinChatApi,
  unpinChat as unpinChatApi,
  searchChats,
  listMessages,
  clearChatSummary,
  getChatNotificationSettings,
  updateChatStatus,
  updateChatStatusDetailed,
  updateChatNotificationSettings,
  viewWorkerConfigForChat,
  transferChat,
  listTransferOptions,
  listTransferUsers,
  listTransferSectors,
  listTransferSectorUsers,
  type ChatNotificationSettings,
  type ChatNotificationSettingsPayload,
  type ChatUserStatus,
  type TransferChatPayload,
  type TransferSectorOption,
  type TransferUserOption,
} from '../api/chatApi';
import {
  getUser,
  getPermissions,
  getSectors,
  getChannels,
  patchUser,
  type UserChannel,
} from '../storage/authStorage';
import {
  canUseUserAndSectorFilters as checkUserSectorFilters,
  canPickQueueChat,
  canViewChat,
  isChatParticipant,
  isChatPrimary,
  isMasterOrAdministratorUser,
  canListAllChatsWithoutSectorLimit,
  canCloseChatWithoutAttending,
  canDisableSendMessageOnFinishAttendance,
  canDisableSendMessageOnTransfer,
  canManageInChatLifecyclePermission,
  canToggleOptionalClosureReason,
} from '../constants/chatAuthorization';
import {
  AdvancedFilterModal,
  type AdvancedFilterValues,
} from '../components/AdvancedFilterModal';
import {
  SelectField,
  SelectSheet,
  type SelectOption,
} from '../components/select';
import { UserSidebar } from '../components/UserSidebar';
import { ChannelStatusBanner } from '../components/ChannelStatusBanner';
import { AppAvatar } from '../components/AppAvatar';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { OpeningConversationModal } from '../components/OpeningConversationModal';
import type { WorkerConfigForChat } from '../types/contact';
import { CHAT_MESSAGES_PER_PAGE } from '../constants/chatMessages';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  useChatFilter,
  type ChatbotFilterStatus,
} from '../context/ChatFilterContext';
import {
  addChatSocketListener,
  type SocketChatPayload,
  type SocketChannelsUpdatedPayload,
} from '../socket/chatSocket';
import {
  getChatUserStatusColor,
  normalizeChatUserStatus,
  readChatUserStatus,
} from '../utils/chatUserStatus';
import {
  normalizeChatCounts,
  syncGlobalChatCounts,
} from '../utils/chatCountsSync';
import { formatBadgeCount } from '../utils/countFormat';
import {
  ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET,
  dismissKeyboard,
  dismissKeyboardAnd,
  getModalKeyboardVerticalOffset,
  modalKeyboardAvoidingBehavior,
} from '../utils/keyboard';
import {
  addAppResumeListener,
  addSessionUpdatedListener,
} from '../utils/appResumeBus';
import {
  buildCloseChatPatchOptions,
  isClosureCommentRequiredFailure,
  shouldShowClosureReasonInput,
} from '../utils/chatClosure';
import {
  parseWhatsAppPreviewTokens,
  type WhatsAppTextToken,
} from '../utils/whatsAppTextFormat';
import { addCurrentUserPresenceStatusListener } from '../utils/currentUserPresence';
import {
  disableMobilePushNotifications,
  enableMobilePushNotifications,
  isAnyMobilePushPreferenceEnabled,
} from '../services/pushNotifications';
import { setChatMessagePreload } from '../utils/chatMessagePreload';
import {
  addChatPinningListener,
  emitChatPinningChange,
  isPinnableChat,
} from '../utils/chatPinning';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatList'>;

const CHAT_STATUS = {
  all: 'my_chats' as const,
  queue: 'queue' as const,
  in_chat: 'in_chat' as const,
  closed: 'closed' as const,
  chatbot: 'ura' as const,
};

type ChatListLoadTrigger =
  | 'initial'
  | 'quick_filter'
  | 'focus'
  | 'realtime'
  | 'resume'
  | 'manual_refresh'
  | 'action'
  | 'criteria_change';
type PendingChatListLoadTrigger = Exclude<
  ChatListLoadTrigger,
  'manual_refresh'
>;

const FOCUS_RELOAD_COOLDOWN_MS = 10_000;
const CHAT_LIST_TRIGGER_PRIORITY: Record<PendingChatListLoadTrigger, number> = {
  initial: 7,
  quick_filter: 6,
  criteria_change: 5,
  action: 4,
  realtime: 3,
  resume: 2,
  focus: 1,
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

const DEFAULT_CHAT_NOTIFICATION_SETTINGS: ChatNotificationSettings = {
  notifications: true,
  notifications_sound: true,
  notifications_vibrate: false,
  notifications_toast: true,
  notifications_browser: true,
  notifications_push: true,
  notifications_message_queue: false,
  notifications_message_in_chat: true,
  notifications_message_chatbot: false,
  notifications_transfer: true,
};

function getChatbotFilterKey(filters: ChatbotFilterStatus[]): string {
  return [...filters].sort().join('|');
}

type TransferDestinationType = 'user' | 'sector' | 'chatbot';
type TransferPickerKind =
  'channel' | 'type' | 'user' | 'sector' | 'sector_user' | 'chatbot' | null;

type TransferChannelOption = {
  value: string;
  label: string;
};

type TransferChatbotOption = {
  value: string;
  label: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

function readBooleanDefaultTrue(value: unknown): boolean {
  return value !== false;
}

function readBooleanDefaultFalse(value: unknown): boolean {
  return value === true;
}

function readChatNotificationSettingsFromUser(
  user: unknown
): ChatNotificationSettings {
  const chatUser =
    isRecord(user) && isRecord(user.chat_user) ? user.chat_user : {};

  return {
    chat_user_id:
      typeof chatUser.chat_user_id === 'string'
        ? chatUser.chat_user_id
        : undefined,
    notifications: readBooleanDefaultTrue(chatUser.notifications),
    notifications_sound: readBooleanDefaultTrue(chatUser.notifications_sound),
    notifications_vibrate: readBooleanDefaultFalse(
      chatUser.notifications_vibrate
    ),
    notifications_toast: readBooleanDefaultTrue(chatUser.notifications_toast),
    notifications_browser: readBooleanDefaultTrue(
      chatUser.notifications_browser
    ),
    notifications_push: readBooleanDefaultTrue(chatUser.notifications_push),
    notifications_message_queue: readBooleanDefaultFalse(
      chatUser.notifications_message_queue
    ),
    notifications_message_in_chat: readBooleanDefaultTrue(
      chatUser.notifications_message_in_chat
    ),
    notifications_message_chatbot: readBooleanDefaultFalse(
      chatUser.notifications_message_chatbot
    ),
    notifications_transfer: readBooleanDefaultTrue(
      chatUser.notifications_transfer
    ),
  };
}

function shouldUseChatPush(settings: ChatNotificationSettingsPayload): boolean {
  return (
    settings.notifications !== false && settings.notifications_push !== false
  );
}

type ChatNotificationSettingKey = Exclude<
  keyof ChatNotificationSettings,
  'chat_user_id'
>;

function ChatNotificationSettingsSheet({
  visible,
  settings,
  loading,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  settings: ChatNotificationSettings;
  loading: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (settings: ChatNotificationSettingsPayload) => void;
}) {
  const [draft, setDraft] = useState<ChatNotificationSettings>(
    DEFAULT_CHAT_NOTIFICATION_SETTINGS
  );

  useEffect(() => {
    if (visible) {
      setDraft(settings);
    }
  }, [settings, visible]);

  const updateDraft = useCallback(
    (key: ChatNotificationSettingKey, value: boolean) => {
      setDraft((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const renderOption = (
    key: ChatNotificationSettingKey,
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
    saving || loading || draft.notifications === false;

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
            style={[styles.sheetSaveBtn, saving && styles.actionBtnDisabled]}
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
            'notifications',
            'Habilitar notificações',
            'Controla todos os avisos do Chat.',
            'notifications-outline'
          )}

          <Text style={styles.notificationSectionTitle}>Mensagens</Text>
          {renderOption(
            'notifications_message_queue',
            'Mensagens na fila',
            'Avisar quando chegar mensagem em atendimento aguardando na fila.',
            'file-tray-stacked-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_message_in_chat',
            'Mensagens em atendimento',
            'Avisar novas mensagens nos atendimentos em andamento.',
            'chatbubbles-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_message_chatbot',
            'Mensagens no chatbot',
            'Avisar novas mensagens em conversas no chatbot.',
            'hardware-chip-outline',
            childOptionsDisabled
          )}

          <Text style={styles.notificationSectionTitle}>Movimentações</Text>
          {renderOption(
            'notifications_transfer',
            'Transferência',
            'Avisar quando um atendimento for transferido para você ou sua fila.',
            'swap-horizontal-outline',
            childOptionsDisabled
          )}

          <Text style={styles.notificationSectionTitle}>Entrega</Text>
          {renderOption(
            'notifications_sound',
            'Som',
            'Tocar alerta sonoro quando disponível.',
            'volume-high-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_vibrate',
            'Vibrar',
            'Vibrar o celular quando uma notificação chegar.',
            'phone-portrait-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_toast',
            'Alerta na tela',
            'Mostrar aviso enquanto o app estiver aberto.',
            'albums-outline',
            childOptionsDisabled
          )}
          {renderOption(
            'notifications_push',
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

function resolveSocketChatSecondaryUserIds(data: SocketChatPayload): string[] {
  const secondaryUsers = (data as { secondary_users?: unknown })
    .secondary_users;
  if (!Array.isArray(secondaryUsers)) {
    return [];
  }

  return secondaryUsers
    .map((secondaryUser) => resolveUserId(secondaryUser))
    .filter((secondaryUserId): secondaryUserId is string => !!secondaryUserId);
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

function limitText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function resolveLabelBackground(color: string | null | undefined): string {
  if (!color) return colors.tagBg;

  const normalized = color.trim();
  const hexMatch = /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.exec(normalized);
  if (!hexMatch) return colors.tagBg;

  let hex = normalized.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, 0.16)`;
}

function formatTransferUserLabel(option: TransferUserOption): string {
  const name = [option.name, option.last_name]
    .filter((item): item is string => !!item && item.trim().length > 0)
    .join(' ')
    .trim();

  if (name.length > 0) return name;

  if (option.nickname && option.nickname.trim().length > 0) {
    return option.nickname.trim();
  }

  return option.id;
}

const OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES = 15;

function isOperatorReplyPendingAlertTriggered(
  item: ListChatsResult,
  workerConfig: WorkerConfigForChat | null | undefined,
  now: number
): boolean {
  if (item.status !== 'in_chat') return false;
  if (workerConfig?.operator_reply_pending_alert_enabled !== true) {
    return false;
  }

  const pendingSince = item.summary?.operator_reply_pending_since;
  if (!pendingSince) return false;

  const pendingSinceMs = new Date(pendingSince).getTime();
  if (!Number.isFinite(pendingSinceMs)) return false;

  const thresholdMinutes =
    typeof workerConfig.operator_reply_pending_alert_time_minutes ===
      'number' && workerConfig.operator_reply_pending_alert_time_minutes >= 1
      ? workerConfig.operator_reply_pending_alert_time_minutes
      : OPERATOR_REPLY_PENDING_ALERT_DEFAULT_TIME_MINUTES;

  return now - pendingSinceMs >= thresholdMinutes * 60 * 1000;
}

function ChatRow({
  item,
  onPress,
  disabled = false,
  chatbotTypeLabel,
  onPressLabelDetails,
  workerConfig,
  now,
}: {
  item: ListChatsResult;
  onPress: () => void;
  disabled?: boolean;
  chatbotTypeLabel?: string | null;
  onPressLabelDetails?: (labelNames: string[]) => void;
  workerConfig?: WorkerConfigForChat | null;
  now: number;
}) {
  const name = item.name ?? item.contact?.name ?? item.phone ?? item.chat_id;
  const lastMsg = item.summary?.last_message ?? '';
  const lastDate = formatDate(item.summary?.last_date ?? item.date);
  const unread = item.summary?.unread_count ?? 0;
  const labels = Array.isArray(item.label) ? item.label : [];
  const firstLabel = labels[0] ?? null;
  const remainingLabelsCount = labels.length > 1 ? labels.length - 1 : 0;
  const labelNames = labels
    .map((labelItem) => labelItem.label?.trim() ?? '')
    .filter((labelName) => labelName.length > 0);
  const channelName = item.worker?.name?.trim() ?? '';
  const channelDisplayName = channelName ? limitText(channelName, 20) : '';
  const sectorName = item.sector?.name?.trim() ?? '';
  const attendantName = item.user?.name?.trim() ?? '';
  const attendantFirstName =
    attendantName
      .split(/\s+/)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  const attendantLabel = attendantFirstName
    ? limitText(attendantFirstName, 10)
    : '';
  const attendantVerticalLabel = attendantLabel.split('').join('\n');
  const previewTokens = useMemo<WhatsAppTextToken[]>(
    () => parseWhatsAppPreviewTokens(lastMsg, 120, '…'),
    [lastMsg]
  );
  const showPendingReplyAlert = isOperatorReplyPendingAlertTriggered(
    item,
    workerConfig,
    now
  );
  const renderPreviewToken = useCallback(
    (token: WhatsAppTextToken, index: number) => {
      if (!token.text) return null;

      return (
        <Text
          key={`chat-preview-${index}`}
          style={[
            styles.chatLastMessageToken,
            token.type === 'bold' && styles.chatLastMessageBold,
            token.type === 'italic' && styles.chatLastMessageItalic,
            token.type === 'strike' && styles.chatLastMessageStrike,
            token.type === 'code' && styles.chatLastMessageCode,
          ]}
        >
          {token.text}
        </Text>
      );
    },
    []
  );

  return (
    <Pressable
      style={[
        styles.chatRow,
        attendantLabel && styles.chatRowWithAttendant,
        showPendingReplyAlert && styles.chatRowPendingReplyAlert,
        disabled && styles.chatRowDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityLabel={disabled ? pt.action_unavailable_by_permission : name}
    >
      <AppAvatar
        uri={item.photo ?? item.contact?.photo ?? null}
        size={48}
        style={styles.chatAvatar}
        iconName="person"
        iconSize={24}
        iconColor={colors.grey600}
      />
      <View style={styles.chatRowContent}>
        <View style={styles.chatRowTop}>
          <Text style={styles.chatName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.chatDate}>{lastDate}</Text>
        </View>
        {showPendingReplyAlert ? (
          <View style={styles.pendingReplyAlertRow}>
            <Ionicons
              name="alert-circle-outline"
              size={13}
              color={colors.error}
            />
            <Text style={styles.pendingReplyAlertText} numberOfLines={1}>
              {pt.chat_operator_reply_pending_alert_short}
            </Text>
          </View>
        ) : null}
        <View style={styles.chatRowBottom}>
          <Text style={styles.chatLastMessage} numberOfLines={1}>
            {previewTokens.length > 0
              ? previewTokens.map(renderPreviewToken)
              : ' '}
          </Text>
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{formatBadgeCount(unread)}</Text>
            </View>
          ) : null}
        </View>
        {item.contact || chatbotTypeLabel || firstLabel ? (
          <View style={styles.metaRow}>
            {item.contact ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{pt.contact}</Text>
              </View>
            ) : null}
            {chatbotTypeLabel ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{chatbotTypeLabel}</Text>
              </View>
            ) : null}
            {firstLabel ? (
              <Pressable
                style={[
                  styles.metaChip,
                  styles.labelChip,
                  { backgroundColor: resolveLabelBackground(firstLabel.color) },
                ]}
                disabled={remainingLabelsCount <= 0}
                onPress={(event) => {
                  event.stopPropagation();
                  if (remainingLabelsCount > 0) {
                    onPressLabelDetails?.(labelNames);
                  }
                }}
              >
                <Text
                  style={[
                    styles.metaChipText,
                    firstLabel.color
                      ? { color: firstLabel.color }
                      : styles.metaChipText,
                  ]}
                  numberOfLines={1}
                >
                  {remainingLabelsCount > 0
                    ? `${firstLabel.label} +${remainingLabelsCount}`
                    : firstLabel.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {channelName || sectorName ? (
          <View style={styles.metaRow}>
            {channelName ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText} numberOfLines={1}>
                  {pt.channel}: {channelDisplayName}
                </Text>
              </View>
            ) : null}
            {sectorName ? (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText} numberOfLines={1}>
                  {pt.queue}: {sectorName}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      {attendantLabel ? (
        <View style={styles.attendantSideLabel}>
          <Text style={styles.attendantSideLabelText} numberOfLines={10}>
            {attendantVerticalLabel}
          </Text>
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

function mergeChatsById(
  current: ListChatsResult[],
  incoming: ListChatsResult[]
): ListChatsResult[] {
  if (current.length === 0) return incoming;
  if (incoming.length === 0) return current;

  const merged = new Map(current.map((item) => [item.chat_id, item]));
  for (const chat of incoming) {
    if (!chat.chat_id) continue;
    merged.set(chat.chat_id, chat);
  }

  return Array.from(merged.values());
}

function ChatListLoadMoreSkeleton() {
  return (
    <View style={styles.loadMoreSkeletonList}>
      {Array.from({ length: 3 }, (_, i) => (
        <View key={`load-more-skeleton-${i}`} style={styles.chatRow}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonContent}>
            <View style={styles.skeletonRowTop}>
              <View style={[styles.skeletonLine, styles.skeletonName]} />
              <View style={[styles.skeletonLine, styles.skeletonDate]} />
            </View>
            <View style={[styles.skeletonLine, styles.skeletonMessage]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChatListScreen({ route, navigation }: Props) {
  const { tab } = route.params;
  const isFocused = useIsFocused();
  const { width: screenWidth } = useWindowDimensions();
  const {
    hasAppliedAdvancedFilters,
    setHasAppliedAdvancedFilters,
    advancedFilterValues,
    setAdvancedFilterValues,
    inChatScope,
    setInChatScope,
    chatbotFilters,
    toggleChatbotFilter,
    clearAdvancedFilters,
    chatCounts,
    setChatCounts,
  } = useChatFilter();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<ChatUserStatus>('offline');
  const [queue, setQueue] = useState<ListChatsResult[]>([]);
  const [inChat, setInChat] = useState<ListChatsResult[]>([]);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [canUseUserAndSectorFilters, setCanUseUserAndSectorFilters] =
    useState(false);
  const [socketPermissions, setSocketPermissions] = useState<string[]>([]);
  const [userSectors, setUserSectors] = useState<string[]>([]);
  const [userChannels, setUserChannels] = useState<UserChannel[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [
    isCurrentUserMasterOrAdministrator,
    setIsCurrentUserMasterOrAdministrator,
  ] = useState(false);
  const [canPickAnyQueueChat, setCanPickAnyQueueChat] = useState(false);
  const [profileSidebarVisible, setProfileSidebarVisible] = useState(false);
  const [notificationSheetVisible, setNotificationSheetVisible] =
    useState(false);
  const [notificationSettings, setNotificationSettings] =
    useState<ChatNotificationSettings>(DEFAULT_CHAT_NOTIFICATION_SETTINGS);
  const [notificationSettingsLoading, setNotificationSettingsLoading] =
    useState(false);
  const [notificationSettingsSaving, setNotificationSettingsSaving] =
    useState(false);
  const [pinnedChats, setPinnedChats] = useState<ListChatsResult[]>([]);
  const [pinningChatIds, setPinningChatIds] = useState<string[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [isUserResolved, setIsUserResolved] = useState(false);
  const [isPermissionsResolved, setIsPermissionsResolved] = useState(false);
  const [isSectorsResolved, setIsSectorsResolved] = useState(false);
  const [isChannelsResolved, setIsChannelsResolved] = useState(false);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferPickerKind, setTransferPickerKind] =
    useState<TransferPickerKind>(null);
  const [transferTargetChat, setTransferTargetChat] =
    useState<ListChatsResult | null>(null);
  const [transferType, setTransferType] =
    useState<TransferDestinationType | null>(null);
  const [transferAnnotation, setTransferAnnotation] = useState('');
  const [transferKeepInChat, setTransferKeepInChat] = useState(false);
  const [transferSendMessageOnTransfer, setTransferSendMessageOnTransfer] =
    useState(true);
  const [transferWorkerConfigForChat, setTransferWorkerConfigForChat] =
    useState<WorkerConfigForChat | null>(null);
  const [transferChannels, setTransferChannels] = useState<
    TransferChannelOption[]
  >([]);
  const [transferUsers, setTransferUsers] = useState<TransferUserOption[]>([]);
  const [transferSectors, setTransferSectors] = useState<
    TransferSectorOption[]
  >([]);
  const [transferSectorUsers, setTransferSectorUsers] = useState<
    TransferUserOption[]
  >([]);
  const [selectedTransferChannelId, setSelectedTransferChannelId] = useState<
    string | null
  >(null);
  const [selectedTransferUserId, setSelectedTransferUserId] = useState<
    string | null
  >(null);
  const [selectedTransferSectorId, setSelectedTransferSectorId] = useState<
    string | null
  >(null);
  const [selectedTransferSectorUserId, setSelectedTransferSectorUserId] =
    useState<string | null>(null);
  const [selectedTransferChatbotId, setSelectedTransferChatbotId] = useState<
    string | null
  >(null);
  const [isLoadingTransferOptions, setIsLoadingTransferOptions] =
    useState(false);
  const [isLoadingTransferSectorUsers, setIsLoadingTransferSectorUsers] =
    useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [isClosingChat, setIsClosingChat] = useState(false);
  const [attendingChatId, setAttendingChatId] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const [labelInfoModalVisible, setLabelInfoModalVisible] = useState(false);
  const [labelInfoNames, setLabelInfoNames] = useState<string[]>([]);
  const [closeServiceModalVisible, setCloseServiceModalVisible] =
    useState(false);
  const [closeServiceTargetChat, setCloseServiceTargetChat] =
    useState<ListChatsResult | null>(null);
  const [closeServiceWorkerConfig, setCloseServiceWorkerConfig] =
    useState<WorkerConfigForChat | null>(null);
  const [
    isLoadingCloseServiceWorkerConfig,
    setIsLoadingCloseServiceWorkerConfig,
  ] = useState(false);
  const [
    closeServiceSendMessageOnFinishAttendance,
    setCloseServiceSendMessageOnFinishAttendance,
  ] = useState(true);
  const [closeServiceClosureComment, setCloseServiceClosureComment] =
    useState('');
  const [closeServiceInformClosureReason, setCloseServiceInformClosureReason] =
    useState(false);
  const [
    closeServiceBackendRequiresClosureReason,
    setCloseServiceBackendRequiresClosureReason,
  ] = useState(false);
  const [closeServiceClosureError, setCloseServiceClosureError] = useState<
    string | null
  >(null);
  const [workerConfigById, setWorkerConfigById] = useState<
    Record<string, WorkerConfigForChat | null>
  >({});
  const [operatorReplyPendingNow, setOperatorReplyPendingNow] = useState(() =>
    Date.now()
  );
  const locallyClearedSummaryChatIdsRef = useRef<Set<string>>(new Set());
  const realtimeReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const scheduledReloadTriggerRef = useRef<PendingChatListLoadTrigger | null>(
    null
  );
  const loadingRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);
  const wasFocusedRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  const isAuthContextResolvedRef = useRef(false);
  const pendingReloadTriggerRef = useRef<PendingChatListLoadTrigger | null>(
    null
  );
  const previousInChatScopeRef = useRef(inChatScope);
  const previousChatbotFilterKeyRef = useRef(
    getChatbotFilterKey(chatbotFilters)
  );
  const lastAutomaticReloadAtRef = useRef<number | null>(null);
  const openedSwipeableRef = useRef<SwipeableMethods | null>(null);
  const closeServiceConfigRequestRef = useRef(0);
  const closeServiceClosureInputRef = useRef<TextInput | null>(null);
  const profileSidebarReopenTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const paginationRef = useRef<{ currentPage: number; totalPages: number }>({
    currentPage: 1,
    totalPages: 1,
  });

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    return () => {
      if (profileSidebarReopenTimerRef.current) {
        clearTimeout(profileSidebarReopenTimerRef.current);
        profileSidebarReopenTimerRef.current = null;
      }
    };
  }, [currentUserId]);

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

  const normalizePinnedChats = useCallback(
    (items: ListChatsResult[]): ListChatsResult[] => {
      const unique = new Map<string, ListChatsResult>();
      for (const chat of applyLocallyClearedUnreadOverrides(
        filterAuthorizedChats(items.filter(isPinnableChat))
      )) {
        if (chat.chat_id) {
          unique.set(chat.chat_id, chat);
        }
      }
      return Array.from(unique.values());
    },
    [applyLocallyClearedUnreadOverrides, filterAuthorizedChats]
  );

  useEffect(
    () =>
      addChatPinningListener(({ chat, pinned }) => {
        setPinnedChats((prev) =>
          pinned
            ? normalizePinnedChats([chat, ...prev])
            : prev.filter((item) => item.chat_id !== chat.chat_id)
        );
      }),
    [normalizePinnedChats]
  );

  const syncChatCounts = useCallback(
    (counts?: Partial<ChatListCounts> | null) => {
      const normalizedCounts = normalizeChatCounts(counts);
      if (!normalizedCounts) return;
      setChatCounts(normalizedCounts);
    },
    [setChatCounts]
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
        setUserStatus(readChatUserStatus(user));
        const userId =
          user && typeof user === 'object' ? resolveUserId(user) : null;
        setCurrentUserId(userId);
        setIsCurrentUserMasterOrAdministrator(
          isMasterOrAdministratorUser(user)
        );
        setNotificationSettings(readChatNotificationSettingsFromUser(user));
      })
      .finally(() => {
        setIsUserResolved(true);
      });
  }, []);

  useEffect(() => {
    return addCurrentUserPresenceStatusListener(setUserStatus, {
      emitCurrent: true,
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

  useEffect(() => {
    return addSessionUpdatedListener(() => {
      void getUser().then((user) => {
        const info =
          user && typeof user === 'object'
            ? (user as { info?: { photo?: string | null } }).info
            : undefined;
        const photo = info && info.photo ? String(info.photo) : null;
        setUserPhoto(photo && photo !== 'null' ? photo : null);
        setUserStatus(readChatUserStatus(user));
        const userId =
          user && typeof user === 'object' ? resolveUserId(user) : null;
        setCurrentUserId(userId);
        setIsCurrentUserMasterOrAdministrator(
          isMasterOrAdministratorUser(user)
        );
        setNotificationSettings(readChatNotificationSettingsFromUser(user));
      });

      void getPermissions().then((permissions) => {
        setCanUseUserAndSectorFilters(checkUserSectorFilters(permissions));
        setSocketPermissions(permissions);
        setCanPickAnyQueueChat(canPickQueueChat(permissions));
      });

      void getSectors().then(setUserSectors);

      void getChannels().then((channels) => {
        setUserChannels((prev) =>
          areChannelsEqual(prev, channels) ? prev : channels
        );
      });
    });
  }, []);

  const isAuthContextResolved =
    isUserResolved &&
    isPermissionsResolved &&
    isSectorsResolved &&
    isChannelsResolved;

  useEffect(() => {
    isAuthContextResolvedRef.current = isAuthContextResolved;
  }, [isAuthContextResolved]);

  const load = useCallback(
    async (options?: { append?: boolean; trigger?: ChatListLoadTrigger }) => {
      const append = options?.append ?? false;
      const trigger = options?.trigger ?? 'criteria_change';

      if (append) {
        const { currentPage, totalPages } = paginationRef.current;
        if (
          isLoadingMoreRef.current ||
          loadingRef.current ||
          currentPage >= totalPages
        ) {
          return;
        }
        setIsLoadingMore(true);
        isLoadingMoreRef.current = true;
      } else {
        if (trigger === 'focus' && hasLoadedOnceRef.current) {
          const lastAutomaticReloadAt = lastAutomaticReloadAtRef.current;
          if (
            lastAutomaticReloadAt &&
            Date.now() - lastAutomaticReloadAt < FOCUS_RELOAD_COOLDOWN_MS
          ) {
            return;
          }
        }

        if (loadingRef.current) {
          if (trigger === 'quick_filter') {
            setLoading(true);
          }
          if (trigger !== 'manual_refresh') {
            const pendingTrigger = trigger as PendingChatListLoadTrigger;
            const currentPendingTrigger = pendingReloadTriggerRef.current;
            if (
              !currentPendingTrigger ||
              CHAT_LIST_TRIGGER_PRIORITY[pendingTrigger] >=
                CHAT_LIST_TRIGGER_PRIORITY[currentPendingTrigger]
            ) {
              pendingReloadTriggerRef.current = pendingTrigger;
            }
          }
          return;
        }

        const shouldShowSkeleton =
          trigger === 'quick_filter' ||
          (trigger === 'initial' && !hasLoadedOnceRef.current);
        if (shouldShowSkeleton) {
          setLoading(true);
        }

        loadingRef.current = true;
        paginationRef.current = { currentPage: 1, totalPages: 1 };
        setHasMorePages(false);
      }

      const targetPage = append ? paginationRef.current.currentPage + 1 : 1;
      const chatbotStatus = chatbotFilters[0] ?? 'ura';
      const status = tab === 'chatbot' ? chatbotStatus : CHAT_STATUS[tab];
      const hasSearchText = (search ?? '').trim().length > 0;
      const useSearch = hasAppliedAdvancedFilters || hasSearchText;
      const pinnedChatsPromise = append
        ? null
        : listPinnedChats().catch(() => null);
      const inChatFilterUserId =
        tab === 'in_chat' && inChatScope === 'mine'
          ? currentUserId
          : advancedFilterValues.filter_user_id;

      const applyPagination = (currentPage: number, totalPages: number) => {
        const safeCurrent = currentPage > 0 ? currentPage : 1;
        const safeTotal = totalPages > 0 ? totalPages : 1;
        paginationRef.current = {
          currentPage: safeCurrent,
          totalPages: safeTotal,
        };
        setHasMorePages(safeCurrent < safeTotal);
      };

      try {
        if (useSearch) {
          const res = await searchChats({
            search: search || '',
            status,
            current_page: targetPage,
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
            applyPagination(res.current_page, res.total_pages);
            const results = res.results.filter(
              (r) => r.chat_id && r.chat_id.trim().length > 0
            );
            const visibleResults = filterAuthorizedChats(results);
            const resolvedResults =
              applyLocallyClearedUnreadOverrides(visibleResults);
            if (tab === 'queue') {
              setQueue((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setInChat([]);
            } else if (tab === 'in_chat') {
              setInChat((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setQueue([]);
            } else if (tab === 'closed') {
              setQueue((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setInChat([]);
            } else {
              setInChat((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setQueue([]);
            }

            syncChatCounts(res.counts);
          } else {
            if (!append) {
              applyPagination(1, 1);
              setQueue([]);
              setInChat([]);
            }
          }
          return;
        }
        if (tab === 'all') {
          const res = await listMyChats(targetPage, 50, search || undefined);
          if (res) {
            applyPagination(res.current_page, res.total_pages);
            const visibleResults = filterAuthorizedChats(res.results);
            const inChatList = visibleResults.filter(
              (c) => c.status === 'in_chat'
            );
            const queueList = visibleResults.filter(
              (c) => c.status === 'queue'
            );
            const resolvedInChat =
              applyLocallyClearedUnreadOverrides(inChatList);
            const resolvedQueue = applyLocallyClearedUnreadOverrides(queueList);
            setInChat((prev) =>
              append ? mergeChatsById(prev, resolvedInChat) : resolvedInChat
            );
            setQueue((prev) =>
              append ? mergeChatsById(prev, resolvedQueue) : resolvedQueue
            );
            syncChatCounts(res.counts);
          } else {
            if (!append) {
              applyPagination(1, 1);
              setQueue([]);
              setInChat([]);
            }
          }
        } else if (tab === 'queue') {
          const res = await listQueueChats(targetPage, 50);
          if (res) {
            applyPagination(res.current_page, res.total_pages);
            const visibleResults = filterAuthorizedChats(res.results);
            const resolvedResults =
              applyLocallyClearedUnreadOverrides(visibleResults);
            setQueue((prev) =>
              append ? mergeChatsById(prev, resolvedResults) : resolvedResults
            );
            syncChatCounts(res.counts);
            if (!append) setInChat([]);
          } else {
            if (!append) {
              applyPagination(1, 1);
              setQueue([]);
              setInChat([]);
            }
          }
        } else if (tab === 'in_chat') {
          const res = await listChats({
            status: 'in_chat',
            current_page: targetPage,
            per_page: 50,
            filter_user_id: inChatScope === 'mine' ? currentUserId : undefined,
          });
          if (res) {
            applyPagination(res.current_page, res.total_pages);
            const visibleResults = filterAuthorizedChats(res.results);
            const resolvedResults =
              applyLocallyClearedUnreadOverrides(visibleResults);
            setInChat((prev) =>
              append ? mergeChatsById(prev, resolvedResults) : resolvedResults
            );
            syncChatCounts(res.counts);
            if (!append) setQueue([]);
          } else {
            if (!append) {
              applyPagination(1, 1);
              setQueue([]);
              setInChat([]);
            }
          }
        } else {
          const res = await listChats({
            status,
            current_page: targetPage,
            per_page: 50,
          });
          if (res) {
            applyPagination(res.current_page, res.total_pages);
            const visibleResults = filterAuthorizedChats(res.results);
            const resolvedResults =
              applyLocallyClearedUnreadOverrides(visibleResults);
            if (tab === 'closed') {
              setQueue((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setInChat([]);
            } else {
              setInChat((prev) =>
                append ? mergeChatsById(prev, resolvedResults) : resolvedResults
              );
              if (!append) setQueue([]);
            }

            syncChatCounts(res.counts);
          } else {
            if (!append) {
              applyPagination(1, 1);
              setQueue([]);
              setInChat([]);
            }
          }
        }
      } catch {
        if (!append) {
          setQueue([]);
          setInChat([]);
        }
        paginationRef.current = { currentPage: 1, totalPages: 1 };
        setHasMorePages(false);
      } finally {
        if (append) {
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        } else {
          if (pinnedChatsPromise) {
            const pinned = await pinnedChatsPromise;
            if (pinned) {
              setPinnedChats(normalizePinnedChats(pinned));
            }
          }

          loadingRef.current = false;
          hasLoadedOnceRef.current = true;

          if (
            trigger === 'initial' ||
            trigger === 'focus' ||
            trigger === 'realtime' ||
            trigger === 'resume'
          ) {
            lastAutomaticReloadAtRef.current = Date.now();
          }

          const pendingTrigger = pendingReloadTriggerRef.current;
          pendingReloadTriggerRef.current = null;
          if (
            pendingTrigger &&
            isFocusedRef.current &&
            isAuthContextResolvedRef.current
          ) {
            if (pendingTrigger === 'quick_filter') {
              setLoading(true);
            } else {
              setLoading(false);
            }
            void load({ trigger: pendingTrigger });
            return;
          }

          setLoading(false);
        }
      }
    },
    [
      tab,
      search,
      hasAppliedAdvancedFilters,
      advancedFilterValues,
      chatbotFilters,
      inChatScope,
      currentUserId,
      applyLocallyClearedUnreadOverrides,
      filterAuthorizedChats,
      normalizePinnedChats,
      syncChatCounts,
    ]
  );

  const handleLoadMore = useCallback(() => {
    if (loadingRef.current || isLoadingMoreRef.current || !hasMorePages) {
      return;
    }

    void load({ append: true, trigger: 'criteria_change' });
  }, [hasMorePages, load]);

  const handleRefresh = useCallback(() => {
    if (loadingRef.current || isLoadingMoreRef.current || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    void load({ trigger: 'manual_refresh' }).finally(() => {
      setIsRefreshing(false);
    });
  }, [isRefreshing, load]);

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

      if (chatExistsInList) {
        return true;
      }

      const chatUserId = resolveSocketChatUserId(chatData);
      const chatSecondaryUserIds = resolveSocketChatSecondaryUserIds(chatData);
      const isParticipant =
        !!currentUserId &&
        ((!!chatUserId && chatUserId === currentUserId) ||
          chatSecondaryUserIds.includes(currentUserId));

      const status = readString((chatData as { status?: unknown }).status);

      if (
        status === 'in_chat' ||
        status === 'ura' ||
        status === 'ura_output' ||
        status === 'ura_schedule' ||
        status === 'ura_webhook'
      ) {
        return isParticipant;
      }

      if (status === 'queue') {
        if (isParticipant) {
          return true;
        }

        if (!!chatUserId || chatSecondaryUserIds.length > 0) {
          return false;
        }

        const sectorId = resolveSocketChatSectorId(chatData);

        if (userSectors.length > 0) {
          if (!sectorId) {
            return true;
          }
          return userSectors.includes(sectorId);
        }

        return !sectorId;
      }

      return false;
    },
    [queue, inChat, currentUserId, userSectors, userChannels]
  );

  const scheduleRealtimeReload = useCallback(
    (trigger: PendingChatListLoadTrigger = 'realtime') => {
      const currentScheduledTrigger = scheduledReloadTriggerRef.current;
      if (
        !currentScheduledTrigger ||
        CHAT_LIST_TRIGGER_PRIORITY[trigger] >=
          CHAT_LIST_TRIGGER_PRIORITY[currentScheduledTrigger]
      ) {
        scheduledReloadTriggerRef.current = trigger;
      }

      if (realtimeReloadTimer.current) {
        return;
      }

      realtimeReloadTimer.current = setTimeout(() => {
        realtimeReloadTimer.current = null;
        const scheduledTrigger =
          scheduledReloadTriggerRef.current ?? 'realtime';
        scheduledReloadTriggerRef.current = null;
        void load({ trigger: scheduledTrigger });
      }, 250);
    },
    [load]
  );

  useEffect(() => {
    const wasFocused = wasFocusedRef.current;
    wasFocusedRef.current = isFocused;
    const chatbotFilterKey = getChatbotFilterKey(chatbotFilters);
    const didInChatScopeChange = previousInChatScopeRef.current !== inChatScope;
    const didChatbotFilterChange =
      previousChatbotFilterKeyRef.current !== chatbotFilterKey;
    previousInChatScopeRef.current = inChatScope;
    previousChatbotFilterKeyRef.current = chatbotFilterKey;

    if (!isFocused || !isAuthContextResolved) {
      if (!hasLoadedOnceRef.current) {
        setLoading(true);
      }
      return;
    }

    if (!hasLoadedOnceRef.current) {
      void load({ trigger: 'initial' });
      return;
    }

    if (!wasFocused) {
      void load({ trigger: 'focus' });
      return;
    }

    const isQuickFilterChange =
      (tab === 'in_chat' && didInChatScopeChange) ||
      (tab === 'chatbot' && didChatbotFilterChange);

    void load({
      trigger: isQuickFilterChange ? 'quick_filter' : 'criteria_change',
    });
  }, [
    chatbotFilters,
    inChatScope,
    isAuthContextResolved,
    isFocused,
    load,
    tab,
  ]);

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
      const offUserPresence = addChatSocketListener(
        'userPresence',
        (payload) => {
          if (!currentUserId) return;
          if (readIdentifier(payload.user_id) !== currentUserId) {
            return;
          }

          setUserStatus(normalizeChatUserStatus(payload.status));
        }
      );

      return () => {
        offMessage();
        offChatUpdate();
        offRecoveryFailed();
        offChannelsUpdated();
        offUserPresence();
        if (realtimeReloadTimer.current) {
          clearTimeout(realtimeReloadTimer.current);
          realtimeReloadTimer.current = null;
        }
        scheduledReloadTriggerRef.current = null;
      };
    }, [canReceiveChatNotification, currentUserId, scheduleRealtimeReload])
  );

  useEffect(() => {
    return addAppResumeListener(() => {
      if (!isFocused || !isAuthContextResolved) return;
      scheduleRealtimeReload('resume');
    });
  }, [isAuthContextResolved, isFocused, scheduleRealtimeReload]);

  const handleCloseProfileSidebar = useCallback(() => {
    if (profileSidebarReopenTimerRef.current) {
      clearTimeout(profileSidebarReopenTimerRef.current);
      profileSidebarReopenTimerRef.current = null;
    }
    setProfileSidebarVisible(false);
  }, []);

  const handleOpenProfileSidebar = useCallback(() => {
    dismissKeyboard();
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

  const openNotificationSheet = useCallback(() => {
    dismissKeyboard();
    openedSwipeableRef.current?.close();
    setNotificationSheetVisible(true);
    setNotificationSettingsLoading(true);

    void getChatNotificationSettings()
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
    async (nextSettings: ChatNotificationSettingsPayload) => {
      if (notificationSettingsSaving) return;

      setNotificationSettingsSaving(true);

      try {
        if (shouldUseChatPush(nextSettings)) {
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

        const updated = await updateChatNotificationSettings(nextSettings);

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

  useFocusEffect(
    useCallback(() => {
      return () => {
        handleCloseProfileSidebar();
      };
    }, [handleCloseProfileSidebar])
  );

  const openChat = useCallback(
    async (chat: ListChatsResult, queueIndex: number | null = null) => {
      if (openingChatId) return;

      dismissKeyboard();
      openedSwipeableRef.current?.close();
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

      const shouldClearSummary =
        chat.status === 'in_chat' && isChatParticipant(chat, currentUserId);

      setOpeningChatId(chat.chat_id);
      try {
        const preloadedMessages = await listMessages(
          chat.chat_id,
          1,
          CHAT_MESSAGES_PER_PAGE
        );

        if (!preloadedMessages) {
          Alert.alert(pt.error_title, pt.messages_error);
          return;
        }

        setChatMessagePreload(chat.chat_id, preloadedMessages);

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
      } catch {
        Alert.alert(pt.error_title, pt.messages_error);
      } finally {
        setOpeningChatId(null);
      }
    },
    [
      canPickAnyQueueChat,
      currentUserId,
      navigation,
      openingChatId,
      socketPermissions,
      userChannels,
      userSectors,
    ]
  );

  const closeTransferModal = useCallback(() => {
    if (isTransferring) return;
    dismissKeyboard();
    setTransferModalVisible(false);
    setTransferPickerKind(null);
    setTransferTargetChat(null);
    setTransferType(null);
    setTransferAnnotation('');
    setTransferKeepInChat(false);
    setTransferSendMessageOnTransfer(true);
    setTransferWorkerConfigForChat(null);
    setTransferChannels([]);
    setTransferUsers([]);
    setTransferSectors([]);
    setTransferSectorUsers([]);
    setSelectedTransferChannelId(null);
    setSelectedTransferUserId(null);
    setSelectedTransferSectorId(null);
    setSelectedTransferSectorUserId(null);
    setSelectedTransferChatbotId(null);
    setIsLoadingTransferOptions(false);
    setIsLoadingTransferSectorUsers(false);
  }, [isTransferring]);

  const openTransferModal = useCallback(
    async (chat: ListChatsResult) => {
      const canManageInChatLifecycle =
        isChatPrimary(chat, currentUserId) ||
        isCurrentUserMasterOrAdministrator ||
        canManageInChatLifecyclePermission(socketPermissions);

      if (chat.status === 'in_chat' && !canManageInChatLifecycle) {
        Alert.alert(pt.warning_title, pt.only_primary_can_transfer);
        return;
      }

      dismissKeyboard();
      setTransferTargetChat(chat);
      setTransferModalVisible(true);
      setTransferPickerKind(null);
      setTransferType(null);
      setTransferAnnotation('');
      setTransferKeepInChat(false);
      setTransferSendMessageOnTransfer(true);
      setTransferWorkerConfigForChat(null);
      setTransferChannels([]);
      setTransferUsers([]);
      setTransferSectors([]);
      setTransferSectorUsers([]);
      setSelectedTransferChannelId(null);
      setSelectedTransferUserId(null);
      setSelectedTransferSectorId(null);
      setSelectedTransferSectorUserId(null);
      setSelectedTransferChatbotId(null);
      setIsLoadingTransferOptions(true);

      try {
        const chatId = chat.chat_id;
        const [baseOptions, users, sectors] = await Promise.all([
          listTransferOptions(),
          listTransferUsers(chatId),
          listTransferSectors(),
        ]);

        const channels = (baseOptions?.workers ?? []).map((worker) => {
          const numberLabel = worker.number ? ` (${worker.number})` : '';
          return {
            value: worker.id,
            label: `${worker.name}${numberLabel}`,
          };
        });

        setTransferChannels(channels);
        setTransferUsers(
          users.filter((user) => user.id !== (chat.user?.id ?? null))
        );
        setTransferSectors(sectors);
      } catch {
        Alert.alert(pt.error_title, pt.chat_transfer_error);
        closeTransferModal();
      } finally {
        setIsLoadingTransferOptions(false);
      }
    },
    [
      closeTransferModal,
      currentUserId,
      isCurrentUserMasterOrAdministrator,
      socketPermissions,
    ]
  );

  useEffect(() => {
    if (!transferModalVisible || !transferTargetChat?.chat_id) {
      return;
    }

    const chatId = transferTargetChat.chat_id;
    setTransferWorkerConfigForChat(null);
    setTransferSendMessageOnTransfer(true);

    let cancelled = false;

    if (selectedTransferChannelId) {
      viewWorkerConfigForChat(selectedTransferChannelId)
        .then((config) => {
          if (cancelled) return;
          setTransferWorkerConfigForChat(config);
        })
        .catch(() => {
          if (cancelled) return;
          setTransferWorkerConfigForChat(null);
        });
    }

    listTransferUsers(chatId, selectedTransferChannelId ?? undefined)
      .then((users) => {
        if (cancelled) return;
        setTransferUsers(
          users.filter(
            (user) => user.id !== (transferTargetChat?.user?.id ?? null)
          )
        );
      })
      .catch(() => {
        if (cancelled) return;
        setTransferUsers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedTransferChannelId,
    transferModalVisible,
    transferTargetChat?.chat_id,
    transferTargetChat?.user?.id,
  ]);

  useEffect(() => {
    if (
      !transferModalVisible ||
      !transferTargetChat?.chat_id ||
      transferType !== 'sector' ||
      !selectedTransferSectorId
    ) {
      setTransferSectorUsers([]);
      return;
    }

    const chatId = transferTargetChat.chat_id;
    setIsLoadingTransferSectorUsers(true);

    listTransferSectorUsers(
      selectedTransferSectorId,
      chatId,
      selectedTransferChannelId ?? undefined
    )
      .then((users) => {
        setTransferSectorUsers(
          users.filter(
            (user) => user.id !== (transferTargetChat?.user?.id ?? null)
          )
        );
      })
      .catch(() => {
        setTransferSectorUsers([]);
      })
      .finally(() => {
        setIsLoadingTransferSectorUsers(false);
      });
  }, [
    selectedTransferChannelId,
    selectedTransferSectorId,
    transferModalVisible,
    transferTargetChat?.chat_id,
    transferTargetChat?.user?.id,
    transferType,
  ]);

  const transferChatbots = useMemo<TransferChatbotOption[]>(() => {
    const items: TransferChatbotOption[] = [];
    const inputChatbot = transferWorkerConfigForChat?.input_chatbot;
    const outputChatbot = transferWorkerConfigForChat?.output_chatbot;

    if (inputChatbot) {
      items.push({
        value: inputChatbot.chatbot_id,
        label: `${inputChatbot.name} (${pt.chatbot_type_input})`,
      });
    }

    if (outputChatbot) {
      items.push({
        value: outputChatbot.chatbot_id,
        label: `${outputChatbot.name} (${pt.chatbot_type_output})`,
      });
    }

    return items;
  }, [transferWorkerConfigForChat]);

  useEffect(() => {
    if (!transferModalVisible) return;

    if (
      selectedTransferChatbotId &&
      !transferChatbots.some((item) => item.value === selectedTransferChatbotId)
    ) {
      setSelectedTransferChatbotId(null);
    }

    if (transferType === 'chatbot' && transferChatbots.length === 0) {
      setTransferType(null);
    }
  }, [
    selectedTransferChatbotId,
    transferChatbots,
    transferModalVisible,
    transferType,
  ]);

  const handleSelectTransferPickerValue = useCallback(
    (value: string) => {
      if (transferPickerKind === 'channel') {
        setSelectedTransferChannelId(value);
        setSelectedTransferUserId(null);
        setSelectedTransferSectorUserId(null);
        setSelectedTransferChatbotId(null);
      } else if (transferPickerKind === 'type') {
        if (value === 'user' || value === 'sector' || value === 'chatbot') {
          setTransferType(value);
          if (value === 'chatbot') {
            setTransferKeepInChat(false);
            setTransferSendMessageOnTransfer(true);
          }
        } else {
          setTransferType(null);
        }
        setSelectedTransferUserId(null);
        setSelectedTransferSectorId(null);
        setSelectedTransferSectorUserId(null);
        setSelectedTransferChatbotId(null);
      } else if (transferPickerKind === 'user') {
        setSelectedTransferUserId(value);
      } else if (transferPickerKind === 'sector') {
        setSelectedTransferSectorId(value);
        setSelectedTransferSectorUserId(null);
      } else if (transferPickerKind === 'sector_user') {
        setSelectedTransferSectorUserId(value);
      } else if (transferPickerKind === 'chatbot') {
        setSelectedTransferChatbotId(value);
      }

      setTransferPickerKind(null);
    },
    [transferPickerKind]
  );

  const transferPickerOptions = useMemo<SelectOption[]>(() => {
    if (transferPickerKind === 'channel') {
      return transferChannels;
    }
    if (transferPickerKind === 'type') {
      const items: SelectOption[] = [
        { value: 'user', label: pt.transfer_type_user },
        { value: 'sector', label: pt.transfer_type_sector },
      ];
      if (transferChatbots.length > 0) {
        items.push({ value: 'chatbot', label: pt.transfer_type_chatbot });
      }
      return items;
    }
    if (transferPickerKind === 'user') {
      return transferUsers.map((option) => ({
        value: option.id,
        label: formatTransferUserLabel(option),
      }));
    }
    if (transferPickerKind === 'sector') {
      return transferSectors.map((option) => ({
        value: option.id,
        label: option.name,
      }));
    }
    if (transferPickerKind === 'sector_user') {
      return transferSectorUsers.map((option) => ({
        value: option.id,
        label: formatTransferUserLabel(option),
      }));
    }
    if (transferPickerKind === 'chatbot') {
      return transferChatbots;
    }
    return [];
  }, [
    transferChannels,
    transferChatbots,
    transferPickerKind,
    transferSectors,
    transferSectorUsers,
    transferUsers,
  ]);

  const transferPickerTitle = useMemo(() => {
    if (transferPickerKind === 'channel') return pt.channel;
    if (transferPickerKind === 'type') return pt.transfer_to;
    if (transferPickerKind === 'user') return pt.attendant;
    if (transferPickerKind === 'sector') return pt.sector;
    if (transferPickerKind === 'sector_user') {
      return pt.transfer_sector_user_optional;
    }
    if (transferPickerKind === 'chatbot') return pt.chatbot;
    return pt.select_option;
  }, [transferPickerKind]);

  const selectedTransferPickerValue = useMemo(() => {
    if (transferPickerKind === 'channel') return selectedTransferChannelId;
    if (transferPickerKind === 'type') return transferType;
    if (transferPickerKind === 'user') return selectedTransferUserId;
    if (transferPickerKind === 'sector') return selectedTransferSectorId;
    if (transferPickerKind === 'sector_user')
      return selectedTransferSectorUserId;
    if (transferPickerKind === 'chatbot') return selectedTransferChatbotId;
    return null;
  }, [
    selectedTransferChannelId,
    selectedTransferChatbotId,
    selectedTransferSectorId,
    selectedTransferSectorUserId,
    selectedTransferUserId,
    transferPickerKind,
    transferType,
  ]);

  const selectedTransferChannelLabel =
    transferChannels.find((item) => item.value === selectedTransferChannelId)
      ?.label ?? null;
  const selectedTransferTypeLabel =
    transferType === 'user'
      ? pt.transfer_type_user
      : transferType === 'sector'
        ? pt.transfer_type_sector
        : transferType === 'chatbot'
          ? pt.transfer_type_chatbot
          : null;
  const selectedTransferUserLabel =
    transferUsers.find((item) => item.id === selectedTransferUserId)?.name ??
    null;
  const selectedTransferSectorLabel =
    transferSectors.find((item) => item.id === selectedTransferSectorId)
      ?.name ?? null;
  const selectedTransferSectorUserLabel =
    transferSectorUsers.find((item) => item.id === selectedTransferSectorUserId)
      ?.name ?? null;
  const selectedTransferChatbotLabel =
    transferChatbots.find((item) => item.value === selectedTransferChatbotId)
      ?.label ?? null;

  const canDisableSendMessageOnFinishAttendanceAction =
    canDisableSendMessageOnFinishAttendance(socketPermissions);
  const canDisableSendMessageOnTransferAction =
    canDisableSendMessageOnTransfer(socketPermissions);
  const canToggleOptionalClosureReasonAction =
    canToggleOptionalClosureReason(socketPermissions);
  const shouldShowCloseServiceSendMessageToggle =
    closeServiceWorkerConfig?.send_message_on_finish_attendance_enabled ===
      true && canDisableSendMessageOnFinishAttendanceAction;
  const shouldShowTransferSendMessageToggle =
    transferType !== 'chatbot' &&
    transferWorkerConfigForChat?.send_message_on_transfer_enabled === true &&
    canDisableSendMessageOnTransferAction;
  const showCloseServiceClosureReasonInput = shouldShowClosureReasonInput({
    canToggleOptionalClosureReason: canToggleOptionalClosureReasonAction,
    informClosureReason: closeServiceInformClosureReason,
    backendRequiresClosureReason: closeServiceBackendRequiresClosureReason,
  });

  const submitTransfer = useCallback(async () => {
    const transferChatTarget = transferTargetChat;
    const chatId = transferChatTarget?.chat_id;
    if (!transferChatTarget || !chatId || isTransferring) return;

    const canManageInChatLifecycle =
      isChatPrimary(transferChatTarget, currentUserId) ||
      isCurrentUserMasterOrAdministrator ||
      canManageInChatLifecyclePermission(socketPermissions);
    if (transferChatTarget.status === 'in_chat' && !canManageInChatLifecycle) {
      Alert.alert(pt.warning_title, pt.only_primary_can_transfer);
      return;
    }

    if (!selectedTransferChannelId) {
      Alert.alert(pt.warning_title, pt.channel_required);
      return;
    }
    if (transferType === 'user' && !selectedTransferUserId) {
      Alert.alert(pt.warning_title, pt.user_required);
      return;
    }
    if (transferType === 'sector' && !selectedTransferSectorId) {
      Alert.alert(pt.warning_title, pt.sector_required);
      return;
    }
    if (transferType === 'chatbot' && !selectedTransferChatbotId) {
      Alert.alert(pt.warning_title, pt.chatbot_required);
      return;
    }

    const targetUserId =
      transferType === 'user'
        ? selectedTransferUserId
        : transferType === 'sector'
          ? selectedTransferSectorUserId
          : null;
    const currentPrimaryUserId = transferChatTarget.user?.id ?? null;
    if (
      targetUserId &&
      currentPrimaryUserId &&
      targetUserId === currentPrimaryUserId
    ) {
      Alert.alert(pt.warning_title, pt.cannot_transfer_to_current_primary);
      return;
    }

    const payload: TransferChatPayload = {
      worker_id: selectedTransferChannelId,
      user_id: targetUserId,
      sector_id: transferType === 'sector' ? selectedTransferSectorId : null,
      chatbot_id: transferType === 'chatbot' ? selectedTransferChatbotId : null,
      annotation: transferAnnotation.trim() || null,
      keep_in_chat: transferType === 'chatbot' ? false : transferKeepInChat,
    };

    if (shouldShowTransferSendMessageToggle) {
      payload.send_message_on_transfer = transferSendMessageOnTransfer;
    }

    setIsTransferring(true);
    try {
      const transferResult = await transferChat(chatId, payload);

      if (!transferResult.ok) {
        Alert.alert(
          pt.error_title,
          transferResult.message ?? pt.chat_transfer_error
        );
        return;
      }

      Alert.alert(pt.success_title, pt.transfer_successfully);
      closeTransferModal();
      void load({ trigger: 'action' });
    } catch {
      Alert.alert(pt.error_title, pt.chat_transfer_error);
    } finally {
      setIsTransferring(false);
    }
  }, [
    closeTransferModal,
    load,
    selectedTransferChannelId,
    selectedTransferChatbotId,
    selectedTransferSectorId,
    selectedTransferSectorUserId,
    selectedTransferUserId,
    transferAnnotation,
    transferKeepInChat,
    transferSendMessageOnTransfer,
    transferTargetChat,
    transferType,
    shouldShowTransferSendMessageToggle,
    currentUserId,
    isTransferring,
    isCurrentUserMasterOrAdministrator,
    socketPermissions,
  ]);

  const closeCloseServiceModal = useCallback(() => {
    closeServiceConfigRequestRef.current += 1;
    setCloseServiceModalVisible(false);
    setCloseServiceTargetChat(null);
    setCloseServiceWorkerConfig(null);
    setIsLoadingCloseServiceWorkerConfig(false);
    setCloseServiceSendMessageOnFinishAttendance(true);
    setCloseServiceClosureComment('');
    setCloseServiceInformClosureReason(!canToggleOptionalClosureReasonAction);
    setCloseServiceBackendRequiresClosureReason(false);
    setCloseServiceClosureError(null);
    setIsClosingChat(false);
  }, [canToggleOptionalClosureReasonAction]);

  const focusCloseServiceClosureInput = useCallback(() => {
    requestAnimationFrame(() => {
      closeServiceClosureInputRef.current?.focus();
    });
  }, []);

  const handleCloseServiceClosureCommentChange = useCallback(
    (value: string) => {
      setCloseServiceClosureComment(value);
      setCloseServiceClosureError(null);
    },
    []
  );

  const confirmCloseChat = useCallback(async () => {
    const chatId = closeServiceTargetChat?.chat_id;
    if (!chatId || isClosingChat) return;

    const closeOptions = buildCloseChatPatchOptions({
      canToggleOptionalClosureReason: canToggleOptionalClosureReasonAction,
      informClosureReason: closeServiceInformClosureReason,
      backendRequiresClosureReason: closeServiceBackendRequiresClosureReason,
      closureComment: closeServiceClosureComment,
      includeSendMessageOnFinishAttendance:
        shouldShowCloseServiceSendMessageToggle,
      sendMessageOnFinishAttendance: closeServiceSendMessageOnFinishAttendance,
    });

    if (!closeOptions.ok) {
      setCloseServiceClosureError(pt.closure_comment_required);
      setCloseServiceInformClosureReason(true);
      focusCloseServiceClosureInput();
      return;
    }

    setIsClosingChat(true);
    try {
      const result = await updateChatStatusDetailed(
        chatId,
        'closed',
        closeOptions.options
      );
      if (!result.ok) {
        if (
          isClosureCommentRequiredFailure({
            reason: result.reason,
            message: result.message,
            expectedMessage: pt.closure_comment_required,
          })
        ) {
          setCloseServiceBackendRequiresClosureReason(true);
          setCloseServiceInformClosureReason(true);
          setCloseServiceClosureError(pt.closure_comment_required);
          focusCloseServiceClosureInput();
          return;
        }

        Alert.alert(pt.error_title, pt.chat_status_update_error);
        return;
      }

      closeCloseServiceModal();
      Alert.alert(pt.success_title, pt.close_service_success);
      void load({ trigger: 'action' });
    } catch {
      Alert.alert(pt.error_title, pt.chat_status_update_error);
    } finally {
      setIsClosingChat(false);
    }
  }, [
    canToggleOptionalClosureReasonAction,
    closeServiceBackendRequiresClosureReason,
    closeCloseServiceModal,
    closeServiceClosureComment,
    closeServiceInformClosureReason,
    closeServiceSendMessageOnFinishAttendance,
    closeServiceTargetChat?.chat_id,
    focusCloseServiceClosureInput,
    isClosingChat,
    load,
    shouldShowCloseServiceSendMessageToggle,
  ]);

  const handleCloseChat = useCallback(
    (chat: ListChatsResult) => {
      const canManageInChatLifecycle =
        isChatPrimary(chat, currentUserId) ||
        isCurrentUserMasterOrAdministrator ||
        canManageInChatLifecyclePermission(socketPermissions);

      if (chat.status === 'in_chat' && !canManageInChatLifecycle) {
        Alert.alert(pt.warning_title, pt.only_primary_can_close);
        return;
      }

      openedSwipeableRef.current?.close();
      setCloseServiceSendMessageOnFinishAttendance(true);
      setCloseServiceClosureComment('');
      setCloseServiceInformClosureReason(!canToggleOptionalClosureReasonAction);
      setCloseServiceBackendRequiresClosureReason(false);
      setCloseServiceClosureError(null);
      setIsClosingChat(false);
      setCloseServiceTargetChat(chat);
      setCloseServiceWorkerConfig(null);
      setCloseServiceModalVisible(true);

      const workerId = readString(chat.worker?.id);
      if (!workerId) {
        setIsLoadingCloseServiceWorkerConfig(false);
        return;
      }

      const requestId = closeServiceConfigRequestRef.current + 1;
      closeServiceConfigRequestRef.current = requestId;
      setIsLoadingCloseServiceWorkerConfig(true);

      viewWorkerConfigForChat(workerId)
        .then((config) => {
          if (closeServiceConfigRequestRef.current !== requestId) return;
          setCloseServiceWorkerConfig(config);
        })
        .catch(() => {
          if (closeServiceConfigRequestRef.current !== requestId) return;
          setCloseServiceWorkerConfig(null);
        })
        .finally(() => {
          if (closeServiceConfigRequestRef.current !== requestId) return;
          setIsLoadingCloseServiceWorkerConfig(false);
        });
    },
    [
      currentUserId,
      isCurrentUserMasterOrAdministrator,
      socketPermissions,
      canToggleOptionalClosureReasonAction,
    ]
  );

  const handleAttendQueueChat = useCallback(
    async (chat: ListChatsResult) => {
      if (attendingChatId) return;

      setAttendingChatId(chat.chat_id);
      let ok = false;
      try {
        ok = await updateChatStatus(chat.chat_id, 'in_chat');
      } catch {
        ok = false;
      } finally {
        setAttendingChatId(null);
        openedSwipeableRef.current?.close();
      }

      if (!ok) {
        Alert.alert(pt.error_title, pt.chat_status_update_error);
        return;
      }

      const attendedChat: ListChatsResult = {
        ...chat,
        status: 'in_chat',
      };
      void syncGlobalChatCounts(setChatCounts);

      const parentNavigation = navigation.getParent() as
        | {
            navigate: (
              routeName: string,
              params?: {
                screen?: string;
                params?: { chat: ListChatsResult };
              }
            ) => void;
          }
        | undefined;

      if (parentNavigation) {
        parentNavigation.navigate('InChat', {
          screen: 'ChatRoom',
          params: { chat: attendedChat },
        });
        return;
      }

      navigation.push('ChatRoom', { chat: attendedChat });
    },
    [attendingChatId, navigation, setChatCounts]
  );

  const handleClearSearch = useCallback(() => {
    dismissKeyboard();
    openedSwipeableRef.current?.close();
    setSearch('');
  }, []);

  const closeOpenedSwipeable = useCallback(() => {
    openedSwipeableRef.current?.close();
  }, []);

  const openLabelInfoModal = useCallback((labelNames: string[]) => {
    if (!Array.isArray(labelNames) || labelNames.length <= 1) {
      return;
    }

    setLabelInfoNames(labelNames);
    setLabelInfoModalVisible(true);
  }, []);

  const pinnedChatIds = useMemo(
    () => new Set(pinnedChats.map((chat) => chat.chat_id)),
    [pinnedChats]
  );
  const canShowPinnedChats = pinnedChats.length > 0;
  const removePinnedFromSections = useCallback(
    (items: ListChatsResult[]): ListChatsResult[] => {
      if (!canShowPinnedChats) return items;
      return items.filter((item) => !pinnedChatIds.has(item.chat_id));
    },
    [canShowPinnedChats, pinnedChatIds]
  );

  const setPinningChat = useCallback((chatId: string, loadingPin: boolean) => {
    if (!chatId) return;
    setPinningChatIds((prev) => {
      if (loadingPin) {
        return prev.includes(chatId) ? prev : [...prev, chatId];
      }
      return prev.filter((id) => id !== chatId);
    });
  }, []);

  const handleTogglePinnedChat = useCallback(
    async (chat: ListChatsResult) => {
      if (!chat.chat_id || !isPinnableChat(chat)) {
        Alert.alert(pt.error_title, pt.chat_pin_error);
        return;
      }

      if (pinningChatIds.includes(chat.chat_id)) {
        return;
      }

      const wasPinned = pinnedChatIds.has(chat.chat_id);
      const previousPinnedChats = pinnedChats;

      setPinningChat(chat.chat_id, true);
      setPinnedChats((prev) =>
        wasPinned
          ? prev.filter((item) => item.chat_id !== chat.chat_id)
          : normalizePinnedChats([chat, ...prev])
      );

      let ok = false;
      try {
        ok = wasPinned
          ? await unpinChatApi(chat.chat_id)
          : await pinChatApi(chat.chat_id);
      } catch {
        ok = false;
      } finally {
        setPinningChat(chat.chat_id, false);
      }

      if (!ok) {
        setPinnedChats(previousPinnedChats);
        Alert.alert(
          pt.error_title,
          wasPinned ? pt.chat_unpin_error : pt.chat_pin_error
        );
      } else {
        emitChatPinningChange({ chat, pinned: !wasPinned });
      }
    },
    [
      normalizePinnedChats,
      pinnedChatIds,
      pinnedChats,
      pinningChatIds,
      setPinningChat,
    ]
  );

  const visibleWorkerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...pinnedChats, ...queue, ...inChat]) {
      const workerId = item.worker?.id;
      if (workerId) ids.add(workerId);
    }
    return Array.from(ids);
  }, [inChat, pinnedChats, queue]);

  useEffect(() => {
    const missingWorkerIds = visibleWorkerIds.filter(
      (workerId) => !(workerId in workerConfigById)
    );
    if (missingWorkerIds.length === 0) return;

    let cancelled = false;
    Promise.all(
      missingWorkerIds.map(async (workerId) => ({
        workerId,
        config: await viewWorkerConfigForChat(workerId).catch(() => null),
      }))
    ).then((results) => {
      if (cancelled) return;
      setWorkerConfigById((prev) => {
        const next = { ...prev };
        for (const item of results) {
          next[item.workerId] = item.config;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [visibleWorkerIds, workerConfigById]);

  useEffect(() => {
    setOperatorReplyPendingNow(Date.now());
    const timer = setInterval(() => {
      setOperatorReplyPendingNow(Date.now());
    }, 30000);

    return () => {
      clearInterval(timer);
    };
  }, []);

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

  const visiblePinnedChats = canShowPinnedChats ? pinnedChats : [];
  const visibleInChat = removePinnedFromSections(inChat);
  const visibleQueue = removePinnedFromSections(queue);
  const sections: {
    title: string;
    data: ListChatsResult[];
    isPinned?: boolean;
  }[] = [];
  if (visiblePinnedChats.length > 0) {
    sections.push({
      title: pt.fixed_chats,
      data: visiblePinnedChats,
      isPinned: true,
    });
  }
  if (tab === 'closed') {
    sections.push({ title: pt.closed, data: visibleQueue });
  } else if (tab === 'chatbot') {
    sections.push({ title: pt.chatbot, data: visibleInChat });
  } else {
    if (visibleInChat.length > 0)
      sections.push({ title: pt.in_service, data: visibleInChat });
    if (visibleQueue.length > 0)
      sections.push({ title: pt.awaiting_service, data: visibleQueue });
  }
  if (sections.length === 0) {
    let emptyTitle = pt.chatbot;
    if (tab === 'queue') emptyTitle = pt.awaiting_service;
    if (tab === 'in_chat') emptyTitle = pt.in_service;
    if (tab === 'closed') emptyTitle = pt.closed;
    sections.push({ title: emptyTitle, data: [] });
  }

  const hasAdvancedFiltersApplied = hasAppliedAdvancedFilters;
  const inChatAllCount = chatCounts.in_chat ?? 0;
  const inChatMineCount = chatCounts.in_chat_mine ?? chatCounts.my_chats ?? 0;
  const chatbotScheduleCount =
    chatCounts.chatbot_schedule ?? chatCounts.schedule ?? 0;
  const chatbotCountsByFilter: Record<ChatbotFilterStatus, number> = {
    ura: chatCounts.chatbot_input ?? 0,
    ura_output: chatCounts.chatbot_output ?? 0,
    ura_schedule: chatbotScheduleCount,
    ura_webhook: chatCounts.chatbot_webhook ?? 0,
  };

  const renderQuickFilterChipContent = (
    label: string,
    count: number,
    active: boolean
  ) => {
    return (
      <View style={styles.quickFilterChipContent}>
        <Text
          style={[
            styles.quickFilterChipText,
            active && styles.quickFilterChipTextActive,
          ]}
        >
          {label}
        </Text>
        <View
          style={[
            styles.quickFilterChipBadge,
            active && styles.quickFilterChipBadgeActive,
          ]}
        >
          <Text
            style={[
              styles.quickFilterChipBadgeText,
              active && styles.quickFilterChipBadgeTextActive,
            ]}
          >
            {formatBadgeCount(count)}
          </Text>
        </View>
      </View>
    );
  };

  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Pressable
            style={styles.avatarPlaceholder}
            onPress={handleOpenProfileSidebar}
            accessibilityLabel="Abrir perfil"
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
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>Chat</Text>
            <Text style={styles.headerSubtitle}>
              {tab === 'queue'
                ? pt.awaiting_service
                : tab === 'in_chat'
                  ? pt.in_service
                  : tab === 'closed'
                    ? pt.closed
                    : tab === 'chatbot'
                      ? pt.chatbot
                      : pt.all}
            </Text>
          </View>
          <Pressable
            style={styles.headerAction}
            onPress={openNotificationSheet}
            accessibilityLabel="Configurar notificações"
          >
            <Ionicons
              name={
                notificationSettings.notifications !== false
                  ? 'notifications-outline'
                  : 'notifications-off-outline'
              }
              size={20}
              color={colors.primary}
            />
          </Pressable>
        </View>
        <View style={styles.searchActionRow}>
          <View style={styles.searchWrap}>
            <Ionicons
              name="search"
              size={20}
              color={colors.grey500}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder={pt.search_service}
              placeholderTextColor={colors.grey500}
              value={search}
              onChangeText={(value) => {
                closeOpenedSwipeable();
                setSearch(value);
              }}
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
            style={styles.filterBtn}
            onPress={() => {
              dismissKeyboard();
              closeOpenedSwipeable();
              setFilterModalVisible(true);
            }}
          >
            <Ionicons name="filter" size={22} color={colors.onSurface} />
          </Pressable>
          {hasAdvancedFiltersApplied ? (
            <Pressable
              style={styles.clearFilterBtn}
              onPress={() => {
                dismissKeyboard();
                closeOpenedSwipeable();
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
      </View>
      <ChannelStatusBanner />
      {tab === 'in_chat' ? (
        <View style={styles.quickFilterRow}>
          <Pressable
            style={[
              styles.quickFilterChip,
              inChatScope === 'all' && styles.quickFilterChipActive,
            ]}
            onPress={dismissKeyboardAnd(() => setInChatScope('all'))}
          >
            {renderQuickFilterChipContent(
              pt.all_attendances,
              inChatAllCount,
              inChatScope === 'all'
            )}
          </Pressable>
          <Pressable
            style={[
              styles.quickFilterChip,
              inChatScope === 'mine' && styles.quickFilterChipActive,
            ]}
            onPress={dismissKeyboardAnd(() => setInChatScope('mine'))}
          >
            {renderQuickFilterChipContent(
              pt.my_attendances,
              inChatMineCount,
              inChatScope === 'mine'
            )}
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
                onPress={dismissKeyboardAnd(() =>
                  toggleChatbotFilter(option.value)
                )}
              >
                {renderQuickFilterChipContent(
                  option.label,
                  chatbotCountsByFilter[option.value] ?? 0,
                  active
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <UserSidebar
        visible={profileSidebarVisible}
        onClose={handleCloseProfileSidebar}
        onProfileUpdated={(nextPhoto) => setUserPhoto(nextPhoto)}
        onStatusUpdated={setUserStatus}
      />
      <ChatNotificationSettingsSheet
        visible={notificationSheetVisible}
        settings={notificationSettings}
        loading={notificationSettingsLoading}
        saving={notificationSettingsSaving}
        onClose={closeNotificationSheet}
        onSave={saveNotificationSettings}
      />
      <OpeningConversationModal
        visible={openingChatId !== null}
        variant="chat"
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
      <Modal
        visible={labelInfoModalVisible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => setLabelInfoModalVisible(false)}
      >
        <View
          style={[
            styles.transferOverlay,
            { paddingBottom: 16 + insets.bottom },
          ]}
        >
          <Pressable
            style={styles.transferBackdrop}
            onPress={() => setLabelInfoModalVisible(false)}
          />
          <View style={styles.labelInfoCard}>
            <View style={styles.transferHeaderRow}>
              <Text style={styles.transferTitle}>{pt.view_labels}</Text>
              <Pressable
                onPress={() => setLabelInfoModalVisible(false)}
                hitSlop={12}
              >
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>
            {labelInfoNames.map((labelName, index) => (
              <View
                key={`label-info-${labelName}-${index}`}
                style={styles.labelInfoRow}
              >
                <Text style={styles.labelInfoRowText}>{labelName}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        visible={closeServiceModalVisible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={() => {
          if (!isClosingChat) closeCloseServiceModal();
        }}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={modalKeyboardAvoidingBehavior}
          keyboardVerticalOffset={getModalKeyboardVerticalOffset(
            insets.bottom + 8,
            ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET
          )}
        >
          <View
            style={[
              styles.transferOverlay,
              { paddingBottom: 16 + insets.bottom },
            ]}
          >
            <Pressable
              style={styles.transferBackdrop}
              onPress={closeCloseServiceModal}
              disabled={isClosingChat}
            />
            <View style={styles.closeServiceCard}>
              <View style={styles.transferHeaderRow}>
                <Text style={styles.transferTitle}>{pt.close_service}</Text>
                <Pressable
                  onPress={closeCloseServiceModal}
                  hitSlop={12}
                  disabled={isClosingChat}
                >
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.closeServiceScroll}
                contentContainerStyle={styles.closeServiceScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={
                  Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                }
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.closeServiceMessage}>
                  {pt.close_service_confirmation}
                </Text>

                {canToggleOptionalClosureReasonAction ? (
                  <>
                    {!closeServiceBackendRequiresClosureReason ? (
                      <View style={styles.closeServiceToggleRow}>
                        <View style={styles.closeServiceToggleTextWrap}>
                          <Text style={styles.closeServiceToggleLabel}>
                            {pt.close_service_inform_closure_toggle_label}
                          </Text>
                          <Text style={styles.closeServiceToggleDescription}>
                            {pt.close_service_inform_closure_toggle_description}
                          </Text>
                        </View>
                        <Switch
                          value={closeServiceInformClosureReason}
                          onValueChange={(value) => {
                            setCloseServiceInformClosureReason(value);
                            setCloseServiceClosureError(null);
                          }}
                          trackColor={{
                            false: colors.grey400,
                            true: colors.primary,
                          }}
                          thumbColor="#FFFFFF"
                        />
                      </View>
                    ) : null}
                    {showCloseServiceClosureReasonInput ? (
                      <TextInput
                        ref={closeServiceClosureInputRef}
                        style={styles.closeServiceClosureInput}
                        value={closeServiceClosureComment}
                        onChangeText={handleCloseServiceClosureCommentChange}
                        placeholder={pt.closure_reason_label}
                        placeholderTextColor={colors.grey500}
                        multiline
                        maxLength={1000}
                        textAlignVertical="top"
                      />
                    ) : null}
                  </>
                ) : (
                  <TextInput
                    ref={closeServiceClosureInputRef}
                    style={styles.closeServiceClosureInput}
                    value={closeServiceClosureComment}
                    onChangeText={handleCloseServiceClosureCommentChange}
                    placeholder={pt.closure_reason_label}
                    placeholderTextColor={colors.grey500}
                    multiline
                    maxLength={1000}
                    textAlignVertical="top"
                  />
                )}

                {closeServiceClosureError ? (
                  <Text style={styles.closeServiceErrorText}>
                    {closeServiceClosureError}
                  </Text>
                ) : null}

                {isLoadingCloseServiceWorkerConfig ? (
                  <View style={styles.transferLoadingWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : shouldShowCloseServiceSendMessageToggle ? (
                  <View style={styles.closeServiceToggleRow}>
                    <View style={styles.closeServiceToggleTextWrap}>
                      <Text style={styles.closeServiceToggleLabel}>
                        {pt.close_service_send_message_toggle_label}
                      </Text>
                      <Text style={styles.closeServiceToggleDescription}>
                        {pt.close_service_send_message_toggle_description}
                      </Text>
                    </View>
                    <Switch
                      value={closeServiceSendMessageOnFinishAttendance}
                      onValueChange={
                        setCloseServiceSendMessageOnFinishAttendance
                      }
                      trackColor={{
                        false: colors.grey400,
                        true: colors.primary,
                      }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.transferActionsRow}>
                <Pressable
                  style={styles.transferCancelBtn}
                  onPress={closeCloseServiceModal}
                  disabled={isClosingChat}
                >
                  <Text style={styles.transferCancelText}>{pt.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.closeServiceConfirmBtn,
                    isClosingChat && styles.actionBtnDisabled,
                  ]}
                  onPress={dismissKeyboardAnd(() => void confirmCloseChat())}
                  disabled={isClosingChat}
                >
                  {isClosingChat ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Text style={styles.transferSubmitText}>
                      {pt.close_service}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={transferModalVisible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={closeTransferModal}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={modalKeyboardAvoidingBehavior}
          keyboardVerticalOffset={getModalKeyboardVerticalOffset(
            insets.bottom + 8,
            ANDROID_MODAL_KEYBOARD_VERTICAL_OFFSET
          )}
        >
          <View
            style={[
              styles.transferOverlay,
              { paddingBottom: 16 + insets.bottom },
            ]}
          >
            <Pressable
              style={styles.transferBackdrop}
              onPress={dismissKeyboardAnd(closeTransferModal)}
            />
            <View style={styles.transferCard}>
              <View style={styles.transferHeaderRow}>
                <Text style={styles.transferTitle}>{pt.transfer_to}</Text>
                <Pressable
                  onPress={dismissKeyboardAnd(closeTransferModal)}
                  hitSlop={12}
                >
                  <Ionicons name="close" size={22} color={colors.onSurface} />
                </Pressable>
              </View>

              {isLoadingTransferOptions ? (
                <View style={styles.transferLoadingWrap}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <>
                  <SelectField
                    label={pt.channel}
                    valueLabel={selectedTransferChannelLabel}
                    placeholder={pt.transfer_select_channel}
                    onPress={dismissKeyboardAnd(() =>
                      setTransferPickerKind('channel')
                    )}
                    containerStyle={styles.transferSelectContainer}
                  />

                  <SelectField
                    label={pt.transfer_to}
                    valueLabel={selectedTransferTypeLabel}
                    placeholder={pt.transfer_to_placeholder}
                    onPress={dismissKeyboardAnd(() =>
                      setTransferPickerKind('type')
                    )}
                    containerStyle={styles.transferSelectContainer}
                  />

                  {transferType === 'user' ? (
                    <SelectField
                      label={pt.attendant}
                      valueLabel={selectedTransferUserLabel}
                      placeholder={pt.transfer_select_user}
                      onPress={dismissKeyboardAnd(() =>
                        setTransferPickerKind('user')
                      )}
                      containerStyle={styles.transferSelectContainer}
                    />
                  ) : null}

                  {transferType === 'sector' ? (
                    <>
                      <SelectField
                        label={pt.sector}
                        valueLabel={selectedTransferSectorLabel}
                        placeholder={pt.transfer_select_sector}
                        onPress={dismissKeyboardAnd(() =>
                          setTransferPickerKind('sector')
                        )}
                        containerStyle={styles.transferSelectContainer}
                      />

                      <SelectField
                        label={pt.transfer_sector_user_optional}
                        valueLabel={selectedTransferSectorUserLabel}
                        placeholder={pt.transfer_select_sector_user}
                        onPress={dismissKeyboardAnd(() =>
                          setTransferPickerKind('sector_user')
                        )}
                        disabled={!selectedTransferSectorId}
                        loading={isLoadingTransferSectorUsers}
                        containerStyle={styles.transferSelectContainer}
                      />
                    </>
                  ) : null}

                  {transferType === 'chatbot' ? (
                    <SelectField
                      label={pt.chatbot}
                      valueLabel={selectedTransferChatbotLabel}
                      placeholder={pt.transfer_select_chatbot}
                      onPress={dismissKeyboardAnd(() =>
                        setTransferPickerKind('chatbot')
                      )}
                      disabled={!selectedTransferChannelId}
                      containerStyle={styles.transferSelectContainer}
                    />
                  ) : null}

                  <Text style={styles.transferFieldLabel}>
                    {pt.transfer_annotation}
                  </Text>
                  <TextInput
                    style={styles.transferAnnotationInput}
                    value={transferAnnotation}
                    onChangeText={setTransferAnnotation}
                    placeholder={pt.transfer_annotation_placeholder}
                    placeholderTextColor={colors.grey500}
                    multiline
                    maxLength={300}
                  />

                  {transferType !== 'chatbot' ? (
                    <View style={styles.transferKeepInChatRow}>
                      <View style={styles.transferKeepInChatTextWrap}>
                        <Text style={styles.transferKeepInChatLabel}>
                          {pt.keep_in_chat}
                        </Text>
                        <Text style={styles.transferKeepInChatDescription}>
                          {pt.keep_in_chat_description}
                        </Text>
                      </View>
                      <Switch
                        value={transferKeepInChat}
                        onValueChange={setTransferKeepInChat}
                        trackColor={{
                          false: colors.grey300,
                          true: colors.primary,
                        }}
                        thumbColor={colors.onPrimary}
                      />
                    </View>
                  ) : null}

                  {shouldShowTransferSendMessageToggle ? (
                    <View style={styles.transferKeepInChatRow}>
                      <View style={styles.transferKeepInChatTextWrap}>
                        <Text style={styles.transferKeepInChatLabel}>
                          {pt.send_message_on_transfer}
                        </Text>
                        <Text style={styles.transferKeepInChatDescription}>
                          {pt.send_message_on_transfer_description}
                        </Text>
                      </View>
                      <Switch
                        value={transferSendMessageOnTransfer}
                        onValueChange={setTransferSendMessageOnTransfer}
                        trackColor={{
                          false: colors.grey300,
                          true: colors.primary,
                        }}
                        thumbColor={colors.onPrimary}
                      />
                    </View>
                  ) : null}

                  <View style={styles.transferActionsRow}>
                    <Pressable
                      style={styles.transferCancelBtn}
                      onPress={dismissKeyboardAnd(closeTransferModal)}
                      disabled={isTransferring}
                    >
                      <Text style={styles.transferCancelText}>{pt.cancel}</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.transferSubmitBtn,
                        isTransferring && styles.actionBtnDisabled,
                      ]}
                      onPress={dismissKeyboardAnd(() => {
                        void submitTransfer();
                      })}
                      disabled={isTransferring}
                    >
                      {isTransferring ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.onPrimary}
                        />
                      ) : (
                        <Text style={styles.transferSubmitText}>
                          {pt.transfer}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
          <SelectSheet
            visible={transferPickerKind !== null}
            title={transferPickerTitle}
            options={transferPickerOptions}
            selectedValue={selectedTransferPickerValue}
            emptyText={pt.no_results_found}
            searchPlaceholder={pt.select_search_placeholder}
            onRequestClose={dismissKeyboardAnd(() =>
              setTransferPickerKind(null)
            )}
            onSelectValue={handleSelectTransferPickerValue}
          />
        </KeyboardAvoidingView>
      </Modal>
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
          onTouchStart={() => {
            dismissKeyboard();
            closeOpenedSwipeable();
          }}
          onScrollBeginDrag={() => {
            dismissKeyboard();
            closeOpenedSwipeable();
          }}
          keyboardDismissMode="on-drag"
          keyExtractor={(item) => item.chat_id}
          renderItem={({ item, index, section }) => {
            const isPinnedSection = section.isPinned === true;
            const queueIndexForItem =
              item.status === 'queue'
                ? isPinnedSection
                  ? queue.findIndex((chat) => chat.chat_id === item.chat_id)
                  : index
                : null;
            const normalizedQueueIndexForOpen =
              item.status === 'queue'
                ? queueIndexForItem !== null && queueIndexForItem >= 0
                  ? queueIndexForItem
                  : canPickAnyQueueChat
                    ? null
                    : 1
                : null;
            const isQueueItemLocked =
              item.status === 'queue' &&
              !canPickAnyQueueChat &&
              queueIndexForItem !== 0;
            const canOpenByVisibility = canViewChat(item, {
              permissions: socketPermissions,
              userId: currentUserId,
              userSectors,
              userChannels,
            });

            const isInChatItem = item.status === 'in_chat';
            const isQueueItem = item.status === 'queue';
            const isPrimaryInChatItem = isChatPrimary(item, currentUserId);
            const canManageInChatItem =
              isInChatItem &&
              (isPrimaryInChatItem ||
                isCurrentUserMasterOrAdministrator ||
                canManageInChatLifecyclePermission(socketPermissions));
            const canAttendQueueItem =
              isQueueItem && (canPickAnyQueueChat || queueIndexForItem === 0);
            const canCloseQueueItem =
              isQueueItem && canCloseChatWithoutAttending(socketPermissions);
            const canTransferItem = isQueueItem || canManageInChatItem;
            const canCloseItem = canManageInChatItem || canCloseQueueItem;
            const canPinItem = isPinnableChat(item);
            const isPinned = pinnedChatIds.has(item.chat_id);
            const pinLoading = pinningChatIds.includes(item.chat_id);
            const canShowLifecycleSwipeActions = !isQueueItemLocked;
            const canSwipe =
              canOpenByVisibility &&
              (canPinItem ||
                (canShowLifecycleSwipeActions &&
                  (isInChatItem || isQueueItem)));

            const row = (
              <ChatRow
                item={item}
                chatbotTypeLabel={
                  tab === 'chatbot'
                    ? chatbotTypeLabelByStatus(item.status)
                    : null
                }
                onPressLabelDetails={openLabelInfoModal}
                workerConfig={workerConfigById[item.worker?.id ?? ''] ?? null}
                now={operatorReplyPendingNow}
                disabled={
                  isQueueItemLocked ||
                  !canOpenByVisibility ||
                  openingChatId !== null
                }
                onPress={() => void openChat(item, normalizedQueueIndexForOpen)}
              />
            );

            const closeSwipeLabel =
              pt.close_service.split(' ')[0] || pt.close_service;

            const queueActions = [
              {
                key: 'pin',
                visible: canPinItem,
                style: styles.swipePinBtn,
                label: isPinned ? pt.unpin : pt.pin,
                loading: pinLoading,
                disabled: pinLoading,
                onPress: () => {
                  openedSwipeableRef.current?.close();
                  void handleTogglePinnedChat(item);
                },
              },
              {
                key: 'attend',
                visible: canShowLifecycleSwipeActions && isQueueItem,
                style: styles.swipeAttendBtn,
                label: pt.attend_service,
                loading: attendingChatId === item.chat_id,
                disabled:
                  attendingChatId !== null && attendingChatId !== item.chat_id,
                onPress: () => {
                  if (!canAttendQueueItem) {
                    Alert.alert(
                      pt.warning_title,
                      pt.action_unavailable_by_permission
                    );
                    return;
                  }
                  void handleAttendQueueChat(item);
                },
              },
              {
                key: 'transfer',
                visible: canShowLifecycleSwipeActions && canTransferItem,
                style: styles.swipeTransferBtn,
                label: pt.transfer,
                loading: false,
                disabled: attendingChatId !== null,
                onPress: () => {
                  openedSwipeableRef.current?.close();
                  void openTransferModal(item);
                },
              },
              {
                key: 'close',
                visible: canShowLifecycleSwipeActions && canCloseItem,
                style: styles.swipeCloseBtn,
                label: closeSwipeLabel,
                loading: false,
                disabled: attendingChatId !== null,
                onPress: () => {
                  handleCloseChat(item);
                },
              },
            ].filter((action) => action.visible);

            if (!canSwipe || queueActions.length === 0) {
              return row;
            }

            const maxActionsWidth = Math.max(
              140,
              Math.floor(screenWidth * 0.65)
            );
            const actionWidth = Math.floor(
              maxActionsWidth / Math.max(queueActions.length, 1)
            );
            const rowSwipeableRef = createRef<SwipeableMethods | null>();

            return (
              <ReanimatedSwipeable
                ref={rowSwipeableRef}
                friction={1.6}
                rightThreshold={32}
                overshootRight={false}
                containerStyle={styles.swipeableContainer}
                childrenContainerStyle={styles.swipeableChildrenContainer}
                onSwipeableWillOpen={(direction) => {
                  if (direction !== SwipeDirection.RIGHT) return;
                  if (
                    openedSwipeableRef.current &&
                    openedSwipeableRef.current !== rowSwipeableRef.current
                  ) {
                    openedSwipeableRef.current.close();
                  }
                }}
                onSwipeableOpen={(direction) => {
                  if (direction !== SwipeDirection.RIGHT) return;
                  openedSwipeableRef.current = rowSwipeableRef.current;
                }}
                onSwipeableClose={(direction) => {
                  if (
                    direction === SwipeDirection.RIGHT &&
                    openedSwipeableRef.current
                  ) {
                    openedSwipeableRef.current = null;
                  }
                }}
                renderRightActions={(_progress, _translation) => {
                  const actionsWidth = actionWidth * queueActions.length;

                  return (
                    <View
                      style={[
                        styles.swipeActionsAnimated,
                        {
                          width: actionsWidth,
                        },
                      ]}
                    >
                      <View style={styles.swipeActionsRow}>
                        {queueActions.map((action) => (
                          <Pressable
                            key={`${item.chat_id}-${action.key}`}
                            style={[
                              styles.swipeActionBtn,
                              action.style,
                              action.disabled && styles.actionBtnDisabled,
                              { width: actionWidth },
                            ]}
                            onPress={action.onPress}
                            disabled={action.disabled || action.loading}
                          >
                            <View style={styles.swipeActionTextWrap}>
                              {action.loading ? (
                                <ActivityIndicator
                                  size="small"
                                  color={colors.onPrimary}
                                />
                              ) : (
                                <Text
                                  style={styles.swipeActionText}
                                  numberOfLines={1}
                                >
                                  {action.label}
                                </Text>
                              )}
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  );
                }}
              >
                {row}
              </ReanimatedSwipeable>
            );
          }}
          renderSectionHeader={({ section }) => (
            <SectionHeader title={section.title} />
          )}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          ListFooterComponent={
            isLoadingMore ? <ChatListLoadMoreSkeleton /> : null
          }
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
    backgroundColor: colors.surface,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    color: colors.grey600,
    fontSize: 12,
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
  searchActionRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
  quickFilterChipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickFilterChipBadge: {
    minWidth: 22,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  quickFilterChipBadgeActive: {
    backgroundColor: colors.onPrimary,
  },
  quickFilterChipBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.onSurface,
  },
  quickFilterChipBadgeTextActive: {
    color: colors.primary,
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
  loadMoreSkeletonList: {
    paddingBottom: 12,
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
  chatRowWithAttendant: {
    paddingRight: 0,
  },
  chatRowPendingReplyAlert: {
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    backgroundColor: 'rgba(255, 77, 79, 0.05)',
  },
  chatRowDisabled: {
    opacity: 0.55,
  },
  chatAvatar: {
    marginRight: 12,
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
  pendingReplyAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  pendingReplyAlertText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    fontWeight: '600',
    color: colors.error,
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
  chatLastMessageToken: {
    color: colors.grey600,
  },
  chatLastMessageBold: {
    color: colors.grey600,
    fontWeight: '700',
  },
  chatLastMessageItalic: {
    color: colors.grey600,
    fontStyle: 'italic',
  },
  chatLastMessageStrike: {
    color: colors.grey600,
    textDecorationLine: 'line-through',
  },
  chatLastMessageCode: {
    color: colors.grey700,
  },
  badge: {
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.onError,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  metaChip: {
    backgroundColor: colors.tagBg,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: '100%',
  },
  channelChip: {
    backgroundColor: colors.grey100,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    maxWidth: '46%',
    flexShrink: 1,
  },
  channelChipText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '700',
  },
  labelChip: {
    paddingRight: 8,
  },
  metaChipText: {
    fontSize: 11,
    color: colors.tagText,
    fontWeight: '500',
  },
  attendantSideLabel: {
    alignSelf: 'stretch',
    width: 28,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: colors.grey200,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.grey100,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  attendantSideLabelText: {
    fontSize: 10,
    lineHeight: 10,
    fontWeight: '600',
    color: colors.onSurface,
    textAlign: 'center',
  },
  labelInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  labelInfoRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.grey200,
  },
  labelInfoRowText: {
    fontSize: 14,
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
  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-end',
    height: '100%',
  },
  swipeActionsAnimated: {
    height: '100%',
    overflow: 'hidden',
  },
  swipeableContainer: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  swipeableChildrenContainer: {
    backgroundColor: colors.surface,
  },
  swipeActionBtn: {
    minWidth: 68,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  swipeActionTextWrap: {
    transform: [{ rotate: '-90deg' }],
    alignItems: 'center',
    justifyContent: 'center',
    width: 92,
  },
  swipeAttendBtn: {
    backgroundColor: colors.success,
  },
  swipePinBtn: {
    backgroundColor: colors.primary,
  },
  swipeTransferBtn: {
    backgroundColor: colors.warning,
  },
  swipeCloseBtn: {
    backgroundColor: colors.error,
  },
  swipeActionText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  keyboardAvoiding: {
    flex: 1,
  },
  transferOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  transferBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  transferCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    maxHeight: '88%',
  },
  closeServiceCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    maxHeight: '88%',
  },
  closeServiceScroll: {
    flexShrink: 1,
  },
  closeServiceScrollContent: {
    paddingBottom: 2,
  },
  closeServiceMessage: {
    fontSize: 14,
    color: colors.onSurface,
    lineHeight: 20,
    marginBottom: 10,
  },
  closeServiceClosureInput: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  closeServiceErrorText: {
    marginTop: -4,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 16,
    color: colors.error,
  },
  closeServiceToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  closeServiceToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  closeServiceToggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeServiceToggleDescription: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
    lineHeight: 16,
  },
  closeServiceConfirmBtn: {
    borderRadius: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
    minWidth: 104,
  },
  transferHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  transferTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
  transferLoadingWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  transferFieldLabel: {
    fontSize: 12,
    color: colors.grey600,
    marginBottom: 4,
    marginTop: 8,
  },
  transferSelectContainer: {
    marginTop: 8,
  },
  transferAnnotationInput: {
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.onSurface,
    backgroundColor: colors.inputBg,
    textAlignVertical: 'top',
  },
  transferKeepInChatRow: {
    marginTop: 10,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  transferKeepInChatTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  transferKeepInChatLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  transferKeepInChatDescription: {
    marginTop: 2,
    fontSize: 12,
    color: colors.grey700,
    lineHeight: 16,
  },
  transferActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 14,
  },
  transferCancelBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  transferCancelText: {
    color: colors.onSurface,
    fontWeight: '600',
  },
  transferSubmitBtn: {
    borderRadius: 8,
    minHeight: 40,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    minWidth: 104,
  },
  transferSubmitText: {
    color: colors.onPrimary,
    fontWeight: '700',
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
  actionBtnDisabled: {
    opacity: 0.55,
  },
});
