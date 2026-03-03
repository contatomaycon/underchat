import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  ChatUserStatus,
  removeUserPhoto,
  updateChatUser,
  uploadUserPhoto,
} from '../api/chatApi';
import {
  clearAuth,
  getPermissions,
  getUser,
  patchUser,
} from '../storage/authStorage';
import { emitAuthUnauthorized } from '../utils/authEvents';
import { hasChatAccessPermission } from '../constants/chatAuthorization';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { AppAvatar } from './AppAvatar';
import { dismissKeyboard, dismissKeyboardAnd } from '../utils/keyboard';

type SidebarStatus = 'online' | 'busy' | 'do_not_disturb';
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

function readBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeStatus(value: unknown): SidebarStatus {
  if (value === 'busy') return 'busy';
  if (value === 'do_not_disturb') return 'do_not_disturb';
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
  notifications: boolean;
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
    notifications: readBoolean(chatUser.notifications),
  };
}

export function UserSidebar({
  visible,
  onClose,
  onLogout,
  onProfileUpdated,
  onStatusUpdated,
}: UserSidebarProps) {
  const [hasAccess, setHasAccess] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState('-');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);

  const [about, setAbout] = useState('');
  const [status, setStatus] = useState<SidebarStatus>('online');
  const [notifications, setNotifications] = useState(false);

  const [statusSaving, setStatusSaving] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [aboutSaving, setAboutSaving] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

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

  const persistProfile = useCallback(
    async (input?: {
      about?: string;
      status?: SidebarStatus;
      notifications?: boolean;
    }): Promise<boolean> => {
      const resolvedAbout = input?.about ?? about;
      const resolvedStatus = input?.status ?? status;
      const resolvedNotifications = input?.notifications ?? notifications;

      const payload = {
        about: resolvedAbout,
        status: resolvedStatus as ChatUserStatus,
        notifications: resolvedNotifications,
      };

      const ok = await updateChatUser(payload);
      if (!ok) {
        Alert.alert(pt.error_title, pt.chat_config_update_error);
        return false;
      }

      await patchUser({
        chat_user: {
          about: resolvedAbout,
          status: resolvedStatus,
          notifications: resolvedNotifications,
        },
      });

      if (input?.status) {
        onStatusUpdated?.(resolvedStatus);
      }

      return true;
    },
    [about, notifications, onStatusUpdated, status]
  );

  useEffect(() => {
    if (!visible) {
      profileReadyRef.current = false;
      setPhotoModalVisible(false);
      setLoadingProfile(false);
      setStatusSaving(false);
      setNotificationSaving(false);
      setAboutSaving(false);
      setPhotoLoading(false);
      if (aboutTimerRef.current) {
        clearTimeout(aboutTimerRef.current);
        aboutTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    setLoadingProfile(true);

    const loadProfile = async () => {
      const permissions = await getPermissions();
      if (cancelled) return;

      const hasPermission = hasChatAccessPermission(permissions);
      setHasAccess(hasPermission);

      const user = await getUser();
      if (cancelled) return;

      const profile = readUserProfile(user);
      setUserId(profile.userId);
      setName(profile.name);
      setRole(profile.role);
      setPhoto(profile.photo);
      setAbout(profile.about);
      setStatus(profile.status);
      setNotifications(profile.notifications);
      lastSyncedAboutRef.current = profile.about;
      profileReadyRef.current = true;
      setLoadingProfile(false);
    };

    loadProfile().catch(() => {
      if (cancelled) return;
      setLoadingProfile(false);
      setHasAccess(false);
    });

    return () => {
      cancelled = true;
      if (aboutTimerRef.current) {
        clearTimeout(aboutTimerRef.current);
        aboutTimerRef.current = null;
      }
    };
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
    [persistProfile, status, statusSaving]
  );

  const handleNotificationToggle = useCallback(
    async (nextValue: boolean) => {
      if (notificationSaving || nextValue === notifications) return;

      const previous = notifications;
      setNotifications(nextValue);
      setNotificationSaving(true);

      const ok = await persistProfile({ notifications: nextValue });
      if (!ok) {
        setNotifications(previous);
      }

      setNotificationSaving(false);
    },
    [notificationSaving, notifications, persistProfile]
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
              mediaTypes: ['images'],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 0.9,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
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

  const handleLogout = useCallback(async () => {
    setLogoutLoading(true);
    await clearAuth();
    emitAuthUnauthorized();
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
        onRequestClose={closeSidebar}
      >
        <View style={styles.overlay}>
          <Pressable
            style={styles.backdrop}
            onPress={dismissKeyboardAnd(closeSidebar)}
          />
          <TouchableWithoutFeedback
            onPress={dismissKeyboard}
            accessible={false}
          >
            <View style={styles.sidebar}>
              <View style={styles.sidebarHeader}>
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

                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{pt.status_chat}</Text>
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

                  <View style={[styles.section, styles.settingsSection]}>
                    <Text style={styles.sectionTitle}>{pt.settings}</Text>
                    <View style={styles.settingRow}>
                        <View style={styles.settingLabelWrap}>
                          <Ionicons
                            name="notifications-outline"
                            size={20}
                            color={colors.onSurface}
                          />
                          <Text style={styles.settingLabel}>
                            {pt.notification}
                          </Text>
                        </View>
                        <Pressable
                          style={[
                            styles.switch,
                            notifications ? styles.switchOn : styles.switchOff,
                          ]}
                          onPress={dismissKeyboardAnd(() =>
                            handleNotificationToggle(!notifications)
                          )}
                          disabled={notificationSaving}
                        >
                          <View
                            style={[
                              styles.switchThumb,
                              notifications && styles.switchThumbOn,
                            ]}
                          />
                        </Pressable>
                      </View>
                      {notificationSaving ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                          style={styles.inlineLoader}
                        />
                      ) : null}
                    </View>
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
                    <ActivityIndicator size="small" color={colors.onPrimary} />
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
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
  settingsSection: {
    marginTop: 24,
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  settingLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingLabel: {
    fontSize: 18,
    color: colors.onSurface,
  },
  switch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: colors.primary,
    alignItems: 'flex-end',
  },
  switchOff: {
    backgroundColor: colors.grey300,
    alignItems: 'flex-start',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
  },
  switchThumbOn: {
    backgroundColor: '#fff',
  },
  inlineLoader: {
    marginTop: 8,
    alignSelf: 'flex-start',
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
    ...StyleSheet.absoluteFillObject,
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
