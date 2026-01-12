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

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'importCompleted'): void;
}>();

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
const showResults = ref<boolean>(false);
const selectedStatusFilter = ref<string | null>(null);
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
      showResults.value = true;

      if (subscription) {
        unsubscribe(channel).catch(() => {});
        socketSubscription.value = null;
      }

      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    const subscription = await onMessage(channel, (data: any) => {
      if (data.processed !== undefined && data.total !== undefined) {
        processedCount.value = data.processed;
        totalCount.value = data.total;
      }

      if (data.lastContact) {
        lastContact.value = data.lastContact;
      }

      if (data.completed && data.results) {
        importResults.value = data.results || [];
        showResults.value = true;
        isCompleted.value = true;

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
        } else {
          contactGroupStore.showSnackbar(
            contactGroupStore.i18n.global.t('no_valid_contacts_found'),
            EColor.warning
          );
        }

        emit('importCompleted');
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
  showResults.value = false;
  selectedStatusFilter.value = null;

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

const statusOptions = computed(() => [
  { value: null, title: t('all') },
  { value: 'valid', title: t('valid') },
  { value: 'invalid', title: t('invalid') },
  { value: 'duplicate', title: t('duplicate') },
  { value: 'error', title: t('error') },
  { value: 'no_phone', title: t('no_phone') },
]);

const filteredResults = computed(() => {
  if (!selectedStatusFilter.value) {
    return importResults.value;
  }
  return importResults.value.filter(
    (result) => result.status === selectedStatusFilter.value
  );
});

const statusCounts = computed(() => {
  const counts: Record<string, number> = {
    valid: 0,
    invalid: 0,
    duplicate: 0,
    error: 0,
    no_phone: 0,
  };

  for (const result of importResults.value) {
    if (result.status in counts) {
      counts[result.status]++;
    }
  }

  return counts;
});

const formatPhoneComplete = (
  phoneComplete: string | null | undefined
): string => {
  if (!phoneComplete) return '';
  return formatPhone(phoneComplete);
};

const statusChipsFirstRow = computed(() => {
  const statusOrder = ['valid', 'invalid', 'duplicate', 'error', 'no_phone'];
  return statusOrder.slice(0, 3);
});

const statusChipsSecondRow = computed(() => {
  const statusOrder = ['valid', 'invalid', 'duplicate', 'error', 'no_phone'];
  return statusOrder.slice(3, 5);
});

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
  <VDialog v-model="isVisible" max-width="1200" scrollable>
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddContact" @submit.prevent>
      <VCard :title="$t('import_contacts')">
        <VOverlay
          :model-value="contactGroupStore.loading && !isCompleted"
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

        <VCardText v-if="!isCompleted">
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

        <VCardText v-if="isCompleted && !showResults" class="text-center">
          <VAlert type="success" variant="tonal" class="mb-4">
            {{ $t('import_completed') }}
          </VAlert>
          <VBtn color="primary" @click="showResults = true">
            {{ $t('view_results') }}
          </VBtn>
        </VCardText>

        <VCardText v-if="showResults && isCompleted">
          <VCard variant="outlined">
            <VCardTitle class="d-flex align-center justify-space-between mb-4">
              <span class="text-body-1">{{ $t('import_results') }}</span>
              <VBtn
                icon
                variant="text"
                size="small"
                @click="showResults = false"
              >
                <VIcon icon="tabler-x" />
              </VBtn>
            </VCardTitle>

            <VCardText>
              <VRow class="mb-4" v-if="importResults.length > 0">
                <VCol cols="12" md="6" class="d-flex">
                  <VCard
                    variant="outlined"
                    class="pa-4 w-100 d-flex flex-column"
                  >
                    <VLabel class="text-body-2 mb-2 d-block"
                      >{{ $t('filter_by_status') }}:</VLabel
                    >
                    <AppSelectSearch
                      v-model="selectedStatusFilter"
                      :items="statusOptions"
                      :placeholder="$t('all')"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                    />
                  </VCard>
                </VCol>
                <VCol cols="12" md="6" class="d-flex">
                  <VCard
                    variant="outlined"
                    class="pa-4 w-100 d-flex flex-column"
                  >
                    <VLabel class="text-body-2 mb-2 d-block"
                      >{{ $t('status') }}:</VLabel
                    >
                    <div class="d-flex flex-column gap-2 flex-grow-1">
                      <div class="d-flex flex-wrap gap-2">
                        <VChip
                          v-for="status in statusChipsFirstRow"
                          :key="status"
                          :color="
                            getStatusColor(
                              status as ContactImportStatus['status']
                            )
                          "
                          size="small"
                          variant="tonal"
                        >
                          {{
                            getStatusText(
                              status as ContactImportStatus['status']
                            )
                          }}: {{ statusCounts[status] }}
                        </VChip>
                      </div>
                      <div class="d-flex flex-wrap gap-2">
                        <VChip
                          v-for="status in statusChipsSecondRow"
                          :key="status"
                          :color="
                            getStatusColor(
                              status as ContactImportStatus['status']
                            )
                          "
                          size="small"
                          variant="tonal"
                        >
                          {{
                            getStatusText(
                              status as ContactImportStatus['status']
                            )
                          }}: {{ statusCounts[status] }}
                        </VChip>
                      </div>
                    </div>
                  </VCard>
                </VCol>
              </VRow>

              <VTable density="compact" v-if="importResults.length > 0">
                <thead>
                  <tr>
                    <th class="text-left">{{ $t('phone') }}</th>
                    <th class="text-left">{{ $t('name') }}</th>
                    <th class="text-left">{{ $t('status') }}</th>
                    <th class="text-left">{{ $t('message') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(result, index) in filteredResults" :key="index">
                    <td>
                      <div class="font-weight-medium">
                        {{ formatPhoneComplete(result.phone_complete) }}
                      </div>
                    </td>
                    <td>
                      <div v-if="result.name || result.last_name">
                        {{ result.name ?? '' }} {{ result.last_name ?? '' }}
                      </div>
                      <span v-else class="text-medium-emphasis">-</span>
                    </td>
                    <td>
                      <VChip
                        :color="getStatusColor(result.status)"
                        size="small"
                        variant="tonal"
                      >
                        {{ getStatusText(result.status) }}
                      </VChip>
                    </td>
                    <td>
                      <span
                        v-if="result.message"
                        class="text-body-2"
                        :class="
                          result.status === 'valid'
                            ? 'text-success'
                            : 'text-error'
                        "
                      >
                        {{ result.message }}
                      </span>
                      <span v-else class="text-medium-emphasis">-</span>
                    </td>
                  </tr>
                  <tr
                    v-if="
                      filteredResults.length === 0 && importResults.length > 0
                    "
                  >
                    <td
                      colspan="4"
                      class="text-center text-medium-emphasis py-4"
                    >
                      {{ $t('no_results_found') }}
                    </td>
                  </tr>
                </tbody>
              </VTable>
              <VAlert v-else type="info" variant="tonal" class="mt-4">
                {{ $t('no_results_found') }}
              </VAlert>
            </VCardText>
          </VCard>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            variant="tonal"
            color="secondary"
            @click="isVisible = false"
            :disabled="contactGroupStore.loading && !isCompleted"
          >
            {{ $t('close') }}
          </VBtn>
          <VBtn
            v-if="contactFile && importResults.length === 0 && !isCompleted"
            @click="addContactGroupAssignment"
            :loading="contactGroupStore.loading"
            :disabled="contactGroupStore.loading"
          >
            {{ $t('save') }}
          </VBtn>
          <VBtn
            v-if="isCompleted && !showResults && importResults.length > 0"
            color="primary"
            @click="showResults = true"
          >
            {{ $t('view_results') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
