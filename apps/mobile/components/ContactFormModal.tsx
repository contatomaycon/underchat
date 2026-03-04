import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { pt } from '../locales/pt';
import { colors } from '../theme/colors';
import { AppAvatar } from './AppAvatar';
import { getCountryDialCodeOptions } from '../constants/countryCodes';
import {
  createChatContact,
  deleteChatContactPhoto,
  getChatContactDocumentDecrypted,
  getChatContactEmailDecrypted,
  getChatContactPhoneDecrypted,
  listChatUsers,
  listContactChannels,
  listLabelTemplates,
  removeChatContactLabelTemplate,
  updateChatContact,
  viewChatContact,
} from '../api/chatApi';
import {
  CONTACT_DOCUMENT_TYPE,
  CONTACT_IGNORE,
  type ChatContactChannelsItem,
  type ContactDocumentTypeId,
  type ContactIgnore,
} from '../types/contact';
import {
  formatDocumentByType,
  getDocumentMaskMaxLength,
  isValidCnpj,
  isValidCpf,
  normalizeDocumentDigits,
} from '../utils/contactDocument';
import {
  birthdayIsoToDate,
  dateToBirthdayIso,
  formatBirthdayDisplay,
  normalizeBirthdayIso,
} from '../utils/date';
import { resolveImageUri } from '../utils/imageUri';
import { dismissKeyboard, dismissKeyboardAnd } from '../utils/keyboard';
import {
  formatChannelPhoneLabel,
  formatLocalPhone,
  formatPhoneForDisplay,
} from '../utils/phoneFormat';

type ContactFormMode = 'create' | 'edit';
type PickerKind =
  | 'labels'
  | 'channels'
  | 'phoneDdi'
  | 'user'
  | 'documentType'
  | 'ignore'
  | null;

type Option = {
  value: string;
  label: string;
};

interface ContactFormModalProps {
  visible: boolean;
  mode: ContactFormMode;
  contactId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

function toDisplayName(name?: string | null, lastName?: string | null): string {
  const parts = [name, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '';
}

function phoneDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function isMaskedValue(value: string | null | undefined): boolean {
  return !!value && value.includes('*');
}

function normalizeDocumentForDisplay(
  value: string | null | undefined,
  documentTypeId: ContactDocumentTypeId | string | null | undefined
): string {
  if (!value) return '';
  if (value.includes('*')) return value;
  return formatDocumentByType(value, documentTypeId);
}

const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

function extractImageExtensionFromAsset(
  asset: ImagePicker.ImagePickerAsset
): string | null {
  const fromFileName = asset.fileName?.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromFileName) return fromFileName.toLowerCase();

  const fromUri = asset.uri?.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)?.[1];
  if (fromUri) return fromUri.toLowerCase();

  if (asset.mimeType?.startsWith('image/')) {
    const fromMime = asset.mimeType.replace('image/', '').toLowerCase();
    if (fromMime === 'jpg') return 'jpeg';
    return fromMime;
  }

  return null;
}

function toImageMimeType(extension: string): string {
  if (extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }
  return `image/${extension}`;
}

export function ContactFormModal({
  visible,
  mode,
  contactId = null,
  onClose,
  onSuccess,
}: ContactFormModalProps) {
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);

  const [labelOptions, setLabelOptions] = useState<Option[]>([]);
  const [channelOptions, setChannelOptions] = useState<Option[]>([]);
  const [userOptions, setUserOptions] = useState<Option[]>([]);

  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [ignore, setIgnore] = useState<ContactIgnore>(
    CONTACT_IGNORE.not_ignore
  );
  const [documentTypeId, setDocumentTypeId] =
    useState<ContactDocumentTypeId | null>(null);

  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [birthdayIso, setBirthdayIso] = useState<string | null>(null);
  const [birthdayPickerVisible, setBirthdayPickerVisible] = useState(false);
  const [birthdayDraftDate, setBirthdayDraftDate] = useState<Date>(new Date());
  const [email, setEmail] = useState('');
  const [phoneDdi, setPhoneDdi] = useState('55');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [document, setDocument] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  const [emailDecrypted, setEmailDecrypted] = useState(false);
  const [phoneDecrypted, setPhoneDecrypted] = useState(false);
  const [documentDecrypted, setDocumentDecrypted] = useState(false);

  const isEditMode = mode === 'edit';
  const canLoadContact = isEditMode && !!contactId;

  const documentTypeOptions = useMemo<Option[]>(
    () => [
      { value: CONTACT_DOCUMENT_TYPE.cpf, label: pt.cpf },
      { value: CONTACT_DOCUMENT_TYPE.cnpj, label: pt.cnpj },
    ],
    []
  );

  const ignoreOptions = useMemo<Option[]>(
    () => [
      { value: CONTACT_IGNORE.not_ignore, label: pt.not_ignore },
      { value: CONTACT_IGNORE.ignore_automation, label: pt.ignore_automation },
      { value: CONTACT_IGNORE.ignore_totally, label: pt.ignore_totally },
    ],
    []
  );
  const countryCodeOptions = useMemo<Option[]>(
    () => getCountryDialCodeOptions('pt-BR'),
    []
  );

  const resetForm = () => {
    setSelectedLabels([]);
    setSelectedChannels([]);
    setSelectedUserId(null);
    setIgnore(CONTACT_IGNORE.not_ignore);
    setDocumentTypeId(null);
    setName('');
    setLastName('');
    setNickname('');
    setBirthdayIso(null);
    setBirthdayPickerVisible(false);
    setBirthdayDraftDate(new Date());
    setEmail('');
    setPhoneDdi('55');
    setPhone('');
    setNotes('');
    setDocument('');
    setPhotoUri(null);
    setPhotoBlob(null);
    setEmailDecrypted(false);
    setPhoneDecrypted(false);
    setDocumentDecrypted(false);
  };

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    const loadInitialData = async () => {
      setLoadingInitial(true);
      try {
        const [labels, users, channels] = await Promise.all([
          listLabelTemplates(),
          listChatUsers(),
          listContactChannels(),
        ]);

        if (cancelled) return;

        setLabelOptions(
          (labels ?? []).map((item) => ({
            value: item.label_template_id,
            label: item.label,
          }))
        );
        setUserOptions(
          (users ?? []).map((item) => ({
            value: item.user_id,
            label: item.name ?? item.user_id,
          }))
        );
        setChannelOptions(
          (channels ?? []).map((item: ChatContactChannelsItem) => ({
            value: item.channel_id,
            label: item.number
              ? `${item.name} (${formatChannelPhoneLabel(item.number)})`
              : item.name,
          }))
        );

        if (canLoadContact) {
          const contact = await viewChatContact(contactId);
          if (!contact || cancelled) return;
          const initialDocumentTypeId =
            (contact.contact_document_type
              ?.contact_document_type_id as ContactDocumentTypeId) ?? null;

          setSelectedLabels(
            (contact.label_templates ?? []).map(
              (item) => item.label_template_id
            )
          );
          setSelectedChannels(contact.channel_ids ?? []);
          setSelectedUserId(contact.user?.user_id ?? null);
          setIgnore(
            (contact.ignore as ContactIgnore) ?? CONTACT_IGNORE.not_ignore
          );
          setDocumentTypeId(initialDocumentTypeId);
          setName(contact.name ?? '');
          setLastName(contact.last_name ?? '');
          setNickname(contact.nickname ?? '');
          setBirthdayIso(normalizeBirthdayIso(contact.birthday));
          setEmail(contact.email_partial ?? '');
          setPhoneDdi(contact.phone_ddi ?? '55');
          setPhone(
            formatPhoneForDisplay(
              contact.phone_partial ?? '',
              contact.phone_ddi ?? null
            )
          );
          setNotes(contact.notes ?? '');
          setDocument(
            normalizeDocumentForDisplay(
              contact.document_partial ?? '',
              initialDocumentTypeId
            )
          );
          setPhotoUri(resolveImageUri(contact.photo) ?? null);
        } else {
          resetForm();
        }
      } finally {
        if (!cancelled) {
          setLoadingInitial(false);
        }
      }
    };

    loadInitialData().catch(() => {
      setLoadingInitial(false);
    });

    return () => {
      cancelled = true;
    };
  }, [canLoadContact, contactId, visible]);

  useEffect(() => {
    if (!visible) {
      setPickerKind(null);
      setBirthdayPickerVisible(false);
    }
  }, [visible]);

  const selectedUserName =
    userOptions.find((item) => item.value === selectedUserId)?.label ??
    pt.select_attendant_filter;
  const selectedDocumentTypeName =
    documentTypeOptions.find((item) => item.value === documentTypeId)?.label ??
    pt.select_option;
  const selectedIgnoreName =
    ignoreOptions.find((item) => item.value === ignore)?.label ?? pt.not_ignore;
  const selectedPhoneDdiName =
    countryCodeOptions.find((item) => item.value === phoneDdi)?.label ??
    (phoneDdi ? `+${phoneDdi}` : pt.select_phone_ddi);
  const documentMaskMaxLength = useMemo(
    () => getDocumentMaskMaxLength(documentTypeId),
    [documentTypeId]
  );
  const birthdayDisplay = useMemo(
    () => formatBirthdayDisplay(birthdayIso),
    [birthdayIso]
  );
  const documentPlaceholder = useMemo(() => {
    if (documentTypeId === CONTACT_DOCUMENT_TYPE.cpf) {
      return '000.000.000-00';
    }
    if (documentTypeId === CONTACT_DOCUMENT_TYPE.cnpj) {
      return '00.000.000/0000-00';
    }
    return pt.document;
  }, [documentTypeId]);

  useEffect(() => {
    if (!document || isMaskedValue(document)) return;
    const reformatted = formatDocumentByType(document, documentTypeId);
    if (reformatted !== document) {
      setDocument(reformatted);
    }
  }, [document, documentTypeId]);

  const pickerItems = useMemo(() => {
    if (pickerKind === 'labels') return labelOptions;
    if (pickerKind === 'channels') return channelOptions;
    if (pickerKind === 'phoneDdi') return countryCodeOptions;
    if (pickerKind === 'user') return userOptions;
    if (pickerKind === 'documentType') return documentTypeOptions;
    if (pickerKind === 'ignore') return ignoreOptions;
    return [];
  }, [
    channelOptions,
    countryCodeOptions,
    documentTypeOptions,
    ignoreOptions,
    labelOptions,
    pickerKind,
    userOptions,
  ]);

  const currentPickerTitle = useMemo(() => {
    if (pickerKind === 'labels') return pt.filter_by_tag;
    if (pickerKind === 'channels') return pt.channel;
    if (pickerKind === 'phoneDdi') return pt.phone_ddi;
    if (pickerKind === 'user') return pt.filter_by_attendant;
    if (pickerKind === 'documentType') return pt.document_type;
    if (pickerKind === 'ignore') return pt.ignore;
    return '';
  }, [pickerKind]);

  const isMultiPicker = pickerKind === 'labels' || pickerKind === 'channels';

  const isOptionSelected = (value: string): boolean => {
    if (pickerKind === 'labels') return selectedLabels.includes(value);
    if (pickerKind === 'channels') return selectedChannels.includes(value);
    if (pickerKind === 'phoneDdi') return phoneDdi === value;
    if (pickerKind === 'user') return selectedUserId === value;
    if (pickerKind === 'documentType') return documentTypeId === value;
    if (pickerKind === 'ignore') return ignore === value;
    return false;
  };

  const toggleOption = (value: string) => {
    if (pickerKind === 'labels') {
      setSelectedLabels((prev) =>
        prev.includes(value)
          ? prev.filter((item) => item !== value)
          : [...prev, value]
      );
      return;
    }
    if (pickerKind === 'channels') {
      setSelectedChannels((prev) =>
        prev.includes(value)
          ? prev.filter((item) => item !== value)
          : [...prev, value]
      );
      return;
    }
    if (pickerKind === 'phoneDdi') {
      setPhoneDdi(value);
      setPickerKind(null);
      return;
    }
    if (pickerKind === 'user') {
      setSelectedUserId(value);
      setPickerKind(null);
      return;
    }
    if (pickerKind === 'documentType') {
      setDocumentTypeId(value as ContactDocumentTypeId);
      setPickerKind(null);
      return;
    }
    if (pickerKind === 'ignore') {
      setIgnore(value as ContactIgnore);
      setPickerKind(null);
    }
  };

  const clearPickerSelection = () => {
    if (pickerKind === 'labels') setSelectedLabels([]);
    if (pickerKind === 'channels') setSelectedChannels([]);
    if (pickerKind === 'phoneDdi') setPhoneDdi('');
    if (pickerKind === 'user') setSelectedUserId(null);
    if (pickerKind === 'documentType') setDocumentTypeId(null);
    if (pickerKind === 'ignore') setIgnore(CONTACT_IGNORE.not_ignore);
    setPickerKind(null);
  };

  const openPicker = (kind: Exclude<PickerKind, null>) => {
    dismissKeyboard();
    setBirthdayPickerVisible(false);
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

    if (Platform.OS === 'ios' && birthdayPickerVisible) {
      setBirthdayPickerVisible(false);
      return;
    }

    onClose();
  };

  const openBirthdayPicker = () => {
    dismissKeyboard();

    const initialDate = birthdayIsoToDate(birthdayIso) ?? new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initialDate,
        mode: 'date',
        display: 'calendar',
        onChange: (event, date) => {
          if (event.type !== 'set' || !date) return;
          setBirthdayIso(dateToBirthdayIso(date));
        },
      });
      return;
    }

    setBirthdayDraftDate(initialDate);
    setBirthdayPickerVisible(true);
  };

  const handleBirthdayIosChange = (
    _event: DateTimePickerEvent,
    date?: Date
  ) => {
    if (!date) return;
    setBirthdayDraftDate(date);
  };

  const handleBirthdayCancel = () => {
    setBirthdayPickerVisible(false);
  };

  const handleBirthdayConfirm = () => {
    setBirthdayIso(dateToBirthdayIso(birthdayDraftDate));
    setBirthdayPickerVisible(false);
  };

  const setPhotoFromAsset = (asset: ImagePicker.ImagePickerAsset) => {
    const uri = asset.uri;
    if (!uri) return;

    setPhotoUri(uri);

    const rawExtension = extractImageExtensionFromAsset(asset);
    const extension =
      rawExtension && ALLOWED_IMAGE_EXTENSIONS.has(rawExtension)
        ? rawExtension
        : 'jpg';
    const mimeType = toImageMimeType(extension);
    const fileName = `contact-photo-${Date.now()}.${extension}`;

    setPhotoBlob({
      uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob);
  };

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) return;
    setPhotoFromAsset(result.assets[0]);
  };

  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.camera_permission_denied);
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) return;
    setPhotoFromAsset(result.assets[0]);
  };

  const handleDeletePhoto = async () => {
    if (!isEditMode || !contactId) {
      setPhotoUri(null);
      setPhotoBlob(null);
      return;
    }

    setSaving(true);
    try {
      const ok = await deleteChatContactPhoto(contactId);
      if (!ok) {
        Alert.alert(pt.error_title, pt.contact_photo_delete_error);
        return;
      }
      setPhotoUri(null);
      setPhotoBlob(null);
    } finally {
      setSaving(false);
    }
  };

  const removeLabel = async (labelId: string) => {
    if (!isEditMode || !contactId) {
      setSelectedLabels((prev) => prev.filter((item) => item !== labelId));
      return;
    }

    setSaving(true);
    try {
      const ok = await removeChatContactLabelTemplate(contactId, labelId);
      if (!ok) {
        Alert.alert(pt.error_title, pt.contact_label_template_remove_error);
        return;
      }
      setSelectedLabels((prev) => prev.filter((item) => item !== labelId));
    } finally {
      setSaving(false);
    }
  };

  const revealEmail = async () => {
    if (!contactId) return;
    const decrypted = await getChatContactEmailDecrypted(contactId);
    if (decrypted) {
      setEmail(decrypted);
      setEmailDecrypted(true);
    }
  };

  const revealPhone = async () => {
    if (!contactId) return;
    const decrypted = await getChatContactPhoneDecrypted(contactId);
    if (decrypted) {
      setPhone(formatPhoneForDisplay(decrypted, phoneDdi));
      setPhoneDecrypted(true);
    }
  };

  const revealDocument = async () => {
    if (!contactId) return;
    const decrypted = await getChatContactDocumentDecrypted(contactId);
    if (decrypted) {
      setDocument(formatDocumentByType(decrypted, documentTypeId));
      setDocumentDecrypted(true);
    }
  };

  const handleSave = async () => {
    const normalizedName = name.trim();
    const normalizedPhone = phoneDigits(phone);
    const normalizedPhoneDdi = phoneDdi.trim();
    const normalizedDocument = normalizeDocumentDigits(
      document,
      documentTypeId
    );
    const skipDocumentUpdate =
      isEditMode && isMaskedValue(document) && !documentDecrypted;

    if (!normalizedName) {
      Alert.alert(pt.warning_title, pt.name_required);
      return;
    }
    if (!normalizedPhoneDdi) {
      Alert.alert(pt.warning_title, pt.phone_ddi_required);
      return;
    }
    if (!normalizedPhone) {
      Alert.alert(pt.warning_title, pt.phone_required);
      return;
    }
    if (
      !skipDocumentUpdate &&
      normalizedDocument &&
      documentTypeId === CONTACT_DOCUMENT_TYPE.cpf
    ) {
      if (!isValidCpf(normalizedDocument)) {
        Alert.alert(pt.warning_title, pt.cpf_invalid);
        return;
      }
    }
    if (
      !skipDocumentUpdate &&
      normalizedDocument &&
      documentTypeId === CONTACT_DOCUMENT_TYPE.cnpj
    ) {
      if (!isValidCnpj(normalizedDocument)) {
        Alert.alert(pt.warning_title, pt.cnpj_invalid);
        return;
      }
    }

    setSaving(true);
    try {
      if (isEditMode && contactId) {
        const emailValue =
          isMaskedValue(email) && !emailDecrypted
            ? undefined
            : email.trim() || null;
        const phoneValue =
          isMaskedValue(phone) && !phoneDecrypted ? undefined : normalizedPhone;
        const documentValue = skipDocumentUpdate
          ? undefined
          : normalizedDocument || null;

        const ok = await updateChatContact(
          {
            contact_id: contactId,
            label_template_ids: selectedLabels,
            channel_ids: selectedChannels,
            name: normalizedName,
            last_name: lastName.trim() || null,
            email: emailValue,
            phone_ddi: normalizedPhoneDdi,
            phone: phoneValue,
            nickname: nickname.trim() || null,
            birthday: birthdayIso,
            notes: notes || null,
            contact_document_type_id: documentTypeId,
            document: documentValue,
            user_id: selectedUserId,
            ignore,
          },
          photoBlob
        );

        if (!ok) {
          Alert.alert(pt.error_title, pt.contact_edit_error);
          return;
        }
      } else {
        const ok = await createChatContact(
          {
            label_template_ids: selectedLabels,
            channel_ids: selectedChannels,
            name: normalizedName,
            last_name: lastName.trim() || null,
            email: email.trim() || null,
            phone_ddi: normalizedPhoneDdi,
            phone: normalizedPhone,
            nickname: nickname.trim() || null,
            birthday: birthdayIso,
            notes: notes || null,
            contact_document_type_id: documentTypeId,
            document: normalizedDocument || null,
            user_id: selectedUserId,
            ignore,
          },
          photoBlob
        );

        if (!ok) {
          Alert.alert(pt.error_title, pt.contact_add_error);
          return;
        }
      }

      onClose();
      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  const selectedLabelsData = selectedLabels
    .map((id) => labelOptions.find((item) => item.value === id))
    .filter(Boolean) as Option[];

  const selectedChannelsData = selectedChannels
    .map((id) => channelOptions.find((item) => item.value === id))
    .filter(Boolean) as Option[];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleRequestClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={dismissKeyboardAnd(handleRequestClose)}
        />
        <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {isEditMode ? pt.edit_contact : pt.add_contact}
              </Text>
              <Pressable
                style={styles.closeBtn}
                onPress={dismissKeyboardAnd(onClose)}
              >
                <Ionicons name="close" size={24} color={colors.onSurface} />
              </Pressable>
            </View>

            {loadingInitial ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <>
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={
                    Platform.OS === 'ios' ? 'interactive' : 'on-drag'
                  }
                >
                  <View style={styles.photoRow}>
                    <View style={styles.photoContainer}>
                      <AppAvatar
                        uri={photoUri}
                        size={72}
                        style={styles.photo}
                        iconName="person-circle-outline"
                        iconSize={72}
                        iconColor={colors.grey500}
                      />
                    </View>
                    <View style={styles.photoActionsGrid}>
                      <View
                        style={[
                          styles.photoActionColumn,
                          !photoUri && styles.photoActionColumnFull,
                        ]}
                      >
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={handlePickImage}
                        >
                          <Text style={styles.secondaryBtnText}>
                            {pt.select_photo}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.secondaryBtn}
                          onPress={handleTakePhoto}
                        >
                          <Text style={styles.secondaryBtnText}>
                            {pt.open_camera}
                          </Text>
                        </Pressable>
                      </View>
                      {photoUri ? (
                        <Pressable
                          style={[styles.secondaryBtn, styles.photoRemoveBtn]}
                          onPress={handleDeletePhoto}
                        >
                          <Text style={styles.secondaryBtnText}>
                            {pt.remove_photo}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>
                      {pt.name} <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={name}
                      onChangeText={setName}
                      placeholder={pt.name}
                      placeholderTextColor={colors.grey500}
                    />
                  </View>

                  <View style={styles.row}>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.last_name}</Text>
                      <TextInput
                        style={styles.input}
                        value={lastName}
                        onChangeText={setLastName}
                        placeholder={pt.last_name}
                        placeholderTextColor={colors.grey500}
                      />
                    </View>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.nickname}</Text>
                      <TextInput
                        style={styles.input}
                        value={nickname}
                        onChangeText={setNickname}
                        placeholder={pt.nickname}
                        placeholderTextColor={colors.grey500}
                      />
                    </View>
                  </View>

                  <View style={styles.row}>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.birthday}</Text>
                      <Pressable
                        style={styles.inputPressable}
                        onPress={openBirthdayPicker}
                      >
                        <Text
                          style={[
                            styles.inputPressableText,
                            !birthdayDisplay &&
                              styles.inputPressablePlaceholder,
                          ]}
                        >
                          {birthdayDisplay || 'DD/MM/YYYY'}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.email}</Text>
                      <View style={styles.inputWithAction}>
                        <TextInput
                          style={styles.inputWithActionField}
                          value={email}
                          onChangeText={setEmail}
                          placeholder={pt.email}
                          placeholderTextColor={colors.grey500}
                          keyboardType="email-address"
                          autoCapitalize="none"
                        />
                        {isEditMode &&
                        isMaskedValue(email) &&
                        !emailDecrypted ? (
                          <Pressable
                            style={styles.actionBtn}
                            onPress={revealEmail}
                          >
                            <Ionicons
                              name="eye-outline"
                              size={18}
                              color={colors.primary}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.row}>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>
                        {pt.phone_ddi} <Text style={styles.required}>*</Text>
                      </Text>
                      <Pressable
                        style={styles.selector}
                        onPress={() => openPicker('phoneDdi')}
                      >
                        <Text style={styles.selectorText} numberOfLines={1}>
                          {selectedPhoneDdiName}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={colors.grey600}
                        />
                      </Pressable>
                    </View>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>
                        {pt.phone} <Text style={styles.required}>*</Text>
                      </Text>
                      <View style={styles.inputWithAction}>
                        <TextInput
                          style={styles.inputWithActionField}
                          value={phone}
                          onChangeText={(value) =>
                            setPhone(formatLocalPhone(value))
                          }
                          keyboardType="phone-pad"
                          maxLength={15}
                          placeholder="(00) 00000-0000"
                          placeholderTextColor={colors.grey500}
                        />
                        {isEditMode &&
                        isMaskedValue(phone) &&
                        !phoneDecrypted ? (
                          <Pressable
                            style={styles.actionBtn}
                            onPress={revealPhone}
                          >
                            <Ionicons
                              name="eye-outline"
                              size={18}
                              color={colors.primary}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.row}>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.document_type}</Text>
                      <Pressable
                        style={styles.selector}
                        onPress={() => openPicker('documentType')}
                      >
                        <Text style={styles.selectorText} numberOfLines={1}>
                          {selectedDocumentTypeName}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={colors.grey600}
                        />
                      </Pressable>
                    </View>
                    <View style={[styles.field, styles.half]}>
                      <Text style={styles.label}>{pt.document}</Text>
                      <View style={styles.inputWithAction}>
                        <TextInput
                          style={styles.inputWithActionField}
                          value={document}
                          onChangeText={(value) =>
                            setDocument(
                              formatDocumentByType(value, documentTypeId)
                            )
                          }
                          keyboardType={
                            Platform.OS === 'ios' ? 'number-pad' : 'numeric'
                          }
                          inputMode="numeric"
                          maxLength={documentMaskMaxLength}
                          placeholder={documentPlaceholder}
                          placeholderTextColor={colors.grey500}
                        />
                        {isEditMode &&
                        isMaskedValue(document) &&
                        !documentDecrypted ? (
                          <Pressable
                            style={styles.actionBtn}
                            onPress={revealDocument}
                          >
                            <Ionicons
                              name="eye-outline"
                              size={18}
                              color={colors.primary}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{pt.filter_by_attendant}</Text>
                    <Pressable
                      style={styles.selector}
                      onPress={() => openPicker('user')}
                    >
                      <Text style={styles.selectorText} numberOfLines={1}>
                        {selectedUserName}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.grey600}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{pt.ignore}</Text>
                    <Pressable
                      style={styles.selector}
                      onPress={() => openPicker('ignore')}
                    >
                      <Text style={styles.selectorText} numberOfLines={1}>
                        {selectedIgnoreName}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.grey600}
                      />
                    </Pressable>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{pt.filter_by_tag}</Text>
                    <Pressable
                      style={styles.selector}
                      onPress={() => openPicker('labels')}
                    >
                      <Text style={styles.selectorText} numberOfLines={1}>
                        {selectedLabelsData.length > 0
                          ? `${selectedLabelsData.length} ${pt.selected_items}`
                          : pt.select_tag_filter}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.grey600}
                      />
                    </Pressable>
                    {selectedLabelsData.length > 0 ? (
                      <View style={styles.selectedWrap}>
                        {selectedLabelsData.map((item) => (
                          <View key={item.value} style={styles.selectedChip}>
                            <Text
                              style={styles.selectedChipText}
                              numberOfLines={1}
                            >
                              {item.label}
                            </Text>
                            <Pressable
                              style={styles.chipRemoveBtn}
                              onPress={() => removeLabel(item.value)}
                            >
                              <Ionicons
                                name="close"
                                size={12}
                                color={colors.onPrimary}
                              />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{pt.channel}</Text>
                    <Pressable
                      style={styles.selector}
                      onPress={() => openPicker('channels')}
                    >
                      <Text style={styles.selectorText} numberOfLines={1}>
                        {selectedChannelsData.length > 0
                          ? `${selectedChannelsData.length} ${pt.selected_items}`
                          : pt.select_channel}
                      </Text>
                      <Ionicons
                        name="chevron-down"
                        size={16}
                        color={colors.grey600}
                      />
                    </Pressable>
                    {selectedChannelsData.length > 0 ? (
                      <View style={styles.selectedWrap}>
                        {selectedChannelsData.map((item) => (
                          <View key={item.value} style={styles.selectedChip}>
                            <Text
                              style={styles.selectedChipText}
                              numberOfLines={1}
                            >
                              {item.label}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{pt.notes}</Text>
                    <TextInput
                      style={[styles.input, styles.notesInput]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder={pt.notes}
                      placeholderTextColor={colors.grey500}
                      multiline
                    />
                  </View>
                </ScrollView>

                <View style={styles.footer}>
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={dismissKeyboardAnd(onClose)}
                  >
                    <Text style={styles.cancelBtnText}>{pt.cancel}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, saving && styles.disabledBtn]}
                    onPress={dismissKeyboardAnd(handleSave)}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.onPrimary}
                      />
                    ) : (
                      <Text style={styles.saveBtnText}>{pt.save}</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </TouchableWithoutFeedback>

        {Platform.OS === 'ios' && birthdayPickerVisible ? (
          <Pressable
            style={styles.pickerOverlay}
            onPress={handleBirthdayCancel}
          >
            <Pressable
              style={styles.datePickerCard}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.datePickerHeader}>
                <Pressable
                  style={styles.datePickerHeaderAction}
                  onPress={handleBirthdayCancel}
                >
                  <Text style={styles.datePickerHeaderActionText}>
                    {pt.cancel}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.datePickerHeaderAction}
                  onPress={handleBirthdayConfirm}
                >
                  <Text style={styles.datePickerHeaderActionText}>
                    {pt.done}
                  </Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={birthdayDraftDate}
                mode="date"
                display="inline"
                onChange={handleBirthdayIosChange}
                minimumDate={new Date(1900, 0, 1)}
                maximumDate={new Date(2100, 11, 31)}
              />
            </Pressable>
          </Pressable>
        ) : null}

        {pickerKind !== null ? (
          <Pressable style={styles.pickerOverlay} onPress={closePicker}>
            <Pressable
              style={styles.pickerCard}
              onPress={(event) => event.stopPropagation()}
            >
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>{currentPickerTitle}</Text>
                <View style={styles.pickerActions}>
                  <Pressable
                    style={styles.pickerActionBtn}
                    onPress={clearPickerSelection}
                  >
                    <Text style={styles.pickerActionText}>
                      {pt.clear_filter}
                    </Text>
                  </Pressable>
                  {isMultiPicker ? (
                    <Pressable
                      style={styles.pickerActionBtn}
                      onPress={closePicker}
                    >
                      <Text style={styles.pickerActionText}>{pt.done}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <FlatList
                data={pickerItems}
                keyExtractor={(item, index) => `${item.value}-${index}`}
                renderItem={({ item }) => {
                  const selected = isOptionSelected(item.value);
                  return (
                    <Pressable
                      style={styles.pickerRow}
                      onPress={() => toggleOption(item.value)}
                    >
                      <Text style={styles.pickerRowText}>{item.label}</Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.primary}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '94%',
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
  loadingWrap: {
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    maxHeight: 560,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 20,
  },
  photoRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 10,
    alignItems: 'center',
  },
  photoContainer: {
    width: 84,
    height: 84,
    borderRadius: 42,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.grey200,
  },
  photo: {
    width: 84,
    height: 84,
  },
  photoActionsGrid: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  photoActionColumn: {
    flex: 1,
    gap: 8,
  },
  photoActionColumnFull: {
    flex: 1,
  },
  photoRemoveBtn: {
    width: 112,
    justifyContent: 'center',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  secondaryBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  half: {
    flex: 1,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    color: colors.grey700,
    marginBottom: 4,
  },
  required: {
    color: colors.error,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: colors.onSurface,
    fontSize: 14,
  },
  inputPressable: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  inputPressableText: {
    color: colors.onSurface,
    fontSize: 14,
  },
  inputPressablePlaceholder: {
    color: colors.grey500,
  },
  inputWithAction: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.grey300,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  inputWithActionField: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
    paddingHorizontal: 4,
  },
  actionBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
    gap: 8,
  },
  selectorText: {
    flex: 1,
    color: colors.onSurface,
    fontSize: 14,
  },
  selectedWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  selectedChip: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    gap: 6,
  },
  selectedChipText: {
    color: colors.onPrimary,
    fontSize: 12,
    maxWidth: 180,
  },
  chipRemoveBtn: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesInput: {
    height: 88,
    textAlignVertical: 'top',
    paddingTop: 10,
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
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
  },
  saveBtnText: {
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
    maxHeight: 360,
  },
  datePickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  datePickerHeaderAction: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  datePickerHeaderActionText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onSurface,
  },
  pickerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerActionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  pickerActionText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '500',
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.grey200,
  },
  pickerRowText: {
    color: colors.onSurface,
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
});
