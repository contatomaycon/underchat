import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import {
  listTransferOptions,
  startChatWithContact,
  viewWorkerConfigForChat,
} from '../api/chatApi';
import { getUser } from '../storage/authStorage';
import type { ListChatsResult } from '../types/chat';
import type {
  ChatContactListItem,
  TransferSector,
  TransferWorker,
  WorkerConfigForChat,
} from '../types/contact';

type PickerKind = 'worker' | 'sector' | null;

type ContactStartConversationModalProps = {
  visible: boolean;
  contact: ChatContactListItem | null;
  onClose: () => void;
  onConversationStarted: (chat: ListChatsResult) => void;
};

function getUserChatStatus(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const chatUser = (user as { chat_user?: unknown }).chat_user;
  if (!chatUser || typeof chatUser !== 'object') return null;
  const status = (chatUser as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

export function ContactStartConversationModal({
  visible,
  contact,
  onClose,
  onConversationStarted,
}: ContactStartConversationModalProps) {
  const [workers, setWorkers] = useState<TransferWorker[]>([]);
  const [sectors, setSectors] = useState<TransferSector[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [startingConversation, setStartingConversation] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [workerConfig, setWorkerConfig] = useState<WorkerConfigForChat | null>(
    null
  );
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [userStatus, setUserStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    setSelectedWorkerId(null);
    setSelectedSectorId(null);
    setWorkers([]);
    setSectors([]);
    setWorkerConfig(null);
    setUserStatus(null);

    getUser()
      .then((user) => {
        setUserStatus(getUserChatStatus(user));
      })
      .catch(() => {
        setUserStatus(null);
      });

    setLoadingOptions(true);
    listTransferOptions()
      .then((result) => {
        setWorkers(result?.workers ?? []);
        setSectors(result?.sectors ?? []);
      })
      .finally(() => setLoadingOptions(false));
  }, [visible]);

  useEffect(() => {
    if (!visible || !selectedWorkerId) {
      setWorkerConfig(null);
      return;
    }

    setLoadingConfig(true);
    viewWorkerConfigForChat(selectedWorkerId)
      .then((result) => {
        setWorkerConfig(result);
      })
      .finally(() => setLoadingConfig(false));
  }, [selectedWorkerId, visible]);

  useEffect(() => {
    if (!visible) {
      setPickerKind(null);
    }
  }, [visible]);

  const selectedWorker = useMemo(
    () => workers.find((item) => item.id === selectedWorkerId) ?? null,
    [selectedWorkerId, workers]
  );

  const selectedSector = useMemo(
    () => sectors.find((item) => item.sector_id === selectedSectorId) ?? null,
    [selectedSectorId, sectors]
  );

  const cannotOpenConversation =
    !!workerConfig?.allow_attendance_only_online && userStatus !== 'online';

  const pickerItems = useMemo(() => {
    if (pickerKind === 'worker') {
      return workers.map((item) => ({
        value: item.id,
        label: item.number ? `${item.name} (${item.number})` : item.name,
      }));
    }
    if (pickerKind === 'sector') {
      return sectors.map((item) => ({
        value: item.sector_id,
        label: item.name,
      }));
    }
    return [];
  }, [pickerKind, sectors, workers]);

  const handleStartConversation = async () => {
    if (!contact?.contact_id) {
      Alert.alert(pt.error_title, pt.contact_not_found);
      return;
    }
    if (!selectedWorkerId) {
      Alert.alert(pt.warning_title, pt.select_channel_required);
      return;
    }

    if (cannotOpenConversation) {
      Alert.alert(pt.warning_title, pt.attendance_only_online_required);
      return;
    }

    setStartingConversation(true);
    try {
      const chat = await startChatWithContact(
        contact.contact_id,
        selectedWorkerId,
        selectedSectorId
      );
      if (!chat) {
        Alert.alert(pt.error_title, pt.chat_creation_error);
        return;
      }

      onClose();
      onConversationStarted(chat);
    } finally {
      setStartingConversation(false);
    }
  };

  const currentPickerTitle =
    pickerKind === 'worker'
      ? pt.channel
      : pickerKind === 'sector'
        ? pt.sector
        : '';

  const openPicker = (kind: Exclude<PickerKind, null>) => {
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
      transparent
      animationType="slide"
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.modalBackdrop} onPress={handleRequestClose} />
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{pt.select_channel_sector}</Text>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.content}>
            {loadingOptions ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>
                    {pt.channel} <Text style={styles.required}>*</Text>
                  </Text>
                  <Pressable
                    style={styles.selector}
                    onPress={() => openPicker('worker')}
                  >
                    <Text style={styles.selectorText} numberOfLines={1}>
                      {selectedWorker
                        ? selectedWorker.number
                          ? `${selectedWorker.name} (${selectedWorker.number})`
                          : selectedWorker.name
                        : pt.select_channel}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{pt.sector}</Text>
                  <Pressable
                    style={styles.selector}
                    onPress={() => openPicker('sector')}
                  >
                    <Text style={styles.selectorText} numberOfLines={1}>
                      {selectedSector?.name ?? pt.select_sector}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={colors.grey600}
                    />
                  </Pressable>
                </View>

                {loadingConfig ? (
                  <View style={styles.inlineLoadingWrap}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null}

                {cannotOpenConversation ? (
                  <Text style={styles.warningText}>
                    {pt.attendance_only_online_required}
                  </Text>
                ) : null}
              </>
            )}
          </View>

          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.confirmBtn,
                (!selectedWorkerId ||
                  startingConversation ||
                  cannotOpenConversation) &&
                  styles.disabledBtn,
              ]}
              disabled={
                !selectedWorkerId ||
                startingConversation ||
                cannotOpenConversation
              }
              onPress={handleStartConversation}
            >
              {startingConversation ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmBtnText}>
                  {pt.open_conversation}
                </Text>
              )}
            </Pressable>
          </View>
        </View>

        {pickerKind !== null ? (
          <Pressable style={styles.pickerOverlay} onPress={closePicker}>
            <Pressable
              style={styles.pickerCard}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>{currentPickerTitle}</Text>
                {pickerKind === 'sector' ? (
                  <Pressable
                    style={styles.clearPickerBtn}
                    onPress={() => {
                      setSelectedSectorId(null);
                      closePicker();
                    }}
                  >
                    <Text style={styles.clearPickerText}>
                      {pt.clear_filter}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <FlatList
                data={pickerItems}
                keyExtractor={(item) => item.value}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.pickerRow}
                    onPress={() => {
                      if (pickerKind === 'worker') {
                        setSelectedWorkerId(item.value);
                      } else if (pickerKind === 'sector') {
                        setSelectedSectorId(item.value);
                      }
                      closePicker();
                    }}
                  >
                    <Text style={styles.pickerRowText}>{item.label}</Text>
                  </Pressable>
                )}
              />
            </Pressable>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
  content: {
    padding: 16,
    gap: 12,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLoadingWrap: {
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  field: {
    gap: 4,
  },
  label: {
    fontSize: 12,
    color: colors.grey700,
  },
  required: {
    color: colors.error,
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
  warningText: {
    fontSize: 13,
    color: colors.error,
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
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelBtnText: {
    color: colors.primary,
    fontWeight: '500',
  },
  confirmBtn: {
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 130,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.65,
  },
  pickerOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    maxHeight: 340,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  clearPickerBtn: {
    padding: 4,
  },
  clearPickerText: {
    color: colors.primary,
    fontSize: 13,
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
