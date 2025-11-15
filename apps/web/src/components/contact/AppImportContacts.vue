<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { VForm } from 'vuetify/components/VForm';
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';

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
    return;
  }

  if (!isAllowedFile(file)) {
    console.warn(t('invalid_contacts_file'));
    contactFile.value = null;
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn(t('file_too_large'));
    contactFile.value = null;
    return;
  }

  contactFile.value = file;
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

  if (result) {
    isVisible.value = false;

    await contactStore.listContact();
  }
};

const resetForm = () => {
  contact_group_id.value = null;
  contactFile.value = null;
  refFormAddContact.value?.resetValidation();
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

    <template v-if="contactStore.loading">
      <VOverlay
        :model-value="contactStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddContact" @submit.prevent>
      <VCard :title="$t('import_contacts')">
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

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addContactGroupAssignment"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
