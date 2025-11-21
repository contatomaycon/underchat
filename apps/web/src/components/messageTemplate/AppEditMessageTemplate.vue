<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { EditMessageTemplateParamsRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  messageTemplateId: string | null;
}>();

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const allowedExts = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'pdf',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'opus',
]);
const allowedMimes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/opus',
  'audio/mp4',
]);

function getExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

function isAllowedFile(file: File) {
  const extOk = allowedExts.has(getExt(file.name));
  const mimeOk = file.type ? allowedMimes.has(file.type) : false;
  return extOk || mimeOk;
}

const onFileChange = (files: File[] | File | null) => {
  const file = Array.isArray(files) ? (files?.[0] ?? null) : files;

  if (!file) {
    attachment_url.value = null;
    hasNewFile.value = false;
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_file_message'));
    attachment_url.value = null;
    hasNewFile.value = false;
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn(t('file_too_large'));
    attachment_url.value = null;
    hasNewFile.value = false;
    return;
  }

  attachment_url.value = file;
  hasNewFile.value = true;
};

function fileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname;

    const last =
      path.split('/').findLast((segment) => segment.length > 0) ?? '';

    return decodeURIComponent(last);
  } catch {
    const last =
      url.split('/').findLast((segment) => segment.length > 0) ?? url;

    return decodeURIComponent(last);
  }
}

const messageTemplateId = toRef(props, 'messageTemplateId');
const message = ref<string | null>(null);
const message_status_id = ref<string | null>(null);
const command = ref<string | null>(null);
const attachment_url = ref<File | string | null>(null);
const existingAttachmentUrl = ref<string | null>(null);
const hasNewFile = ref(false);

const refFormEditMessageTemplate = ref<VForm>();

const updateMessageTemplate = async () => {
  const validateForm = await refFormEditMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!messageTemplateId.value || !message_status_id.value) {
    return;
  }

  const payload: EditMessageTemplateParamsRequest = {
    message_template_id: messageTemplateId.value,
  };

  const form = new FormData();
  form.append('message', message.value ?? '');
  form.append('command', command.value ?? '');
  form.append('message_status_id', message_status_id.value ?? '');
  if (attachment_url.value && hasNewFile.value) {
    form.append('attachment_url', attachment_url.value);
  }

  const result = await messageTemplateStore.updateMessageTemplate(
    payload,
    form as any
  );

  if (result) {
    isVisible.value = false;

    await messageTemplateStore.listMessageTemplate();
  }
};

const noSlashRule = (value: string) => {
  if (!value) return true;

  if (/[\\/]/.test(value)) {
    return t('command_no_slash');
  }

  if (value.trim() === '.') {
    return t('command_only_dot_not_allowed');
  }

  return true;
};

onMounted(async () => {
  if (!messageTemplateId.value) return;

  const messageTemplate = await messageTemplateStore.getMessageTemplateById(
    messageTemplateId.value
  );
  if (messageTemplate) {
    message.value = messageTemplate.message;
    command.value = messageTemplate.command;
    message_status_id.value =
      messageTemplate.message_status?.message_status_id ?? null;
    existingAttachmentUrl.value = messageTemplate?.attachment_url ?? null;

    attachment_url.value = null;
    hasNewFile.value = false;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="messageTemplateStore.loading">
      <VOverlay
        :model-value="messageTemplateStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditMessageTemplate" @submit.prevent>
      <VCard :title="$t('edit_message_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <label class="text-body-2 mb-1" for="message-textarea">
                {{ $t('message') }}:
              </label>
              <VTextarea
                v-model="message"
                :placeholder="$t('message')"
                :rules="[requiredValidator(message, $t('message_required'))]"
              />
            </VCol>
            <VCol cols="12">
              <AppTextField
                v-model="command"
                :label="$t('command') + ':'"
                :placeholder="$t('command')"
                :rules="[
                  requiredValidator(command, $t('command_required')),
                  noSlashRule,
                ]"
              />
            </VCol>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('file') + ':' }}</VLabel>
              <VFileInput
                variant="outlined"
                density="comfortable"
                :placeholder="$t('select_file')"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,image/jpeg,image/png,image/gif,image/webp,application/pdf,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/aac,audio/flac,audio/opus,audio/mp4"
                show-size
                :chips="!!attachment_url"
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
              <div v-if="existingAttachmentUrl && !hasNewFile" class="mt-2">
                <VChip
                  size="small"
                  variant="tonal"
                  color="primary"
                  class="cursor-default"
                >
                  <VIcon start icon="tabler-paperclip" class="mr-1" />
                  {{ fileNameFromUrl(existingAttachmentUrl) }}
                </VChip>
              </div>
              <small class="text-caption text-medium-emphasis mt-1 d-block">
                {{ $t('msg_image_pdf_or_audio') }}
              </small>
            </VCol>
            <VCol cols="12" md="6">
              <AppSelect
                v-model="message_status_id"
                :items="itemsStatus"
                item-title="text"
                item-value="value"
                :label="$t('message_status') + ':'"
                :placeholder="$t('message_status')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateMessageTemplate"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
