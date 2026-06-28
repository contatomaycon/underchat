import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  ChatUserStatus,
  removeUserPhoto,
  updateChatUser,
  uploadUserPhoto,
} from '../api/chatApi';
import { getPermissions, getUser, patchUser } from '../storage/authStorage';
import {
  canUpdateOwnChatStatusPermission,
  hasChatAccessPermission,
} from '../constants/chatAuthorization';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { AppAvatar } from './AppAvatar';
import {
  dismissKeyboard,
  dismissKeyboardAnd,
  getModalKeyboardVerticalOffset,
  modalKeyboardAvoidingBehavior,
} from '../utils/keyboard';
import { teardownMobileSession } from '../utils/sessionTeardown';
import { useChannelStatus } from '../context/ChannelStatusContext';
import { addSessionUpdatedListener } from '../utils/appResumeBus';
import {
  disableBiometricLogin,
  enableBiometricLogin,
  getBiometricCapability,
  isBiometricLoginEnabled,
  type BiometricCapability,
} from '../utils/biometricAuth';

type SidebarStatus = 'online' | 'busy' | 'do_not_disturb' | 'away' | 'offline';
type PhotoPickerSource = 'camera' | 'gallery';
type ProfilePhotoFilePayload = {
  uri: string;
  name: string;
  mimeType: string;
};

const STATUS_OPTIONS: Array<{
  value: SidebarStatus;
  label: string;
  color: string;
}> = [
  { value: 'online', label: pt.online, color: colors.success },
  { value: 'busy', label: pt.busy, color: colors.error },
  {
    value: 'do_not_disturb',
    label: pt.do_not_disturb,
    color: colors.primaryDarken1,
  },
  {
    value: 'away',
    label: pt.away,
    color: colors.warning,
  },
  {
    value: 'offline',
    label: pt.offline,
    color: colors.grey600,
  },
];

interface UserSidebarProps {
  visible: boolean;
  onClose: () => void;
  onLogout?: () => void;
  onProfileUpdated?: (photo: string | null) => void;
  onStatusUpdated?: (status: ChatUserStatus) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStatus(value: unknown): SidebarStatus {
  if (value === 'busy') return 'busy';
  if (value === 'do_not_disturb') return 'do_not_disturb';
  if (value === 'away') return 'away';
  if (value === 'offline') return 'offline';
  return 'online';
}

function resolveProfilePhotoFile(
  asset: ImagePicker.ImagePickerAsset
): ProfilePhotoFilePayload | null {
  const uri = typeof asset.uri === 'string' ? asset.uri.trim() : '';
  if (uri.length === 0) return null;

  const mimeType =
    typeof asset.mimeType === 'string' && asset.mimeType.trim().length > 0
      ? asset.mimeType.trim()
      : 'image/jpeg';
  const fileNameRaw =
    typeof asset.fileName === 'string' ? asset.fileName.trim() : '';
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(fileNameRaw);
  const fallbackExtension = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';
  const name = hasExtension
    ? fileNameRaw
    : `profile-photo-${Date.now()}.${fallbackExtension}`;

  return {
    uri,
    name,
    mimeType,
  };
}

function readUserProfile(user: unknown): {
  userId: string | null;
  name: string;
  role: string;
  photo: string | null;
  about: string;
  status: SidebarStatus;
} {
  const root = isRecord(user) ? user : {};
  const info = isRecord(root.info) ? root.info : {};
  const type = isRecord(root.type) ? root.type : {};
  const chatUser = isRecord(root.chat_user) ? root.chat_user : {};

  const userId = readString(root.user_id) ?? readString(root.id);
  const name = readString(info.name) ?? '-';
  const role = readString(type.name) ?? '';
  const photoRaw = readString(info.photo);
  const photo = photoRaw && photoRaw !== 'null' ? photoRaw : null;

  return {
    userId,
    name,
    role,
    photo,
    about: readString(chatUser.about) ?? '',
    status: normalizeStatus(chatUser.status),
  };
}

function getBiometricSettingsDescription(
  capability: BiometricCapability | null
): string {
  if (!capability) {
    return pt.biometric_login_description;
  }

  if (capability.available) {
    return `Use ${capability.label} para desbloquear sua sessão salva.`;
  }

  if (capability.reason === 'not_enrolled') {
    return 'Cadastre Face ID, Touch ID ou fingerprint no aparelho para ativar.';
  }

  if (capability.reason === 'no_hardware') {
    return 'Este aparelho não possui biometria disponível.';
  }

  if (capability.reason === 'unsupported_platform') {
    return 'Disponível apenas no app Android ou iOS.';
  }

  return 'Biometria indisponível neste aparelho.';
}

const CHANNEL_STATUS_COLORS: Record<string, string> = {
  '019a930d-c6f6-766d-9c84-30af6ecc33b2': colors.success,
  '019a930d-c6f6-766d-9c84-3696c2cd5ed8': colors.error,
  '019a930d-c6f6-766d-9c84-48cb970a9f21': colors.error,
  '019a930d-c6f6-766d-9c84-5056ccf66633': colors.error,
  '019bcd18-ce66-77a2-9d7c-e48159c253da': colors.warning,
  '019a930d-c6f6-766d-9c84-52e87789979b': colors.warning,
  '019a930d-c6f6-766d-9c84-3904383fe742': colors.warning,
  '019a930d-c6f6-766d-9c84-3f0abf55560d': colors.grey400,
};

function getChannelDotColor(
  isOnline: boolean,
  statusId?: string | null
): string {
  if (isOnline) return colors.success;
  if (statusId && CHANNEL_STATUS_COLORS[statusId])
    return CHANNEL_STATUS_COLORS[statusId];
  return colors.warning;
}

function getChannelStatusLabel(
  isOnline: boolean,
  statusName?: string | null
): string {
  if (isOnline) return pt.channel_online;
  if (statusName) return statusName;
  return pt.channel_offline;
}

function ChannelStatusSection() {
  const { allChannelStatuses, isLoading, refresh } = useChannelStatus();
  const [expanded, setExpanded] = useState(false);

  const handleToggle = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      await refresh();
    }
  }, [expanded, refresh]);

  const issueCount = allChannelStatuses.filter((ch) => !ch.isOnline).length;

  return (
    <View style={channelStyles.section}>
      <Pressable
        style={channelStyles.button}
        onPress={dismissKeyboardAnd(handleToggle)}
      >
        <View style={channelStyles.buttonLeft}>
          <Ionicons name="wifi-outline" size={20} color={colors.onSurface} />
          <Text style={channelStyles.buttonLabel}>{pt.channel_status}</Text>
        </View>
        <View style={channelStyles.buttonRight}>
          {issueCount > 0 && (
            <View style={channelStyles.badge}>
              <Text style={channelStyles.badgeText}>{issueCount}</Text>
            </View>
          )}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.grey500}
          />
        </View>
      </Pressable>

      {expanded && (
        <View style={channelStyles.expandedContent}>
          {isLoading && allChannelStatuses.length === 0 ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : allChannelStatuses.length === 0 ? (
            <Text style={channelStyles.emptyText}>Nenhum canal encontrado</Text>
          ) : (
            <View style={channelStyles.list}>
              {allChannelStatuses.map((ch) => (
                <View key={ch.id} style={channelStyles.row}>
                  <View
                    style={[
                      channelStyles.dot,
                      {
                        backgroundColor: getChannelDotColor(
                          ch.isOnline,
                          ch.status?.id
                        ),
                      },
                    ]}
                  />
                  <Text style={channelStyles.name} numberOfLines={1}>
                    {ch.name}
                  </Text>
                  <Text
                    style={[
                      channelStyles.statusLabel,
                      { color: getChannelDotColor(ch.isOnline, ch.status?.id) },
                    ]}
                  >
                    {getChannelStatusLabel(ch.isOnline, ch.status?.name)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const channelStyles = StyleSheet.create({
  section: {
    marginTop: 24,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.grey100,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  buttonLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.onSurface,
  },
  buttonRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    backgroundColor: colors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  expandedContent: {
    marginTop: 12,
    paddingLeft: 4,
  },
  emptyText: {
    fontSize: 14,
    color: colors.grey500,
    fontStyle: 'italic',
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: colors.onSurface,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});

export function UserSidebar({
  visible,
  onClose,
  onLogout,
  onProfileUpdated,
  onStatusUpdated,
}: UserSidebarProps) {
  const insets = useSafeAreaInsets();
  const [hasAccess, setHasAccess] = useState(true);
  const [canUpdateOwnStatus, setCanUpdateOwnStatus] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('-');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const [about, setAbout] = useState('');
  const [status, setStatus] = useState<SidebarStatus>('online');

  const [statusSaving, setStatusSaving] = useState(false);
  const [aboutSaving, setAboutSaving] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);
  const [biometricCapability, setBiometricCapability] =
    useState<BiometricCapability | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const lastSyncedAboutRef = useRef('');
  const aboutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileReadyRef = useRef(false);
  const closePhotoModal = useCallback(() => {
    setPhotoModalVisible(false);
  }, []);
  const closeSidebar = useCallback(() => {
    setPhotoModalVisible(false);
    onClose();
  }, [onClose]);

  const statusColor = useMemo(() => {
    const selected = STATUS_OPTIONS.find((item) => item.value === status);
    return selected?.color ?? colors.success;
  }, [status]);
  const statusLabel = useMemo(() => {
    const selected = STATUS_OPTIONS.find((item) => item.value === status);
    return selected?.label ?? pt.online;
  }, [status]);
  const biometricDescription = useMemo(
    () => getBiometricSettingsDescription(biometricCapability),
    [biometricCapability]
  );
  const biometricAvailable = biometricCapability?.available === true;

  const loadBiometricSettings = useCallback(async (): Promise<void> => {
    const [capability, enabled] = await Promise.all([
      getBiometricCapability(),
      isBiometricLoginEnabled(),
    ]);
    setBiometricCapability(capability);
    setBiometricEnabled(enabled);
  }, []);

  const persistProfile = useCallback(
    async (input?: {
      about?: string;
      status?: SidebarStatus;
    }): Promise<boolean> => {
      const resolvedAbout = input?.about ?? about;
      const resolvedStatus = input?.status ?? status;

      const payload: {
        about: string;
        status?: ChatUserStatus;
      } = {
        about: resolvedAbout,
      };

      if (input?.status && canUpdateOwnStatus) {
        payload.status = resolvedStatus as ChatUserStatus;
      }

      const ok = await updateChatUser(payload);
      if (!ok) {
        Alert.alert(pt.error_title, pt.chat_config_update_error);
        return false;
      }

      await patchUser({
        chat_user: {
          about: resolvedAbout,
          ...(input?.status && canUpdateOwnStatus
            ? { status: resolvedStatus }
            : {}),
        },
      });

      if (input?.status) {
        onStatusUpdated?.(resolvedStatus);
      }

      return true;
    },
    [about, canUpdateOwnStatus, onStatusUpdated, status]
  );

  useEffect(() => {
    if (!visible) {
      profileReadyRef.current = false;
      setPhotoModalVisible(false);
      setLoadingProfile(false);
      setStatusSaving(false);
      setAboutSaving(false);
      setPhotoLoading(false);
      setBiometricLoading(false);
      if (aboutTimerRef.current) {
        clearTimeout(aboutTimerRef.current);
        aboutTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setLoadingProfile(true);
    void loadBiometricSettings().catch(() => {
      setBiometricCapability(null);
      setBiometricEnabled(false);
    });

    const loadProfile = async () => {
      const permissions = await getPermissions();
      if (cancelled) return;

      const hasPermission = hasChatAccessPermission(permissions);
      const canUpdateStatus = canUpdateOwnChatStatusPermission(permissions);
      setHasAccess(hasPermission);
      setCanUpdateOwnStatus(canUpdateStatus);

      const user = await getUser();
      if (cancelled) return;

      const profile = readUserProfile(user);
      setUserId(profile.userId);
      setName(profile.name);
      setRole(profile.role);
      setPhoto(profile.photo);
      setAbout(profile.about);
      setStatus(profile.status);
      lastSyncedAboutRef.current = profile.about;
      profileReadyRef.current = true;
      setLoadingProfile(false);
    };

    loadProfile().catch(() => {
      if (cancelled) return;
      setLoadingProfile(false);
      setHasAccess(false);
      setCanUpdateOwnStatus(false);
    });

    return () => {
      cancelled = true;
      if (aboutTimerRef.current) {
        clearTimeout(aboutTimerRef.current);
        aboutTimerRef.current = null;
      }
    };
  }, [loadBiometricSettings, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    return addSessionUpdatedListener(() => {
      void (async () => {
        const permissions = await getPermissions();
        const hasPermission = hasChatAccessPermission(permissions);
        const canUpdateStatus = canUpdateOwnChatStatusPermission(permissions);
        setHasAccess(hasPermission);
        setCanUpdateOwnStatus(canUpdateStatus);

        const user = await getUser();
        const profile = readUserProfile(user);
        setUserId(profile.userId);
        setName(profile.name);
        setRole(profile.role);
        setPhoto(profile.photo);
        setAbout(profile.about);
        setStatus(profile.status);
        lastSyncedAboutRef.current = profile.about;
        profileReadyRef.current = true;
      })().catch(() => {
        setHasAccess(false);
        setCanUpdateOwnStatus(false);
      });
    });
  }, [visible]);

  useEffect(() => {
    if (!visible || !hasAccess || !profileReadyRef.current) {
      return;
    }

    if (about === lastSyncedAboutRef.current) {
      return;
    }

    if (aboutTimerRef.current) {
      clearTimeout(aboutTimerRef.current);
    }

    aboutTimerRef.current = setTimeout(async () => {
      setAboutSaving(true);
      const ok = await persistProfile({ about });
      if (ok) {
        lastSyncedAboutRef.current = about;
      }
      setAboutSaving(false);
    }, 1000);

    return () => {
      if (aboutTimerRef.current) {
        clearTimeout(aboutTimerRef.current);
        aboutTimerRef.current = null;
      }
    };
  }, [about, hasAccess, persistProfile, visible]);

  const handleStatusChange = useCallback(
    async (nextStatus: SidebarStatus) => {
      if (!canUpdateOwnStatus) {
        return;
      }

      if (statusSaving || nextStatus === status) return;

      const previous = status;
      setStatus(nextStatus);
      setStatusSaving(true);

      const ok = await persistProfile({ status: nextStatus });
      if (!ok) {
        setStatus(previous);
      }

      setStatusSaving(false);
    },
    [canUpdateOwnStatus, persistProfile, status, statusSaving]
  );

  const uploadPhotoByAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      if (!userId) return;
      const filePayload = resolveProfilePhotoFile(asset);
      if (!filePayload) return;

      try {
        setPhotoLoading(true);
        let uploaded: { photo: string | null } | null = null;

        if (Platform.OS === 'web') {
          const response = await fetch(filePayload.uri);
          const blob = await response.blob();
          uploaded = await uploadUserPhoto(userId, blob);
        } else {
          uploaded = await uploadUserPhoto(userId, {
            uri: filePayload.uri,
            name: filePayload.name,
            type: filePayload.mimeType,
          } as unknown as Blob);
        }

        if (!uploaded) {
          Alert.alert(pt.error_title, pt.profile_photo_upload_error);
          return;
        }

        const nextPhoto = uploaded.photo ?? null;
        setPhoto(nextPhoto);
        await patchUser({ info: { photo: nextPhoto } });
        onProfileUpdated?.(nextPhoto);
        setPhotoModalVisible(false);
        Alert.alert(pt.success_title, pt.profile_photo_upload_success);
      } catch {
        Alert.alert(pt.error_title, pt.profile_photo_upload_error);
      } finally {
        setPhotoLoading(false);
      }
    },
    [onProfileUpdated, userId]
  );

  const handlePickPhoto = useCallback(
    async (source: PhotoPickerSource) => {
      if (photoLoading || !userId) return;

      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          pt.warning_title,
          source === 'camera'
            ? pt.camera_permission_denied
            : pt.image_permission_denied
        );
        return;
      }

      const pickerResult =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.9,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.9,
              allowsMultipleSelection: false,
            });

      if (
        pickerResult.canceled ||
        !pickerResult.assets ||
        pickerResult.assets.length === 0
      ) {
        return;
      }

      const asset = pickerResult.assets[0];
      if (!asset?.uri) return;
      await uploadPhotoByAsset(asset);
    },
    [photoLoading, uploadPhotoByAsset, userId]
  );

  const handleRemovePhoto = useCallback(async () => {
    if (!userId || !photo) return;

    try {
      setPhotoLoading(true);
      const removed = await removeUserPhoto(userId);
      if (!removed) {
        Alert.alert(pt.error_title, pt.profile_photo_remove_error);
        return;
      }

      setPhoto(null);
      await patchUser({ info: { photo: null } });
      onProfileUpdated?.(null);
      setPhotoModalVisible(false);
      Alert.alert(pt.success_title, pt.profile_photo_remove_success);
    } catch {
      Alert.alert(pt.error_title, pt.profile_photo_remove_error);
    } finally {
      setPhotoLoading(false);
    }
  }, [onProfileUpdated, photo, userId]);

  const handleBiometricToggle = useCallback(
    async (nextEnabled: boolean) => {
      if (biometricLoading) {
        return;
      }

      setBiometricLoading(true);

      try {
        if (nextEnabled) {
          const result = await enableBiometricLogin();
          if (!result.success) {
            Alert.alert(pt.error_title, result.message);
            await loadBiometricSettings();
            return;
          }

          setBiometricEnabled(true);
          Alert.alert(pt.success_title, pt.biometric_login_enabled);
          return;
        }

        await disableBiometricLogin();
        setBiometricEnabled(false);
        Alert.alert(pt.success_title, pt.biometric_login_disabled);
      } finally {
        setBiometricLoading(false);
      }
    },
    [biometricLoading, loadBiometricSettings]
  );

  const handleLogout = useCallback(async () => {
    setLogoutLoading(true);
    await teardownMobileSession({
      notifyPushServer: true,
      notifyServerLogout: true,
      emitUnauthorized: true,
    });
    setLogoutLoading(false);
    closeSidebar();
    onLogout?.();
  }, [closeSidebar, onLogout]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={closeSidebar}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={modalKeyboardAvoidingBehavior}
          keyboardVerticalOffset={getModalKeyboardVerticalOffset(8)}
        >
          <View style={[styles.overlay, { paddingBottom: insets.bottom }]}>
            <Pressable
              style={styles.backdrop}
              onPress={dismissKeyboardAnd(closeSidebar)}
            />
            <TouchableWithoutFeedback
              onPress={dismissKeyboard}
              accessible={false}
            >
              <View style={styles.sidebar}>
                <View
                  style={[
                    styles.sidebarHeader,
                    { paddingTop: insets.top + 12 },
                  ]}
                >
                  <Text style={styles.sidebarTitle}>{pt.account}</Text>
                  <Pressable
                    onPress={dismissKeyboardAnd(closeSidebar)}
                    hitSlop={12}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={24} color={colors.onSurface} />
                  </Pressable>
                </View>

                {loadingProfile ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : !hasAccess ? (
                  <View style={styles.permissionDeniedWrap}>
                    <Text style={styles.permissionDeniedText}>
                      {pt.chat_permission_denied}
                    </Text>
                  </View>
                ) : (
                  <>
                    <View style={styles.profileTop}>
                      <Pressable
                        style={styles.avatarWrap}
                        onPress={dismissKeyboardAnd(() =>
                          setPhotoModalVisible(true)
                        )}
                      >
                        <AppAvatar
                          uri={photo}
                          size={84}
                          style={styles.avatarImage}
                          iconName="person-circle-outline"
                          iconSize={84}
                          iconColor={colors.grey400}
                        />
                      </Pressable>
                      <Text style={styles.profileName}>{name}</Text>
                      <View style={styles.profileMetaRow}>
                        {role ? (
                          <Text style={styles.profileRole}>{role}</Text>
                        ) : null}
                        <View style={styles.profileStatusInline}>
                          <View
                            style={[
                              styles.profileStatusDot,
                              { backgroundColor: statusColor },
                            ]}
                          />
                          <Text style={styles.profileStatusText}>
                            {statusLabel}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <ScrollView
                      style={styles.scroll}
                      contentContainerStyle={styles.scrollContent}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode={
                        Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                      }
                    >
                      <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{pt.about}</Text>
                        <TextInput
                          style={styles.aboutInput}
                          multiline
                          value={about}
                          maxLength={200}
                          onChangeText={setAbout}
                          placeholder={pt.about}
                          placeholderTextColor={colors.grey500}
                        />
                        <View style={styles.aboutFooter}>
                          <Text style={styles.counterText}>
                            {about.length}/200
                          </Text>
                          {aboutSaving ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                            />
                          ) : null}
                        </View>
                      </View>

                      {canUpdateOwnStatus ? (
                        <View style={styles.section}>
                          <Text style={styles.sectionTitle}>
                            {pt.status_chat}
                          </Text>
                          <View style={styles.statusGroup}>
                            {STATUS_OPTIONS.map((option) => {
                              const active = status === option.value;
                              return (
                                <Pressable
                                  key={option.value}
                                  style={styles.statusOption}
                                  onPress={dismissKeyboardAnd(() =>
                                    handleStatusChange(option.value)
                                  )}
                                  disabled={statusSaving}
                                >
                                  <View
                                    style={[
                                      styles.statusRadio,
                                      active && {
                                        borderColor: option.color,
                                      },
                                    ]}
                                  >
                                    {active ? (
                                      <View
                                        style={[
                                          styles.statusRadioDot,
                                          { backgroundColor: option.color },
                                        ]}
                                      />
                                    ) : null}
                                  </View>
                                  <Text style={styles.statusLabel}>
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          {statusSaving ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                              style={styles.inlineLoader}
                            />
                          ) : null}
                        </View>
                      ) : null}

                      <View style={styles.section}>
                        <Text style={styles.sectionTitle}>{pt.settings}</Text>
                        <View
                          style={[
                            styles.settingRow,
                            !biometricAvailable &&
                              !biometricEnabled &&
                              styles.settingRowDisabled,
                          ]}
                        >
                          <View style={styles.settingIcon}>
                            <Ionicons
                              name="finger-print-outline"
                              size={22}
                              color={
                                biometricAvailable
                                  ? colors.primary
                                  : colors.grey500
                              }
                            />
                          </View>
                          <View style={styles.settingText}>
                            <Text style={styles.settingTitle}>
                              {pt.biometric_login}
                            </Text>
                            <Text style={styles.settingDescription}>
                              {biometricDescription}
                            </Text>
                          </View>
                          {biometricLoading ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.primary}
                            />
                          ) : (
                            <Switch
                              value={biometricEnabled}
                              onValueChange={handleBiometricToggle}
                              disabled={
                                !biometricAvailable && !biometricEnabled
                              }
                              trackColor={{
                                false: colors.grey300,
                                true: colors.primary,
                              }}
                              thumbColor={colors.surface}
                            />
                          )}
                        </View>
                      </View>

                      <ChannelStatusSection />
                    </ScrollView>
                  </>
                )}

                <View style={styles.footer}>
                  <Pressable
                    style={[
                      styles.logoutBtn,
                      logoutLoading && styles.logoutBtnDisabled,
                    ]}
                    onPress={dismissKeyboardAnd(handleLogout)}
                    disabled={logoutLoading}
                  >
                    {logoutLoading ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.onPrimary}
                      />
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
            </TouchableWithoutFeedback>
          </View>
          {photoModalVisible ? (
            <View style={styles.photoOverlayLayer}>
              <Pressable
                style={styles.photoOverlayBackdrop}
                onPress={dismissKeyboardAnd(closePhotoModal)}
              />
              <View style={styles.photoCard}>
                <View style={styles.photoHeader}>
                  <Text style={styles.photoTitle}>{pt.profile_photo}</Text>
                  <Pressable
                    onPress={dismissKeyboardAnd(closePhotoModal)}
                    hitSlop={10}
                  >
                    <Ionicons name="close" size={22} color={colors.onSurface} />
                  </Pressable>
                </View>

                <View style={styles.photoPreviewWrap}>
                  <AppAvatar
                    uri={photo}
                    size={120}
                    style={styles.photoPreview}
                    iconName="person-circle-outline"
                    iconSize={120}
                    iconColor={colors.grey400}
                  />
                </View>

                <View style={styles.photoActions}>
                  <Pressable
                    style={styles.primaryActionBtn}
                    onPress={dismissKeyboardAnd(() => {
                      void handlePickPhoto('camera');
                    })}
                    disabled={photoLoading}
                  >
                    {photoLoading ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.onPrimary}
                      />
                    ) : (
                      <Text style={styles.primaryActionText}>
                        {pt.open_camera}
                      </Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.neutralActionBtn}
                    onPress={dismissKeyboardAnd(() => {
                      void handlePickPhoto('gallery');
                    })}
                    disabled={photoLoading}
                  >
                    <Text style={styles.neutralActionText}>
                      {pt.select_photo}
                    </Text>
                  </Pressable>
                  {photo ? (
                    <Pressable
                      style={styles.secondaryActionBtn}
                      onPress={dismissKeyboardAnd(handleRemovePhoto)}
                      disabled={photoLoading}
                    >
                      <Text style={styles.secondaryActionText}>
                        {pt.remove_photo}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.onSurface,
  },
  closeBtn: {
    padding: 4,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
  profileTop: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  avatarWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 10,
    backgroundColor: colors.grey100,
    position: 'relative',
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  profileName: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.onSurface,
  },
  profileMetaRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  profileRole: {
    fontSize: 16,
    color: colors.grey600,
    textTransform: 'capitalize',
  },
  profileStatusInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  profileStatusText: {
    fontSize: 14,
    color: colors.grey700,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  section: {
    marginTop: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.grey700,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  aboutInput: {
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    minHeight: 110,
    textAlignVertical: 'top',
    fontSize: 16,
    color: colors.onSurface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  aboutFooter: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterText: {
    fontSize: 12,
    color: colors.grey600,
  },
  statusGroup: {
    gap: 10,
  },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.grey400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 18,
    color: colors.onSurface,
  },
  inlineLoader: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  settingRow: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: colors.grey200,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingRowDisabled: {
    opacity: 0.65,
  },
  settingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey100,
  },
  settingText: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
  },
  settingDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.grey600,
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
  photoOverlayLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 40,
    elevation: 40,
  },
  photoOverlayBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  photoCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: 16,
  },
  photoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  photoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onSurface,
  },
  photoPreviewWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  photoActions: {
    gap: 10,
  },
  primaryActionBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  neutralActionBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  neutralActionText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryActionBtn: {
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.error,
    fontSize: 15,
    fontWeight: '600',
  },
});
