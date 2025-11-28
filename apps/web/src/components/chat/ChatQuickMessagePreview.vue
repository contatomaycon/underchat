<script lang="ts" setup>
import { computed, ref, onUnmounted } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { formatDate } from '@/@webcore/utils/formatters';
import { EMessageType } from '@core/common/enums/EMessageType';
import type { ListQuickMessageTemplatesResponse } from '@core/schema/chat/listQuickMessageTemplates/response.schema';

const props = defineProps<{
  template: ListQuickMessageTemplatesResponse;
}>();

const emit = defineEmits<{
  send: [];
}>();

const chatStore = useChatStore();

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
  viewerCaption.value = props.template.message || '';
  viewerOpen.value = true;
};

const openVideo = () => {
  if (!props.template.attachment_url) return;
  viewerKind.value = 'video';
  viewerSrc.value = props.template.attachment_url;
  viewerCaption.value = props.template.message || '';
  viewerOpen.value = true;
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

const formatWhatsAppText = (text: string): string => {
  if (!text) return '';

  const escapeHtml = (str: string) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  let formatted = escapeHtml(text);

  formatted = formatted.replaceAll(/`([^`]+?)`/g, '<code>$1</code>');
  formatted = formatted.replaceAll(/~([^~]+?)~/g, '<s>$1</s>');
  formatted = formatted.replaceAll(/(?<!_)_([^_\n]+?)_(?!_)/g, '<em>$1</em>');
  formatted = formatted.replaceAll(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    '<strong>$1</strong>'
  );

  return formatted;
};

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
</script>

<template>
  <div
    class="chat-group d-flex align-start position-relative mb-6"
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
            <div v-if="template.type === 'text' && template.message">
              <p
                class="mr-6 text-base message-text mb-2"
                :style="{
                  color: 'rgb(var(--v-theme-on-surface))',
                }"
                v-html="formatWhatsAppText(template.message)"
              ></p>
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
                v-if="template.message"
                class="image-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-on-surface))',
                }"
              >
                <span v-html="formatWhatsAppText(template.message)"></span>
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
                v-if="template.message"
                class="video-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-on-surface))',
                }"
              >
                <span v-html="formatWhatsAppText(template.message)"></span>
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
                    {{ isAudioPlaying ? 'tabler-player-pause' : 'tabler-player-play' }}
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
                v-if="template.message"
                class="audio-caption mt-2"
                :style="{
                  color: 'rgb(var(--v-theme-on-surface))',
                }"
              >
                <span v-html="formatWhatsAppText(template.message)"></span>
              </p>
            </div>
          </div>

          <div class="message-meta">
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
  padding-bottom: 1.4rem !important;

  p {
    overflow-wrap: anywhere;
  }

  &.chat-right {
    border-start-start-radius: 6px;
    .message-meta {
      color: rgba(17, 27, 33, 0.6);
    }
  }

  .message-block {
    position: relative;
  }

  .message-text {
    white-space: pre-line;
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

  .message-meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6px;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    justify-content: flex-end;
    padding-inline: 16px 12px;
    font-size: 0.75rem;

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
