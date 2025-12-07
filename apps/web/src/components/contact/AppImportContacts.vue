<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { VForm } from 'vuetify/components/VForm';
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { ContactImportStatus } from '@core/schema/contactGroup/createContactGroupAssignment/response.schema';

const contactStore = useContactStore();
const contactGroupStore = useContactGroupStore();

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

const addContactGroupAssignment = async () => {
  const validateForm = await refFormAddContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactFile.value) {
    return;
  }

  const form = new FormData();
  form.append('contact_group_id', contact_group_id.value ?? '');
  form.append('contacts', contactFile.value);

  const result = await contactGroupStore.addContactGroupAssignment(form as any);

  if (result && result.length > 0) {
    importResults.value = result;

    const hasValidContacts = result.some((r) => r.status === 'valid');

    if (hasValidContacts) {
      await contactStore.listContact();
    }

    const allValid = result.every((r) => r.status === 'valid');
    if (allValid) {
      isVisible.value = false;
    }
  } else if (result === null) {
    importResults.value = [];
  }
};

const resetForm = () => {
  contact_group_id.value = null;
  contactFile.value = null;
  importResults.value = [];
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
  if (visible) resetForm();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddContact" @submit.prevent>
      <VCard :title="$t('import_contacts')">
        <VOverlay
          :model-value="contactGroupStore.loading"
          class="align-center justify-center"
          contained
          persistent
        >
          <VCard
            class="text-center pa-6"
            elevation="4"
            style="min-width: 280px"
          >
            <VProgressCircular
              color="primary"
              indeterminate
              size="64"
              class="ma-auto"
            />
            <div class="text-body-1 mt-4 text-high-emphasis">
              {{ $t('processing_import') }}
            </div>
            <div class="text-caption text-medium-emphasis mt-2">
              {{ $t('please_wait') }}
            </div>
          </VCard>
        </VOverlay>

        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppSelect
                v-model="contact_group_id"
                :items="itemsGroup"
                item-title="title"
                item-value="value"
                :label="$t('contact_groups') + ':'"
                :placeholder="$t('contact_groups')"
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
