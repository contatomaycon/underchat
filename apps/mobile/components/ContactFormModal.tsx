import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
import { resolveImageUri } from '../utils/imageUri';

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

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

function normalizePhoneForDisplay(value: string | null | undefined): string {
  if (!value) return '';
  if (value.includes('*')) return value;
  return formatPhone(value);
}

function normalizeDocumentForDisplay(
  value: string | null | undefined,
  documentTypeId: ContactDocumentTypeId | string | null | undefined
): string {
  if (!value) return '';
  if (value.includes('*')) return value;
  return formatDocumentByType(value, documentTypeId);
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
  const [birthday, setBirthday] = useState('');
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
    setBirthday('');
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
            label: item.number ? `${item.name} (${item.number})` : item.name,
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
          setBirthday(contact.birthday ?? '');
          setEmail(contact.email_partial ?? '');
          setPhoneDdi(contact.phone_ddi ?? '55');
          setPhone(normalizePhoneForDisplay(contact.phone_partial ?? ''));
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

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(pt.warning_title, pt.image_permission_denied);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });

    if (result.canceled || !result.assets?.length) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);

    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      setPhotoBlob(blob);
    } catch {
      setPhotoBlob(null);
    }
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
      setPhone(formatPhone(decrypted));
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
            birthday: birthday.trim() || null,
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
            birthday: birthday.trim() || null,
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
    <>
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {isEditMode ? pt.edit_contact : pt.add_contact}
              </Text>
              <Pressable style={styles.closeBtn} onPress={onClose}>
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
                    <View style={styles.photoButtons}>
                      <Pressable
                        style={styles.secondaryBtn}
                        onPress={handlePickImage}
                      >
                        <Text style={styles.secondaryBtnText}>
                          {pt.select_photo}
                        </Text>
                      </Pressable>
                      {photoUri ? (
                        <Pressable
                          style={styles.secondaryBtn}
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
                      <TextInput
                        style={styles.input}
                        value={birthday}
                        onChangeText={setBirthday}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.grey500}
                      />
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
                        onPress={() => setPickerKind('phoneDdi')}
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
                          onChangeText={(value) => setPhone(formatPhone(value))}
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
                        onPress={() => setPickerKind('documentType')}
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
                      onPress={() => setPickerKind('user')}
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
                      onPress={() => setPickerKind('ignore')}
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
                      onPress={() => setPickerKind('labels')}
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
                      onPress={() => setPickerKind('channels')}
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
                  <Pressable style={styles.cancelBtn} onPress={onClose}>
                    <Text style={styles.cancelBtnText}>{pt.cancel}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, saving && styles.disabledBtn]}
                    onPress={handleSave}
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
        </View>
      </Modal>

      <Modal
        visible={pickerKind !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerKind(null)}
      >
        <Pressable
          style={styles.pickerOverlay}
          onPress={() => setPickerKind(null)}
        >
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{currentPickerTitle}</Text>
              <View style={styles.pickerActions}>
                <Pressable
                  style={styles.pickerActionBtn}
                  onPress={clearPickerSelection}
                >
                  <Text style={styles.pickerActionText}>{pt.clear_filter}</Text>
                </Pressable>
                {isMultiPicker ? (
                  <Pressable
                    style={styles.pickerActionBtn}
                    onPress={() => setPickerKind(null)}
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
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
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
  photoButtons: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
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
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    maxHeight: 360,
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
