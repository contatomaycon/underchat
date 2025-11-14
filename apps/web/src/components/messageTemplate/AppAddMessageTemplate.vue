<script lang="ts" setup>
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { VForm } from 'vuetify/components/VForm';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

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
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn('Arquivo inválido. Envie imagem, PDF ou áudio');
    attachment_url.value = null;
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn('Arquivo muito grande (máx 10MB).');
    attachment_url.value = null;
    return;
  }

  attachment_url.value = file;
};

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const message = ref<string | null>(null);
const command = ref<string | null>(null);
const message_status_id = ref<string | null>(null);
const attachment_url = ref<File | null>(null);

const refFormAddMessageTemplate = ref<VForm>();

const addMessageTemplate = async () => {
  const validateForm = await refFormAddMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!message.value || !message_status_id.value || !command.value) {
    return;
  }

  const form = new FormData();
  form.append('message', message.value ?? '');
  form.append('command', command.value ?? '');
  form.append('message_status_id', message_status_id.value ?? '');
  if (attachment_url.value) {
    form.append('attachment_url', attachment_url.value);
  }

  const result = await messageTemplateStore.addMessageTemplate(form as any);

  if (result) {
    isVisible.value = false;

    await messageTemplateStore.listMessageTemplate();
  }
};

const noSlashRule = (value: string) => {
  if (!value) return true;

  if (/[\\/]/.test(value)) {
    return String.raw`Não é permitido usar / ou \ no comando.`;
  }

  if (value.trim() === '.') {
    return 'O comando não pode ser apenas um ponto.';
  }

  return true;
};

const resetForm = () => {
  message.value = null;
  message_status_id.value = null;
  command.value = null;
  attachment_url.value = null;
  refFormAddMessageTemplate.value?.resetValidation();
};

onMounted(async () => {
  resetForm();
});

watch(isVisible, (visible) => {
  if (visible) resetForm();
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

    <VForm ref="refFormAddMessageTemplate" @submit.prevent>
      <VCard :title="$t('add_message_template')">
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
                :label="$t('shortcut') + ':'"
                :placeholder="$t('shortcut')"
                :rules="[
                  requiredValidator(command, $t('shortcut_required')),
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
                :rules="[
                  requiredValidator(
                    message_status_id,
                    $t('message_status_id_required')
                  ),
                ]"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addMessageTemplate"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
