import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { formatChannelPhoneLabel } from '../utils/phoneFormat';
import { SelectField, SelectSheet, type SelectOption } from './select';
import {
  listTransferOptions,
  startChatWithContactDetailed,
  viewOfficialOpeningContext,
  viewWorkerConfigForChat,
} from '../api/chatApi';
import { getUser } from '../storage/authStorage';
import type {
  ListChatsResult,
  OfficialOpeningContextResponse,
  OfficialTemplateVariableValue,
} from '../types/chat';
import type {
  ChatContactListItem,
  TransferSector,
  TransferWorker,
  WorkerConfigForChat,
} from '../types/contact';
import { OfficialTemplateFields } from './OfficialTemplateFields';
import { OfficialOpeningWindowCard } from './OfficialOpeningWindowCard';
import { isOfficialChatWorker } from '../utils/officialChat';
import {
  areOfficialTemplateVariablesValid,
  buildOfficialTemplateRequest,
  createManualOfficialTemplateVariable,
  createOfficialTemplateOptions,
  createOfficialTemplateVariableValues,
  findOfficialTemplate,
  refreshOfficialTemplateVariableKey,
} from '../utils/officialTemplate';

type PickerKind = 'worker' | 'sector' | 'officialTemplate' | null;

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
  const insets = useSafeAreaInsets();
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
  const [officialOpeningContext, setOfficialOpeningContext] =
    useState<OfficialOpeningContextResponse | null>(null);
  const [loadingOfficialOpeningContext, setLoadingOfficialOpeningContext] =
    useState(false);
  const [officialOpeningError, setOfficialOpeningError] = useState<
    string | null
  >(null);
  const [selectedOfficialTemplateKey, setSelectedOfficialTemplateKey] =
    useState<string | null>(null);
  const [officialTemplateVariableValues, setOfficialTemplateVariableValues] =
    useState<OfficialTemplateVariableValue[]>([]);
  const [officialOpeningReloadKey, setOfficialOpeningReloadKey] = useState(0);
  const openingAttemptRef = useRef(0);
  const startingConversationRef = useRef(false);

  useLayoutEffect(() => {
    openingAttemptRef.current += 1;
    startingConversationRef.current = false;
    setStartingConversation(false);

    return () => {
      openingAttemptRef.current += 1;
    };
  }, [contact?.contact_id, selectedSectorId, selectedWorkerId, visible]);

  useEffect(() => {
    if (!visible) return;

    setSelectedWorkerId(null);
    setSelectedSectorId(null);
    setWorkers([]);
    setSectors([]);
    setWorkerConfig(null);
    setUserStatus(null);
    setOfficialOpeningContext(null);
    setOfficialOpeningError(null);
    setSelectedOfficialTemplateKey(null);
    setOfficialTemplateVariableValues([]);
    setOfficialOpeningReloadKey(0);

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
      setLoadingConfig(false);
      return;
    }

    let cancelled = false;
    setWorkerConfig(null);
    setLoadingConfig(true);
    viewWorkerConfigForChat(selectedWorkerId)
      .then((result) => {
        if (cancelled) return;
        setWorkerConfig(result);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingConfig(false);
      });

    return () => {
      cancelled = true;
    };
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

  const selectedWorkerIsOfficial = useMemo(
    () => isOfficialChatWorker(selectedWorker),
    [selectedWorker]
  );

  useEffect(() => {
    setOfficialOpeningContext(null);
    setOfficialOpeningError(null);
    setSelectedOfficialTemplateKey(null);
    setOfficialTemplateVariableValues([]);

    if (
      !visible ||
      !selectedWorkerId ||
      !selectedWorkerIsOfficial ||
      !contact?.contact_id
    ) {
      setLoadingOfficialOpeningContext(false);
      return;
    }

    let cancelled = false;
    setLoadingOfficialOpeningContext(true);

    viewOfficialOpeningContext(selectedWorkerId, contact.contact_id)
      .then((context) => {
        if (cancelled) return;
        if (!context) {
          setOfficialOpeningError(pt.official_templates_loading_error);
          return;
        }
        setOfficialOpeningContext(context);
      })
      .catch(() => {
        if (cancelled) return;
        setOfficialOpeningError(pt.official_templates_loading_error);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingOfficialOpeningContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    contact?.contact_id,
    selectedWorkerId,
    selectedWorkerIsOfficial,
    visible,
    officialOpeningReloadKey,
  ]);

  useEffect(() => {
    const officialWindow = officialOpeningContext?.official_window;
    if (!visible || !officialWindow) return;

    const expirationValue =
      officialWindow.state === 'open'
        ? officialWindow.service_window_expires_at
        : officialWindow.state === 'awaiting_contact_reply' ||
            officialWindow.state === 'send_uncertain'
          ? officialWindow.awaiting_contact_reply_expires_at
          : null;
    const expiresAt = expirationValue
      ? new Date(expirationValue).getTime()
      : Number.NaN;
    if (!Number.isFinite(expiresAt)) return;

    const timeout = setTimeout(
      () => setOfficialOpeningReloadKey((current) => current + 1),
      Math.max(250, expiresAt - Date.now() + 250)
    );
    return () => clearTimeout(timeout);
  }, [officialOpeningContext?.official_window, visible]);

  const selectedOfficialTemplate = useMemo(
    () =>
      findOfficialTemplate(
        officialOpeningContext?.templates,
        selectedOfficialTemplateKey
      ),
    [officialOpeningContext?.templates, selectedOfficialTemplateKey]
  );

  useEffect(() => {
    if (!selectedOfficialTemplate) {
      setOfficialTemplateVariableValues([]);
      return;
    }

    setOfficialTemplateVariableValues((current) =>
      createOfficialTemplateVariableValues(
        selectedOfficialTemplate.variables,
        current
      )
    );
  }, [selectedOfficialTemplate]);

  const requiresOfficialTemplate =
    selectedWorkerIsOfficial &&
    officialOpeningContext?.requires_template === true;
  const isAwaitingOfficialContactReply =
    selectedWorkerIsOfficial &&
    officialOpeningContext?.official_window.state === 'awaiting_contact_reply';
  const isOfficialSendUncertain =
    selectedWorkerIsOfficial &&
    officialOpeningContext?.official_window.state === 'send_uncertain';
  const isOfficialOpeningBlocked =
    isAwaitingOfficialContactReply || isOfficialSendUncertain;

  const isOfficialOpeningReady =
    !loadingConfig &&
    (!selectedWorkerIsOfficial ||
      (!!officialOpeningContext &&
        !loadingOfficialOpeningContext &&
        !officialOpeningError &&
        !isOfficialOpeningBlocked &&
        (!requiresOfficialTemplate ||
          (!!selectedOfficialTemplate &&
            areOfficialTemplateVariablesValid(
              selectedOfficialTemplate,
              officialTemplateVariableValues
            )))));

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
    if (pickerKind === 'officialTemplate') {
      return createOfficialTemplateOptions(
        officialOpeningContext?.templates,
        'pt'
      ).map((item) => ({
        value: item.value,
        label: item.label,
      }));
    }
    return [];
  }, [officialOpeningContext?.templates, pickerKind, sectors, workers]);

  const handleStartConversation = async () => {
    if (startingConversation || startingConversationRef.current) return;

    if (!contact?.contact_id) {
      Alert.alert(pt.error_title, pt.contact_not_found);
      return;
    }
    if (!selectedWorkerId) {
      Alert.alert(pt.warning_title, pt.select_channel_required);
      return;
    }
    if (loadingConfig) return;

    if (cannotOpenConversation) {
      Alert.alert(pt.warning_title, pt.attendance_only_online_required);
      return;
    }

    if (isOfficialOpeningBlocked) {
      Alert.alert(
        pt.warning_title,
        isOfficialSendUncertain
          ? pt.official_window_uncertain_description
          : pt.official_window_awaiting_description
      );
      return;
    }

    if (!isOfficialOpeningReady) {
      Alert.alert(pt.warning_title, pt.official_template_required_for_opening);
      return;
    }

    const officialTemplatePayload =
      requiresOfficialTemplate && selectedOfficialTemplate
        ? buildOfficialTemplateRequest(
            selectedOfficialTemplate,
            officialTemplateVariableValues
          )
        : null;

    const openingAttempt = ++openingAttemptRef.current;
    startingConversationRef.current = true;
    setStartingConversation(true);
    try {
      const result = await startChatWithContactDetailed(
        contact.contact_id,
        selectedWorkerId,
        selectedSectorId,
        officialTemplatePayload
      );
      if (openingAttempt !== openingAttemptRef.current) return;

      if (
        result.reason === 'official_window_requires_template_refresh' ||
        result.httpStatus === 409
      ) {
        setOfficialOpeningReloadKey((current) => current + 1);
        Alert.alert(pt.warning_title, pt.official_window_refresh_required);
        return;
      }

      if (!result.chat) {
        const safeMessage =
          result.httpStatus !== null && result.httpStatus < 500
            ? result.message
            : null;
        const requestSuffix = result.requestId
          ? `\n\nID: ${result.requestId}`
          : '';
        Alert.alert(
          pt.error_title,
          `${safeMessage ?? pt.chat_creation_error}${requestSuffix}`
        );
        return;
      }

      onClose();
      onConversationStarted(result.chat);
    } catch {
      if (openingAttempt === openingAttemptRef.current) {
        Alert.alert(pt.error_title, pt.chat_creation_error);
      }
    } finally {
      if (openingAttempt === openingAttemptRef.current) {
        startingConversationRef.current = false;
        setStartingConversation(false);
      }
    }
  };

  const currentPickerTitle =
    pickerKind === 'worker'
      ? pt.channel
      : pickerKind === 'sector'
        ? pt.sector
        : pickerKind === 'officialTemplate'
          ? pt.official_template_model
          : '';

  const openPicker = (kind: Exclude<PickerKind, null>) => {
    setPickerKind(kind);
  };

  const closePicker = () => {
    setPickerKind(null);
  };

  const handleChangeOfficialTemplateVariable = (key: string, value: string) => {
    setOfficialTemplateVariableValues((current) =>
      current.map((variable) =>
        variable.key === key ? { ...variable, value } : variable
      )
    );
  };

  const handleAddManualOfficialTemplateVariable = () => {
    setOfficialTemplateVariableValues((current) => {
      const nextBodyIndex =
        current.reduce(
          (max, variable) =>
            variable.component_type === 'BODY'
              ? Math.max(max, variable.index)
              : max,
          0
        ) + 1;
      return [
        ...current,
        createManualOfficialTemplateVariable(nextBodyIndex - 1),
      ];
    });
  };

  const handleChangeManualOfficialTemplateVariable = (
    key: string,
    patch: Partial<
      Pick<
        OfficialTemplateVariableValue,
        'component_type' | 'index' | 'button_index'
      >
    >
  ) => {
    setOfficialTemplateVariableValues((current) =>
      current.map((variable) => {
        if (variable.key !== key) return variable;

        return refreshOfficialTemplateVariableKey({
          ...variable,
          ...patch,
          value: variable.value,
        });
      })
    );
  };

  const handleRemoveManualOfficialTemplateVariable = (key: string) => {
    setOfficialTemplateVariableValues((current) =>
      current.filter((variable) => variable.key !== key)
    );
  };

  const handleRequestClose = () => {
    if (startingConversation || startingConversationRef.current) return;

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
      statusBarTranslucent
      navigationBarTranslucent
      animationType="slide"
      onRequestClose={handleRequestClose}
    >
      <View style={[styles.overlay, { paddingBottom: insets.bottom }]}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={handleRequestClose}
          disabled={startingConversation}
        />
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>{pt.select_channel_sector}</Text>
            <Pressable
              style={[
                styles.closeBtn,
                startingConversation && styles.closeControlDisabled,
              ]}
              onPress={handleRequestClose}
              disabled={startingConversation}
              accessibilityRole="button"
              accessibilityLabel={pt.close}
            >
              <Ionicons name="close" size={24} color={colors.onSurface} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
                  disabled={startingConversation}
                  containerStyle={styles.field}
                />

                {selectedWorkerIsOfficial ? (
                  <View style={styles.officialOpeningSection}>
                    <OfficialOpeningWindowCard
                      window={officialOpeningContext?.official_window ?? null}
                      loading={
                        loadingOfficialOpeningContext ||
                        (!officialOpeningContext && !officialOpeningError)
                      }
                      error={officialOpeningError}
                      onRetry={() =>
                        setOfficialOpeningReloadKey((current) => current + 1)
                      }
                    />

                    {requiresOfficialTemplate &&
                    officialOpeningContext &&
                    !officialOpeningError ? (
                      <OfficialTemplateFields
                        templates={officialOpeningContext.templates}
                        selectedTemplateKey={selectedOfficialTemplateKey}
                        variableValues={officialTemplateVariableValues}
                        submitting={startingConversation}
                        onOpenTemplatePicker={() =>
                          openPicker('officialTemplate')
                        }
                        onChangeVariableValue={
                          handleChangeOfficialTemplateVariable
                        }
                        onChangeManualVariable={
                          handleChangeManualOfficialTemplateVariable
                        }
                        onAddManualVariable={
                          handleAddManualOfficialTemplateVariable
                        }
                        onRemoveManualVariable={
                          handleRemoveManualOfficialTemplateVariable
                        }
                      />
                    ) : null}
                  </View>
                ) : null}

                <SelectField
                  label={pt.sector}
                  valueLabel={selectedSector?.name ?? null}
                  placeholder={pt.select_sector}
                  onPress={() => openPicker('sector')}
                  disabled={startingConversation || isOfficialOpeningBlocked}
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
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              style={[
                styles.cancelBtn,
                startingConversation && styles.closeControlDisabled,
              ]}
              onPress={handleRequestClose}
              disabled={startingConversation}
              accessibilityRole="button"
            >
              <Text style={styles.cancelBtnText}>{pt.cancel}</Text>
            </Pressable>
            <Pressable
              style={[
                styles.confirmBtn,
                (!selectedWorkerId ||
                  startingConversation ||
                  loadingConfig ||
                  cannotOpenConversation ||
                  !isOfficialOpeningReady) &&
                  styles.disabledBtn,
              ]}
              disabled={
                !selectedWorkerId ||
                startingConversation ||
                loadingConfig ||
                cannotOpenConversation ||
                !isOfficialOpeningReady
              }
              onPress={handleStartConversation}
            >
              {startingConversation ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmBtnText}>
                  {isOfficialOpeningBlocked
                    ? isOfficialSendUncertain
                      ? pt.official_opening_uncertain_action
                      : pt.official_opening_waiting_action
                    : requiresOfficialTemplate
                      ? pt.official_template_send_and_open
                      : pt.open_conversation}
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
            pickerKind === 'worker'
              ? selectedWorkerId
              : pickerKind === 'sector'
                ? selectedSectorId
                : selectedOfficialTemplateKey
          }
          emptyText={pt.no_results_found}
          searchPlaceholder={pt.select_search_placeholder}
          showClear={pickerKind === 'sector'}
          clearLabel={pt.clear_filter}
          onClear={() => {
            if (pickerKind === 'sector') {
              setSelectedSectorId(null);
            }
          }}
          onRequestClose={closePicker}
          onSelectValue={(value) => {
            if (pickerKind === 'worker') {
              setSelectedWorkerId(value);
            } else if (pickerKind === 'sector') {
              setSelectedSectorId(value);
            } else if (pickerKind === 'officialTemplate') {
              setSelectedOfficialTemplateKey(value);
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
    ...StyleSheet.absoluteFill,
  },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
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
  closeControlDisabled: {
    opacity: 0.5,
  },
  contentScroll: {
    maxHeight: 560,
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
  officialOpeningSection: {
    gap: 12,
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
