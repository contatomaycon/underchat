<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useChatbotStore } from '@/@webcore/stores/chatbot';
import { useScheduleStore } from '@/@webcore/stores/schedule';
import ScheduleOfficialTemplatePicker from './ScheduleOfficialTemplatePicker.vue';
import { EScheduleType } from '@core/common/enums/EScheduleType';
import { EScheduleSendTo } from '@core/common/enums/EScheduleSendTo';
import { EScheduleSendSpeed } from '@core/common/enums/EScheduleSendSpeed';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EColor } from '@core/common/enums/EColor';
import { refDebounced } from '@vueuse/core';
import { EditScheduleParamsRequest } from '@core/schema/schedule/editSchedule/request.schema';
import { formatDateToDateTimePicker } from '@core/common/functions/formatDateToDateTimePicker';
import type { IOfficialWhatsappTemplateMessage } from '@core/common/interfaces/IOfficialWhatsappTemplate';
import type { OfficialTemplatesResponse } from '@core/schema/chatbot/officialTemplates/response.schema';
import { doesChatbotFlowStartWithOfficialTemplate } from '@core/common/functions/chatbotOfficialNodes';

const scheduleStore = useScheduleStore();
const chatbotStore = useChatbotStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  scheduleId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];
const ACCEPTED_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg'];
const ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];
const ACCEPTED_AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
];
const ACCEPTED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/opus',
];

const ACCEPTED_IMAGE_TYPES = `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
const ACCEPTED_VIDEO_TYPES = `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
const ACCEPTED_AUDIO_TYPES = `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;

type FilePreview = {
  id: string;
  file: File;
  src: string;
};

type ScheduleWorkerOption = {
  worker_id: string;
  name: string;
  number: string;
  type_id?: string | null;
  is_official?: boolean | null;
};

type ScheduleContactOption = {
  contact_id: string;
  name: string;
  last_name: string | null;
  phone_partial: string | null;
};

type ScheduleContactGroupOption = {
  contact_group_id: string;
  name: string;
};

const messageTypeOptions = computed(() => [
  {
    value: EScheduleType.text,
    title: t('message_type_text'),
  },
  {
    value: EScheduleType.image,
    title: t('message_type_image'),
  },
  {
    value: EScheduleType.video,
    title: t('message_type_video'),
  },
  {
    value: EScheduleType.audio,
    title: t('message_type_audio'),
  },
  {
    value: EScheduleType.chatbot,
    title: t('message_type_chatbot'),
  },
]);

const sendToOptions = computed(() => [
  {
    value: EScheduleSendTo.contacts,
    title: t('contacts'),
  },
  {
    value: EScheduleSendTo.contact_groups,
    title: t('contact_groups'),
  },
  {
    value: EScheduleSendTo.all,
    title: t('all'),
  },
]);

const sendSpeedOptions = computed(() => [
  { value: EScheduleSendSpeed.low, title: t('send_speed_low') },
  { value: EScheduleSendSpeed.medium, title: t('send_speed_medium') },
  { value: EScheduleSendSpeed.high, title: t('send_speed_high') },
]);

const officialSendTypeOptions = computed(() => [
  {
    value: EScheduleType.official_template,
    title: t('official_template_model'),
  },
  {
    value: EScheduleType.chatbot,
    title: t('message_type_chatbot'),
  },
]);

const scheduleId = toRef(props, 'scheduleId');
const selectedType = ref<EScheduleType>(EScheduleType.text);
const selectedOfficialType = ref<
  EScheduleType.official_template | EScheduleType.chatbot
>(EScheduleType.official_template);
const message = ref<string | null>(null);
const attachmentFile = ref<File | null>(null);
const filePreview = ref<FilePreview | null>(null);
const existingAttachmentUrl = ref<string | null>(null);
const hasNewFile = ref(false);
const fileInputKey = ref(0);
const fileSizeError = ref<string | null>(null);
const isLoading = ref(false);
const previewDialog = ref<{
  open: boolean;
  src: string | null;
  caption: string | null;
  text: string | null;
  type: EScheduleType | null;
}>({
  open: false,
  src: null,
  caption: null,
  text: null,
  type: null,
});
const audioPreviewRef = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioProgress = ref(0);
const audioDuration = ref(0);
const audioCurrentTime = ref(0);
const audioWaveformBars = ref<number[]>([]);
const workerId = ref<string | null>(null);
const sendTo = ref<EScheduleSendTo | null>(null);
const sendSpeed = ref<EScheduleSendSpeed>(EScheduleSendSpeed.low);
const sendDate = ref<string | null>(null);
const selectedContactIds = ref<string[]>([]);
const selectedContactGroupIds = ref<string[]>([]);
const contactSearch = ref('');
const contactGroupSearch = ref('');
const debouncedContactSearch = refDebounced(contactSearch, 500);
const debouncedContactGroupSearch = refDebounced(contactGroupSearch, 500);
const workers = ref<ScheduleWorkerOption[]>([]);
const contacts = ref<ScheduleContactOption[]>([]);
const contactGroups = ref<ScheduleContactGroupOption[]>([]);
const chatbotId = ref<string | null>(null);
const chatbots = ref<
  Array<{ chatbot_id: string; name: string; type?: string | null }>
>([]);
const officialTemplates = ref<OfficialTemplatesResponse>([]);
const isLoadingOfficialTemplates = ref(false);
const officialTemplatesError = ref<string | null>(null);
const officialTemplate = ref<IOfficialWhatsappTemplateMessage | null>(null);
const isOfficialTemplateValid = ref(false);
const officialCompatibleChatbotIds = ref<Set<string>>(new Set());
const isLoadingOfficialChatbots = ref(false);
let officialTemplatesRequestId = 0;
let officialChatbotsRequestId = 0;
let scheduleHydrationRequestId = 0;
// Dependent-field watchers must only react to user changes, never to API hydration.
let isHydratingSchedule = false;

const selectedWorker = computed(
  () =>
    workers.value.find((worker) => worker.worker_id === workerId.value) ?? null
);

const isOfficialWorker = computed(
  () =>
    selectedWorker.value?.is_official === true ||
    selectedWorker.value?.type_id === EWorkerType.whatsapp
);

const effectiveSelectedType = computed(() =>
  isOfficialWorker.value ? selectedOfficialType.value : selectedType.value
);

const availableChatbots = computed(() => {
  const selectedId = chatbotId.value;
  const items = isOfficialWorker.value
    ? chatbots.value.filter(
        (chatbot) =>
          officialCompatibleChatbotIds.value.has(chatbot.chatbot_id) ||
          chatbot.chatbot_id === selectedId
      )
    : chatbots.value;

  if (
    selectedId &&
    !items.some((chatbot) => chatbot.chatbot_id === selectedId)
  ) {
    return [
      ...items,
      {
        chatbot_id: selectedId,
        name: selectedId,
      },
    ];
  }

  return items;
});

const showTextInput = computed(() => {
  return !isOfficialWorker.value && selectedType.value === EScheduleType.text;
});

const showFileInput = computed(() => {
  return (
    !isOfficialWorker.value &&
    [EScheduleType.image, EScheduleType.video, EScheduleType.audio].includes(
      selectedType.value
    )
  );
});

const showChatbotSelect = computed(() => {
  return effectiveSelectedType.value === EScheduleType.chatbot;
});

const showContactsSelect = computed(() => {
  return sendTo.value === EScheduleSendTo.contacts;
});

const showContactGroupsSelect = computed(() => {
  return sendTo.value === EScheduleSendTo.contact_groups;
});

const acceptedFileTypes = computed(() => {
  if (selectedType.value === EScheduleType.image) {
    return ACCEPTED_IMAGE_TYPES;
  }
  if (selectedType.value === EScheduleType.video) {
    return ACCEPTED_VIDEO_TYPES;
  }
  if (selectedType.value === EScheduleType.audio) {
    return ACCEPTED_AUDIO_TYPES;
  }
  return '';
});

const filteredContacts = computed(() => {
  return contacts.value;
});

const filteredContactGroups = computed(() => {
  if (!debouncedContactGroupSearch.value) {
    return contactGroups.value;
  }
  const query = debouncedContactGroupSearch.value.toLowerCase();
  return contactGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query)
  );
});

const refFormEditSchedule = ref<VForm>();

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  const ext = getExt(file.name);
  if (selectedType.value === EScheduleType.image) {
    return (
      ACCEPTED_IMAGE_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EScheduleType.video) {
    return (
      ACCEPTED_VIDEO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_VIDEO_MIME_TYPES.includes(file.type)
    );
  }
  if (selectedType.value === EScheduleType.audio) {
    return (
      ACCEPTED_AUDIO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_AUDIO_MIME_TYPES.includes(file.type)
    );
  }
  return false;
}

const onFileChange = (files: File[] | File | null) => {
  const file = Array.isArray(files) ? (files?.[0] ?? null) : files;
  fileSizeError.value = null;

  if (!file) {
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_file_message'));
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  const MAX_FILE_SIZE = 16 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = t('file_too_large');
    attachmentFile.value = null;
    filePreview.value = null;
    hasNewFile.value = false;
    return;
  }

  attachmentFile.value = file;
  hasNewFile.value = true;
  const previewId = `preview-${Date.now()}`;
  const previewSrc = URL.createObjectURL(file);
  filePreview.value = {
    id: previewId,
    file,
    src: previewSrc,
  };
};

const validateRequiredFields = (): boolean => {
  return !!(
    scheduleId.value &&
    workerId.value &&
    sendTo.value &&
    sendDate.value
  );
};

const validateMessage = (): boolean => {
  if (effectiveSelectedType.value === EScheduleType.text) {
    return !!message.value?.trim();
  }
  return true;
};

const validateFile = (): boolean => {
  if (!showFileInput.value) {
    return true;
  }

  const hasExisting = !!existingAttachmentUrl.value;
  const hasNewValidFile =
    hasNewFile.value && !!attachmentFile.value && !!filePreview.value;

  return hasExisting || hasNewValidFile;
};

const validateRecipients = (): boolean => {
  if (sendTo.value === EScheduleSendTo.contacts) {
    return selectedContactIds.value.length > 0;
  }

  if (sendTo.value === EScheduleSendTo.contact_groups) {
    return selectedContactGroupIds.value.length > 0;
  }

  return true;
};

const buildFormData = (): FormData => {
  const form = new FormData();

  if (workerId.value) {
    form.append('worker_id', workerId.value);
  }
  const scheduleType = effectiveSelectedType.value;

  if (scheduleType) {
    form.append('type', scheduleType);
  }
  if (sendTo.value) {
    form.append('send_to', sendTo.value);
  }
  if (!isOfficialWorker.value) {
    form.append('send_speed', sendSpeed.value ?? EScheduleSendSpeed.low);
  }
  if (sendDate.value) {
    form.append('send_date', sendDate.value);
  }
  form.append(
    'chatbot_id',
    scheduleType === EScheduleType.chatbot && chatbotId.value
      ? chatbotId.value
      : ''
  );
  if (
    scheduleType === EScheduleType.official_template &&
    officialTemplate.value
  ) {
    form.append('official_template', JSON.stringify(officialTemplate.value));
  }
  if (!isOfficialWorker.value && message.value !== null) {
    form.append('message', message.value);
  }
  if (!isOfficialWorker.value && attachmentFile.value && hasNewFile.value) {
    form.append('url', attachmentFile.value);
  }
  if (
    sendTo.value === EScheduleSendTo.contacts &&
    selectedContactIds.value.length > 0
  ) {
    form.append('contact_ids', JSON.stringify(selectedContactIds.value));
  }
  if (
    sendTo.value === EScheduleSendTo.contact_groups &&
    selectedContactGroupIds.value.length > 0
  ) {
    form.append(
      'contact_group_ids',
      JSON.stringify(selectedContactGroupIds.value)
    );
  }

  return form;
};

const updateSchedule = async () => {
  const validateForm = await refFormEditSchedule?.value?.validate();
  if (!validateForm?.valid) return;
  if (!validateRequiredFields()) return;
  if (!validateMessage()) return;
  if (!validateFile()) return;
  if (!validateRecipients()) return;
  if (!scheduleId.value) return;
  if (
    effectiveSelectedType.value === EScheduleType.chatbot &&
    (!chatbotId.value || !chatbotId.value.trim())
  ) {
    return;
  }
  if (
    effectiveSelectedType.value === EScheduleType.official_template &&
    (!officialTemplate.value || !isOfficialTemplateValid.value)
  ) {
    scheduleStore.showSnackbar(
      t('schedule_official_template_required'),
      EColor.warning
    );
    return;
  }

  isLoading.value = true;

  try {
    const payload: EditScheduleParamsRequest = {
      schedule_id: scheduleId.value,
    };

    const form = buildFormData();
    const result = await scheduleStore.updateSchedule(payload, form as any);

    if (result) {
      isVisible.value = false;
      await scheduleStore.listSchedule();
    }
  } finally {
    isLoading.value = false;
  }
};

const resetForm = () => {
  selectedType.value = EScheduleType.text;
  selectedOfficialType.value = EScheduleType.official_template;
  message.value = null;
  workerId.value = null;
  sendTo.value = null;
  sendSpeed.value = EScheduleSendSpeed.low;
  sendDate.value = null;
  selectedContactIds.value = [];
  selectedContactGroupIds.value = [];
  contactSearch.value = '';
  contactGroupSearch.value = '';
  chatbotId.value = null;
  officialTemplate.value = null;
  isOfficialTemplateValid.value = false;
  officialTemplates.value = [];
  officialTemplatesError.value = null;
  officialCompatibleChatbotIds.value = new Set();
  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  existingAttachmentUrl.value = null;
  hasNewFile.value = false;
  fileInputKey.value++;
  refFormEditSchedule.value?.resetValidation();
};

const loadWorkers = async () => {
  const result = await scheduleStore.listScheduleWorkers();
  if (result) {
    workers.value = result.map((w) => ({
      worker_id: w.worker_id,
      name: w.name,
      number: w.number ?? '',
      type_id: w.type_id ?? null,
      is_official: w.is_official ?? false,
    }));
  }
};

const resetOfficialState = () => {
  officialTemplatesRequestId += 1;
  officialChatbotsRequestId += 1;
  officialTemplates.value = [];
  officialTemplatesError.value = null;
  officialTemplate.value = null;
  isOfficialTemplateValid.value = false;
  officialCompatibleChatbotIds.value = new Set();
  isLoadingOfficialTemplates.value = false;
  isLoadingOfficialChatbots.value = false;
};

const loadOfficialTemplates = async (options?: {
  preserveTemplate?: boolean;
}) => {
  if (!isOfficialWorker.value || !workerId.value) {
    return;
  }

  const requestId = ++officialTemplatesRequestId;
  officialTemplates.value = [];
  officialTemplatesError.value = null;
  if (!options?.preserveTemplate) {
    officialTemplate.value = null;
    isOfficialTemplateValid.value = false;
  }
  isLoadingOfficialTemplates.value = true;

  try {
    const result = await scheduleStore.listScheduleOfficialTemplates(
      workerId.value
    );
    if (requestId !== officialTemplatesRequestId) {
      return;
    }

    officialTemplates.value = result.templates ?? [];
    if (!result.templates) {
      officialTemplatesError.value =
        result.error ?? t('official_templates_loading_error');
    }
  } catch {
    if (requestId === officialTemplatesRequestId) {
      officialTemplatesError.value = t('official_templates_loading_error');
    }
  } finally {
    if (requestId === officialTemplatesRequestId) {
      isLoadingOfficialTemplates.value = false;
    }
  }
};

const loadOfficialCompatibleChatbots = async () => {
  if (!isOfficialWorker.value) {
    officialCompatibleChatbotIds.value = new Set();
    return;
  }

  const requestId = ++officialChatbotsRequestId;
  isLoadingOfficialChatbots.value = true;
  const compatibleIds = new Set<string>();

  try {
    await Promise.all(
      chatbots.value.map(async (chatbot) => {
        const flow = await chatbotStore.listChatbotFlow(chatbot.chatbot_id);
        if (doesChatbotFlowStartWithOfficialTemplate(flow)) {
          compatibleIds.add(chatbot.chatbot_id);
        }
      })
    );

    if (requestId !== officialChatbotsRequestId) {
      return;
    }

    officialCompatibleChatbotIds.value = compatibleIds;
  } finally {
    if (requestId === officialChatbotsRequestId) {
      isLoadingOfficialChatbots.value = false;
    }
  }
};

const loadContacts = async (
  contactsToPreserve: ScheduleContactOption[] = []
) => {
  const result = await scheduleStore.listScheduleContacts(
    1,
    100,
    debouncedContactSearch.value || undefined
  );
  if (result) {
    const selectedContacts = contacts.value.filter((contact) =>
      selectedContactIds.value.includes(contact.contact_id)
    );
    const fetchedContacts = result.results.map((c) => ({
      contact_id: c.contact_id,
      name: c.name,
      last_name: c.last_name ?? null,
      phone_partial: c.phone_partial ?? null,
    }));
    const mergedContacts = new Map<string, ScheduleContactOption>();

    for (const contact of [...contactsToPreserve, ...selectedContacts]) {
      mergedContacts.set(contact.contact_id, contact);
    }
    for (const contact of fetchedContacts) {
      mergedContacts.set(contact.contact_id, contact);
    }

    contacts.value = [...mergedContacts.values()];
  }
};

const loadContactGroups = async (
  groupsToPreserve: ScheduleContactGroupOption[] = []
) => {
  const result = await scheduleStore.listScheduleContactGroups();
  if (result) {
    const selectedGroups = contactGroups.value.filter((group) =>
      selectedContactGroupIds.value.includes(group.contact_group_id)
    );
    const mergedGroups = new Map<string, ScheduleContactGroupOption>();

    for (const group of [...groupsToPreserve, ...selectedGroups, ...result]) {
      mergedGroups.set(group.contact_group_id, group);
    }

    contactGroups.value = [...mergedGroups.values()];
  }
};

const loadChatbots = async () => {
  const result = await scheduleStore.listScheduleChatbots();
  if (result) {
    chatbots.value = result;
  }
};

const openPreview = (
  src: string | null,
  caption?: string | null,
  text?: string | null,
  type?: EScheduleType
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
  audioWaveformBars.value = [];
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

const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ nickname }}',
    description: t('tag_nickname_description'),
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

watch(selectedType, () => {
  if (isHydratingSchedule) {
    return;
  }

  if (hasNewFile.value) {
    attachmentFile.value = null;
    fileSizeError.value = null;
    if (filePreview.value?.src) {
      URL.revokeObjectURL(filePreview.value.src);
    }
    filePreview.value = null;
    hasNewFile.value = false;
    fileInputKey.value++;
  }
  if (selectedType.value === EScheduleType.chatbot) {
    message.value = null;
  }
  if (selectedType.value !== EScheduleType.chatbot) {
    chatbotId.value = null;
  }
});

watch(selectedOfficialType, () => {
  if (isHydratingSchedule) {
    return;
  }

  chatbotId.value = null;
  if (selectedOfficialType.value !== EScheduleType.official_template) {
    officialTemplate.value = null;
    isOfficialTemplateValid.value = false;
  }
});

watch(workerId, () => {
  if (isHydratingSchedule) {
    return;
  }

  attachmentFile.value = null;
  fileSizeError.value = null;
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  filePreview.value = null;
  existingAttachmentUrl.value = null;
  hasNewFile.value = false;
  fileInputKey.value++;
  message.value = null;
  chatbotId.value = null;

  if (!isOfficialWorker.value) {
    resetOfficialState();
    selectedType.value = EScheduleType.text;
    return;
  }

  selectedOfficialType.value = EScheduleType.official_template;
  loadOfficialTemplates().catch(() => {});
  loadOfficialCompatibleChatbots().catch(() => {});
});

watch(debouncedContactSearch, () => {
  if (isHydratingSchedule) {
    return;
  }

  loadContacts();
});

watch(debouncedContactGroupSearch, () => {
  if (isHydratingSchedule) {
    return;
  }

  loadContactGroups();
});

watch(selectedContactIds, (newValue, oldValue) => {
  if (isHydratingSchedule) {
    return;
  }

  if (newValue.length > (oldValue?.length ?? 0)) {
    contactSearch.value = '';
  }
});

watch(sendTo, (newValue) => {
  if (isHydratingSchedule) {
    return;
  }

  if (newValue === EScheduleSendTo.contacts) {
    loadContacts();
  } else if (newValue === EScheduleSendTo.contact_groups) {
    loadContactGroups();
  }
  if (newValue !== EScheduleSendTo.contacts) {
    selectedContactIds.value = [];
  }
  if (newValue !== EScheduleSendTo.contact_groups) {
    selectedContactGroupIds.value = [];
  }
});

const hydrateSchedule = async (id: string) => {
  const requestId = ++scheduleHydrationRequestId;
  isHydratingSchedule = true;
  resetForm();

  try {
    const [, , schedule] = await Promise.all([
      loadWorkers(),
      loadChatbots(),
      scheduleStore.getScheduleById(id),
    ]);

    if (requestId !== scheduleHydrationRequestId || !schedule) {
      return;
    }

    const scheduleSendTo = schedule.send_to as EScheduleSendTo;
    const scheduleType = (schedule.type as EScheduleType) || EScheduleType.text;

    message.value = schedule.message ?? null;
    workerId.value = schedule.worker.worker_id;
    sendTo.value = scheduleSendTo;
    sendSpeed.value =
      (schedule.send_speed as EScheduleSendSpeed) || EScheduleSendSpeed.low;
    sendDate.value = formatDateToDateTimePicker(schedule.send_date ?? null);
    existingAttachmentUrl.value = schedule.url ?? null;
    selectedType.value = scheduleType;

    if (isOfficialWorker.value) {
      selectedOfficialType.value =
        scheduleType === EScheduleType.chatbot
          ? EScheduleType.chatbot
          : EScheduleType.official_template;
      officialTemplate.value = schedule.official_template ?? null;
      isOfficialTemplateValid.value = !!schedule.official_template;
    }

    chatbotId.value =
      scheduleType === EScheduleType.chatbot
        ? (schedule.chatbot_id ?? null)
        : null;

    const scheduledContacts: ScheduleContactOption[] =
      schedule.contacts?.map((contact) => ({
        contact_id: contact.contact_id,
        name: contact.name,
        last_name: null,
        phone_partial: contact.phone_partial ?? null,
      })) ?? [];
    const scheduledContactGroups: ScheduleContactGroupOption[] =
      schedule.contact_groups?.map((group) => ({
        contact_group_id: group.contact_group_id,
        name: group.name,
      })) ?? [];

    selectedContactIds.value =
      scheduleSendTo === EScheduleSendTo.contacts
        ? scheduledContacts.map((contact) => contact.contact_id)
        : [];
    selectedContactGroupIds.value =
      scheduleSendTo === EScheduleSendTo.contact_groups
        ? scheduledContactGroups.map((group) => group.contact_group_id)
        : [];

    const relatedLoads: Promise<void>[] = [];

    if (isOfficialWorker.value) {
      relatedLoads.push(
        loadOfficialTemplates({ preserveTemplate: true }),
        loadOfficialCompatibleChatbots()
      );
    }
    if (scheduleSendTo === EScheduleSendTo.contacts) {
      relatedLoads.push(loadContacts(scheduledContacts));
    }
    if (scheduleSendTo === EScheduleSendTo.contact_groups) {
      relatedLoads.push(loadContactGroups(scheduledContactGroups));
    }

    await Promise.all(relatedLoads);
  } finally {
    if (requestId === scheduleHydrationRequestId) {
      await nextTick();
      isHydratingSchedule = false;
    }
  }
};

watch(
  [isVisible, scheduleId],
  async ([visible, id]) => {
    if (visible && id) {
      await hydrateSchedule(id);
    } else if (!visible) {
      scheduleHydrationRequestId += 1;
      isHydratingSchedule = true;
      resetForm();
      await nextTick();
      isHydratingSchedule = false;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (filePreview.value?.src) {
    URL.revokeObjectURL(filePreview.value.src);
  }
  closePreview();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="700" :persistent="isLoading">
    <DialogCloseBtn :disabled="isLoading" @click="isVisible = false" />

    <VOverlay
      :model-value="isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormEditSchedule" @submit.prevent>
      <VCard :title="$t('edit_schedule')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('channel') }}:</VLabel>
              <AppSelectSearch
                v-model="workerId"
                :items="
                  workers.map((w) => ({
                    id: w.worker_id,
                    title: w.number ? `${w.name} (${w.number})` : w.name,
                  }))
                "
                :placeholder="$t('select_channel')"
                :clearable="false"
                item-value="id"
                item-title="title"
                :rules="[requiredValidator(workerId, $t('channel_required'))]"
              />
            </VCol>

            <VCol v-if="!isOfficialWorker" cols="12">
              <div class="d-flex align-center gap-2 mb-1">
                <VLabel class="text-body-2">{{ $t('message_type') }}:</VLabel>
                <AppInfoTooltip :text="$t('message_type_info')" />
              </div>
              <AppSelectSearch
                v-model="selectedType"
                :items="messageTypeOptions"
                item-value="value"
                item-title="title"
                :clearable="true"
              />
            </VCol>

            <VCol v-else cols="12">
              <VLabel class="text-body-2 mb-1">
                {{ $t('schedule_official_send_type') }}:
              </VLabel>
              <AppSelectSearch
                v-model="selectedOfficialType"
                :items="officialSendTypeOptions"
                item-value="value"
                item-title="title"
                :clearable="false"
                :rules="[
                  requiredValidator(
                    selectedOfficialType,
                    $t('message_type_required')
                  ),
                ]"
              />

              <ScheduleOfficialTemplatePicker
                v-if="selectedOfficialType === EScheduleType.official_template"
                v-model="officialTemplate"
                class="mt-3"
                :templates="officialTemplates"
                :loading="isLoadingOfficialTemplates"
                :error="officialTemplatesError"
                :available-tags="availableTags"
                @valid-change="isOfficialTemplateValid = $event"
              />
            </VCol>

            <VCol v-if="showChatbotSelect" cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('chatbot') }}:</VLabel>
              <VAlert
                v-if="isOfficialWorker && isLoadingOfficialChatbots"
                class="mb-2"
                color="primary"
                variant="tonal"
                density="compact"
              >
                {{ $t('schedule_official_chatbots_loading') }}
              </VAlert>
              <AppSelectSearch
                v-model="chatbotId"
                :items="
                  availableChatbots.map((c) => ({
                    id: c.chatbot_id,
                    title: c.name,
                  }))
                "
                :placeholder="$t('select_chatbot')"
                :clearable="false"
                item-value="id"
                item-title="title"
                :rules="[requiredValidator(chatbotId, $t('chatbot_required'))]"
              />
              <small
                v-if="
                  isOfficialWorker &&
                  !isLoadingOfficialChatbots &&
                  !availableChatbots.length
                "
                class="text-caption text-warning mt-1 d-block"
              >
                {{ $t('schedule_official_chatbots_empty') }}
              </small>
            </VCol>

            <VCol v-if="showTextInput" cols="12">
              <div class="d-flex align-center justify-space-between mb-1">
                <label class="text-body-2" for="message-textarea">
                  {{ $t('message') }}:
                </label>
                <VBtn
                  v-if="message && message.trim()"
                  size="x-small"
                  variant="text"
                  color="primary"
                  @click="
                    openPreview(
                      null,
                      null,
                      message && message.trim() ? message : null,
                      selectedType
                    )
                  "
                >
                  <VIcon start icon="tabler-eye" size="16" />
                  {{ $t('preview') }}
                </VBtn>
              </div>
              <VTextarea
                id="message-textarea"
                v-model="message"
                :placeholder="$t('message')"
                :rules="
                  selectedType === EScheduleType.text
                    ? [requiredValidator(message, $t('message_required'))]
                    : []
                "
                rows="4"
              />
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
            </VCol>

            <template v-if="showFileInput">
              <VCol cols="12">
                <VLabel class="text-body-2 mb-1">{{ $t('file') + ':' }}</VLabel>
                <VFileInput
                  :key="fileInputKey"
                  variant="outlined"
                  density="comfortable"
                  :placeholder="$t('select_file')"
                  :accept="acceptedFileTypes"
                  show-size
                  :chips="!!attachmentFile"
                  :clearable="true"
                  hide-details="auto"
                  :prepend-icon="''"
                  @update:model-value="onFileChange"
                  class="w-100"
                >
                  <template #prepend-inner>
                    <VIcon icon="tabler-upload" />
                  </template>
                </VFileInput>
                <small
                  v-if="fileSizeError"
                  class="text-caption text-error mt-1 d-block"
                >
                  {{ fileSizeError }}
                </small>
                <div v-if="existingAttachmentUrl && !hasNewFile" class="mt-2">
                  <VBtn
                    size="small"
                    variant="tonal"
                    color="primary"
                    @click="
                      openPreview(
                        existingAttachmentUrl,
                        message && message.trim() ? message : null,
                        null,
                        selectedType
                      )
                    "
                  >
                    <VIcon start icon="tabler-eye" size="16" />
                    {{ $t('preview') }}
                  </VBtn>
                </div>
                <small
                  v-if="!fileSizeError"
                  class="text-caption text-medium-emphasis mt-1 d-block"
                >
                  <template v-if="selectedType === EScheduleType.image">
                    {{ $t('msg_image_pdf_or_audio') }}
                  </template>
                  <template v-else-if="selectedType === EScheduleType.video">
                    {{ $t('msg_video_file') }}
                  </template>
                  <template v-else-if="selectedType === EScheduleType.audio">
                    {{ $t('msg_audio_file') }}
                  </template>
                </small>
              </VCol>
              <VCol cols="12">
                <label class="text-body-2 mb-1" for="message-caption">
                  {{ $t('message') }}:
                </label>
                <VTextarea
                  id="message-caption"
                  v-model="message"
                  :placeholder="$t('message')"
                  :rules="[]"
                  rows="3"
                />
                <VExpansionPanels variant="accordion" class="mt-2">
                  <VExpansionPanel>
                    <VExpansionPanelTitle>
                      <span class="text-caption">{{
                        $t('available_tags')
                      }}</span>
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
              </VCol>

              <VCol v-if="filePreview" cols="12">
                <div class="d-flex align-center gap-2 mb-1">
                  <p class="text-caption text-medium-emphasis mb-0">
                    {{ $t('preview') }}:
                  </p>
                  <VBtn
                    size="x-small"
                    variant="text"
                    color="primary"
                    @click="
                      openPreview(
                        filePreview.src,
                        message && message.trim() ? message : null,
                        null,
                        selectedType
                      )
                    "
                  >
                    <VIcon start icon="tabler-eye" size="16" />
                    {{ $t('preview') }}
                  </VBtn>
                </div>
                <VCard
                  class="pa-1 cursor-pointer"
                  style="max-width: 200px"
                  @click="
                    openPreview(
                      filePreview.src,
                      message && message.trim() ? message : null,
                      null,
                      selectedType
                    )
                  "
                >
                  <VImg
                    v-if="selectedType === EScheduleType.image"
                    :src="filePreview.src"
                    max-width="200"
                    max-height="150"
                    aspect-ratio="4/3"
                    cover
                    class="rounded cursor-pointer"
                    style="object-fit: cover"
                  />
                  <div
                    v-else-if="selectedType === EScheduleType.video"
                    class="position-relative rounded cursor-pointer"
                    style="
                      width: 200px;
                      height: 150px;
                      background: rgba(var(--v-theme-surface-variant), 0.1);
                    "
                  >
                    <video
                      :src="filePreview.src"
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
                        pointer-events: none;
                      "
                    >
                      <VIcon
                        icon="tabler-player-play-filled"
                        size="32"
                        color="white"
                        style="
                          filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5));
                        "
                      />
                    </div>
                  </div>
                  <div
                    v-else-if="selectedType === EScheduleType.audio"
                    class="d-flex align-center gap-2 pa-2"
                    style="
                      background: rgba(var(--v-theme-surface-variant), 0.1);
                      border-radius: 8px;
                      max-width: 200px;
                    "
                  >
                    <VIcon icon="tabler-music" size="24" />
                    <div class="flex-grow-1" style="min-width: 0">
                      <div class="text-caption text-truncate">
                        {{ filePreview.file.name }}
                      </div>
                    </div>
                    <VIcon icon="tabler-player-play-filled" size="20" />
                  </div>
                </VCard>
              </VCol>
            </template>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('send_to') }}:</VLabel>
              <AppSelectSearch
                v-model="sendTo"
                :items="sendToOptions"
                item-value="value"
                item-title="title"
                :clearable="true"
              />
            </VCol>

            <VCol v-if="!isOfficialWorker" cols="12">
              <div class="d-flex align-center gap-2 mb-1">
                <VLabel class="text-body-2">{{ $t('send_speed') }}:</VLabel>
                <AppInfoTooltip :text="$t('send_speed_info')" />
              </div>
              <AppSelectSearch
                v-model="sendSpeed"
                :items="sendSpeedOptions"
                item-value="value"
                item-title="title"
                :clearable="false"
                :rules="[
                  requiredValidator(sendSpeed, $t('send_speed_required')),
                ]"
              />
            </VCol>

            <VCol v-if="showContactsSelect" cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('contacts') }}:</VLabel>
              <AppSelectSearch
                v-model="selectedContactIds"
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
                :search="contactSearch"
                @update:search="contactSearch = $event"
                :placeholder="$t('contacts')"
                :rules="[
                  (value) => requiredValidator(value, $t('contacts_required')),
                ]"
              >
                <template #chip="{ item }">
                  <span
                    >{{ item.name
                    }}{{ item.last_name ? ' ' + item.last_name : '' }}</span
                  >
                  <span
                    v-if="item.phone_partial"
                    class="text-medium-emphasis ml-1"
                  >
                    ({{ item.phone_partial }})
                  </span>
                </template>
              </AppSelectSearch>
            </VCol>

            <VCol v-if="showContactGroupsSelect" cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('contact_groups') }}:</VLabel
              >
              <VAutocomplete
                v-model="selectedContactGroupIds"
                :items="filteredContactGroups"
                item-title="name"
                item-value="contact_group_id"
                multiple
                chips
                closable-chips
                :search="contactGroupSearch"
                @update:search="contactGroupSearch = $event"
                :rules="[
                  requiredValidator(
                    selectedContactGroupIds.length > 0,
                    $t('contact_groups_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('send_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="sendDate"
                :placeholder="$t('send_date')"
                :rules="[requiredValidator(sendDate, $t('send_date_required'))]"
                :config="{
                  enableTime: true,
                  time_24hr: true,
                  dateFormat: 'Y-m-d H:i',
                  altFormat: 'd/m/Y H:i',
                }"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="isLoading"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn :loading="isLoading" @click="updateSchedule">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>

    <VDialog v-model="previewDialog.open" max-width="800">
      <DialogCloseBtn @click="closePreview" />
      <VCard :title="$t('preview')">
        <VCardText>
          <VImg
            v-if="
              previewDialog.src && previewDialog.type === EScheduleType.image
            "
            :src="previewDialog.src"
            max-height="420"
            class="rounded"
            contain
          />
          <video
            v-if="
              previewDialog.src && previewDialog.type === EScheduleType.video
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
              previewDialog.src && previewDialog.type === EScheduleType.audio
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
                        audioProgress >
                        (index / audioWaveformBars.length) * 100,
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
                    isAudioPlaying
                      ? 'tabler-player-pause'
                      : 'tabler-player-play'
                  "
                  variant="flat"
                  color="primary"
                  size="large"
                  @click="toggleAudioPreview"
                />
                <div class="flex-grow-1">
                  <audio
                    ref="audioPreviewRef"
                    :src="previewDialog.src || undefined"
                    @timeupdate="updateAudioProgress"
                    @loadedmetadata="updateAudioDuration"
                    @play="isAudioPlaying = true"
                    @pause="isAudioPlaying = false"
                    @ended="isAudioPlaying = false"
                  >
                    <track kind="captions" />
                  </audio>
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
  </VDialog>
</template>

<style lang="scss" scoped>
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
  background: rgba(var(--v-theme-primary), 1);
  z-index: 2;
  pointer-events: none;
  transform: translateX(-50%);
}
</style>
