<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { EMessageType } from '@core/common/enums/EMessageType';
import { useI18n } from 'vue-i18n';

interface MessageData {
  messageType:
    | EMessageType.text
    | EMessageType.image
    | EMessageType.audio
    | EMessageType.video
    | null;
  text: string;
  attachmentFile: File | null;
  continueType: 'automatic' | 'after_response' | null;
  onRemove?: () => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();

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

const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

const getInitialData = (): MessageData => {
  const data = props.data as MessageData | undefined;
  return {
    messageType: data?.messageType || null,
    text: data?.text || '',
    attachmentFile: data?.attachmentFile || null,
    continueType: data?.continueType || null,
  };
};

const messageData = ref<MessageData>(getInitialData());
const fileInputRef = ref<HTMLInputElement | null>(null);
const filePreview = ref<string | null>(null);
const fileSizeError = ref<string | null>(null);

const messageTypeOptions = computed(() => [
  {
    value: EMessageType.text,
    title: 'Texto',
  },
  {
    value: EMessageType.image,
    title: 'Imagem',
  },
  {
    value: EMessageType.audio,
    title: 'Áudio',
  },
  {
    value: EMessageType.video,
    title: 'Vídeo',
  },
]);

const continueOptions = computed(() => [
  {
    value: 'automatic',
    title: 'Automaticamente',
  },
  {
    value: 'after_response',
    title: 'Após resposta',
  },
]);

const maxTextLength = computed(() => {
  return messageData.value.messageType === EMessageType.text ? 2000 : 500;
});

const textLength = computed(() => messageData.value.text.length);

const acceptedFileTypes = computed(() => {
  if (messageData.value.messageType === EMessageType.image) {
    return `${ACCEPTED_IMAGE_MIME_TYPES.join(',')},${ACCEPTED_IMAGE_EXTENSIONS.join(',')}`;
  }
  if (messageData.value.messageType === EMessageType.video) {
    return `${ACCEPTED_VIDEO_MIME_TYPES.join(',')},${ACCEPTED_VIDEO_EXTENSIONS.join(',')}`;
  }
  if (messageData.value.messageType === EMessageType.audio) {
    return `${ACCEPTED_AUDIO_MIME_TYPES.join(',')},${ACCEPTED_AUDIO_EXTENSIONS.join(',')}`;
  }
  return '';
});

const showAttachment = computed(() => {
  return (
    messageData.value.messageType === EMessageType.image ||
    messageData.value.messageType === EMessageType.audio ||
    messageData.value.messageType === EMessageType.video
  );
});

const showTextarea = computed(() => {
  return messageData.value.messageType !== null;
});

const updateNodeData = () => {
  if (props.data) {
    const data = props.data as MessageData;
    data.messageType = messageData.value.messageType;
    data.text = messageData.value.text;
    data.attachmentFile = messageData.value.attachmentFile;
    data.continueType = messageData.value.continueType;
  }
};

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File): boolean {
  const ext = getExt(file.name);
  if (messageData.value.messageType === EMessageType.image) {
    return (
      ACCEPTED_IMAGE_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_IMAGE_MIME_TYPES.includes(file.type)
    );
  }
  if (messageData.value.messageType === EMessageType.video) {
    return (
      ACCEPTED_VIDEO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_VIDEO_MIME_TYPES.includes(file.type)
    );
  }
  if (messageData.value.messageType === EMessageType.audio) {
    return (
      ACCEPTED_AUDIO_EXTENSIONS.includes(`.${ext}`) ||
      ACCEPTED_AUDIO_MIME_TYPES.includes(file.type)
    );
  }
  return false;
}

const onFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  fileSizeError.value = null;

  if (!files || files.length === 0) {
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  const file = files[0];

  if (!isAllowedFile(file)) {
    fileSizeError.value = 'Formato de arquivo não permitido';
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    fileSizeError.value = 'Arquivo muito grande. Tamanho máximo: 16MB';
    messageData.value.attachmentFile = null;
    filePreview.value = null;
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
    return;
  }

  messageData.value.attachmentFile = file;
  filePreview.value = URL.createObjectURL(file);
  updateNodeData();
};

const removeFile = () => {
  if (filePreview.value) {
    URL.revokeObjectURL(filePreview.value);
  }
  messageData.value.attachmentFile = null;
  filePreview.value = null;
  fileSizeError.value = null;
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
  updateNodeData();
};

const handleRemove = () => {
  const data = props.data as MessageData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => messageData.value.messageType,
  (newType) => {
    if (newType === EMessageType.text) {
      removeFile();
    }
    updateNodeData();
  }
);

watch(
  () => messageData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-message-node">
    <Handle type="target" :position="Position.Top" />
    <Handle type="source" :position="Position.Bottom" />

    <VCard class="message-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-message" color="success" size="20" />
          <span class="text-sm font-weight-medium">Mensagem</span>
        </div>
        <VIcon
          v-if="(props.data as MessageData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <VSelect
          v-model="messageData.messageType"
          :items="messageTypeOptions"
          label="Tipo de Mensagem"
          variant="outlined"
          density="compact"
          class="mb-3"
          hide-details
        />

        <div v-if="showAttachment" class="mb-3">
          <VLabel class="mb-1 text-body-2">Anexar Arquivo</VLabel>
          <input
            ref="fileInputRef"
            type="file"
            :accept="acceptedFileTypes"
            style="display: none"
            @change="onFileChange"
          />
          <div v-if="!filePreview" class="d-flex align-center ga-2">
            <VBtn
              variant="outlined"
              color="primary"
              size="small"
              @click="fileInputRef?.click()"
            >
              <VIcon icon="tabler-paperclip" size="18" class="me-1" />
              Anexar
            </VBtn>
          </div>
          <div v-else class="d-flex align-center ga-2">
            <span class="text-body-2 text-truncate" style="flex: 1">
              {{ messageData.attachmentFile?.name }}
            </span>
            <VBtn
              icon
              size="small"
              variant="text"
              color="error"
              @click="removeFile"
            >
              <VIcon icon="tabler-x" size="18" />
            </VBtn>
          </div>
          <div v-if="fileSizeError" class="text-caption text-error mt-1">
            {{ fileSizeError }}
          </div>
        </div>

        <div v-if="showTextarea" class="mb-3">
          <VTextarea
            v-model="messageData.text"
            :placeholder="
              messageData.messageType === EMessageType.text
                ? 'Digite o texto da mensagem'
                : 'Digite a legenda (opcional)'
            "
            variant="outlined"
            density="compact"
            rows="3"
            :counter="maxTextLength"
            :maxlength="maxTextLength"
            hide-details="auto"
          />
          <div class="d-flex justify-end mt-1">
            <span class="text-caption text-medium-emphasis">
              {{ textLength }}/{{ maxTextLength }}
            </span>
          </div>
        </div>

        <VSelect
          v-model="messageData.continueType"
          :items="continueOptions"
          label="Continuar"
          variant="outlined"
          density="compact"
          hide-details
        />
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-message-node {
  min-width: 350px;
}

.message-card {
  border-radius: 8px;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
