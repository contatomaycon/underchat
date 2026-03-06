import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { formatChannelPhoneLabel } from '../utils/phoneFormat';
import { SelectField, SelectSheet, type SelectOption } from './select';
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

  const pickerItems = useMemo<SelectOption[]>(() => {
    if (pickerKind === 'worker') {
      return workers.map((item) => ({
        value: item.id,
        label: item.number
          ? `${item.name} (${formatChannelPhoneLabel(item.number)})`
          : item.name,
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
                <SelectField
                  label={pt.channel}
                  required
                  valueLabel={
                    selectedWorker
                      ? selectedWorker.number
                        ? `${selectedWorker.name} (${formatChannelPhoneLabel(selectedWorker.number)})`
                        : selectedWorker.name
                      : null
                  }
                  placeholder={pt.select_channel}
                  onPress={() => openPicker('worker')}
                  containerStyle={styles.field}
                />

                <SelectField
                  label={pt.sector}
                  valueLabel={selectedSector?.name ?? null}
                  placeholder={pt.select_sector}
                  onPress={() => openPicker('sector')}
                  containerStyle={styles.field}
                />

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

        <SelectSheet
          visible={pickerKind !== null}
          title={currentPickerTitle}
          options={pickerItems}
          selectedValue={
            pickerKind === 'worker' ? selectedWorkerId : selectedSectorId
          }
          emptyText={pt.no_results_found}
          searchPlaceholder={pt.select_search_placeholder}
          showClear={pickerKind === 'sector'}
          clearLabel={pt.clear_filter}
          onClear={() => {
            setSelectedSectorId(null);
          }}
          onRequestClose={closePicker}
          onSelectValue={(value) => {
            if (pickerKind === 'worker') {
              setSelectedWorkerId(value);
            } else if (pickerKind === 'sector') {
              setSelectedSectorId(value);
            }
            closePicker();
          }}
        />
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
    marginBottom: 2,
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
});
