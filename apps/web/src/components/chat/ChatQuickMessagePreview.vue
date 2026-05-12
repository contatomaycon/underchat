<script lang="ts" setup>
import { computed, ref, onUnmounted } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { formatDate } from '@/@webcore/utils/formatters';
import { formatPhoneBR } from '@core/common/functions/formatPhoneBR';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { formatWhatsAppTextToHtml } from '@core/common/functions/whatsAppTextFormat';
import { useI18n } from 'vue-i18n';
import type { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';

const props = defineProps<{
  template: ListQuickMessageTemplatesResponse;
  messageOverride?: string | null;
}>();

const chatStore = useChatStore();
const { t } = useI18n();

const viewerOpen = ref(false);
const viewerKind = ref<'image' | 'video'>('image');
const viewerSrc = ref('');
const viewerCaption = ref('');

const audioPlayer = ref<HTMLAudioElement | null>(null);
const isAudioPlaying = ref(false);
const audioCurrentTime = ref(0);
const audioDuration = ref(0);

const openImage = () => {
  if (!props.template.attachment_url) return;
  viewerKind.value = 'image';
  viewerSrc.value = props.template.attachment_url;
  viewerCaption.value = replacedMessage.value || '';
  viewerOpen.value = true;
};

const openVideo = () => {
  if (!props.template.attachment_url) return;
  viewerKind.value = 'video';
  viewerSrc.value = props.template.attachment_url;
  viewerCaption.value = replacedMessage.value || '';
  viewerOpen.value = true;
};

const openDocument = () => {
  if (!props.template.attachment_url) return;
  window.open(props.template.attachment_url, '_blank');
};

const toggleAudioPlay = () => {
  if (!props.template.attachment_url) return;

  if (!audioPlayer.value) {
    audioPlayer.value = new Audio(props.template.attachment_url);
    audioPlayer.value.preload = 'metadata';

    audioPlayer.value.addEventListener('loadedmetadata', () => {
      audioDuration.value = audioPlayer.value?.duration || 0;
    });

    audioPlayer.value.addEventListener('timeupdate', () => {
      audioCurrentTime.value = audioPlayer.value?.currentTime || 0;
    });

    audioPlayer.value.addEventListener('play', () => {
      isAudioPlaying.value = true;
    });

    audioPlayer.value.addEventListener('pause', () => {
      isAudioPlaying.value = false;
    });

    audioPlayer.value.addEventListener('ended', () => {
      isAudioPlaying.value = false;
      audioCurrentTime.value = 0;
    });
  }

  if (isAudioPlaying.value) {
    audioPlayer.value.pause();
  } else {
    audioPlayer.value.play().catch(() => {
      isAudioPlaying.value = false;
    });
  }
};

onUnmounted(() => {
  if (audioPlayer.value) {
    audioPlayer.value.pause();
    audioPlayer.value = null;
  }
});

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return t('good_morning');
  }
  if (hour >= 12 && hour < 18) {
    return t('good_afternoon');
  }
  return t('good_evening');
};

const getCurrentProtocol = (): string => {
  const activeChat = chatStore.activeChat;
  if (!activeChat) {
    return generateProtocol();
  }

  if (activeChat.protocol_start && activeChat.protocol_start.length > 0) {
    return activeChat.protocol_start[activeChat.protocol_start.length - 1];
  }
  if (activeChat.protocol_transfer && activeChat.protocol_transfer.length > 0) {
    return activeChat.protocol_transfer[
      activeChat.protocol_transfer.length - 1
    ];
  }
  if (activeChat.protocol_ura && activeChat.protocol_ura.length > 0) {
    return activeChat.protocol_ura[activeChat.protocol_ura.length - 1];
  }

  return generateProtocol();
};

const replaceTagsInMessage = (message: string | null): string => {
  if (!message) return '';

  const activeChat = chatStore.activeChat;
  const contactName = activeChat?.name || '';
  const protocol = getCurrentProtocol();
  const now = new Date();
  const date = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const greeting = getGreeting();
  const accountName = activeChat?.account?.name || '';
  const phone = activeChat?.phone ? formatPhoneBR(activeChat.phone) : '';
  const channelName = activeChat?.worker?.name || '';

  let replaced = message;

  replaced = replaced.replaceAll(/\{\{\s*greeting\s*\}\}/gi, greeting);
  replaced = replaced.replaceAll(/\{\{\s*name\s*\}\}/gi, contactName);
  replaced = replaced.replaceAll(/\{\{\s*protocol\s*\}\}/gi, protocol);
  replaced = replaced.replaceAll(/\{\{\s*protocolo\s*\}\}/gi, protocol);
  replaced = replaced.replaceAll(/\{\{\s*date\s*\}\}/gi, date);
  replaced = replaced.replaceAll(/\{\{\s*time\s*\}\}/gi, time);
  replaced = replaced.replaceAll(/\{\{\s*account_name\s*\}\}/gi, accountName);
  replaced = replaced.replaceAll(/\{\{\s*accountname\s*\}\}/gi, accountName);
  replaced = replaced.replaceAll(/\{\{\s*phone\s*\}\}/gi, phone);
  replaced = replaced.replaceAll(/\{\{\s*channel_name\s*\}\}/gi, channelName);
  replaced = replaced.replaceAll(/\{\{\s*channelname\s*\}\}/gi, channelName);

  return replaced;
};

const replacedMessage = computed(() => {
  if (props.messageOverride !== null && props.messageOverride !== undefined) {
    return props.messageOverride;
  }

  return replaceTagsInMessage(props.template.message);
});

const formatWhatsAppText = (text: string): string =>
  formatWhatsAppTextToHtml(text);

const currentTime = computed(() => {
  return formatDate(new Date().toISOString(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
});

const userPhoto = computed(() => {
  return chatStore.user?.info.photo || '/images/svg/avatar-default.svg';
});

const hasPhoto = computed(() => {
  return !!chatStore.user?.info.photo;
});

const documentLabel = computed(() => {
  const url = props.template.attachment_url;

  if (!url) {
    return t('message_type_document');
  }

  try {
    const { pathname } = new URL(url);
    const fileName = pathname.split('/').pop();

    return fileName ? decodeURIComponent(fileName) : t('message_type_document');
  } catch {
    const clean = url.split(/[?#]/)[0] || '';
    const fileName = clean.split('/').pop();

    return fileName ? decodeURIComponent(fileName) : t('message_type_document');
  }
});
</script>

<template>
  <div
    class="chat-group d-flex align-start position-relative mb-6 mr-6"
    :class="{
      'flex-row-reverse': true,
    }"
  >
    <div class="chat-avatar ms-4">
      <VAvatar size="32" :variant="!hasPhoto ? 'tonal' : undefined">
        <VImg :src="userPhoto" />
      </VAvatar>
    </div>

    <div
      class="chat-body d-inline-flex flex-column position-relative align-end"
    >
      <div class="chat-content-wrapper wrapper-operator">
        <div
          class="chat-content py-2 px-2 elevation-2 chat-right"
          :style="{
            backgroundColor: 'rgb(217, 253, 211)',
          }"
        >
          <div class="message-block">
            <div
              v-if="template.type === 'text' && replacedMessage"
              class="text-message-wrapper"
            >
              <p
                class="text-base message-text mb-0"
                :style="{
                  color: 'rgb(var(--v-theme-title))',
                }"
                v-html="formatWhatsAppText(replacedMessage)"
              ></p>
              <span class="message-time-inline">
                {{ currentTime }}
                <VIcon size="16" color="rgba(17, 27, 33, 0.6)" class="ml-1">
                  tabler-checks
                </VIcon>
              </span>
            </div>

            <div
              v-if="template.type === 'image' && template.attachment_url"
              class="image-bubble image-bubble--right"
              @click="openImage"
            >
              <VImg
                :src="template.attachment_url"
                class="image-thumb"
                width="120"
                cover
              />
              <p
                v-if="replacedMessage"
                class="image-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-title))',
                }"
              >
                <span v-html="formatWhatsAppText(replacedMessage)"></span>
              </p>
            </div>

            <div
              v-if="template.type === 'video' && template.attachment_url"
              class="video-bubble video-bubble--right"
              @click="openVideo"
            >
              <div class="video-thumb-wrapper">
                <video
                  :src="template.attachment_url"
                  class="video-thumb"
                  preload="metadata"
                  muted
                  playsinline
                >
                  <track kind="captions" />
                </video>
                <div class="video-play-overlay">
                  <VIcon size="28">tabler-player-play</VIcon>
                </div>
              </div>
              <p
                v-if="replacedMessage"
                class="video-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-title))',
                }"
              >
                <span v-html="formatWhatsAppText(replacedMessage)"></span>
              </p>
            </div>

            <div
              v-if="template.type === 'audio' && template.attachment_url"
              class="audio-bubble audio-bubble--right"
            >
              <div class="audio-player-container">
                <VBtn
                  icon
                  size="36"
                  variant="text"
                  class="audio-play-btn"
                  @click="toggleAudioPlay"
                >
                  <VIcon size="18">
                    {{
                      isAudioPlaying
                        ? 'tabler-player-pause'
                        : 'tabler-player-play'
                    }}
                  </VIcon>
                </VBtn>
                <div class="audio-waveform-container">
                  <div class="audio-waveform-placeholder">
                    <div
                      v-for="i in 80"
                      :key="`placeholder-${i}`"
                      class="audio-waveform-bar-placeholder"
                    ></div>
                  </div>
                </div>
              </div>
              <p
                v-if="replacedMessage"
                class="audio-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-title))',
                }"
              >
                <span v-html="formatWhatsAppText(replacedMessage)"></span>
              </p>
            </div>

            <div
              v-if="template.type === 'document' && template.attachment_url"
              class="document-bubble document-bubble--right"
              @click="openDocument"
            >
              <div class="d-flex align-center gap-2">
                <VIcon size="20">tabler-file</VIcon>
                <span class="document-label text-truncate">{{
                  documentLabel
                }}</span>
                <VIcon size="18">tabler-external-link</VIcon>
              </div>
              <p
                v-if="replacedMessage"
                class="document-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-title))',
                }"
              >
                <span v-html="formatWhatsAppText(replacedMessage)"></span>
              </p>
            </div>
          </div>

          <div v-if="template.type !== 'text'" class="message-meta">
            <div class="message-meta-content">
              <div class="message-meta-row">
                <span class="message-time">
                  {{ currentTime }}
                </span>
                <VIcon size="16" color="rgba(17, 27, 33, 0.6)">
                  tabler-checks
                </VIcon>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <VDialog
    v-model="viewerOpen"
    fullscreen
    scrim="rgba(0,0,0,.9)"
    :scrollable="false"
  >
    <div class="viewer-wrap" @click="viewerOpen = false">
      <div class="viewer-box" @click.stop>
        <div class="viewer-media-container">
          <img
            v-if="viewerKind === 'image'"
            :src="viewerSrc"
            alt=""
            class="viewer-img"
            loading="eager"
            decoding="async"
          />
          <video
            v-if="viewerKind === 'video'"
            :src="viewerSrc"
            class="viewer-video"
            controls
            playsinline
          >
            <track kind="captions" />
          </video>

          <div class="viewer-actions">
            <VBtn
              class="viewer-close"
              icon
              size="36"
              variant="text"
              @click="viewerOpen = false"
            >
              <VIcon size="20">tabler-x</VIcon>
            </VBtn>
          </div>
        </div>

        <div v-if="viewerCaption" class="viewer-caption">
          {{ viewerCaption }}
        </div>
      </div>
    </div>
  </VDialog>
</template>

<style lang="scss" scoped>
.chat-avatar {
  flex-shrink: 0;
}

.chat-body {
  max-width: 65%;
  min-width: 0;
}

.chat-content-wrapper {
  position: relative;
  display: inline-flex;
  overflow: visible !important;
}

.chat-content {
  position: relative;
  border-end-end-radius: 6px;
  border-end-start-radius: 6px;
  padding-right: 1.8rem !important;
  padding-bottom: 0.75rem !important;
  max-height: 40vh;
  overflow-y: auto;
  overflow-x: hidden;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.05);
    border-radius: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 10px;

    &:hover {
      background: rgba(0, 0, 0, 0.3);
    }
  }

  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) rgba(0, 0, 0, 0.05);

  p {
    overflow-wrap: anywhere;
  }

  &.chat-right {
    border-start-start-radius: 6px;

    :deep(.whatsapp-quote) {
      border-left-color: rgba(17, 27, 33, 0.38);
      color: rgba(17, 27, 33, 0.68);
    }

    :deep(.whatsapp-quote code) {
      color: inherit;
    }

    .message-meta {
      color: rgba(17, 27, 33, 0.6);
    }
  }

  .message-block {
    position: relative;
  }

  .text-message-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .message-text {
    white-space: pre-line;
  }

  .message-text,
  .image-caption,
  .video-caption,
  .audio-caption {
    :deep(code) {
      border-radius: 3px;
      background: rgba(var(--v-theme-on-surface), 0.08);
      color: inherit;
      font-family:
        ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        'Liberation Mono', 'Courier New', monospace;
      font-size: 0.86em;
      padding: 0 0.18em;
      white-space: pre-wrap;
    }

    :deep(.whatsapp-quote) {
      display: block;
      margin-block: 0.35rem 0.1rem;
      border-left: 4px solid rgba(var(--v-theme-on-surface), 0.35);
      color: rgba(var(--v-theme-on-surface), 0.68);
      line-height: 1.4;
      padding-block: 0.08rem;
      padding-inline-start: 0.65rem;
    }

    :deep(.whatsapp-quote code) {
      background: transparent;
      padding: 0;
    }
  }

  .message-time-inline {
    display: inline-flex;
    align-items: center;
    align-self: flex-end;
    gap: 2px;
    font-size: 0.75rem;
    color: rgba(17, 27, 33, 0.6);
    white-space: nowrap;
    margin-top: 0.125rem;
    margin-right: -1rem;
    margin-bottom: -0.25rem;
  }

  .image-bubble {
    max-inline-size: 260px;
    inline-size: 100%;
    cursor: zoom-in;

    .image-thumb {
      border-radius: 8px;
      inline-size: 100%;
      max-inline-size: 260px;
      max-block-size: 360px;
    }

    .image-caption {
      font-size: 0.95rem;
      line-height: 1.25rem;
      white-space: pre-line;
      margin-bottom: 0 !important;
    }
  }

  .image-bubble--right .image-thumb {
    border-start-start-radius: 6px;
  }

  .video-bubble {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-inline-size: 260px;
    inline-size: 100%;
    cursor: pointer;
    border-radius: 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    padding: 10px;
  }

  .video-bubble--right {
    border-start-start-radius: 6px;
  }

  .video-thumb-wrapper {
    position: relative;
    width: 100%;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(var(--v-theme-on-surface), 0.04);

    video {
      width: 100%;
      max-height: 300px;
      display: block;
    }

    .video-play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.3);
      pointer-events: none;
      transition: background 0.2s ease;

      .v-icon {
        color: white;
      }
    }
  }

  .video-caption {
    font-size: 0.95rem;
    line-height: 1.25rem;
    white-space: pre-line;
    margin-bottom: 0 !important;
  }

  .audio-bubble {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-inline-size: 380px;
    inline-size: 100%;
    position: relative;
  }

  .audio-bubble--right {
    border-start-start-radius: 6px;
  }

  .audio-player-container {
    display: flex;
    align-items: center;
    gap: 12px;
    inline-size: 100%;
    padding: 8px 14px;
    border-radius: 20px;
  }

  .audio-play-btn {
    flex-shrink: 0;
    min-width: 36px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.95);
    border: 2px solid rgba(255, 255, 255, 0.8);
    color: rgb(var(--v-theme-primary));
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);

    :deep(.v-icon) {
      color: rgb(var(--v-theme-primary));
      font-size: 18px;
    }
  }

  .audio-waveform-container {
    position: relative;
    flex: 1 1 auto;
    height: 36px;
    display: flex;
    align-items: center;
    overflow: hidden;
    min-width: 100px;
  }

  .audio-waveform-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 3px;
    padding: 6px 0;
  }

  .audio-waveform-bar-placeholder {
    flex: 1;
    min-width: 3px;
    max-width: 4px;
    height: 20%;
    background: rgba(var(--v-theme-on-surface), 0.2);
    border-radius: 2px;
  }

  .audio-caption {
    font-size: 0.95rem;
    line-height: 1.25rem;
    white-space: pre-line;
    margin-bottom: 0 !important;
  }

  .document-bubble {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-inline-size: 300px;
    inline-size: 100%;
    border-radius: 10px;
    background: rgba(var(--v-theme-on-surface), 0.04);
    padding: 10px;
    cursor: pointer;
  }

  .document-bubble--right {
    border-start-start-radius: 6px;
  }

  .document-label {
    font-size: 0.9rem;
    line-height: 1.2rem;
    font-weight: 500;
  }

  .document-caption {
    font-size: 0.95rem;
    line-height: 1.25rem;
    white-space: pre-line;
    margin-bottom: 0 !important;
  }

  .message-meta {
    position: absolute;
    bottom: 6px;
    right: 12px;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    justify-content: flex-end;
    font-size: 0.75rem;
    z-index: 1;

    .v-icon {
      font-size: 0.95rem;
    }

    .message-meta-content {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .message-meta-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .message-time {
      line-height: 1;
      pointer-events: auto;
    }

    .v-icon {
      pointer-events: auto;
    }
  }
}

.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 90vh;
}

.viewer-media-container {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-video {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 12px;
  background: #000;
}

.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 10;
}

.viewer-close {
  color: white !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 50%;
  min-width: 36px;
  height: 36px;

  &:hover {
    background: rgba(0, 0, 0, 0.7) !important;
  }
}

.viewer-caption {
  color: white;
  text-align: center;
  margin: 12px;
}
</style>
