<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useDisplay, useTheme } from 'vuetify';
import { themes } from '@/plugins/vuetify/theme';
import ChatActiveChatUserProfileSidebarContent from '@/components/chat/ChatActiveChatUserProfileSidebarContent.vue';
import ChatLeftSidebarContent from '@/components/chat/ChatLeftSidebarContent.vue';
import ChatLog from '@/components/chat/ChatLog.vue';
import ChatUserProfileSidebarContent from '@/components/chat/ChatUserProfileSidebarContent.vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { useChatStore } from '@/@webcore/stores/chat';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { ListMessageChatsQuery } from '@core/schema/chat/listMessageChats/request.schema';
import { onMessage, unsubscribe } from '@/@webcore/centrifugo';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EColor } from '@core/common/enums/EColor';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { IChat } from '@core/common/interfaces/IChat';
import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';
import { refDebounced } from '@vueuse/core';
import { getOffsetTop } from '@core/common/functions/getOffsetTop';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { useI18n } from 'vue-i18n';

const emojiIndex = new EmojiIndex(data);
const { t } = useI18n();

definePage({
  meta: {
    layoutWrapperClasses: 'layout-content-height-fixed',
    permissions: [EGeneralPermissions.full_access],
  },
});

const chatStore = useChatStore();
const { name } = useTheme();
const vuetifyDisplays = useDisplay();

const contact_id = ref('contact-id');
const { isLeftSidebarOpen } = useResponsiveLeftSidebar(
  vuetifyDisplays.smAndDown
);

const currentPage = ref(1);
const perPage = ref(10);
const chatLogPS = ref();
const q = ref('');
const msg = ref('');
const isUserProfileSidebarOpen = ref(false);
const isActiveChatUserProfileSidebarOpen = ref(false);
const linkPreview = ref<ViewLinkPreviewResponse | null>(null);
const composerRef = ref();

const fileDocRef = ref<HTMLInputElement | null>(null);
const filePhotoRef = ref<HTMLInputElement | null>(null);
const fileVideoRef = ref<HTMLInputElement | null>(null);
const fileAudioRef = ref<HTMLInputElement | null>(null);
const isEmojiOpen = ref(false);
const selectedPhotos = ref<{ file: File; preview: string }[]>([]);
type SelectedDocumentPreview = {
  file: File;
  name: string;
  size: number;
  extension: string;
  type: string;
};
const selectedDocuments = ref<SelectedDocumentPreview[]>([]);

const hasContent = computed(() => !!msg.value && msg.value.trim().length > 0);
const hasAttachmentsOrContent = computed(
  () =>
    hasContent.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0
);
const forceReflow = (el: HTMLElement): number => el.offsetWidth;

const scrollToBottomInChatLog = () => {
  if (!chatLogPS.value) return;

  const scrollEl = chatLogPS.value.$el || chatLogPS.value;
  if (!scrollEl) return;

  scrollEl.scrollTop = scrollEl.scrollHeight;
};

const scrollToMessageById = async (id?: string) => {
  await nextTick();

  const container: HTMLElement = chatLogPS.value?.$el || chatLogPS.value;
  if (!container) return;

  if (!id) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    chatLogPS.value?.update?.();

    return;
  }

  const target =
    (container.querySelector(`[data-message-id="${id}"]`) as HTMLElement) ||
    (document.getElementById(`msg-${id}`) as HTMLElement);

  if (target) {
    const top = getOffsetTop(container, target) - 60;

    container.scrollTo({ top, behavior: 'auto' });

    requestAnimationFrame(() => {
      container.scrollTo({ top, behavior: 'smooth' });
      chatLogPS.value?.update?.();
    });

    return;
  }

  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  chatLogPS.value?.update?.();
};

const highlightAndScrollToMessage = (id: string) => {
  if (!id || !chatLogPS.value) return;

  const container: HTMLElement = chatLogPS.value.$el || chatLogPS.value;
  const target =
    (container.querySelector(`[data-message-id="${id}"]`) as HTMLElement) ||
    (document.getElementById(`msg-${id}`) as HTMLElement);

  if (!target) return;

  const top = getOffsetTop(container, target) - 60;
  container.scrollTo({ top, behavior: 'auto' });

  requestAnimationFrame(() => container.scrollTo({ top, behavior: 'smooth' }));

  nextTick(() => (chatLogPS.value?.update ? chatLogPS.value.update() : null));

  target.classList.remove('message-target-flash');

  forceReflow(target);

  target.classList.add('message-target-flash');
};

const startConversation = () => {
  if (vuetifyDisplays.mdAndUp.value) return;
  isLeftSidebarOpen.value = true;
};

const createImageFormData = (): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.image);
  if (msg.value) {
    formData.append('message', msg.value);
  }

  if (chatStore.messageReply?.message_id) {
    formData.append('message_quoted_id', chatStore.messageReply.message_id);
  }

  selectedPhotos.value.forEach((photo) => {
    formData.append('images', photo.file);
  });

  return formData;
};

const createDocumentFormData = (): FormData => {
  const formData = new FormData();
  formData.append('type', EMessageType.document);
  if (msg.value) {
    formData.append('message', msg.value);
  }

  if (chatStore.messageReply?.message_id) {
    formData.append('message_quoted_id', chatStore.messageReply.message_id);
  }

  selectedDocuments.value.forEach((doc) => {
    formData.append('documents', doc.file);
  });

  return formData;
};

const createTextMessageBody = (): CreateMessageChatsBody => {
  const inputCreateMessage: CreateMessageChatsBody = {
    type: EMessageType.text,
    message: msg.value,
    link_preview: linkPreview.value?.title
      ? (linkPreview.value as ViewLinkPreviewResponse)
      : undefined,
  };

  if (chatStore.messageReply?.message_id) {
    inputCreateMessage.message_quoted_id = chatStore.messageReply.message_id;
  }

  return inputCreateMessage;
};

const clearMessageFields = () => {
  msg.value = '';
  linkPreview.value = null;
  selectedPhotos.value = [];
  selectedDocuments.value = [];
  chatStore.clearMessageReply();
};

const canSendMessage = (): boolean => {
  return !!(
    msg.value ||
    selectedPhotos.value.length > 0 ||
    selectedDocuments.value.length > 0
  );
};

const hasActiveChat = (): boolean => {
  return !!chatStore.activeChat?.worker?.id;
};

const sendImageMessage = async (): Promise<void> => {
  const formData = createImageFormData();
  await chatStore.createMessageWithImages(formData);
};

const sendDocumentMessage = async (): Promise<void> => {
  const formData = createDocumentFormData();
  await chatStore.createMessageWithDocuments(formData);
};

const sendTextMessage = async (): Promise<void> => {
  const messageBody = createTextMessageBody();
  await chatStore.createMessage(messageBody);
};

const finalizeSend = () => {
  clearMessageFields();

  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

const sendMessage = async () => {
  if (!canSendMessage()) return;
  if (!hasActiveChat()) return;

  if (selectedDocuments.value.length > 0) {
    await sendDocumentMessage();
    finalizeSend();
    return;
  }

  if (selectedPhotos.value.length > 0) {
    await sendImageMessage();
    finalizeSend();
    return;
  }

  await sendTextMessage();
  finalizeSend();
};

const openChat = async (chatId: ListChatsResult['chat_id']) => {
  chatStore.setActiveChat(chatId);

  const requestQueue: ListMessageChatsQuery = {
    current_page: currentPage.value,
    per_page: perPage.value,
  };

  await chatStore.getChatById(requestQueue);

  if (vuetifyDisplays.smAndDown.value) {
    isLeftSidebarOpen.value = false;
  }

  nextTick(() => {
    scrollToBottomInChatLog();
  });
};

const chatContentContainerBg = computed(() => {
  let color = 'transparent';

  if (themes) {
    color = themes?.[name.value].colors?.background as string;
  }

  return color;
});

const previewDomain = computed(() => {
  const u =
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    '';
  if (!u) return '';
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
});

const previewHref = computed(() => {
  return (
    linkPreview.value?.['canonical-url'] ||
    linkPreview.value?.['matched-text'] ||
    ''
  );
});

const previewImage = computed(() => {
  const p = linkPreview.value;
  if (!p) {
    return null;
  }
  const cand =
    p.highQualityThumbnail || p.originalThumbnailUrl || p.jpegThumbnail || '';
  if (!cand) return null;
  if (cand.startsWith('http')) return cand;
  return `data:image/jpeg;base64,${cand}`;
});

const openAttach = (
  type: 'document' | 'photo' | 'video' | 'audio' | 'contact'
) => {
  switch (type) {
    case 'document':
      fileDocRef.value?.click();
      break;
    case 'photo':
      filePhotoRef.value?.click();
      break;
    case 'video':
      fileVideoRef.value?.click();
      break;
    case 'audio':
      fileAudioRef.value?.click();
      break;
    case 'contact':
      globalThis.dispatchEvent(new CustomEvent('open-contact-picker'));
      break;
  }
};

const onPickDoc = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedPhotos.value.length > 0) {
    chatStore.showSnackbar(t('clear_images_before_documents'), EColor.warning);
    target.value = '';
    return;
  }

  const limit = 10;
  const currentCount = selectedDocuments.value.length;
  if (currentCount >= limit) {
    chatStore.showSnackbar(t('max_documents_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const spaceLeft = limit - currentCount;
  const filesArray = Array.from(files);
  const filesToAdd = filesArray.slice(0, spaceLeft);
  if (filesArray.length > spaceLeft) {
    chatStore.showSnackbar(
      t('can_select_more_documents', { count: spaceLeft }),
      EColor.warning
    );
  }

  filesToAdd.forEach((file) => {
    selectedDocuments.value.push({
      file,
      name: file.name,
      size: file.size,
      extension: (file.name.split('.').pop() || '').toLowerCase(),
      type: file.type,
    });
  });

  target.value = '';
};
const onPickPhoto = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const files = target.files;

  if (!files || files.length === 0) {
    target.value = '';
    return;
  }

  if (selectedDocuments.value.length > 0) {
    chatStore.showSnackbar(t('clear_documents_before_images'), EColor.warning);
    target.value = '';
    return;
  }

  const imageFiles = Array.from(files).filter((file) =>
    file.type.startsWith('image/')
  );

  if (imageFiles.length === 0) {
    target.value = '';
    return;
  }

  const currentCount = selectedPhotos.value.length;
  const totalAfterSelection = currentCount + imageFiles.length;

  if (totalAfterSelection > 10) {
    chatStore.showSnackbar(t('max_images_selected'), EColor.warning);
    target.value = '';
    return;
  }

  const remainingSlots = 10 - currentCount;

  if (imageFiles.length > remainingSlots) {
    chatStore.showSnackbar(
      t('can_select_more_images', { count: remainingSlots }),
      EColor.warning
    );
    target.value = '';
    return;
  }

  imageFiles.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        selectedPhotos.value.push({
          file,
          preview: event.target.result as string,
        });
      }
    };
    reader.readAsDataURL(file);
  });

  target.value = '';
};
const onPickVideo = (e: Event) => {
  console.log(e);
};
const onPickAudio = (e: Event) => {
  console.log(e);
};

const onEmojiSelect = (e: any) => {
  const ch = e?.native || e?.skins?.[0]?.native || '';

  if (ch) {
    msg.value = (msg.value || '') + ch;
    nextTick(() => globalThis.dispatchEvent(new CustomEvent('focus-composer')));
  }
};

const onRecordAudio = () => {
  globalThis.dispatchEvent(new CustomEvent('start-recording-audio'));
};

const onSendText = () => sendMessage();

const removeDocument = (index: number) => {
  selectedDocuments.value.splice(index, 1);
};

const documentIconMap: Record<string, string> = {
  pdf: 'tabler-file-type-pdf',
  doc: 'tabler-file-type-doc',
  docx: 'tabler-file-type-doc',
  xls: 'tabler-file-type-xls',
  xlsx: 'tabler-file-type-xls',
  csv: 'tabler-file-type-xls',
  ppt: 'tabler-file-type-ppt',
  pptx: 'tabler-file-type-ppt',
  txt: 'tabler-file-type-txt',
  zip: 'tabler-file-type-zip',
  rar: 'tabler-file-type-zip',
  '7z': 'tabler-file-type-zip',
  json: 'tabler-file-code',
  xml: 'tabler-file-code',
};

const resolveDocumentIcon = (extension?: string, mimetype?: string): string => {
  const ext = extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }

  if (mimetype?.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype?.includes('word')) return 'tabler-file-type-doc';
  if (mimetype?.includes('sheet') || mimetype?.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype?.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype?.includes('zip') || mimetype?.includes('compressed'))
    return 'tabler-file-type-zip';

  return 'tabler-file-description';
};

const truncateFileName = (name: string, max = 32): string => {
  if (name.length <= max) return name;
  const extIndex = name.lastIndexOf('.');
  if (extIndex === -1 || extIndex < name.length - 6) {
    return `${name.slice(0, max - 3)}...`;
  }

  const ext = name.slice(extIndex);
  const base = name.slice(0, max - ext.length - 3);
  return `${base}...${ext}`;
};

const formatFileSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  const formatted =
    value >= 100
      ? value.toFixed(0)
      : value >= 10
        ? value.toFixed(1)
        : value.toFixed(2);

  return `${formatted} ${units[exponent]}`;
};

const debouncedMsg = refDebounced(msg, 500);
watch(
  debouncedMsg,
  async (val) => {
    const firstUrl = extractFirstUrl(val as string);
    if (firstUrl) {
      const linkPreviewResponse = await chatStore.generateLinkPreview({
        url: firstUrl,
      });
      if (linkPreviewResponse?.title !== 'Error') {
        linkPreview.value = linkPreviewResponse as ViewLinkPreviewResponse;
      }
      return;
    }
    linkPreview.value = null;
  },
  { immediate: true }
);

const focusComposer = () => {
  setTimeout(() => {
    const el = composerRef.value?.$el?.querySelector(
      'textarea'
    ) as HTMLTextAreaElement | null;
    el?.focus({ preventScroll: false });
  }, 120);
};

const onScrollToMessageEvt = (e: Event) => {
  const id = (e as CustomEvent<string>).detail;
  if (id) highlightAndScrollToMessage(id);
};

onMounted(async () => {
  if (chatStore.user?.account_id) {
    await onMessage(
      chatAccountCentrifugo(chatStore.user.account_id),
      (data: IChatMessage) => {
        console.log('data:', data);

        if (chatStore.activeChat?.chat_id !== data.chat_id) {
          return;
        }

        chatStore.addMessageActiveChat(data);

        scrollToMessageById(data.message_id);
        globalThis.dispatchEvent(new CustomEvent('focus-composer'));
      }
    );

    await onMessage(
      chatQueueAccountCentrifugo(chatStore.user.account_id),
      (data: IChat) => {
        chatStore.addChat(data);
      }
    );

    globalThis.addEventListener('focus-composer', focusComposer);
    globalThis.addEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
  }
});

onUnmounted(async () => {
  if (chatStore.user?.account_id) {
    await unsubscribe(chatAccountCentrifugo(chatStore.user.account_id));
    await unsubscribe(chatQueueAccountCentrifugo(chatStore.user.account_id));

    globalThis.removeEventListener('focus-composer', focusComposer);
    globalThis.removeEventListener(
      'scroll-to-message',
      onScrollToMessageEvt as EventListener
    );
  }
});
</script>

<template>
  <VLayout class="chat-app-layout" style="z-index: 0">
    <VNavigationDrawer
      v-model="isUserProfileSidebarOpen"
      data-allow-mismatch
      temporary
      touchless
      absolute
      class="user-profile-sidebar"
      location="start"
      width="370"
    >
      <ChatUserProfileSidebarContent
        @close="isUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isActiveChatUserProfileSidebarOpen"
      data-allow-mismatch
      width="374"
      absolute
      temporary
      location="end"
      touchless
      class="active-chat-user-profile-sidebar"
    >
      <ChatActiveChatUserProfileSidebarContent
        @close="isActiveChatUserProfileSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VNavigationDrawer
      v-model="isLeftSidebarOpen"
      data-allow-mismatch
      absolute
      touchless
      location="start"
      width="370"
      :temporary="$vuetify.display.smAndDown"
      class="chat-list-sidebar"
      :permanent="$vuetify.display.mdAndUp"
    >
      <ChatLeftSidebarContent
        v-model:is-drawer-open="isLeftSidebarOpen"
        v-model:search="q"
        @open-chat="openChat"
        @show-user-profile="isUserProfileSidebarOpen = true"
        @close="isLeftSidebarOpen = false"
      />
    </VNavigationDrawer>

    <VMain class="chat-content-container">
      <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
        <div
          class="active-chat-header d-flex align-center text-medium-emphasis bg-surface"
        >
          <IconBtn class="d-md-none me-3" @click="isLeftSidebarOpen = true">
            <VIcon icon="tabler-menu-2" />
          </IconBtn>

          <div
            class="d-flex align-center cursor-pointer"
            @click="isActiveChatUserProfileSidebarOpen = true"
          >
            <VAvatar
              size="40"
              :variant="!chatStore.activeChat.photo ? 'tonal' : undefined"
              class="cursor-pointer"
            >
              <VImg
                v-if="chatStore.activeChat.photo"
                :src="chatStore.activeChat.photo"
                :alt="chatStore.activeChat.name ?? ''"
              />
              <span v-if="!chatStore.activeChat.photo">{{
                avatarText(chatStore.activeChat.name)
              }}</span>
            </VAvatar>

            <div class="flex-grow-1 ms-4 overflow-hidden">
              <div class="text-h6 mb-0 font-weight-regular">
                {{ chatStore.activeChat.name }}
              </div>
              <p class="text-truncate mb-0 text-body-2">
                {{ formatPhoneBR(chatStore.activeChat.phone) }}
              </p>
            </div>
          </div>

          <VSpacer />

          <div class="d-sm-flex align-center d-none text-medium-emphasis">
            <IconBtn>
              <VIcon icon="tabler-search" />
            </IconBtn>
            <IconBtn>
              <VIcon icon="tabler-dots-vertical" />
            </IconBtn>
          </div>
        </div>

        <VDivider />

        <PerfectScrollbar
          ref="chatLogPS"
          tag="ul"
          :options="{ wheelPropagation: false }"
          class="flex-grow-1"
        >
          <ChatLog />
        </PerfectScrollbar>

        <Transition name="fade">
          <div v-if="linkPreview" class="mx-5 mt-3">
            <VCard class="link-preview-card">
              <VBtn
                class="link-preview-close"
                icon
                size="24"
                variant="text"
                @click="linkPreview = null"
              >
                <VIcon size="18" icon="tabler-x" />
              </VBtn>
              <div class="d-flex gap-3">
                <VAvatar size="56" :rounded="8" variant="tonal">
                  <VImg v-if="previewImage" :src="previewImage" />
                </VAvatar>
                <div class="flex-grow-1 overflow-hidden">
                  <div class="text-caption text-medium-emphasis">
                    {{ previewDomain }}
                  </div>
                  <div class="text-subtitle-1 font-weight-medium text-truncate">
                    {{ linkPreview?.title }}
                  </div>
                  <div
                    class="text-body-2 text-medium-emphasis two-line-ellipsis"
                  >
                    {{ linkPreview?.description }}
                  </div>
                  <div class="mt-2">
                    <a
                      v-if="previewHref"
                      :href="previewHref"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-primary text-body-2"
                    >
                      {{ previewHref }}
                    </a>
                  </div>
                </div>
              </div>
            </VCard>
          </div>
        </Transition>

        <VForm
          class="chat-log-message-form mb-5 mx-5"
          @submit.prevent="sendMessage"
        >
          <ReplyPreview v-if="chatStore.messageReply" />

          <Transition name="fade">
            <div
              v-if="selectedDocuments.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('documents_selected') }} (
                    {{ selectedDocuments.length }}/10 )</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedDocuments = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="document-preview-list">
                    <div
                      v-for="(doc, index) in selectedDocuments"
                      :key="`${doc.name}-${index}`"
                      class="document-preview-item d-flex align-center justify-space-between px-3 py-2"
                    >
                      <div class="d-flex align-center gap-3 overflow-hidden">
                        <VIcon
                          :icon="resolveDocumentIcon(doc.extension, doc.type)"
                          size="28"
                          color="primary"
                        />
                        <div class="d-flex flex-column overflow-hidden">
                          <VTooltip location="bottom">
                            <template #activator="{ props }">
                              <span
                                v-bind="props"
                                class="text-body-2 fw-medium document-preview-name"
                              >
                                {{ truncateFileName(doc.name) }}
                              </span>
                            </template>
                            <span>{{ doc.name }}</span>
                          </VTooltip>
                          <span class="text-caption text-disabled">
                            {{ formatFileSize(doc.size) }}
                          </span>
                        </div>
                      </div>
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        @click="removeDocument(index)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <Transition name="fade">
            <div
              v-if="selectedPhotos.length > 0"
              class="composer-attachment mt-3"
            >
              <VCard class="composer-attachment-card">
                <VCardTitle class="d-flex align-center justify-space-between">
                  <span
                    >{{ t('images_selected') }} ({{
                      selectedPhotos.length
                    }}/10)</span
                  >
                  <VBtn
                    icon
                    size="24"
                    variant="text"
                    @click="selectedPhotos = []"
                  >
                    <VIcon size="18" icon="tabler-x" />
                  </VBtn>
                </VCardTitle>
                <VCardText>
                  <div class="attachment-grid">
                    <div
                      v-for="(photo, index) in selectedPhotos"
                      :key="index"
                      class="photo-preview-wrapper"
                    >
                      <VImg
                        :src="photo.preview"
                        cover
                        class="photo-preview-image"
                      />
                      <VBtn
                        icon
                        size="20"
                        variant="flat"
                        color="error"
                        class="photo-preview-remove"
                        @click="selectedPhotos.splice(index, 1)"
                      >
                        <VIcon size="14" icon="tabler-x" />
                      </VBtn>
                    </div>
                  </div>
                </VCardText>
              </VCard>
            </div>
          </Transition>

          <VTextarea
            ref="composerRef"
            :key="contact_id"
            v-model="msg"
            variant="solo"
            density="comfortable"
            class="chat-message-input whats-composer"
            :placeholder="$t('write_your_message')"
            :auto-grow="true"
            rows="1"
            :max-rows="8"
            @keydown.enter.exact.prevent="onSendText"
          >
            <template #prepend-inner>
              <VMenu
                offset="8"
                :close-on-content-click="true"
                location="top start"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Anexar"
                  >
                    <VIcon size="22">tabler-plus</VIcon>
                  </IconBtn>
                </template>

                <VList
                  density="comfortable"
                  min-width="220"
                  class="attach-menu"
                >
                  <VListItem @click="openAttach('document')">
                    <template #prepend
                      ><VIcon size="20">tabler-file</VIcon></template
                    >
                    <VListItemTitle>Documentos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('photo')">
                    <template #prepend
                      ><VIcon size="20">tabler-photo</VIcon></template
                    >
                    <VListItemTitle>Fotos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('video')">
                    <template #prepend
                      ><VIcon size="20">tabler-video</VIcon></template
                    >
                    <VListItemTitle>Vídeos</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('audio')">
                    <template #prepend
                      ><VIcon size="20">tabler-headphones</VIcon></template
                    >
                    <VListItemTitle>Áudio</VListItemTitle>
                  </VListItem>
                  <VListItem @click="openAttach('contact')">
                    <template #prepend
                      ><VIcon size="20">tabler-user</VIcon></template
                    >
                    <VListItemTitle>Contato</VListItemTitle>
                  </VListItem>
                </VList>
              </VMenu>

              <VMenu
                v-model="isEmojiOpen"
                location="top start"
                :close-on-content-click="false"
                offset="8"
              >
                <template #activator="{ props }">
                  <IconBtn
                    v-bind="props"
                    class="composer-btn"
                    aria-label="Emoji"
                  >
                    <VIcon size="22">tabler-mood-smile</VIcon>
                  </IconBtn>
                </template>

                <div class="emoji-picker-wrap">
                  <Picker
                    :data="emojiIndex"
                    :per-line="8"
                    :show-preview="false"
                    :show-search="true"
                    :show-skin-tones="false"
                    @select="onEmojiSelect"
                  />
                </div>
              </VMenu>
            </template>

            <template #append-inner>
              <div class="d-flex align-center gap-1">
                <IconBtn
                  v-if="!hasAttachmentsOrContent"
                  class="composer-btn mic-btn"
                  aria-label="Gravar áudio"
                  @click="onRecordAudio"
                >
                  <VIcon size="22">tabler-microphone</VIcon>
                </IconBtn>

                <VBtn
                  v-if="hasAttachmentsOrContent"
                  class="send-btn"
                  icon
                  color="success"
                  variant="flat"
                  rounded="pill"
                  aria-label="Enviar mensagem"
                  @click="onSendText"
                >
                  <VIcon size="22">tabler-send</VIcon>
                </VBtn>
              </div>
            </template>
          </VTextarea>

          <input
            ref="fileDocRef"
            type="file"
            hidden
            multiple
            @change="onPickDoc"
          />
          <input
            ref="filePhotoRef"
            type="file"
            hidden
            accept="image/*"
            multiple
            @change="onPickPhoto"
          />
          <input
            ref="fileVideoRef"
            type="file"
            hidden
            accept="video/*"
            @change="onPickVideo"
          />
          <input
            ref="fileAudioRef"
            type="file"
            hidden
            accept="audio/*"
            @change="onPickAudio"
          />
        </VForm>
      </div>

      <div
        v-if="!chatStore.activeChat"
        class="d-flex h-100 align-center justify-center flex-column"
      >
        <VAvatar size="98" variant="tonal" color="primary" class="mb-4">
          <VIcon size="50" class="rounded-0" icon="tabler-message-2" />
        </VAvatar>
        <VBtn
          v-if="$vuetify.display.smAndDown"
          rounded="pill"
          @click="startConversation"
        >
          {{ $t('start_conversation') }}
        </VBtn>

        <p
          v-if="!$vuetify.display.smAndDown"
          style="max-inline-size: 40ch; text-wrap: balance"
          class="text-center text-disabled"
        >
          {{ $t('select_a_contact') }}
        </p>
      </div>
    </VMain>
  </VLayout>

  <VSnackbar
    v-model="chatStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="chatStore.snackbar.color"
  >
    {{ chatStore.snackbar.message }}
  </VSnackbar>
</template>

<style lang="scss">
@use '@styles/variables/vuetify';
@use '@webcore/scss/base/mixins';
@use '@layouts/styles/mixins' as layoutsMixins;

$chat-app-header-height: 76px;

%chat-header {
  display: flex;
  align-items: center;
  min-block-size: $chat-app-header-height;
  padding-inline: 1.5rem;
}

.chat-start-conversation-btn {
  cursor: default;
}

.chat-app-layout {
  border-radius: vuetify.$card-border-radius;
  @include mixins.elevation(vuetify.$card-elevation);
  $sel-chat-app-layout: &;

  @at-root {
    .skin--bordered {
      @include mixins.bordered-skin($sel-chat-app-layout);
    }
  }

  .active-chat-user-profile-sidebar,
  .user-profile-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }

  .chat-list-header,
  .active-chat-header {
    @extend %chat-header;
  }

  .chat-list-sidebar {
    .v-navigation-drawer__content {
      display: flex;
      flex-direction: column;
    }
  }
}

.chat-message-input textarea {
  resize: none;
  overflow: hidden;
  line-height: 1.5rem;
  padding-top: 0.8rem !important;
  padding-bottom: 0.5rem !important;
}

.chat-content-container {
  background-color: v-bind(chatContentContainerBg);

  .chat-message-input {
    .v-field__input {
      font-size: 0.9375rem !important;
      line-height: 1.375rem !important;
      padding-block: 0.6rem 0.5rem;
      white-space: pre-wrap;
    }

    .v-field__append-inner {
      align-items: center;
      padding-block-start: 0;
    }

    .v-field--appended {
      padding-inline-end: 8px;
    }
  }
}

.chat-user-profile-badge {
  .v-badge__badge {
    min-width: 12px !important;
    height: 0.75rem;
  }
}

.link-preview-card {
  position: relative;
  padding: 14px;
  margin-bottom: 0.5rem;
}

.link-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.two-line-ellipsis {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.composer-attachment {
  display: flex;
  justify-content: flex-start;
  width: 100%;
}

.composer-attachment-card {
  inline-size: 100%;
  max-inline-size: 100%;
}

.attachment-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.photo-preview-wrapper {
  position: relative;
  inline-size: 132px;
  block-size: 132px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.photo-preview-image {
  inline-size: 100%;
  block-size: 100%;
  border-radius: 8px;
}

.photo-preview-remove {
  position: absolute;
  inset-block-start: 4px;
  inset-inline-end: 4px;
}

.message-target-flash {
  animation: messageTargetFlash 1.1s ease;
}
@keyframes messageTargetFlash {
  0% {
    background-color: rgba(var(--v-theme-primary), 0.16);
  }
  100% {
    background-color: transparent;
  }
}

.document-preview-item {
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.document-preview-name {
  display: inline-block;
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.document-preview-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
  padding-inline-end: 4px;
}
</style>
