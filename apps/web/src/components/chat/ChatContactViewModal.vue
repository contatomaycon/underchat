<script lang="ts" setup>
import { ref, computed } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const chatStore = useChatStore();

const props = defineProps<{
  modelValue: boolean;
  contact: ViewChatContactResponse | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const viewContactEmail = ref<string | null>(null);
const viewContactEmailPartial = ref<string | null>(null);
const viewContactPhone = ref<string | null>(null);
const viewContactPhonePartial = ref<string | null>(null);
const isViewEmailDecrypted = ref(false);
const isViewPhoneDecrypted = ref(false);
const isLoadingViewEmail = ref(false);
const isLoadingViewPhone = ref(false);

const viewContactEmailFormatted = computed(() => {
  if (isViewEmailDecrypted.value) {
    return viewContactEmail.value ?? '';
  }
  return viewContactEmailPartial.value ?? '';
});

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

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
}

const viewContactPhoneFormatted = computed(() => {
  if (isViewPhoneDecrypted.value && viewContactPhone.value) {
    return formatPhone(viewContactPhone.value);
  }
  return viewContactPhonePartial.value ?? '';
});

const toggleViewEmailVisibility = async () => {
  if (!props.contact?.contact_id) return;

  if (isViewEmailDecrypted.value) {
    viewContactEmail.value = null;
    isViewEmailDecrypted.value = false;
    return;
  }

  isLoadingViewEmail.value = true;
  const decryptedEmail = await chatStore.getChatContactEmailDecrypted(
    props.contact.contact_id
  );
  isLoadingViewEmail.value = false;

  if (decryptedEmail) {
    viewContactEmail.value = decryptedEmail;
    isViewEmailDecrypted.value = true;
  }
};

const toggleViewPhoneVisibility = async () => {
  if (!props.contact?.contact_id) return;

  if (isViewPhoneDecrypted.value) {
    if (viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value = null;
    }
    if (!viewContactPhonePartial.value?.includes('*')) {
      viewContactPhone.value =
        viewContactPhonePartial.value?.replaceAll(/\D/g, '') ?? null;
    }
    isViewPhoneDecrypted.value = false;
    return;
  }

  isLoadingViewPhone.value = true;
  const decryptedPhone = await chatStore.getChatContactPhoneDecrypted(
    props.contact.contact_id
  );
  isLoadingViewPhone.value = false;

  if (decryptedPhone) {
    viewContactPhone.value = decryptedPhone.replaceAll(/\D/g, '');
    isViewPhoneDecrypted.value = true;
  }
};

watch(
  () => props.contact,
  (contact) => {
    if (contact) {
      viewContactEmailPartial.value = contact.email_partial ?? null;
      viewContactEmail.value = null;
      isViewEmailDecrypted.value = false;
      viewContactPhonePartial.value = contact.phone_partial ?? null;
      viewContactPhone.value = null;
      isViewPhoneDecrypted.value = false;
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog
    :model-value="isOpen"
    max-width="600"
    @update:model-value="isOpen = $event"
  >
    <DialogCloseBtn @click="isOpen = false" />

    <VOverlay
      :model-value="chatStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard :title="$t('view_contact')" v-if="contact">
      <VCardText>
        <VRow>
          <VCol cols="12" class="d-flex justify-center mb-4">
            <VAvatar size="120">
              <VImg
                v-if="contact.photo"
                :src="contact.photo"
                :alt="contact.name"
              />
              <VImg
                v-else
                :src="'/images/svg/avatar-default.svg'"
                :alt="contact.name"
              />
            </VAvatar>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="contact.name"
              :label="$t('name') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="contact.last_name || ''"
              :label="$t('last_name') + ':'"
              readonly
            />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="contact.nickname || ''"
              :label="$t('nickname') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="viewContactEmailFormatted"
              type="email"
              :label="$t('email') + ':'"
              readonly
            >
              <template #append-inner>
                <VIcon
                  :icon="isViewEmailDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingViewEmail }"
                  @click="toggleViewEmailVisibility"
                />
              </template>
            </AppTextField>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="contact.phone_ddi || ''"
              :label="$t('phone_ddi') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              :model-value="viewContactPhoneFormatted"
              type="tel"
              :label="$t('phone') + ':'"
              readonly
            >
              <template #append-inner>
                <VIcon
                  :icon="isViewPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingViewPhone }"
                  @click="toggleViewPhoneVisibility"
                />
              </template>
            </AppTextField>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              :model-value="
                contact.birthday
                  ? new Date(contact.birthday + 'T00:00:00').toLocaleDateString(
                      'pt-BR'
                    )
                  : ''
              "
              :label="$t('birthday') + ':'"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <span class="text-body-2 mb-1 d-inline-block">
              {{ $t('label') + ':' }}
            </span>
            <div v-if="contact.label_template" class="d-flex align-center mt-1">
              <div
                class="label-color-circle"
                :style="{
                  backgroundColor: contact.label_template.color,
                }"
              />
              <span
                class="ms-2 text-body-2 text-medium-emphasis"
                :title="contact.label_template.label"
              >
                {{
                  contact.label_template.label.length > 15
                    ? `${contact.label_template.label.slice(0, 15)}…`
                    : contact.label_template.label
                }}
              </span>
            </div>
            <div v-else class="text-body-2 text-medium-emphasis mt-1">-</div>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12">
            <label class="text-body-2 mb-1" for="notes-textarea">
              {{ $t('notes') }}:
            </label>
            <VTextarea :model-value="contact.notes || ''" readonly />
          </VCol>
        </VRow>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn variant="tonal" color="secondary" @click="isOpen = false">
          {{ $t('close') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.label-color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
