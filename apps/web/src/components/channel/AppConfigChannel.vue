<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { useContactStore } from '@/@webcore/stores/contact';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { EColor } from '@core/common/enums/EColor';
import { ProfileStatus } from '@core/schema/worker/listProfileStatus/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { EWorkerProfileStatusType } from '@core/common/enums/EWorkerProfileStatusType';
import { can } from '@layouts/plugins/casl';
import { ListContactGroupAllResponse } from '@core/schema/contactGroup/listContactGroupAll/response.schema';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { ViewWorkerConfigResponse } from '@core/schema/worker/viewWorkerConfig/response.schema';

const channelStore = useChannelsStore();
const contactGroupStore = useContactGroupStore();
const contactStore = useContactStore();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const MAX_PROFILE_STATUS = 30;
const MAX_TEXT_LENGTH = 130;
const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.flv',
  '.mkv',
  '.mov',
  '.3gp',
];
const ACCEPTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/avi',
  'video/x-flv',
  'video/x-matroska',
  'video/quicktime',
  'video/3gpp',
];
const ACCEPTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.aac',
  '.m4a',
  '.amr',
  '.ogg',
  '.opus',
];
const ACCEPTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/m4a',
  'audio/x-m4a',
  'audio/amr',
  'audio/amr-wb',
  'audio/ogg',
  'audio/opus',
];
const ACCEPTED_IMAGE_TYPES = `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
const ACCEPTED_VIDEO_TYPES = `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
const ACCEPTED_AUDIO_TYPES = `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;

type StatusPreview = {
  id: string;
  file: File;
  src: string;
};

type CropResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

interface CropDimensions {
  width: number;
  height: number;
  x: number;
  y: number;
}

interface CropFixedPoint {
  x: number;
  y: number;
}

interface CropMaxLimits {
  maxWidth: number;
  maxHeight: number;
}

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const channelId = toRef(props, 'channelId');
const currentTab = ref<'general' | 'profile-status' | 'profile-info'>(
  'general'
);
const isInitialLoad = ref(false);
const selectedStatusPreviews = ref<StatusPreview[]>([]);
const existingStatus = ref<ProfileStatus[]>([]);
const isSavingProfileStatus = ref(false);
const isLoadingProfileStatus = ref(false);
const fileInputKey = ref(0);
const previewDialog = ref<{
  open: boolean;
  src: string | null;
  caption: string | null;
  text: string | null;
  type: EWorkerProfileStatusType | null;
}>({
  open: false,
  src: null,
  caption: null,
  text: null,
  type: null,
});
const selectedType = ref<EWorkerProfileStatusType>(
  EWorkerProfileStatusType.text
);
const isPermanent = ref<string>('false');
const textContent = ref('');
const caption = ref('');
const audioPreviewRef = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);
const audioCurrentTime = ref(0);
const audioWaveformBars = ref<number[]>([]);

type StatusVisibilityType = 'all' | 'contact_groups' | 'contacts';
const statusVisibilityType = ref<StatusVisibilityType>('all');
const selectedContactGroups = ref<string[]>([]);
const selectedContacts = ref<string[]>([]);
const contactGroupsList = ref<ListContactGroupAllResponse[]>([]);
const contactsList = ref<ListContactResponse[]>([]);
const isLoadingContactGroups = ref(false);
const isLoadingContacts = ref(false);
const contactGroupSearch = ref('');
const contactSearch = ref('');

const profilePhoto = ref<string | null>(null);
const profilePhotoFile = ref<File | null>(null);
const isUploadingProfilePhoto = ref(false);
const isRemovingProfilePhoto = ref(false);
const profileName = ref<string | null>(null);
const profileDescription = ref<string | null>(null);
const isSavingProfileInfo = ref(false);
const MAX_DESCRIPTION_LENGTH = 120;
const cropDialog = ref({
  open: false,
  imageSrc: '',
  croppedImage: '',
});
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropCanvasRef = ref<HTMLCanvasElement | null>(null);
const cropArea = ref({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  aspectRatio: 1,
  startX: 0,
  startY: 0,
  isDragging: false,
  isResizing: false,
  resizeHandle: null as CropResizeHandle | null,
  initialWidth: 0,
  initialHeight: 0,
  initialX: 0,
  initialY: 0,
});
const cropPreviewSize = 160;
/* removed isInitializingGeneralTab flag */

type WorkerConfigForm = {
  is_automatic_attendance: boolean;
  show_attendee_name: boolean;
  show_worker_name: boolean;
  allow_attendance_only_online: boolean;
  simultaneous_attendance: boolean;
  generate_protocol_at_start: boolean;
  generate_protocol_at_transfer: boolean;
  show_message_on_call: boolean;
  send_message_on_finish_attendance: boolean;
  reject_call: boolean;
  auto_save_contacts: boolean;
  chatbot: boolean;
};

const createDefaultWorkerConfig = (): WorkerConfigForm => ({
  is_automatic_attendance: false,
  show_attendee_name: false,
  show_worker_name: false,
  allow_attendance_only_online: false,
  simultaneous_attendance: false,
  generate_protocol_at_start: false,
  generate_protocol_at_transfer: false,
  show_message_on_call: false,
  send_message_on_finish_attendance: false,
  reject_call: false,
  auto_save_contacts: false,
  chatbot: false,
});

const workerConfigForm = reactive<WorkerConfigForm>(
  createDefaultWorkerConfig()
);
const isLoadingWorkerConfig = ref(false);
const isSavingWorkerConfig = ref(false);
const workerConfigLoadedFor = ref<string | null>(null);
const transferProtocolText = ref<string>('');
const transferProtocolModalOpen = ref(false);
const isSavingTransferProtocol = ref(false);
const startProtocolText = ref<string>('');
const startProtocolModalOpen = ref(false);
const isSavingStartProtocol = ref(false);

const protocolTag = '{{protocolo}}';
const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ name }}',
    description: t('tag_name_description'),
  },
  {
    tag: '{{ protocol }}',
    description: t('tag_protocol_description'),
  },
  {
    tag: '{{ date }}',
    description: t('tag_date_description'),
  },
  {
    tag: '{{ time }}',
    description: t('tag_time_description'),
  },
  {
    tag: '{{ account_name }}',
    description: t('tag_account_name_description'),
  },
  {
    tag: '{{ phone }}',
    description: t('tag_phone_description'),
  },
  {
    tag: '{{ channel_name }}',
    description: t('tag_channel_name_description'),
  },
]);
const simultaneousAttendance = ref<number | null>(null);
const simultaneousAttendanceModalOpen = ref(false);
const isSavingSimultaneousAttendance = ref(false);
const simultaneousAttendanceInput = ref<string>('');
const showMessageOnCallText = ref<string>('');
const showMessageOnCallModalOpen = ref(false);
const isSavingShowMessageOnCall = ref(false);
const showMessageOnCallRejectCall = ref<boolean>(false);
const sendMessageOnFinishAttendanceText = ref<string>('');
const sendMessageOnFinishAttendanceModalOpen = ref(false);
const isSavingSendMessageOnFinishAttendance = ref(false);
const chatbotId = ref<string | null>(null);
const chatbotModalOpen = ref(false);
const isSavingChatbot = ref(false);
const selectedChatbotId = ref<string | null>(null);

const statusTypeOptions = computed(() => [
  {
    value: EWorkerProfileStatusType.text,
    title: t('profile_status_type_text'),
  },
  {
    value: EWorkerProfileStatusType.image,
    title: t('profile_status_type_image'),
  },
  {
    value: EWorkerProfileStatusType.video,
    title: t('profile_status_type_video'),
  },
  {
    value: EWorkerProfileStatusType.audio,
    title: t('profile_status_type_audio'),
  },
]);

const isPermanentOptions = [
  { value: 'false', title: 'Temporário' },
  { value: 'true', title: 'Permanente' },
];

const statusVisibilityOptions = computed(() => [
  { value: 'all', title: t('status_visibility_all') },
  { value: 'contact_groups', title: t('status_visibility_contact_groups') },
  { value: 'contacts', title: t('status_visibility_contacts') },
]);

const filteredContactGroups = computed(() => {
  if (!contactGroupSearch.value) {
    return contactGroupsList.value;
  }
  const search = contactGroupSearch.value.toLowerCase();
  return contactGroupsList.value.filter((group) =>
    group.name.toLowerCase().includes(search)
  );
});

const filteredContacts = computed(() => {
  if (!contactSearch.value) {
    return contactsList.value;
  }
  const search = contactSearch.value.toLowerCase();
  return contactsList.value.filter((contact) => {
    const name = contact.name.toLowerCase();
    const lastName = contact.last_name?.toLowerCase() || '';
    const phone = contact.phone_partial?.toLowerCase() || '';
    return (
      name.includes(search) ||
      lastName.includes(search) ||
      phone.includes(search)
    );
  });
});

const acceptedFileTypes = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.image) {
    return ACCEPTED_IMAGE_TYPES;
  }
  if (selectedType.value === EWorkerProfileStatusType.video) {
    return ACCEPTED_VIDEO_TYPES;
  }
  if (selectedType.value === EWorkerProfileStatusType.audio) {
    return ACCEPTED_AUDIO_TYPES;
  }
  return '';
});

const showFileInput = computed(() => {
  return [
    EWorkerProfileStatusType.image,
    EWorkerProfileStatusType.video,
    EWorkerProfileStatusType.audio,
  ].includes(selectedType.value);
});

const showTextInput = computed(() => {
  return selectedType.value === EWorkerProfileStatusType.text;
});

const showCaptionInput = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.text) {
    return false;
  }

  return [
    EWorkerProfileStatusType.image,
    EWorkerProfileStatusType.video,
    EWorkerProfileStatusType.audio,
  ].includes(selectedType.value);
});

const uploadHelperMessage = computed(() => {
  if (selectedType.value === EWorkerProfileStatusType.text) {
    return null;
  }

  if (selectedType.value === EWorkerProfileStatusType.image) {
    return t('profile_status_upload_helper_image');
  }

  if (selectedType.value === EWorkerProfileStatusType.video) {
    return t('profile_status_upload_helper_video');
  }

  if (selectedType.value === EWorkerProfileStatusType.audio) {
    return t('profile_status_upload_helper_audio');
  }

  return null;
});

const permissionsProfileStatus = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.profile_status_worker,
];

const canAccessProfileStatus = computed(() => can(permissionsProfileStatus));

const permissionsProfileInfo = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EWorkerPermissions.worker_group,
  EWorkerPermissions.profile_info_worker,
];

const canAccessProfileInfo = computed(() => can(permissionsProfileInfo));

const formatDate = (dateString: string): string => {
  if (!dateString) return '';

  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
};

const extractUrlAndCaption = (
  value: string
): { url: string; caption: string | null } => {
  if (value.includes('|')) {
    const [url, ...captionParts] = value.split('|');
    return {
      url: url.trim(),
      caption: captionParts.join('|').trim() || null,
    };
  }
  return { url: value, caption: null };
};

const applyWorkerConfig = (config?: ViewWorkerConfigResponse | null) => {
  const nextState = createDefaultWorkerConfig();

  if (config) {
    nextState.is_automatic_attendance = config.is_automatic_attendance;
    nextState.show_attendee_name = config.show_attendee_name;
    nextState.show_worker_name = config.show_worker_name;
    nextState.allow_attendance_only_online =
      config.allow_attendance_only_online;
    nextState.simultaneous_attendance = Boolean(config.simultaneous_attendance);
    nextState.generate_protocol_at_start = Boolean(
      config.generate_protocol_at_start
    );
    nextState.generate_protocol_at_transfer = Boolean(
      config.generate_protocol_at_transfer
    );
    nextState.show_message_on_call = Boolean(config.show_message_on_call);
    nextState.send_message_on_finish_attendance = Boolean(
      config.send_message_on_finish_attendance
    );
    nextState.reject_call = config.reject_call ?? false;
    nextState.auto_save_contacts = config.auto_save_contacts;
  }

  Object.assign(workerConfigForm, nextState);
};

const resetWorkerConfigState = () => {
  applyWorkerConfig();
  workerConfigLoadedFor.value = null;
};

const loadWorkerConfig = async (force = false) => {
  if (!channelId.value) return;
  if (!force && workerConfigLoadedFor.value === channelId.value) return;

  try {
    isLoadingWorkerConfig.value = true;
    const result = await channelStore.fetchWorkerConfig(channelId.value, force);

    applyWorkerConfig(result);
    workerConfigLoadedFor.value = channelId.value;

    const [
      protocolTransferText,
      protocolStartText,
      simultaneousAttendanceValue,
      showMessageOnCallValue,
      sendMessageOnFinishAttendanceValue,
      chatbotValue,
    ] = await Promise.all([
      channelStore.fetchTransferProtocolText(channelId.value),
      channelStore.fetchStartProtocolText(channelId.value),
      channelStore.fetchSimultaneousAttendance(channelId.value),
      channelStore.fetchShowMessageOnCall(channelId.value),
      channelStore.fetchSendMessageOnFinishAttendance(channelId.value),
      channelStore.fetchChatbot(channelId.value),
    ]);

    const hasTransferProtocolText =
      protocolTransferText !== null && protocolTransferText.trim().length > 0;
    const hasStartProtocolText =
      protocolStartText !== null && protocolStartText.trim().length > 0;
    const hasSimultaneousAttendance =
      simultaneousAttendanceValue !== null && simultaneousAttendanceValue > 0;

    transferProtocolText.value = hasTransferProtocolText
      ? protocolTransferText
      : '';
    workerConfigForm.generate_protocol_at_transfer = hasTransferProtocolText;

    startProtocolText.value = hasStartProtocolText ? protocolStartText : '';
    workerConfigForm.generate_protocol_at_start = hasStartProtocolText;

    simultaneousAttendance.value = simultaneousAttendanceValue;
    workerConfigForm.simultaneous_attendance = hasSimultaneousAttendance;
    simultaneousAttendanceInput.value = hasSimultaneousAttendance
      ? simultaneousAttendanceValue.toString()
      : '';

    const hasShowMessageOnCall =
      showMessageOnCallValue !== null &&
      showMessageOnCallValue.trim().length > 0;
    showMessageOnCallText.value = hasShowMessageOnCall
      ? showMessageOnCallValue
      : '';
    workerConfigForm.show_message_on_call = hasShowMessageOnCall;

    const hasSendMessageOnFinishAttendance =
      sendMessageOnFinishAttendanceValue !== null &&
      sendMessageOnFinishAttendanceValue.trim().length > 0;
    sendMessageOnFinishAttendanceText.value = hasSendMessageOnFinishAttendance
      ? sendMessageOnFinishAttendanceValue
      : '';
    workerConfigForm.send_message_on_finish_attendance =
      hasSendMessageOnFinishAttendance;

    chatbotId.value = chatbotValue;
    workerConfigForm.chatbot = chatbotValue !== null && chatbotValue !== '';
  } finally {
    isLoadingWorkerConfig.value = false;
  }
};

const saveWorkerConfig = async () => {
  if (!channelId.value) return;

  try {
    isSavingWorkerConfig.value = true;
    const payload: WorkerConfigForm = {
      ...workerConfigForm,
    };
    const result = await channelStore.updateWorkerConfig(
      channelId.value,
      payload
    );

    if (result) {
      applyWorkerConfig(result);
      workerConfigLoadedFor.value = channelId.value;
    }
  } finally {
    isSavingWorkerConfig.value = false;
  }
};

const onWorkerConfigCheckboxChange = async (
  field: WorkerConfigField,
  value: boolean | null
) => {
  workerConfigForm[field] = Boolean(value);
  await saveWorkerConfig();
};

type WorkerConfigField = keyof WorkerConfigForm;

const openTransferProtocolModal = async () => {
  if (!channelId.value) return;

  const protocolText = await channelStore.fetchTransferProtocolText(
    channelId.value
  );
  transferProtocolText.value = protocolText || '';
  transferProtocolModalOpen.value = true;
};

const closeTransferProtocolModal = () => {
  transferProtocolModalOpen.value = false;
};

const saveTransferProtocolText = async () => {
  if (!channelId.value) return;

  try {
    isSavingTransferProtocol.value = true;
    const text = transferProtocolText.value.trim() || null;
    const result = await channelStore.updateTransferProtocolText(
      channelId.value,
      text
    );

    const hasText = result !== null && result.trim().length > 0;
    workerConfigForm.generate_protocol_at_transfer = hasText;
    transferProtocolText.value = result || '';

    closeTransferProtocolModal();
  } finally {
    isSavingTransferProtocol.value = false;
  }
};

const deleteTransferProtocolText = async () => {
  if (!channelId.value) return;

  try {
    isSavingTransferProtocol.value = true;
    await channelStore.updateTransferProtocolText(channelId.value, null);

    workerConfigForm.generate_protocol_at_transfer = false;
    transferProtocolText.value = '';
    closeTransferProtocolModal();
  } finally {
    isSavingTransferProtocol.value = false;
  }
};

const openStartProtocolModal = async () => {
  if (!channelId.value) return;

  const protocolText = await channelStore.fetchStartProtocolText(
    channelId.value
  );
  startProtocolText.value = protocolText || '';
  startProtocolModalOpen.value = true;
};

const closeStartProtocolModal = () => {
  startProtocolModalOpen.value = false;
};

const saveStartProtocolText = async () => {
  if (!channelId.value) return;

  try {
    isSavingStartProtocol.value = true;
    const text = startProtocolText.value.trim() || null;
    const result = await channelStore.updateStartProtocolText(
      channelId.value,
      text
    );

    const hasText = result !== null && result.trim().length > 0;
    workerConfigForm.generate_protocol_at_start = hasText;
    startProtocolText.value = result || '';

    closeStartProtocolModal();
  } finally {
    isSavingStartProtocol.value = false;
  }
};

const deleteStartProtocolText = async () => {
  if (!channelId.value) return;

  try {
    isSavingStartProtocol.value = true;
    await channelStore.updateStartProtocolText(channelId.value, null);

    workerConfigForm.generate_protocol_at_start = false;
    startProtocolText.value = '';
    closeStartProtocolModal();
  } finally {
    isSavingStartProtocol.value = false;
  }
};

const openSimultaneousAttendanceModal = async () => {
  if (!channelId.value) return;

  const quantity = await channelStore.fetchSimultaneousAttendance(
    channelId.value
  );
  simultaneousAttendance.value = quantity;
  simultaneousAttendanceInput.value = quantity ? quantity.toString() : '';
  simultaneousAttendanceModalOpen.value = true;
};

const closeSimultaneousAttendanceModal = () => {
  simultaneousAttendanceModalOpen.value = false;
  simultaneousAttendanceInput.value = simultaneousAttendance.value
    ? simultaneousAttendance.value.toString()
    : '';
};

const saveSimultaneousAttendance = async () => {
  if (!channelId.value) return;

  const quantityValue = simultaneousAttendanceInput.value.trim();
  if (!quantityValue) {
    return;
  }

  const quantity = Number.parseInt(quantityValue, 10);
  if (Number.isNaN(quantity) || quantity < 1) {
    return;
  }

  try {
    isSavingSimultaneousAttendance.value = true;
    const result = await channelStore.updateSimultaneousAttendance(
      channelId.value,
      quantity
    );

    const hasQuantity = result !== null && result > 0;
    workerConfigForm.simultaneous_attendance = hasQuantity;
    simultaneousAttendance.value = result;
    simultaneousAttendanceInput.value = result ? result.toString() : '';

    closeSimultaneousAttendanceModal();
  } finally {
    isSavingSimultaneousAttendance.value = false;
  }
};

const deleteSimultaneousAttendance = async () => {
  if (!channelId.value) return;

  try {
    isSavingSimultaneousAttendance.value = true;
    await channelStore.updateSimultaneousAttendance(channelId.value, null);

    workerConfigForm.simultaneous_attendance = false;
    simultaneousAttendance.value = null;
    simultaneousAttendanceInput.value = '';
    closeSimultaneousAttendanceModal();
  } finally {
    isSavingSimultaneousAttendance.value = false;
  }
};

const openShowMessageOnCallModal = async () => {
  if (!channelId.value) return;

  const [messageText, config] = await Promise.all([
    channelStore.fetchShowMessageOnCall(channelId.value),
    channelStore.fetchWorkerConfig(channelId.value, false),
  ]);
  showMessageOnCallText.value = messageText || '';
  showMessageOnCallRejectCall.value = config?.reject_call ?? false;
  showMessageOnCallModalOpen.value = true;
};

const closeShowMessageOnCallModal = () => {
  showMessageOnCallModalOpen.value = false;
};

const saveShowMessageOnCallText = async () => {
  if (!channelId.value) return;

  try {
    isSavingShowMessageOnCall.value = true;
    const text = showMessageOnCallText.value.trim() || null;
    const [result] = await Promise.all([
      channelStore.updateShowMessageOnCall(channelId.value, text),
      channelStore.updateWorkerConfig(channelId.value, {
        reject_call: showMessageOnCallRejectCall.value,
      }),
    ]);

    const hasText = result !== null && result.trim().length > 0;
    workerConfigForm.show_message_on_call = hasText;
    workerConfigForm.reject_call = showMessageOnCallRejectCall.value;
    showMessageOnCallText.value = result || '';

    closeShowMessageOnCallModal();
  } finally {
    isSavingShowMessageOnCall.value = false;
  }
};

const deleteShowMessageOnCallText = async () => {
  if (!channelId.value) return;

  try {
    isSavingShowMessageOnCall.value = true;
    await Promise.all([
      channelStore.updateShowMessageOnCall(channelId.value, null),
      channelStore.updateWorkerConfig(channelId.value, {
        reject_call: false,
      }),
    ]);

    workerConfigForm.show_message_on_call = false;
    workerConfigForm.reject_call = false;
    showMessageOnCallText.value = '';
    showMessageOnCallRejectCall.value = false;
    closeShowMessageOnCallModal();
  } finally {
    isSavingShowMessageOnCall.value = false;
  }
};

const openSendMessageOnFinishAttendanceModal = async () => {
  if (!channelId.value) return;

  const messageText = await channelStore.fetchSendMessageOnFinishAttendance(
    channelId.value
  );
  sendMessageOnFinishAttendanceText.value = messageText || '';
  sendMessageOnFinishAttendanceModalOpen.value = true;
};

const closeSendMessageOnFinishAttendanceModal = () => {
  sendMessageOnFinishAttendanceModalOpen.value = false;
};

const saveSendMessageOnFinishAttendanceText = async () => {
  if (!channelId.value) return;

  try {
    isSavingSendMessageOnFinishAttendance.value = true;
    const text = sendMessageOnFinishAttendanceText.value.trim() || null;
    const result = await channelStore.updateSendMessageOnFinishAttendance(
      channelId.value,
      text
    );

    const hasText = result !== null && result.trim().length > 0;
    workerConfigForm.send_message_on_finish_attendance = hasText;
    sendMessageOnFinishAttendanceText.value = result || '';

    closeSendMessageOnFinishAttendanceModal();
  } finally {
    isSavingSendMessageOnFinishAttendance.value = false;
  }
};

const deleteSendMessageOnFinishAttendanceText = async () => {
  if (!channelId.value) return;

  try {
    isSavingSendMessageOnFinishAttendance.value = true;
    await channelStore.updateSendMessageOnFinishAttendance(
      channelId.value,
      null
    );

    workerConfigForm.send_message_on_finish_attendance = false;
    sendMessageOnFinishAttendanceText.value = '';
    closeSendMessageOnFinishAttendanceModal();
  } finally {
    isSavingSendMessageOnFinishAttendance.value = false;
  }
};

const openChatbotModal = async () => {
  if (!channelId.value) return;

  await chatbotStore.listChatbots();
  const currentChatbotId = await channelStore.fetchChatbot(channelId.value);
  chatbotId.value = currentChatbotId;
  selectedChatbotId.value = currentChatbotId;
  chatbotModalOpen.value = true;
};

const closeChatbotModal = () => {
  chatbotModalOpen.value = false;
};

const saveChatbot = async () => {
  if (!channelId.value) return;

  try {
    isSavingChatbot.value = true;
    const result = await channelStore.updateChatbot(
      channelId.value,
      selectedChatbotId.value
    );

    const hasChatbot = result !== null && result !== '';
    workerConfigForm.chatbot = hasChatbot;
    chatbotId.value = result;

    closeChatbotModal();
  } finally {
    isSavingChatbot.value = false;
  }
};

const deleteChatbot = async () => {
  if (!channelId.value) return;

  try {
    isSavingChatbot.value = true;
    await channelStore.updateChatbot(channelId.value, null);

    workerConfigForm.chatbot = false;
    chatbotId.value = null;
    selectedChatbotId.value = null;

    closeChatbotModal();
  } finally {
    isSavingChatbot.value = false;
  }
};

const workerConfigOptions = computed(() => [
  {
    key: 'is_automatic_attendance' as WorkerConfigField,
    title: t('channel_general_config_auto_attendance_title'),
    description: t('channel_general_config_auto_attendance_description'),
  },
  {
    key: 'show_attendee_name' as WorkerConfigField,
    title: t('channel_general_config_show_attendee_name_title'),
    description: t('channel_general_config_show_attendee_name_description'),
  },
  {
    key: 'show_worker_name' as WorkerConfigField,
    title: t('channel_general_config_show_worker_name_title'),
    description: t('channel_general_config_show_worker_name_description'),
  },
  {
    key: 'allow_attendance_only_online' as WorkerConfigField,
    title: t('channel_general_config_allow_attendance_only_online_title'),
    description: t(
      'channel_general_config_allow_attendance_only_online_description'
    ),
  },
  {
    key: 'simultaneous_attendance' as WorkerConfigField,
    title: t('channel_general_config_simultaneous_attendance_title'),
    description: t(
      'channel_general_config_simultaneous_attendance_description'
    ),
  },
  {
    key: 'generate_protocol_at_start' as WorkerConfigField,
    title: t('channel_general_config_generate_protocol_start_title'),
    description: t(
      'channel_general_config_generate_protocol_start_description'
    ),
  },
  {
    key: 'generate_protocol_at_transfer' as WorkerConfigField,
    title: t('channel_general_config_generate_protocol_transfer_title'),
    description: t(
      'channel_general_config_generate_protocol_transfer_description'
    ),
  },
  {
    key: 'show_message_on_call' as WorkerConfigField,
    title: t('channel_general_config_show_message_on_call_title'),
    description: t('channel_general_config_show_message_on_call_description'),
  },
  {
    key: 'send_message_on_finish_attendance' as WorkerConfigField,
    title: t('channel_general_config_send_message_on_finish_attendance_title'),
    description: t(
      'channel_general_config_send_message_on_finish_attendance_description'
    ),
  },
  {
    key: 'auto_save_contacts' as WorkerConfigField,
    title: t('channel_general_config_auto_save_contacts_title'),
    description: t('channel_general_config_auto_save_contacts_description'),
  },
  {
    key: 'chatbot' as WorkerConfigField,
    title: t('channel_general_config_chatbot_title'),
    description: t('channel_general_config_chatbot_description'),
  },
]);

const remainingSlots = computed(() => {
  const existingCount = existingStatus.value.length;

  let pendingCount = 0;
  if (selectedType.value === EWorkerProfileStatusType.text) {
    pendingCount = textContent.value.trim() ? 1 : 0;
  } else {
    pendingCount = selectedStatusPreviews.value.length;
  }

  return MAX_PROFILE_STATUS - (existingCount + pendingCount);
});

const resetPendingSelections = () => {
  for (const preview of selectedStatusPreviews.value) {
    URL.revokeObjectURL(preview.src);
  }
  selectedStatusPreviews.value = [];
  textContent.value = '';
  caption.value = '';
  isPermanent.value = 'false';
  fileInputKey.value += 1;
  statusVisibilityType.value = 'all';
  selectedContactGroups.value = [];
  selectedContacts.value = [];
  contactGroupSearch.value = '';
  contactSearch.value = '';
};

const loadContactGroups = async () => {
  if (contactGroupsList.value.length > 0) return;

  try {
    isLoadingContactGroups.value = true;
    const response = await contactGroupStore.listContactGroupAll();
    if (response) {
      contactGroupsList.value = response;
    }
  } finally {
    isLoadingContactGroups.value = false;
  }
};

const loadContacts = async () => {
  if (contactsList.value.length > 0) return;

  try {
    isLoadingContacts.value = true;
    const allContacts: ListContactResponse[] = [];
    let currentPage = 1;
    let hasMore = true;
    const perPage = 200;

    while (hasMore) {
      const response = await contactStore.listContact({
        page: currentPage,
        per_page: perPage,
        sort_by: [],
      });

      if (!response?.results?.length) {
        hasMore = false;
        continue;
      }

      allContacts.push(...response.results);

      if (response.pagings && currentPage < response.pagings.total_pages) {
        currentPage++;
        continue;
      }

      hasMore = false;
    }

    contactsList.value = allContacts;
  } finally {
    isLoadingContacts.value = false;
  }
};

watch(statusVisibilityType, (newValue) => {
  selectedContactGroups.value = [];
  selectedContacts.value = [];

  if (newValue === 'contact_groups') {
    loadContactGroups();
    return;
  }

  if (newValue === 'contacts') {
    loadContacts();
  }
});

const fetchProfileStatus = async () => {
  if (!channelId.value) return;

  try {
    isLoadingProfileStatus.value = true;
    const response = await channelStore.fetchWorkerProfileStatus(
      channelId.value
    );

    if (response) {
      existingStatus.value = response;
    }
  } finally {
    isLoadingProfileStatus.value = false;
  }
};

const handleFilesSelected = (files: File[] | File | null) => {
  if (!files) return;

  const normalizedFiles = Array.isArray(files) ? files : [files];

  let allowedMimeTypes: string[] = [];
  let allowedExtensions: string[] = [];

  if (selectedType.value === EWorkerProfileStatusType.image) {
    allowedMimeTypes = ACCEPTED_IMAGE_MIME_TYPES;
    allowedExtensions = ACCEPTED_IMAGE_EXTENSIONS;
  }
  if (selectedType.value === EWorkerProfileStatusType.video) {
    allowedMimeTypes = ACCEPTED_VIDEO_MIME_TYPES;
    allowedExtensions = ACCEPTED_VIDEO_EXTENSIONS;
  }
  if (selectedType.value === EWorkerProfileStatusType.audio) {
    allowedMimeTypes = ACCEPTED_AUDIO_MIME_TYPES;
    allowedExtensions = ACCEPTED_AUDIO_EXTENSIONS;
  }

  const invalidFiles: File[] = [];
  const sanitizedFiles = normalizedFiles.filter((file) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      invalidFiles.push(file);
      return false;
    }

    if (allowedMimeTypes.includes(file.type)) {
      return true;
    }

    const filename = file.name.toLowerCase();

    return allowedExtensions.some((ext) => filename.endsWith(ext));
  });

  if (invalidFiles.length > 0) {
    channelStore.showSnackbar(
      t('profile_status_file_size_exceeded', { max: '16 MB' }),
      EColor.error
    );
    fileInputKey.value += 1;
  }

  if (!sanitizedFiles.length) {
    return;
  }

  if (remainingSlots.value <= 0) {
    channelStore.showSnackbar(
      t('profile_status_limit_reached'),
      EColor.warning
    );

    return;
  }

  if (sanitizedFiles.length > remainingSlots.value) {
    channelStore.showSnackbar(
      t('profile_status_remaining_photos', {
        count: remainingSlots.value,
      }),
      EColor.warning
    );
  }

  for (const file of sanitizedFiles.slice(0, remainingSlots.value)) {
    const id = crypto.randomUUID();
    const src = URL.createObjectURL(file);

    selectedStatusPreviews.value.push({ id, file, src });
  }

  fileInputKey.value += 1;
};

const removePreview = (previewId: string) => {
  const index = selectedStatusPreviews.value.findIndex(
    (preview) => preview.id === previewId
  );

  if (index === -1) return;

  URL.revokeObjectURL(selectedStatusPreviews.value[index].src);
  selectedStatusPreviews.value.splice(index, 1);
};

const validateTextContent = (): boolean => {
  if (!textContent.value.trim()) {
    channelStore.showSnackbar(
      t('profile_status_text_required'),
      EColor.warning
    );
    return false;
  }
  if (textContent.value.length > MAX_TEXT_LENGTH) {
    channelStore.showSnackbar(
      t('profile_status_text_too_long', { max: MAX_TEXT_LENGTH }),
      EColor.warning
    );
    return false;
  }
  return true;
};

const validateStatusPreviews = (): boolean => {
  if (!selectedStatusPreviews.value.length) {
    channelStore.showSnackbar(
      t('profile_status_no_photos_selected'),
      EColor.warning
    );
    return false;
  }
  return true;
};

const validateCaption = (): boolean => {
  if (caption.value.length > MAX_TEXT_LENGTH) {
    channelStore.showSnackbar(
      t('profile_status_caption_too_long', { max: MAX_TEXT_LENGTH }),
      EColor.warning
    );
    return false;
  }
  return true;
};

const validateVisibility = (): boolean => {
  if (!statusVisibilityType.value) {
    channelStore.showSnackbar(
      t('profile_status_visibility_required'),
      EColor.warning
    );
    return false;
  }

  if (
    statusVisibilityType.value === 'contact_groups' &&
    selectedContactGroups.value.length === 0
  ) {
    channelStore.showSnackbar(t('contact_groups_required'), EColor.warning);
    return false;
  }

  if (
    statusVisibilityType.value === 'contacts' &&
    selectedContacts.value.length === 0
  ) {
    channelStore.showSnackbar(t('contacts_required'), EColor.warning);
    return false;
  }

  return true;
};

const buildVisibilityData = (): {
  visibility_type: StatusVisibilityType;
  contact_group_ids?: string[];
  contact_ids?: string[];
} => {
  const visibilityData: {
    visibility_type: StatusVisibilityType;
    contact_group_ids?: string[];
    contact_ids?: string[];
  } = {
    visibility_type: statusVisibilityType.value,
  };

  if (
    statusVisibilityType.value === 'contact_groups' &&
    selectedContactGroups.value.length > 0
  ) {
    visibilityData.contact_group_ids = selectedContactGroups.value;
  }

  if (
    statusVisibilityType.value === 'contacts' &&
    selectedContacts.value.length > 0
  ) {
    visibilityData.contact_ids = selectedContacts.value;
  }

  return visibilityData;
};

const saveProfileStatus = async () => {
  if (!channelId.value) return;

  if (selectedType.value === EWorkerProfileStatusType.text) {
    if (!validateTextContent()) return;
  } else if (!validateStatusPreviews()) {
    return;
  }

  if (!validateCaption()) return;
  if (!validateVisibility()) return;

  try {
    isSavingProfileStatus.value = true;

    const files = selectedStatusPreviews.value.map((preview) => preview.file);
    const visibilityData = buildVisibilityData();

    const response = await channelStore.uploadWorkerProfileStatus(
      channelId.value,
      selectedType.value,
      files.length > 0 ? files : undefined,
      selectedType.value === EWorkerProfileStatusType.text
        ? textContent.value
        : undefined,
      showCaptionInput.value ? caption.value : undefined,
      isPermanent.value,
      visibilityData
    );

    if (response) {
      const newStatuses = response.map((status) => ({
        ...status,
        created_at: (status as any).created_at || new Date().toISOString(),
      }));
      existingStatus.value = [...newStatuses, ...existingStatus.value];
      resetPendingSelections();
    }
  } finally {
    isSavingProfileStatus.value = false;
  }
};

const openPreview = (
  src: string,
  caption?: string,
  text?: string,
  type?: EWorkerProfileStatusType
) => {
  previewDialog.value = {
    open: true,
    src: text ? null : src,
    caption: caption && caption.trim() ? caption.trim() : null,
    text: text && text.trim() ? text.trim() : null,
    type: type || null,
  };
};

const closePreview = () => {
  if (audioPreviewRef.value) {
    audioPreviewRef.value.pause();
    audioPreviewRef.value.currentTime = 0;
  }
  isAudioPlaying.value = false;
  audioProgress.value = 0;
  audioDuration.value = 0;
  audioCurrentTime.value = 0;
  previewDialog.value = {
    open: false,
    src: null,
    caption: null,
    text: null,
    type: null,
  };
};

const createDefaultWaveform = (): number[] => {
  return new Array(64).fill(0.3);
};

const toggleAudioPreview = () => {
  if (!audioPreviewRef.value) return;

  if (isAudioPlaying.value) {
    audioPreviewRef.value.pause();
    return;
  }

  audioPreviewRef.value.play().catch(() => {
    isAudioPlaying.value = false;
  });
};

const updateAudioProgress = () => {
  if (!audioPreviewRef.value) return;
  audioCurrentTime.value = audioPreviewRef.value.currentTime;
  if (audioDuration.value > 0) {
    audioProgress.value =
      (audioPreviewRef.value.currentTime / audioDuration.value) * 100;
  }
};

const updateAudioDuration = () => {
  if (!audioPreviewRef.value) return;
  audioDuration.value = audioPreviewRef.value.duration;
  if (!audioWaveformBars.value.length) {
    audioWaveformBars.value = createDefaultWaveform();
  }
};

const formatAudioTime = (seconds: number): string => {
  if (!seconds || Number.isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const audioTimeDisplay = computed(() => {
  if (isAudioPlaying.value) {
    return `${formatAudioTime(audioCurrentTime.value)} / ${formatAudioTime(
      audioDuration.value
    )}`;
  }
  return formatAudioTime(audioDuration.value);
});

const togglePermanent = async (status: ProfileStatus) => {
  if (!channelId.value) return;

  const newIsPermanent = !status.is_permanent;

  const success = await channelStore.updateProfileStatusIsPermanent(
    status.worker_profile_status_id,
    newIsPermanent
  );

  if (success) {
    const index = existingStatus.value.findIndex(
      (s) => s.worker_profile_status_id === status.worker_profile_status_id
    );

    if (index !== -1) {
      existingStatus.value[index] = {
        ...existingStatus.value[index],
        is_permanent: newIsPermanent,
      };
    }
  }
};

const deleteStatus = async (status: ProfileStatus) => {
  if (!channelId.value) return;

  const success = await channelStore.deleteProfileStatus(
    status.worker_profile_status_id
  );

  if (success) {
    existingStatus.value = existingStatus.value.filter(
      (s) => s.worker_profile_status_id !== status.worker_profile_status_id
    );
  }
};

const loadProfileInfo = async () => {
  if (!channelId.value) return;

  const profileInfo = await channelStore.fetchWorkerProfileInfo(
    channelId.value
  );

  if (profileInfo) {
    profilePhoto.value = profileInfo.photo;
    profileName.value = profileInfo.name;
    profileDescription.value = profileInfo.message;

    return;
  }

  profilePhoto.value = null;
  profileName.value = null;
  profileDescription.value = null;
};

const isProfilePhotoBusy = computed(
  () => isUploadingProfilePhoto.value || isRemovingProfilePhoto.value
);

const openFileSelector = () => {
  if (isProfilePhotoBusy.value) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  };
  input.click();
};

const handleImageSelect = (file: File) => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    channelStore.showSnackbar(
      t('profile_status_file_size_exceeded', { max: '16 MB' }),
      EColor.error
    );
    return;
  }

  const reader = new FileReader();
  reader.onload = (e: ProgressEvent<FileReader>) => {
    const result = e.target?.result as string;
    if (result) {
      cropDialog.value.imageSrc = result;
      cropDialog.value.open = true;
      profilePhotoFile.value = file;
      nextTick(() => {
        initializeCrop();
      });
    }
  };
  reader.readAsDataURL(file);
};

const initializeCrop = () => {
  if (!cropImageRef.value) return;

  const img = cropImageRef.value;
  const containerWidth = 400;
  const containerHeight = 400;

  if (img.complete) {
    setupCropArea(img, containerWidth, containerHeight);
    return;
  }

  img.onload = () => {
    setupCropArea(img, containerWidth, containerHeight);
  };
};

const setupCropArea = (
  img: HTMLImageElement,
  containerWidth: number,
  containerHeight: number
) => {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  let displayWidth = containerWidth;
  let displayHeight = containerHeight;

  if (imgAspect > containerAspect) {
    displayHeight = containerWidth / imgAspect;
  }

  if (imgAspect <= containerAspect) {
    displayWidth = containerHeight * imgAspect;
  }

  img.style.width = `${displayWidth}px`;
  img.style.height = `${displayHeight}px`;

  cropArea.value.aspectRatio = 1;

  const maxCropSize = Math.min(displayWidth, displayHeight, cropPreviewSize);
  const cropSize = maxCropSize;

  cropArea.value.width = cropSize;
  cropArea.value.height = cropSize;

  const imgLeft = (containerWidth - displayWidth) / 2;
  const imgTop = (containerHeight - displayHeight) / 2;

  cropArea.value.x = imgLeft + Math.max(0, (displayWidth - cropSize) / 2);
  cropArea.value.y = imgTop + Math.max(0, (displayHeight - cropSize) / 2);
};

const startCropDrag = (e: MouseEvent | TouchEvent) => {
  e.preventDefault();
  e.stopPropagation();
  cropArea.value.isDragging = true;
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left - cropArea.value.x;
  cropArea.value.startY = clientY - rect.top - cropArea.value.y;

  document.addEventListener('mousemove', onCropDrag);
  document.addEventListener('touchmove', onCropDrag);
  document.addEventListener('mouseup', endCropDrag);
  document.addEventListener('touchend', endCropDrag);
};

const startCropResize = (
  handle: CropResizeHandle,
  e: MouseEvent | TouchEvent
) => {
  e.preventDefault();
  e.stopPropagation();
  cropArea.value.isResizing = true;
  cropArea.value.resizeHandle = handle;

  cropArea.value.initialWidth = cropArea.value.width;
  cropArea.value.initialHeight = cropArea.value.height;
  cropArea.value.initialX = cropArea.value.x;
  cropArea.value.initialY = cropArea.value.y;

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left;
  cropArea.value.startY = clientY - rect.top;

  document.addEventListener('mousemove', onCropResize);
  document.addEventListener('touchmove', onCropResize);
  document.addEventListener('mouseup', endCropResize);
  document.addEventListener('touchend', endCropResize);
};

const onCropDrag = (e: MouseEvent | TouchEvent) => {
  if (!cropArea.value.isDragging || !cropImageRef.value) return;

  e.preventDefault();
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left - cropArea.value.startX;
  const y = clientY - rect.top - cropArea.value.startY;

  const imgWidth = cropImageRef.value.offsetWidth;
  const imgHeight = cropImageRef.value.offsetHeight;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  const imgLeft = (containerWidth - imgWidth) / 2;
  const imgTop = (containerHeight - imgHeight) / 2;

  const minX = imgLeft;
  const minY = imgTop;
  const maxX = imgLeft + imgWidth - cropArea.value.width;
  const maxY = imgTop + imgHeight - cropArea.value.height;

  cropArea.value.x = Math.max(minX, Math.min(x, maxX));
  cropArea.value.y = Math.max(minY, Math.min(y, maxY));
};

const getEventCoordinates = (
  e: MouseEvent | TouchEvent
): { x: number; y: number } => {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
};

const getFixedPoint = (
  handle: CropResizeHandle,
  initialX: number,
  initialY: number,
  initialWidth: number,
  initialHeight: number
): { x: number; y: number } => {
  const fixedPoints: Record<CropResizeHandle, { x: number; y: number }> = {
    nw: { x: initialX + initialWidth, y: initialY + initialHeight },
    ne: { x: initialX, y: initialY + initialHeight },
    sw: { x: initialX + initialWidth, y: initialY },
    se: { x: initialX, y: initialY },
  };

  return fixedPoints[handle];
};

const calculateInitialPosition = (
  handle: CropResizeHandle,
  fixedX: number,
  fixedY: number,
  size: number
): { x: number; y: number } => {
  const positions: Record<CropResizeHandle, { x: number; y: number }> = {
    nw: { x: fixedX - size, y: fixedY - size },
    ne: { x: fixedX, y: fixedY - size },
    sw: { x: fixedX - size, y: fixedY },
    se: { x: fixedX, y: fixedY },
  };

  return positions[handle];
};

const applyMinSizeConstraint = (
  handle: CropResizeHandle,
  fixedPoint: CropFixedPoint,
  minSize: number,
  current: CropDimensions
): CropDimensions => {
  if (current.width >= minSize && current.height >= minSize) {
    return current;
  }

  const position = calculateInitialPosition(
    handle,
    fixedPoint.x,
    fixedPoint.y,
    minSize
  );
  return { width: minSize, height: minSize, x: position.x, y: position.y };
};

const applyMaxSizeConstraint = (
  handle: CropResizeHandle,
  fixedPoint: CropFixedPoint,
  limits: CropMaxLimits,
  current: CropDimensions
): CropDimensions => {
  let { width, height, x, y } = current;

  if (width > limits.maxWidth) {
    width = limits.maxWidth;
    height = limits.maxWidth;
    x =
      handle === 'nw' || handle === 'sw'
        ? fixedPoint.x - limits.maxWidth
        : fixedPoint.x;
  }

  if (height > limits.maxHeight) {
    height = limits.maxHeight;
    width = limits.maxHeight;
    y =
      handle === 'nw' || handle === 'ne'
        ? fixedPoint.y - limits.maxHeight
        : fixedPoint.y;
  }

  return { width, height, x, y };
};

const applyBoundaryConstraints = (
  maxWidth: number,
  maxHeight: number,
  width: number,
  height: number,
  x: number,
  y: number
): { x: number; y: number } => {
  let newX = Math.max(0, x);
  let newY = Math.max(0, y);

  if (newX + width > maxWidth) {
    newX = maxWidth - width;
  }

  if (newY + height > maxHeight) {
    newY = maxHeight - height;
  }

  return { x: newX, y: newY };
};

const onCropResize = (e: MouseEvent | TouchEvent) => {
  if (
    !cropArea.value.isResizing ||
    !cropImageRef.value ||
    !cropArea.value.resizeHandle
  )
    return;

  e.preventDefault();

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const rect = container.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const handle = cropArea.value.resizeHandle;
  const { x: fixedX, y: fixedY } = getFixedPoint(
    handle,
    cropArea.value.initialX,
    cropArea.value.initialY,
    cropArea.value.initialWidth,
    cropArea.value.initialHeight
  );

  const deltaX = mouseX - fixedX;
  const deltaY = mouseY - fixedY;
  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));

  const { x: initialX, y: initialY } = calculateInitialPosition(
    handle,
    fixedX,
    fixedY,
    size
  );

  const imgWidth = cropImageRef.value.offsetWidth;
  const imgHeight = cropImageRef.value.offsetHeight;
  const resizeContainer = cropImageRef.value.parentElement;
  if (!resizeContainer) return;

  const resizeContainerWidth = resizeContainer.clientWidth;
  const resizeContainerHeight = resizeContainer.clientHeight;
  const imgLeft = (resizeContainerWidth - imgWidth) / 2;
  const imgTop = (resizeContainerHeight - imgHeight) / 2;

  const maxWidth = imgLeft + imgWidth;
  const maxHeight = imgTop + imgHeight;
  const minSize = 50;

  const fixedPoint = { x: fixedX, y: fixedY };
  let dimensions = applyMinSizeConstraint(handle, fixedPoint, minSize, {
    width: size,
    height: size,
    x: initialX,
    y: initialY,
  });

  dimensions = applyMaxSizeConstraint(
    handle,
    fixedPoint,
    { maxWidth, maxHeight },
    dimensions
  );

  const finalImgWidth = cropImageRef.value.offsetWidth;
  const finalImgHeight = cropImageRef.value.offsetHeight;
  const finalContainer = cropImageRef.value.parentElement;
  if (!finalContainer) return;

  const finalContainerWidth = finalContainer.clientWidth;
  const finalContainerHeight = finalContainer.clientHeight;
  const finalImgLeft = (finalContainerWidth - finalImgWidth) / 2;
  const finalImgTop = (finalContainerHeight - finalImgHeight) / 2;

  const minX = finalImgLeft;
  const minY = finalImgTop;
  const maxX = finalImgLeft + finalImgWidth;
  const maxY = finalImgTop + finalImgHeight;

  const finalPosition = applyBoundaryConstraints(
    maxX,
    maxY,
    dimensions.width,
    dimensions.height,
    dimensions.x,
    dimensions.y
  );

  finalPosition.x = Math.max(
    minX,
    Math.min(finalPosition.x, maxX - dimensions.width)
  );
  finalPosition.y = Math.max(
    minY,
    Math.min(finalPosition.y, maxY - dimensions.height)
  );

  cropArea.value.width = dimensions.width;
  cropArea.value.height = dimensions.height;
  cropArea.value.x = finalPosition.x;
  cropArea.value.y = finalPosition.y;
};

const endCropDrag = () => {
  cropArea.value.isDragging = false;
  document.removeEventListener('mousemove', onCropDrag);
  document.removeEventListener('touchmove', onCropDrag);
  document.removeEventListener('mouseup', endCropDrag);
  document.removeEventListener('touchend', endCropDrag);
};

const endCropResize = () => {
  cropArea.value.isResizing = false;
  cropArea.value.resizeHandle = null;
  document.removeEventListener('mousemove', onCropResize);
  document.removeEventListener('touchmove', onCropResize);
  document.removeEventListener('mouseup', endCropResize);
  document.removeEventListener('touchend', endCropResize);
};

const cropImage = () => {
  if (!cropImageRef.value || !cropCanvasRef.value) return;

  const img = cropImageRef.value;
  const canvas = cropCanvasRef.value;
  const ctx = canvas.getContext('2d');

  if (!ctx || !img.complete) {
    channelStore.showSnackbar(
      'Aguarde a imagem carregar completamente',
      EColor.warning
    );
    return;
  }

  const container = img.parentElement;
  if (!container) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const imgLeft = (containerWidth - img.offsetWidth) / 2;
  const imgTop = (containerHeight - img.offsetHeight) / 2;

  const relativeX = cropArea.value.x - imgLeft;
  const relativeY = cropArea.value.y - imgTop;

  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;

  const sourceX = relativeX * scaleX;
  const sourceY = relativeY * scaleY;
  const sourceWidth = cropArea.value.width * scaleX;
  const sourceHeight = cropArea.value.height * scaleY;

  canvas.width = cropPreviewSize;
  canvas.height = cropPreviewSize;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    cropPreviewSize,
    cropPreviewSize
  );

  canvas.toBlob(
    (blob) => {
      if (!blob) return;

      const croppedFile = new File([blob], 'profile-photo.jpg', {
        type: 'image/jpeg',
      });
      profilePhotoFile.value = croppedFile;
      cropDialog.value.croppedImage = canvas.toDataURL('image/jpeg');
      cropDialog.value.open = false;

      saveProfilePhoto();
    },
    'image/jpeg',
    0.9
  );
};

const saveProfilePhoto = async () => {
  if (!channelId.value || !profilePhotoFile.value) return;

  try {
    isUploadingProfilePhoto.value = true;

    const result = await channelStore.uploadWorkerProfileInfo(
      channelId.value,
      profileName.value,
      profileDescription.value,
      profilePhotoFile.value
    );

    if (result) {
      profilePhoto.value = result.photo;
      profileName.value = result.name;
      profileDescription.value = result.message;
      cropDialog.value.croppedImage = '';
      profilePhotoFile.value = null;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : t('profile_photo_upload_error') || 'Erro ao fazer upload da foto';
    channelStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    isUploadingProfilePhoto.value = false;
  }
};

const saveProfileInfo = async () => {
  if (!channelId.value) return;

  try {
    isSavingProfileInfo.value = true;

    const result = await channelStore.uploadWorkerProfileInfo(
      channelId.value,
      profileName.value,
      profileDescription.value,
      profilePhotoFile.value || null
    );

    if (result) {
      profilePhoto.value = result.photo;
      profileName.value = result.name;
      profileDescription.value = result.message;
      profilePhotoFile.value = null;
      cropDialog.value.croppedImage = '';
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : t('profile_info_upload_error');
    channelStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    isSavingProfileInfo.value = false;
  }
};

const removeProfilePhoto = async () => {
  if (!channelId.value || !profilePhoto.value) return;

  try {
    isRemovingProfilePhoto.value = true;

    const result = await channelStore.uploadWorkerProfileInfo(
      channelId.value,
      profileName.value,
      profileDescription.value,
      null,
      true
    );

    if (result) {
      profilePhoto.value = result.photo;
      profileName.value = result.name;
      profileDescription.value = result.message;
      profilePhotoFile.value = null;
      cropDialog.value.croppedImage = '';
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : t('profile_photo_remove_error') || 'Erro ao remover a foto do perfil';
    channelStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    isRemovingProfilePhoto.value = false;
  }
};

const cancelCrop = () => {
  cropDialog.value.open = false;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
  profilePhotoFile.value = null;
};

watch(isVisible, async (visible, oldVisible) => {
  if (!visible) {
    resetPendingSelections();
    closePreview();
    cancelCrop();
    resetWorkerConfigState();
    isInitialLoad.value = false;
    return;
  }

  if (oldVisible === false) {
    currentTab.value = 'general';
    isInitialLoad.value = true;

    if (channelId.value) {
      await loadWorkerConfig(true);
      isInitialLoad.value = false;
    }
  }
});

watch(
  channelId,
  async (newValue, oldValue) => {
    if (!isVisible.value) return;
    if (!newValue) return;
    if (newValue === oldValue) return;

    if (isInitialLoad.value) {
      isInitialLoad.value = false;
      return;
    }

    resetWorkerConfigState();

    if (currentTab.value === 'general') {
      await loadWorkerConfig(true);
    } else if (currentTab.value === 'profile-status') {
      await fetchProfileStatus();
    } else if (currentTab.value === 'profile-info') {
      await loadProfileInfo();
    }
  },
  { immediate: false }
);

watch(currentTab, async (newTab, oldTab) => {
  if (!isVisible.value || !channelId.value) return;
  if (newTab === oldTab) return;

  if (newTab === 'general') {
    await loadWorkerConfig(true);
  } else if (newTab === 'profile-status') {
    await fetchProfileStatus();
  } else if (newTab === 'profile-info') {
    await loadProfileInfo();
  }
});

watch(selectedType, () => {
  resetPendingSelections();
});

onBeforeUnmount(() => {
  resetPendingSelections();
});

onMounted(async () => {
  if (isVisible.value && channelId.value) {
    currentTab.value = 'general';

    await loadWorkerConfig(true);
  }
});
</script>

<template>
  <VDialog
    v-model="isVisible"
    max-width="960"
    :persistent="isSavingProfileStatus"
  >
    <DialogCloseBtn
      :disabled="isSavingProfileStatus"
      @click="isVisible = false"
    />

    <VOverlay
      :model-value="channelStore.loading && !isSavingProfileStatus"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('configurations') }}</span>
        <DialogCloseBtn
          class="d-none d-sm-flex"
          :disabled="isSavingProfileStatus"
          @click="isVisible = false"
        />
      </VCardTitle>

      <VTabs v-model="currentTab" grow>
        <VTab value="general">{{ $t('general_settings') }}</VTab>
        <VTab v-if="canAccessProfileStatus" value="profile-status">{{
          $t('profile_status_tab')
        }}</VTab>
        <VTab v-if="canAccessProfileInfo" value="profile-info">{{
          $t('profile_information_tab')
        }}</VTab>
      </VTabs>

      <VDivider />

      <VCardText class="scrollable-content">
        <VWindow v-model="currentTab">
          <VWindowItem value="general">
            <div
              class="general-config-wrapper position-relative pa-4 d-flex flex-column gap-4"
            >
              <VOverlay
                :model-value="isLoadingWorkerConfig"
                contained
                class="align-center justify-center general-config-overlay"
              >
                <VProgressCircular color="primary" indeterminate size="32" />
              </VOverlay>

              <div>
                <h5 class="text-h6 mb-1">
                  {{ $t('channel_general_config_title') }}
                </h5>
                <p class="text-body-2 text-medium-emphasis mb-0">
                  {{ $t('channel_general_config_subtitle') }}
                </p>
              </div>

              <VRow class="general-config-grid" dense>
                <VCol
                  v-for="option in workerConfigOptions"
                  :key="option.key"
                  cols="12"
                  md="6"
                >
                  <VCard class="general-config-card h-100" variant="outlined">
                    <div class="d-flex flex-column gap-2">
                      <VCheckbox
                        v-if="
                          option.key !== 'generate_protocol_at_transfer' &&
                          option.key !== 'generate_protocol_at_start' &&
                          option.key !== 'simultaneous_attendance' &&
                          option.key !== 'show_message_on_call' &&
                          option.key !== 'send_message_on_finish_attendance' &&
                          option.key !== 'chatbot'
                        "
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="isSavingWorkerConfig"
                        @update:model-value="
                          onWorkerConfigCheckboxChange(option.key, $event)
                        "
                      />
                      <VCheckbox
                        v-else-if="
                          option.key === 'generate_protocol_at_transfer'
                        "
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="
                          isSavingWorkerConfig || isSavingTransferProtocol
                        "
                        @click.stop.prevent="openTransferProtocolModal"
                      />
                      <VCheckbox
                        v-else-if="option.key === 'generate_protocol_at_start'"
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="
                          isSavingWorkerConfig || isSavingStartProtocol
                        "
                        @click.stop.prevent="openStartProtocolModal"
                      />
                      <VCheckbox
                        v-else-if="option.key === 'simultaneous_attendance'"
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="
                          isSavingWorkerConfig || isSavingSimultaneousAttendance
                        "
                        @click.stop.prevent="openSimultaneousAttendanceModal"
                      />
                      <VCheckbox
                        v-else-if="option.key === 'show_message_on_call'"
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="
                          isSavingWorkerConfig || isSavingShowMessageOnCall
                        "
                        @click.stop.prevent="openShowMessageOnCallModal"
                      />
                      <VCheckbox
                        v-else-if="
                          option.key === 'send_message_on_finish_attendance'
                        "
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="
                          isSavingWorkerConfig ||
                          isSavingSendMessageOnFinishAttendance
                        "
                        @click.stop.prevent="
                          openSendMessageOnFinishAttendanceModal
                        "
                      />
                      <VCheckbox
                        v-else-if="option.key === 'chatbot'"
                        :model-value="workerConfigForm[option.key]"
                        :label="option.title"
                        color="primary"
                        hide-details
                        :disabled="isSavingWorkerConfig || isSavingChatbot"
                        @click.stop.prevent="openChatbotModal"
                      />
                      <p class="text-body-2 text-medium-emphasis mb-0">
                        {{ option.description }}
                      </p>
                    </div>
                  </VCard>
                </VCol>
              </VRow>
            </div>
          </VWindowItem>

          <VWindowItem value="profile-status">
            <div class="d-flex flex-column gap-4 position-relative pa-4">
              <VOverlay
                v-model="isLoadingProfileStatus"
                class="align-center justify-center"
                contained
              >
                <VProgressCircular color="primary" indeterminate size="32" />
              </VOverlay>

              <VAlert
                v-if="uploadHelperMessage"
                color="warning"
                variant="tonal"
                :text="uploadHelperMessage"
                icon="tabler-info-circle"
                class="alert-helper"
              />

              <div class="status-type-wrapper">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('profile_status_type') }}:</VLabel
                >
                <VSelect
                  v-model="selectedType"
                  :items="statusTypeOptions"
                  item-title="title"
                  item-value="value"
                  class="mb-4"
                />

                <div v-if="showTextInput" class="mb-4">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('profile_status_text') }}:</VLabel
                  >
                  <VTextarea
                    v-model="textContent"
                    :counter="MAX_TEXT_LENGTH"
                    :maxlength="MAX_TEXT_LENGTH"
                    rows="4"
                  />
                </div>

                <div
                  v-if="showFileInput"
                  class="d-flex align-center gap-4 file-input-wrapper mb-4"
                >
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('profile_status_upload_button') }}:</VLabel
                  >
                  <VFileInput
                    :key="fileInputKey"
                    multiple
                    show-size
                    counter
                    chips
                    :accept="acceptedFileTypes"
                    class="flex-grow-1"
                    @update:model-value="handleFilesSelected"
                  />
                </div>

                <div v-if="showCaptionInput" class="mb-4">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('profile_status_caption') }}:</VLabel
                  >
                  <VTextarea
                    v-model="caption"
                    :counter="MAX_TEXT_LENGTH"
                    :maxlength="MAX_TEXT_LENGTH"
                    rows="2"
                  />
                </div>

                <VLabel class="text-body-2 mb-1"
                  >{{ $t('is_permanent') }}:</VLabel
                >
                <VSelect
                  v-model="isPermanent"
                  :items="isPermanentOptions"
                  item-title="title"
                  item-value="value"
                  class="mb-4"
                />

                <VLabel class="text-body-2 mb-1"
                  >{{ $t('status_visibility_label') }}:</VLabel
                >
                <VSelect
                  v-model="statusVisibilityType"
                  :items="statusVisibilityOptions"
                  item-title="title"
                  item-value="value"
                  class="mb-4"
                />

                <VLabel
                  v-if="statusVisibilityType === 'contact_groups'"
                  class="text-body-2 mb-1"
                  >{{ $t('status_visibility_select_contact_groups') }}:</VLabel
                >
                <VAutocomplete
                  v-if="statusVisibilityType === 'contact_groups'"
                  v-model="selectedContactGroups"
                  :items="filteredContactGroups"
                  item-title="name"
                  item-value="contact_group_id"
                  multiple
                  chips
                  closable-chips
                  :loading="isLoadingContactGroups"
                  :search="contactGroupSearch"
                  @update:search="contactGroupSearch = $event"
                  class="mb-4"
                />

                <VLabel
                  v-if="statusVisibilityType === 'contacts'"
                  class="text-body-2 mb-1"
                  >{{ $t('status_visibility_select_contacts') }}:</VLabel
                >
                <VAutocomplete
                  v-if="statusVisibilityType === 'contacts'"
                  v-model="selectedContacts"
                  :items="filteredContacts"
                  :item-title="
                    (item) => {
                      const fullName = `${item.name}${item.last_name ? ' ' + item.last_name : ''}`;
                      return item.phone_partial
                        ? `${fullName} (${item.phone_partial})`
                        : fullName;
                    }
                  "
                  item-value="contact_id"
                  multiple
                  chips
                  closable-chips
                  :loading="isLoadingContacts"
                  :search="contactSearch"
                  @update:search="contactSearch = $event"
                  class="mb-4"
                />
              </div>

              <div v-if="showTextInput && textContent">
                <p class="text-subtitle-2 mb-2">
                  {{ $t('profile_status_pending_title') }}
                </p>
                <VCard class="pa-4">
                  <p class="text-body-1">{{ textContent }}</p>
                </VCard>
              </div>

              <div v-if="showFileInput && selectedStatusPreviews.length">
                <p class="text-subtitle-2 mb-2">
                  {{ $t('profile_status_pending_title') }}
                </p>
                <VRow>
                  <VCol
                    v-for="preview in selectedStatusPreviews"
                    :key="preview.id"
                    cols="6"
                    sm="4"
                    md="3"
                    lg="2"
                  >
                    <VCard class="pa-2 photo-pending-card">
                      <VImg
                        v-if="selectedType === EWorkerProfileStatusType.image"
                        :src="preview.src"
                        aspect-ratio="1"
                        cover
                        class="rounded mb-2 cursor-pointer"
                        @click="
                          openPreview(
                            preview.src,
                            caption && caption.trim() ? caption : undefined,
                            undefined,
                            EWorkerProfileStatusType.image
                          )
                        "
                      />
                      <div
                        v-else-if="
                          selectedType === EWorkerProfileStatusType.video
                        "
                        class="position-relative rounded mb-2 cursor-pointer"
                        style="
                          width: 100%;
                          aspect-ratio: 1;
                          background: rgba(var(--v-theme-surface-variant), 0.1);
                        "
                        @click="
                          openPreview(
                            preview.src,
                            caption && caption.trim() ? caption : undefined,
                            undefined,
                            EWorkerProfileStatusType.video
                          )
                        "
                      >
                        <video
                          :src="preview.src"
                          class="rounded"
                          preload="metadata"
                          muted
                          playsinline
                          style="
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                            pointer-events: none;
                          "
                        >
                          <track kind="captions" />
                        </video>
                        <div
                          class="position-absolute d-flex align-center justify-center"
                          style="
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            z-index: 1;
                          "
                        >
                          <VIcon
                            icon="tabler-player-play-filled"
                            size="48"
                            color="white"
                            style="
                              filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5));
                            "
                          />
                        </div>
                      </div>
                      <div
                        v-else-if="
                          selectedType === EWorkerProfileStatusType.audio
                        "
                        class="d-flex align-center justify-center rounded mb-2 cursor-pointer position-relative"
                        style="
                          width: 100%;
                          aspect-ratio: 1;
                          background: rgba(var(--v-theme-surface-variant), 0.1);
                        "
                        @click="
                          openPreview(
                            preview.src,
                            caption && caption.trim() ? caption : undefined,
                            undefined,
                            EWorkerProfileStatusType.audio
                          )
                        "
                      >
                        <VIcon icon="tabler-music" size="48" />
                      </div>
                      <div class="d-flex justify-space-between align-center">
                        <span class="text-caption">{{
                          $t('profile_status_preview_label')
                        }}</span>
                        <VBtn
                          icon="tabler-x"
                          variant="text"
                          color="error"
                          size="small"
                          @click="removePreview(preview.id)"
                        />
                      </div>
                    </VCard>
                  </VCol>
                </VRow>
              </div>

              <div class="d-flex justify-end">
                <VBtn
                  color="primary"
                  :loading="isSavingProfileStatus"
                  :disabled="
                    (showTextInput && !textContent.trim()) ||
                    (showFileInput && !selectedStatusPreviews.length)
                  "
                  @click="saveProfileStatus"
                >
                  {{ $t('profile_status_save') }}
                </VBtn>
              </div>

              <VDivider />

              <div>
                <div class="d-flex justify-space-between align-center mb-2">
                  <p class="text-subtitle-2 mb-0">
                    {{ $t('profile_status_current_gallery') }}
                  </p>
                  <span class="text-caption text-medium-emphasis">
                    {{ $t('profile_status_gallery_subtitle') }}
                  </span>
                </div>

                <VRow v-if="existingStatus.length">
                  <VCol
                    v-for="status in existingStatus"
                    :key="status.worker_profile_status_id"
                    cols="6"
                    sm="4"
                    md="3"
                  >
                    <div class="photo-container">
                      <VCard
                        class="pa-2 photo-existing-card"
                        @click="
                          status.worker_profile_status_type_id ===
                          EWorkerProfileStatusType.text
                            ? openPreview('', undefined, status.value)
                            : status.worker_profile_status_type_id ===
                                EWorkerProfileStatusType.image
                              ? openPreview(
                                  extractUrlAndCaption(status.value).url,
                                  extractUrlAndCaption(status.value).caption ||
                                    undefined,
                                  undefined,
                                  EWorkerProfileStatusType.image
                                )
                              : openPreview(
                                  extractUrlAndCaption(status.value).url,
                                  extractUrlAndCaption(status.value).caption ||
                                    undefined,
                                  undefined,
                                  status.worker_profile_status_type_id as EWorkerProfileStatusType
                                )
                        "
                      >
                        <div class="photo-wrapper position-relative">
                          <VImg
                            v-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.image
                            "
                            :src="extractUrlAndCaption(status.value).url"
                            aspect-ratio="1"
                            cover
                            class="rounded"
                          />
                          <div
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.video
                            "
                            class="position-relative rounded cursor-pointer"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              background: rgba(
                                var(--v-theme-surface-variant),
                                0.1
                              );
                            "
                            @click="
                              openPreview(
                                extractUrlAndCaption(status.value).url,
                                extractUrlAndCaption(status.value).caption ||
                                  undefined,
                                undefined,
                                EWorkerProfileStatusType.video
                              )
                            "
                          >
                            <video
                              :src="extractUrlAndCaption(status.value).url"
                              class="rounded"
                              preload="metadata"
                              muted
                              playsinline
                              style="
                                width: 100%;
                                height: 100%;
                                object-fit: cover;
                                pointer-events: none;
                              "
                            >
                              <track kind="captions" />
                            </video>
                            <div
                              class="position-absolute d-flex align-center justify-center"
                              style="
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                z-index: 1;
                              "
                            >
                              <VIcon
                                icon="tabler-player-play-filled"
                                size="48"
                                color="white"
                                style="
                                  filter: drop-shadow(
                                    0 2px 8px rgba(0, 0, 0, 0.5)
                                  );
                                "
                              />
                            </div>
                          </div>
                          <div
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.audio
                            "
                            class="d-flex align-center justify-center rounded cursor-pointer"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              background: rgba(
                                var(--v-theme-surface-variant),
                                0.1
                              );
                            "
                            @click="
                              openPreview(
                                extractUrlAndCaption(status.value).url,
                                extractUrlAndCaption(status.value).caption ||
                                  undefined,
                                undefined,
                                EWorkerProfileStatusType.audio
                              )
                            "
                          >
                            <VIcon icon="tabler-music" size="48" />
                          </div>
                          <div
                            v-else-if="
                              status.worker_profile_status_type_id ===
                              EWorkerProfileStatusType.text
                            "
                            class="d-flex align-center justify-center rounded pa-4"
                            style="
                              width: 100%;
                              aspect-ratio: 1;
                              background: rgba(
                                var(--v-theme-surface-variant),
                                0.1
                              );
                            "
                          >
                            <p class="text-body-2 text-center">
                              {{ status.value }}
                            </p>
                          </div>
                          <div class="photo-actions">
                            <div
                              class="action-icon permanent-icon"
                              :class="{
                                'permanent-active': status.is_permanent,
                              }"
                              @click.stop="togglePermanent(status)"
                            >
                              <VIcon
                                :icon="
                                  status.is_permanent
                                    ? 'tabler-lock'
                                    : 'tabler-lock-open'
                                "
                                size="16"
                                :color="
                                  status.is_permanent ? 'primary' : 'secondary'
                                "
                              />
                            </div>
                            <div
                              class="action-icon delete-icon"
                              @click.stop="deleteStatus(status)"
                            >
                              <VIcon
                                icon="tabler-trash"
                                size="16"
                                color="error"
                              />
                            </div>
                          </div>
                        </div>
                      </VCard>
                      <div class="photo-date-wrapper">
                        <span class="photo-date">{{
                          formatDate(status.created_at)
                        }}</span>
                      </div>
                    </div>
                  </VCol>
                </VRow>

                <VAlert
                  v-else
                  color="primary"
                  variant="tonal"
                  class="empty-gallery-alert"
                  :text="$t('profile_status_no_photos')"
                />
              </div>
            </div>
          </VWindowItem>

          <VWindowItem value="profile-info">
            <div class="d-flex flex-column gap-6 pa-4">
              <div class="d-flex flex-column align-center gap-4">
                <div
                  class="profile-photo-container position-relative cursor-pointer"
                  @click="openFileSelector"
                >
                  <VTooltip
                    v-if="profilePhoto && !cropDialog.croppedImage"
                    location="bottom"
                    :text="$t('profile_photo_remove_tooltip')"
                  >
                    <template #activator="{ props }">
                      <IconBtn
                        v-bind="props"
                        class="profile-photo-remove-btn"
                        size="small"
                        color="error"
                        variant="flat"
                        :disabled="isProfilePhotoBusy"
                        :loading="isRemovingProfilePhoto"
                        @click.stop="removeProfilePhoto"
                      >
                        <VIcon icon="tabler-trash" />
                      </IconBtn>
                    </template>
                  </VTooltip>

                  <VAvatar
                    :size="cropPreviewSize"
                    :variant="
                      !profilePhoto && !cropDialog.croppedImage
                        ? 'tonal'
                        : undefined
                    "
                    color="primary"
                    class="profile-photo-avatar"
                  >
                    <VImg
                      v-if="profilePhoto || cropDialog.croppedImage"
                      :src="
                        (cropDialog.croppedImage || profilePhoto) ?? undefined
                      "
                      cover
                    />
                    <VImg
                      v-else
                      :src="'/images/svg/avatar-default.svg'"
                      alt="Avatar padrão"
                    />
                  </VAvatar>

                  <div
                    class="profile-photo-overlay d-flex align-center justify-center"
                  >
                    <VIcon icon="tabler-camera" size="32" color="white" />
                  </div>
                </div>

                <p class="text-body-2 text-medium-emphasis text-center">
                  Clique na imagem para fazer upload de uma nova foto de perfil
                </p>
              </div>

              <VDivider />

              <VForm @submit.prevent="saveProfileInfo">
                <VRow>
                  <VCol cols="12">
                    <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
                    <AppTextField
                      v-model="profileName"
                      :placeholder="$t('name')"
                    />
                  </VCol>

                  <VCol cols="12">
                    <VLabel class="text-body-2 mb-1"
                      >{{ $t('description') }}:</VLabel
                    >
                    <VTextarea
                      v-model="profileDescription"
                      :placeholder="$t('description')"
                      :counter="MAX_DESCRIPTION_LENGTH"
                      :maxlength="MAX_DESCRIPTION_LENGTH"
                      rows="4"
                      auto-grow
                    />
                  </VCol>

                  <VCol cols="12" class="d-flex justify-end">
                    <VBtn
                      color="primary"
                      :loading="isSavingProfileInfo"
                      type="submit"
                    >
                      Salvar
                    </VBtn>
                  </VCol>
                </VRow>
              </VForm>
            </div>
          </VWindowItem>
        </VWindow>
      </VCardText>
    </VCard>
  </VDialog>

  <!-- Crop Image Dialog -->
  <VDialog v-model="cropDialog.open" max-width="500" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>Cortar Imagem</span>
        <IconBtn @click="cancelCrop">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VCardText>
        <div class="crop-container position-relative">
          <img
            ref="cropImageRef"
            :src="cropDialog.imageSrc"
            alt="Para cortar"
            class="crop-image"
            @load="initializeCrop"
          />

          <div
            class="crop-area"
            :style="{
              left: `${cropArea.x}px`,
              top: `${cropArea.y}px`,
              width: `${cropArea.width}px`,
              height: `${cropArea.height}px`,
            }"
            @mousedown="startCropDrag"
            @touchstart="startCropDrag"
          >
            <div class="crop-area-border"></div>
            <div class="crop-area-handles">
              <div
                class="crop-handle crop-handle-nw"
                @mousedown="startCropResize('nw', $event)"
                @touchstart="startCropResize('nw', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-ne"
                @mousedown="startCropResize('ne', $event)"
                @touchstart="startCropResize('ne', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-sw"
                @mousedown="startCropResize('sw', $event)"
                @touchstart="startCropResize('sw', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-se"
                @mousedown="startCropResize('se', $event)"
                @touchstart="startCropResize('se', $event)"
              ></div>
            </div>
          </div>
        </div>

        <canvas ref="cropCanvasRef" style="display: none"></canvas>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn variant="tonal" color="secondary" @click="cancelCrop">
          Cancelar
        </VBtn>
        <VBtn color="primary" @click="cropImage"> Aplicar Corte </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="previewDialog.open" max-width="800">
    <DialogCloseBtn @click="closePreview" />
    <VCard :title="$t('profile_status_modal_title')">
      <VCardText>
        <VImg
          v-if="
            previewDialog.src &&
            previewDialog.type === EWorkerProfileStatusType.image
          "
          :src="previewDialog.src"
          max-height="420"
          class="rounded"
          contain
        />
        <video
          v-if="
            previewDialog.src &&
            previewDialog.type === EWorkerProfileStatusType.video
          "
          :src="previewDialog.src"
          max-height="600"
          class="rounded"
          style="width: 100%"
          controls
        >
          <track kind="captions" />
        </video>
        <div
          v-if="
            previewDialog.src &&
            previewDialog.type === EWorkerProfileStatusType.audio
          "
          class="d-flex flex-column align-center pa-6"
        >
          <div class="audio-preview-container w-100">
            <div class="audio-waveform-container mb-4">
              <div class="audio-waveform">
                <div
                  v-for="(bar, index) in audioWaveformBars"
                  :key="index"
                  class="audio-waveform-bar"
                  :class="{
                    'audio-waveform-bar--active':
                      audioProgress > (index / audioWaveformBars.length) * 100,
                  }"
                  :style="{
                    height: `${Math.max(10, bar * 100)}%`,
                  }"
                ></div>
              </div>
              <div
                class="audio-progress-indicator"
                :style="{
                  left: `${audioProgress}%`,
                }"
              ></div>
            </div>
            <div class="d-flex align-center justify-center gap-4 w-100">
              <VBtn
                :icon="
                  isAudioPlaying ? 'tabler-player-pause' : 'tabler-player-play'
                "
                variant="flat"
                color="primary"
                size="large"
                @click="toggleAudioPreview"
              />
              <div class="flex-grow-1">
                <audio
                  ref="audioPreviewRef"
                  :src="previewDialog.src"
                  @timeupdate="updateAudioProgress"
                  @loadedmetadata="updateAudioDuration"
                  @play="isAudioPlaying = true"
                  @pause="isAudioPlaying = false"
                  @ended="isAudioPlaying = false"
                />
                <div class="text-caption text-center">
                  {{ audioTimeDisplay }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="previewDialog.text"
          class="d-flex align-center justify-center pa-8"
          style="min-height: 200px"
        >
          <p class="text-body-1 text-center">
            {{ previewDialog.text }}
          </p>
        </div>
        <div v-if="previewDialog.caption" class="mt-4 text-center">
          <p class="text-body-2 text-medium-emphasis font-italic">
            {{ previewDialog.caption }}
          </p>
        </div>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="transferProtocolModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t('channel_general_config_generate_protocol_transfer_title')
        }}</span>
        <IconBtn @click="closeTransferProtocolModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('transfer_protocol_text_label') }}:</VLabel
        >
        <VTextarea
          v-model="transferProtocolText"
          :placeholder="$t('transfer_protocol_text_placeholder')"
          :maxlength="2000"
          rows="8"
          counter
          auto-grow
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('transfer_protocol_text_hint') }}
        </div>
        <VExpansionPanels variant="accordion" class="mt-2">
          <VExpansionPanel>
            <VExpansionPanelTitle>
              <span class="text-caption">{{ $t('available_tags') }}</span>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <div class="d-flex flex-column gap-1">
                <div
                  v-for="tag in availableTags"
                  :key="tag.tag"
                  class="text-caption"
                >
                  <code>{{ tag.tag }}</code
                  >: {{ tag.description }}
                </div>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingTransferProtocol"
          @click="closeTransferProtocolModal"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="error"
          variant="tonal"
          :loading="isSavingTransferProtocol"
          :disabled="isSavingTransferProtocol"
          @click="deleteTransferProtocolText"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingTransferProtocol"
          :disabled="isSavingTransferProtocol"
          @click="saveTransferProtocolText"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="startProtocolModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t('channel_general_config_generate_protocol_start_title')
        }}</span>
        <IconBtn @click="closeStartProtocolModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('start_protocol_text_label') }}:</VLabel
        >
        <VTextarea
          v-model="startProtocolText"
          :placeholder="$t('start_protocol_text_placeholder')"
          :maxlength="2000"
          rows="8"
          counter
          auto-grow
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('start_protocol_text_hint') }}
        </div>
        <VExpansionPanels variant="accordion" class="mt-2">
          <VExpansionPanel>
            <VExpansionPanelTitle>
              <span class="text-caption">{{ $t('available_tags') }}</span>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <div class="d-flex flex-column gap-1">
                <div
                  v-for="tag in availableTags"
                  :key="tag.tag"
                  class="text-caption"
                >
                  <code>{{ tag.tag }}</code
                  >: {{ tag.description }}
                </div>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingStartProtocol"
          @click="closeStartProtocolModal"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="error"
          variant="tonal"
          :loading="isSavingStartProtocol"
          :disabled="isSavingStartProtocol"
          @click="deleteStartProtocolText"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingStartProtocol"
          :disabled="isSavingStartProtocol"
          @click="saveStartProtocolText"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="simultaneousAttendanceModalOpen" max-width="500" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t('channel_general_config_simultaneous_attendance_title')
        }}</span>
        <IconBtn @click="closeSimultaneousAttendanceModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('simultaneous_attendance_quantity_label') }}:</VLabel
        >
        <VTextField
          v-model="simultaneousAttendanceInput"
          :placeholder="$t('simultaneous_attendance_quantity_placeholder')"
          type="number"
          min="1"
          :rules="[
            (v) => {
              if (!v || v.trim() === '') return true;
              const num = Number.parseInt(v, 10);
              if (Number.isNaN(num) || num < 1) {
                return $t('simultaneous_attendance_invalid_number');
              }
              return true;
            },
          ]"
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('simultaneous_attendance_description') }}
        </div>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingSimultaneousAttendance"
          @click="closeSimultaneousAttendanceModal"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          v-if="simultaneousAttendance !== null && simultaneousAttendance > 0"
          color="error"
          variant="tonal"
          :loading="isSavingSimultaneousAttendance"
          :disabled="isSavingSimultaneousAttendance"
          @click="deleteSimultaneousAttendance"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingSimultaneousAttendance"
          :disabled="
            isSavingSimultaneousAttendance ||
            !simultaneousAttendanceInput.trim() ||
            Number.parseInt(simultaneousAttendanceInput, 10) < 1
          "
          @click="saveSimultaneousAttendance"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="showMessageOnCallModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t('channel_general_config_show_message_on_call_title')
        }}</span>
        <IconBtn @click="closeShowMessageOnCallModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('show_message_on_call_text_label') }}:</VLabel
        >
        <VTextarea
          v-model="showMessageOnCallText"
          :placeholder="$t('show_message_on_call_text_placeholder')"
          :maxlength="2000"
          rows="8"
          counter
          auto-grow
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('show_message_on_call_text_hint') }}
        </div>
        <VExpansionPanels variant="accordion" class="mt-2">
          <VExpansionPanel>
            <VExpansionPanelTitle>
              <span class="text-caption">{{ $t('available_tags') }}</span>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <div class="d-flex flex-column gap-1">
                <div
                  v-for="tag in availableTags"
                  :key="tag.tag"
                  class="text-caption"
                >
                  <code>{{ tag.tag }}</code
                  >: {{ tag.description }}
                </div>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
        <VDivider class="my-4" />
        <div class="d-flex flex-column" style="gap: 4px">
          <VCheckbox
            v-model="showMessageOnCallRejectCall"
            :label="$t('channel_general_config_reject_call_title')"
            color="primary"
            hide-details
            :disabled="isSavingShowMessageOnCall"
            class="mb-0"
          />
          <p
            class="text-body-2 text-medium-emphasis mb-0"
            style="padding-left: 36px; margin-top: -4px"
          >
            {{ $t('channel_general_config_reject_call_description') }}
          </p>
        </div>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingShowMessageOnCall"
          @click="closeShowMessageOnCallModal"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="error"
          variant="tonal"
          :loading="isSavingShowMessageOnCall"
          :disabled="isSavingShowMessageOnCall"
          @click="deleteShowMessageOnCallText"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingShowMessageOnCall"
          :disabled="isSavingShowMessageOnCall"
          @click="saveShowMessageOnCallText"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog
    v-model="sendMessageOnFinishAttendanceModalOpen"
    max-width="600"
    persistent
  >
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t('channel_general_config_send_message_on_finish_attendance_title')
        }}</span>
        <IconBtn @click="closeSendMessageOnFinishAttendanceModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('send_message_on_finish_attendance_text_label') }}:</VLabel
        >
        <VTextarea
          v-model="sendMessageOnFinishAttendanceText"
          :placeholder="
            $t('send_message_on_finish_attendance_text_placeholder')
          "
          :maxlength="2000"
          rows="8"
          counter
          auto-grow
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('send_message_on_finish_attendance_text_hint') }}
        </div>
        <VExpansionPanels variant="accordion" class="mt-2">
          <VExpansionPanel>
            <VExpansionPanelTitle>
              <span class="text-caption">{{ $t('available_tags') }}</span>
            </VExpansionPanelTitle>
            <VExpansionPanelText>
              <div class="d-flex flex-column gap-1">
                <div
                  v-for="tag in availableTags"
                  :key="tag.tag"
                  class="text-caption"
                >
                  <code>{{ tag.tag }}</code
                  >: {{ tag.description }}
                </div>
              </div>
            </VExpansionPanelText>
          </VExpansionPanel>
        </VExpansionPanels>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingSendMessageOnFinishAttendance"
          @click="closeSendMessageOnFinishAttendanceModal"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="error"
          variant="tonal"
          :loading="isSavingSendMessageOnFinishAttendance"
          :disabled="isSavingSendMessageOnFinishAttendance"
          @click="deleteSendMessageOnFinishAttendanceText"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingSendMessageOnFinishAttendance"
          :disabled="isSavingSendMessageOnFinishAttendance"
          @click="saveSendMessageOnFinishAttendanceText"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VDialog v-model="chatbotModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('channel_general_config_chatbot_title') }}</span>
        <IconBtn @click="closeChatbotModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>
      <VCardText>
        <VLabel class="text-body-2 mb-1"
          >{{ $t('chatbot_select_label') }}:</VLabel
        >
        <VSelect
          v-model="selectedChatbotId"
          :items="chatbotStore.list"
          item-title="name"
          item-value="chatbot_id"
          :placeholder="$t('chatbot_select_placeholder')"
          clearable
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('chatbot_select_hint') }}
        </div>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSavingChatbot"
          @click="closeChatbotModal"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          v-if="selectedChatbotId"
          color="error"
          variant="tonal"
          :loading="isSavingChatbot"
          :disabled="isSavingChatbot"
          @click="deleteChatbot"
        >
          {{ $t('deactivate') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="isSavingChatbot"
          :disabled="isSavingChatbot"
          @click="saveChatbot"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.photo-existing-card {
  cursor: pointer;
  transition: box-shadow 0.2s ease;
}

.photo-existing-card:hover {
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.15);
}

.photo-pending-card {
  min-height: 150px;
}

.alert-helper {
  font-size: 0.85rem;
  line-height: 1.2rem;
}

.file-input-wrapper {
  flex-wrap: wrap;
  align-items: center;
}

.file-input-wrapper :deep(.v-field) {
  min-height: 48px;
  height: 48px;
}

.file-input-wrapper :deep(.v-field__input) {
  min-height: 48px;
  padding-top: 0;
  padding-bottom: 0;
}

.permanent-checkbox {
  flex-shrink: 0;
  margin-top: 0;
}

.permanent-checkbox :deep(.v-label) {
  font-size: 0.9rem;
}

.empty-gallery-alert {
  color: inherit;
  background-color: rgba(var(--v-theme-primary), 0.12);
}

.photo-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.photo-wrapper {
  position: relative;
}

.photo-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  z-index: 2;
}

.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.95);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(4px);
}

.action-icon:hover {
  background-color: rgba(255, 255, 255, 1);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  transform: scale(1.1);
}

.photo-date-wrapper {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.photo-date {
  font-size: 0.75rem;
  font-style: italic;
  color: rgba(var(--v-theme-on-surface), 0.6);
  text-align: right;
}

.scrollable-content {
  max-height: 70vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--v-theme-on-surface), 0.2) transparent;
}

.scrollable-content::-webkit-scrollbar {
  width: 6px;
}

.scrollable-content::-webkit-scrollbar-track {
  background: transparent;
}

.scrollable-content::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 3px;
}

.scrollable-content::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.3);
}

.general-config-wrapper {
  min-height: 320px;
}

.general-config-overlay :deep(.v-overlay__scrim) {
  border-radius: 12px;
}

.general-config-card {
  border-radius: 12px !important;
  padding: 16px;
  height: 100%;
}

.general-config-card :deep(.v-selection-control) {
  margin-bottom: 0;
}

.general-config-grid {
  row-gap: 16px;
}

.status-type-wrapper {
  width: 100%;
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-field) {
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-field__input) {
  min-width: 0;
  overflow: visible;
}

.status-type-wrapper :deep(.v-select__selection) {
  white-space: normal;
  word-wrap: break-word;
  overflow: visible;
  max-width: 100%;
}

.cursor-pointer {
  cursor: pointer;
}

.audio-preview-container {
  width: 100%;
  max-width: 500px;
}

.audio-waveform-container {
  position: relative;
  width: 100%;
  height: 80px;
  display: flex;
  align-items: center;
  overflow: hidden;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  border-radius: 8px;
  padding: 12px;
}

.audio-waveform {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 4px;
  padding: 12px;
  z-index: 1;
  height: 100%;
  width: 100%;
}

.audio-waveform-bar {
  flex: 1;
  min-width: 3px;
  max-width: 4px;
  background: rgba(var(--v-theme-primary), 0.4);
  border-radius: 2px;
  transition: background 0.2s ease;
}

.audio-waveform-bar--active {
  background: rgba(var(--v-theme-primary), 0.8);
}

.audio-progress-indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgb(var(--v-theme-primary));
  z-index: 2;
  pointer-events: none;
  transition: left 0.1s linear;
}

.profile-photo-container {
  position: relative;
  display: inline-block;
}

.profile-photo-remove-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background-color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  border-radius: 50%;
  z-index: 3;
}

.profile-photo-remove-btn:disabled {
  opacity: 0.6;
}

.profile-photo-avatar {
  border: 3px solid rgba(var(--v-theme-primary), 0.2);
  transition: all 0.3s ease;
}

.profile-photo-container:hover .profile-photo-avatar {
  border-color: rgba(var(--v-theme-primary), 0.5);
  transform: scale(1.02);
}

.profile-photo-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.profile-photo-container:hover .profile-photo-overlay {
  opacity: 1;
}

.crop-container {
  width: 100%;
  max-width: 400px;
  height: 400px;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  position: relative;
  user-select: none;
  touch-action: none;
}

.crop-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.crop-area {
  position: absolute;
  border: 2px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
  cursor: move;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  z-index: 10;
  touch-action: none;
}

.crop-area-border {
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(255, 255, 255, 0.8);
  pointer-events: none;
}

.crop-area-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: rgb(var(--v-theme-primary));
  border: 2px solid white;
  border-radius: 50%;
  pointer-events: all;
  cursor: nwse-resize;
}

.crop-handle-nw {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}

.crop-handle-ne {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}

.crop-handle-sw {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}

.crop-handle-se {
  bottom: -6px;
  right: -6px;
  cursor: nwse-resize;
}
</style>
