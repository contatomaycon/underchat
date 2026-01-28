<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { ListMessageResult } from '@core/schema/chat/listMessageChats/response.schema';
import { useI18n } from 'vue-i18n';

const chatStore = useChatStore();
const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);

const replying = computed(() => chatStore.messageReply);

const isClient = (m: ListMessageResult | null) =>
  !!m && m.type_user === ETypeUserChat.client;

const replyName = computed(() => {
  const m = replying.value;
  if (!m) {
    return '';
  }
  if (isClient(m)) {
    return chatStore.activeChat?.name || '';
  }

  return m.user?.name || chatStore.user?.info.name || '';
});

const replyIsImage = computed(
  () => replying.value?.content?.type === EMessageType.image
);

const replyIsDocument = computed(
  () => replying.value?.content?.type === EMessageType.document
);

const replyIsVideo = computed(
  () =>
    replying.value?.content?.type === EMessageType.video ||
    replying.value?.content?.type === EMessageType.video_note
);

const replyIsAudio = computed(
  () => replying.value?.content?.type === EMessageType.audio
);

const replyIsSticker = computed(
  () => replying.value?.content?.type === EMessageType.sticker
);

const replyIsLocation = computed(
  () => replying.value?.content?.type === EMessageType.location
);

const replyIsContact = computed(() => {
  const type = replying.value?.content?.type;
  return type === EMessageType.contact_card || type === EMessageType.contacts;
});

const replyIsContactGroup = computed(
  () => replying.value?.content?.type === EMessageType.contacts
);

const replyImageSrc = computed(() => {
  const img = replying.value?.content?.image;
  if (!img) {
    return null;
  }

  return img.url || img.thumbnail || null;
});

const replyStickerSrc = computed(() => {
  const sticker = replying.value?.content?.sticker;
  if (!sticker) {
    return null;
  }

  return sticker.url || null;
});

const replyContactPhoto = computed(() => {
  if (
    replying.value?.content?.type === EMessageType.contact_card &&
    replying.value.content.contact
  ) {
    return replying.value.content.contact.photo || null;
  }
  return null;
});

const replyText = computed(() => {
  const m = replying.value;
  if (!m) {
    return '';
  }

  if (m.content?.type === EMessageType.image) {
    return m.content.image?.caption || t('photo_label');
  }

  if (m.content?.type === EMessageType.document) {
    return m.content.document?.name || t('document_label');
  }

  if (m.content?.type === EMessageType.video) {
    return m.content.video?.caption || t('video_label');
  }

  if (m.content?.type === EMessageType.video_note) {
    return m.content.video?.caption || t('video_note_label');
  }

  if (m.content?.type === EMessageType.audio) {
    return t('audio_label');
  }

  if (m.content?.type === EMessageType.sticker) {
    return t('sticker_label', 'Sticker');
  }

  if (m.content?.type === EMessageType.location) {
    return (
      m.content.location?.name ||
      m.content.location?.address ||
      t('location_label', 'Localização')
    );
  }

  if (m.content?.type === EMessageType.contact_card && m.content.contact) {
    const contactName = m.content.contact.name || t('contact_label', 'Contato');
    if (m.content.message) {
      return `${contactName} - ${m.content.message}`;
    }
    return contactName;
  }

  if (
    m.content?.type === EMessageType.contacts &&
    m.content.contacts &&
    m.content.contacts.length > 0
  ) {
    const firstContact = m.content.contacts[0];
    let groupName = '';
    if (m.content.contacts.length === 1) {
      groupName = firstContact.name || t('contact_label', 'Contato');
    } else {
      groupName = `${firstContact.name}${
        m.content.contacts.length > 1
          ? ` e ${m.content.contacts.length - 1}`
          : ''
      }${m.content.contacts.length > 1 ? ' outro contato' : ''}`;
    }
    if (m.content.message) {
      return `${groupName} - ${m.content.message}`;
    }
    return groupName;
  }

  if (m.content?.message) {
    return m.content.message;
  }

  if (m.content?.link_preview?.['matched-text']) {
    return m.content.link_preview['matched-text'];
  }

  if (m.content?.link_preview?.['canonical-url']) {
    return m.content.link_preview['canonical-url'];
  }

  return '';
});

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

const replyDocumentIcon = computed(() => {
  const ext = replying.value?.content?.document?.extension?.toLowerCase();
  if (ext && documentIconMap[ext]) {
    return documentIconMap[ext];
  }
  const mimetype = replying.value?.content?.document?.mimetype ?? '';
  if (mimetype.includes('pdf')) return 'tabler-file-type-pdf';
  if (mimetype.includes('word')) return 'tabler-file-type-doc';
  if (mimetype.includes('sheet') || mimetype.includes('excel'))
    return 'tabler-file-type-xls';
  if (mimetype.includes('presentation')) return 'tabler-file-type-ppt';
  if (mimetype.includes('zip') || mimetype.includes('compressed'))
    return 'tabler-file-type-zip';
  return 'tabler-file-description';
});

const formatFileSize = (bytes?: number | null): string => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const replyDocumentMeta = computed(() => {
  const doc = replying.value?.content?.document;
  if (!doc) return '';
  const items: string[] = [];
  const ext = doc.extension?.toUpperCase();
  if (ext) items.push(ext);
  const sizeText = formatFileSize(doc.size ?? undefined);
  if (sizeText) items.push(sizeText);
  return items.join(' • ');
});

const formatDuration = (seconds?: number | null): string => {
  if (!seconds || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
};

const replyVideoMeta = computed(() => {
  const video = replying.value?.content?.video;
  if (!video) return '';
  const items: string[] = [];
  const ext = video.extension?.toUpperCase();
  if (ext) items.push(ext);
  const sizeText = formatFileSize(video.size ?? undefined);
  if (sizeText) items.push(sizeText);
  return items.join(' • ');
});

const replyAudioMeta = computed(() => {
  const audio = replying.value?.content?.audio;
  if (!audio) return '';
  const items: string[] = [];
  const sizeText = formatFileSize(audio.size ?? undefined);
  if (sizeText) items.push(sizeText);
  const durationText = formatDuration(audio.duration ?? null);
  if (durationText) items.push(durationText);
  return items.join(' • ');
});

onMounted(() => {
  (globalThis as Window & typeof globalThis).addEventListener(
    'focus-composer',
    () => {
      inputRef.value?.focus();
    }
  );
});
</script>

<template>
  <div v-if="replying" class="reply-preview">
    <div v-if="replyIsImage && replyImageSrc" class="rp-media">
      <img :src="replyImageSrc" alt="preview" />
    </div>
    <div v-if="replyIsSticker && replyStickerSrc" class="rp-media">
      <img :src="replyStickerSrc" alt="sticker preview" />
    </div>
    <div v-if="replyIsLocation" class="rp-doc-icon rp-location-icon">
      <VIcon size="26" color="primary">tabler-map-pin</VIcon>
    </div>
    <div v-if="replyIsContact" class="rp-doc-icon rp-contact-icon">
      <VAvatar v-if="replyContactPhoto" size="26" class="rp-contact-avatar">
        <VImg :src="replyContactPhoto" :alt="replyText" />
      </VAvatar>
      <VIcon
        v-else
        size="26"
        color="primary"
        :icon="replyIsContactGroup ? 'tabler-users' : 'tabler-user'"
      ></VIcon>
    </div>
    <div
      v-if="
        !replyIsImage &&
        !replyIsSticker &&
        !replyIsLocation &&
        !replyIsContact &&
        replyIsDocument
      "
      class="rp-doc-icon"
    >
      <VIcon :icon="replyDocumentIcon" size="26" color="primary" />
    </div>
    <div
      v-if="
        !replyIsImage &&
        !replyIsSticker &&
        !replyIsLocation &&
        !replyIsContact &&
        !replyIsDocument &&
        replyIsVideo
      "
      class="rp-doc-icon rp-video-icon"
    >
      <VIcon size="26" color="primary">tabler-player-play</VIcon>
    </div>
    <div
      v-if="
        !replyIsImage &&
        !replyIsSticker &&
        !replyIsLocation &&
        !replyIsContact &&
        !replyIsDocument &&
        !replyIsVideo &&
        replyIsAudio
      "
      class="rp-doc-icon rp-audio-icon"
    >
      <VIcon size="26" color="primary">tabler-microphone</VIcon>
    </div>
    <div class="rp-content">
      <div class="rp-name">{{ replyName }}</div>
      <div class="rp-text">{{ replyText }}</div>
      <div v-if="replyIsDocument && replyDocumentMeta" class="rp-meta">
        {{ replyDocumentMeta }}
      </div>
      <div v-if="replyIsVideo && replyVideoMeta" class="rp-meta">
        {{ replyVideoMeta }}
      </div>
      <div v-if="replyIsAudio && replyAudioMeta" class="rp-meta">
        {{ replyAudioMeta }}
      </div>
    </div>
    <VBtn
      class="rp-close"
      icon
      size="22"
      density="comfortable"
      variant="text"
      @click="chatStore.clearMessageReply()"
    >
      <VIcon size="18">tabler-x</VIcon>
    </VBtn>
  </div>
</template>

<style lang="scss">
.reply-preview {
  position: relative;
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
  padding: 10px 36px 10px 12px;
  margin-bottom: 8px;
  border-inline-start: 3px solid rgb(var(--v-theme-primary));
  display: flex;
  align-items: center;
  gap: 10px;
}
.rp-media {
  inline-size: 40px;
  block-size: 40px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;

  img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    display: block;
  }
}
.rp-doc-icon {
  inline-size: 40px;
  block-size: 40px;
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .rp-contact-avatar {
    width: 100%;
    height: 100%;
  }
}
.rp-content {
  flex: 1;
  min-inline-size: 0;
}
.rp-name {
  font-size: 14px;
  line-height: 1.1;
  margin-bottom: 4px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
.rp-text {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rp-meta {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  margin-top: 2px;
}
.rp-close {
  position: absolute;
  top: 6px;
  right: 6px;
}
</style>
