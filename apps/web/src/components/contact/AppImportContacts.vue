<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { VForm } from 'vuetify/components/VForm';
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { ContactImportStatus } from '@core/schema/contactGroup/createContactGroupAssignment/response.schema';
import {
  onMessage,
  unsubscribe,
  type Subscription,
} from '@/@webcore/centrifugo';
import { useChatStore } from '@/@webcore/stores/chat';
import { EColor } from '@core/common/enums/EColor';

const contactStore = useContactStore();
const contactGroupStore = useContactGroupStore();
const chatStore = useChatStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const itemsGroup = computed(() =>
  (contactGroupStore.listAll ?? []).map((item) => ({
    value: item.contact_group_id,
    title: item.name,
  }))
);

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const contact_group_id = ref<string | null>(null);
const contactFile = ref<File | null>(null);
const importResults = ref<ContactImportStatus[]>([]);
const processedCount = ref<number>(0);
const totalCount = ref<number>(0);
const lastContact = ref<ContactImportStatus | null>(null);
const importSessionId = ref<string | null>(null);
const socketSubscription = ref<Subscription | null>(null);
const isCompleted = ref<boolean>(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const progressPercentage = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((processedCount.value / totalCount.value) * 100);
});

const formatPhone = (phone: string | null | undefined): string => {
  if (!phone) return '';

  const numbers = phone.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
};

const formattedPhone = computed(() => {
  if (!lastContact.value?.phone_complete) return '';
  return formatPhone(lastContact.value.phone_complete);
});

const refFormAddContact = ref<VForm>();

const allowedExts = new Set(['csv', 'vcf', 'vcard']);
const allowedMimes = new Set(['text/csv', 'text/vcard', 'text/x-vcard']);

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
    contactFile.value = null;
    importResults.value = [];
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_contacts_file'));
    contactFile.value = null;
    importResults.value = [];
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn(t('file_too_large'));
    contactFile.value = null;
    importResults.value = [];
    return;
  }

  contactFile.value = file;
  importResults.value = [];
};

const subscribeToImportProgress = async (sessionId: string) => {
  const userId = chatStore.user?.user_id;
  if (!userId) return;

  const channel = `channels:user#${userId}:contact-import:${sessionId}`;

  try {
    const handleCompletion = () => {
      if (isCompleted.value) return;

      isCompleted.value = true;
      contactGroupStore.loading = false;

      if (subscription) {
        unsubscribe(channel).catch(() => {});
        socketSubscription.value = null;
      }

      if (closeTimer) {
        clearTimeout(closeTimer);
      }

      closeTimer = setTimeout(() => {
        isCompleted.value = false;
        isVisible.value = false;
        resetForm();
      }, 2000);
    };

    const subscription = await onMessage(channel, (data: any) => {
      if (data.processed !== undefined && data.total !== undefined) {
        processedCount.value = data.processed;
        totalCount.value = data.total;

        if (data.processed === data.total && data.total > 0) {
          handleCompletion();
        }
      }

      if (data.lastContact) {
        lastContact.value = data.lastContact;
      }

      if (data.completed && data.results) {
        importResults.value = data.results;

        const validCount = data.results.filter(
          (r: ContactImportStatus) => r.status === 'valid'
        ).length;
        const total = data.results.length;

        if (validCount > 0) {
          contactGroupStore.showSnackbar(
            contactGroupStore.i18n.global.t(
              'contact_group_assignment_add_success'
            ) +
              ` (${validCount}/${total} ${contactGroupStore.i18n.global.t('valid')})`,
            EColor.success
          );
          contactStore.listContact();
        } else {
          contactGroupStore.showSnackbar(
            contactGroupStore.i18n.global.t('no_valid_contacts_found'),
            EColor.warning
          );
        }

        handleCompletion();
      }
    });

    socketSubscription.value = subscription;
  } catch (error) {
    console.error('Error subscribing to import progress:', error);
  }
};

const addContactGroupAssignment = async () => {
  const validateForm = await refFormAddContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactFile.value) {
    return;
  }

  processedCount.value = 0;
  totalCount.value = 0;
  lastContact.value = null;
  importResults.value = [];
  isCompleted.value = false;

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  const form = new FormData();
  form.append('contact_group_id', contact_group_id.value ?? '');
  form.append('contacts', contactFile.value);

  const result = await contactGroupStore.addContactGroupAssignment(form as any);

  if (result?.import_session_id) {
    importSessionId.value = result.import_session_id;
    await subscribeToImportProgress(result.import_session_id);
  } else {
    contactGroupStore.loading = false;
    importResults.value = [];
  }
};

const resetForm = () => {
  contact_group_id.value = null;
  contactFile.value = null;
  importResults.value = [];
  processedCount.value = 0;
  totalCount.value = 0;
  lastContact.value = null;
  importSessionId.value = null;
  isCompleted.value = false;

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  if (socketSubscription.value && importSessionId.value) {
    const userId = chatStore.user?.user_id;
    if (userId) {
      const channel = `channels:user#${userId}:contact-import:${importSessionId.value}`;
      unsubscribe(channel).catch(() => {});
    }
    socketSubscription.value = null;
  }

  refFormAddContact.value?.resetValidation();
};

const getStatusColor = (status: ContactImportStatus['status']) => {
  switch (status) {
    case 'valid':
      return 'success';
    case 'invalid':
      return 'error';
    case 'duplicate':
      return 'warning';
    case 'error':
      return 'error';
    case 'no_phone':
      return 'info';
    default:
      return 'default';
  }
};

const getStatusText = (status: ContactImportStatus['status']) => {
  switch (status) {
    case 'valid':
      return t('valid');
    case 'invalid':
      return t('invalid');
    case 'duplicate':
      return t('duplicate');
    case 'error':
      return t('error');
    case 'no_phone':
      return t('no_phone');
    default:
      return status;
  }
};

onMounted(async () => {
  resetForm();
  await contactGroupStore.listContactGroupAll();
});

watch(isVisible, (visible) => {
  if (visible) {
    resetForm();
  }
});

onUnmounted(() => {
  if (socketSubscription.value && importSessionId.value) {
    const userId = chatStore.user?.user_id;
    if (userId) {
      const channel = `channels:user#${userId}:contact-import:${importSessionId.value}`;
      unsubscribe(channel).catch(() => {});
    }
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddContact" @submit.prevent>
      <VCard :title="$t('import_contacts')">
        <VOverlay
          :model-value="contactGroupStore.loading || isCompleted"
          class="align-center justify-center"
          contained
        >
          <VCard
            class="text-center pa-6"
            elevation="4"
            style="min-width: 320px"
          >
            <div class="d-flex align-center justify-center position-relative">
              <VProgressCircular
                :color="isCompleted ? 'success' : 'primary'"
                :model-value="
                  totalCount > 0 || isCompleted
                    ? isCompleted
                      ? 100
                      : progressPercentage
                    : undefined
                "
                :indeterminate="totalCount === 0 && !isCompleted"
                size="80"
                width="6"
              >
                <template v-if="totalCount > 0 || isCompleted">
                  <div class="text-h6 font-weight-bold">
                    {{ isCompleted ? 100 : progressPercentage }}%
                  </div>
                </template>
              </VProgressCircular>
            </div>
            <div
              class="text-body-1 mt-4 text-high-emphasis"
              v-if="!isCompleted"
            >
              {{ $t('processing_import') }}
            </div>
            <div class="text-body-1 mt-4 text-success font-weight-bold" v-else>
              {{ $t('import_completed') }}
            </div>
            <div
              class="text-caption text-medium-emphasis mt-2"
              v-if="lastContact && !isCompleted"
            >
              <div v-if="lastContact.name || lastContact.last_name">
                <strong>{{ $t('last_imported') }}:</strong>
                {{ lastContact.name ?? '' }}
                {{ lastContact.last_name ?? '' }}
              </div>
              <div v-if="formattedPhone">
                {{ formattedPhone }}
              </div>
            </div>
            <div
              class="text-caption text-medium-emphasis mt-2"
              v-else-if="!isCompleted"
            >
              {{ $t('please_wait') }}
            </div>
          </VCard>
        </VOverlay>

        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('contact_groups') }}:</VLabel
              >
              <AppSelectSearch
                v-model="contact_group_id"
                :items="itemsGroup"
                :placeholder="$t('contact_groups')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('file') + ':' }}</VLabel>

              <VFileInput
                variant="outlined"
                density="comfortable"
                :placeholder="$t('select_file')"
                accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard"
                show-size
                :chips="!!contactFile"
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
                {{ $t('msg_csv_or_vcard') }}
              </small>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText v-if="importResults.length > 0">
          <VCard variant="outlined">
            <VCardTitle class="text-body-1">
              {{ $t('import_results') }}
            </VCardTitle>
            <VCardText>
              <VList density="compact">
                <VListItem
                  v-for="(result, index) in importResults"
                  :key="index"
                  :title="result.phone_complete"
                  :subtitle="result.message || ''"
                >
                  <template #prepend>
                    <VChip
                      :color="getStatusColor(result.status)"
                      size="small"
                      class="mr-2"
                    >
                      {{ getStatusText(result.status) }}
                    </VChip>
                  </template>
                </VListItem>
              </VList>
            </VCardText>
          </VCard>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            @click="isVisible = false"
            :disabled="contactGroupStore.loading"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            v-if="contactFile && importResults.length === 0"
            @click="addContactGroupAssignment"
            :loading="contactGroupStore.loading"
            :disabled="contactGroupStore.loading"
          >
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
