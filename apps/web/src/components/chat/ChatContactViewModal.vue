<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useReportConversationHistoryStore } from '@/@webcore/stores/reportConversationHistory';
import { ViewChatContactResponse } from '@core/schema/chat/viewContact/response.schema';
import { ViewReportConversationHistoryContactResponse } from '@core/schema/reportConversationHistory/viewReportConversationHistoryContact/response.schema';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const chatStore = useChatStore();
const reportConversationHistoryStore = useReportConversationHistoryStore();

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    contact:
      | ViewChatContactResponse
      | ViewReportConversationHistoryContactResponse
      | null;
    useReportStore?: boolean;
  }>(),
  {
    useReportStore: false,
  }
);

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
const viewContactDocument = ref<string | null>(null);
const viewContactDocumentPartial = ref<string | null>(null);
const isViewEmailDecrypted = ref(false);
const isViewPhoneDecrypted = ref(false);
const isViewDocumentDecrypted = ref(false);
const isLoadingViewEmail = ref(false);
const isLoadingViewPhone = ref(false);
const isLoadingViewDocument = ref(false);
const contactChannelIds = ref<string[]>([]);
const channelsOptions = ref<
  { channel_id: string; name: string; number: string | null }[]
>([]);
const contactChannelsDisplay = computed(() => {
  if (contactChannelIds.value.length === 0) return [];
  return contactChannelIds.value
    .map((id) => channelsOptions.value.find((c) => c.channel_id === id))
    .filter(Boolean)
    .map((c) => (c!.number ? `${c!.name} (${c!.number})` : c!.name));
});

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

function formatCpfDigits(digits: string): string {
  const clean = digits.replaceAll(/\D/g, '').slice(0, 11);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9) {
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  }
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

function formatCnpjDigits(digits: string): string {
  const clean = digits.replaceAll(/\D/g, '').slice(0, 14);
  if (clean.length <= 2) return clean;
  if (clean.length <= 5) {
    return `${clean.slice(0, 2)}.${clean.slice(2)}`;
  }
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5)}`;
  }
  if (clean.length <= 12) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8)}`;
  }
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
}

const documentFormatted = computed(() => {
  if (!props.contact?.contact_document_type) return '';

  if (isViewDocumentDecrypted.value && viewContactDocument.value) {
    const digits = viewContactDocument.value.replaceAll(/\D/g, '');
    if (props.contact.contact_document_type.name === 'CPF') {
      return formatCpfDigits(digits);
    }
    if (props.contact.contact_document_type.name === 'CNPJ') {
      return formatCnpjDigits(digits);
    }
    return viewContactDocument.value;
  }

  return viewContactDocumentPartial.value ?? '';
});

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
  const decryptedEmail = props.useReportStore
    ? await reportConversationHistoryStore.getReportConversationHistoryContactEmailDecrypted(
        props.contact.contact_id
      )
    : await chatStore.getChatContactEmailDecrypted(props.contact.contact_id);
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
  const decryptedPhone = props.useReportStore
    ? await reportConversationHistoryStore.getReportConversationHistoryContactPhoneDecrypted(
        props.contact.contact_id
      )
    : await chatStore.getChatContactPhoneDecrypted(props.contact.contact_id);
  isLoadingViewPhone.value = false;

  if (decryptedPhone) {
    viewContactPhone.value = decryptedPhone.replaceAll(/\D/g, '');
    isViewPhoneDecrypted.value = true;
  }
};

const toggleViewDocumentVisibility = async () => {
  if (!props.contact?.contact_id) return;

  if (isViewDocumentDecrypted.value) {
    viewContactDocument.value = null;
    isViewDocumentDecrypted.value = false;
    return;
  }

  isLoadingViewDocument.value = true;
  const decryptedDocument = await chatStore.getChatContactDocumentDecrypted(
    props.contact.contact_id
  );
  isLoadingViewDocument.value = false;

  if (decryptedDocument) {
    viewContactDocument.value = decryptedDocument;
    isViewDocumentDecrypted.value = true;
  }
};

const removeLabelTemplate = async (labelTemplateId: string) => {
  if (!props.contact?.contact_id) return;

  if (props.useReportStore) {
    return;
  }

  const result = await chatStore.removeChatContactLabelTemplate(
    props.contact.contact_id,
    labelTemplateId
  );

  if (result && props.contact && props.contact.label_templates) {
    props.contact.label_templates = props.contact.label_templates.filter(
      (label) => label.label_template_id !== labelTemplateId
    );
  }
};

const loadContactChannels = async () => {
  if (!props.contact?.contact_id || props.useReportStore) return;
  const [channelIds, channels] = await Promise.all([
    chatStore.viewContactChannelsByContactId(props.contact.contact_id),
    chatStore.listContactChannels(),
  ]);
  if (channelIds) {
    contactChannelIds.value = channelIds;
  }
  if (channels) {
    channelsOptions.value = channels;
  }
};

watch(
  () => props.contact,
  async (contact) => {
    if (contact) {
      viewContactEmailPartial.value = contact.email_partial ?? null;
      viewContactEmail.value = null;
      isViewEmailDecrypted.value = false;
      viewContactPhonePartial.value = contact.phone_partial ?? null;
      viewContactPhone.value = null;
      isViewPhoneDecrypted.value = false;
      viewContactDocumentPartial.value = contact.document_partial ?? null;
      viewContactDocument.value = null;
      isViewDocumentDecrypted.value = false;
      contactChannelIds.value = [];
      channelsOptions.value = [];
      await loadContactChannels();
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
      :model-value="
        props.useReportStore
          ? reportConversationHistoryStore.loading
          : chatStore.loading
      "
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
            <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
            <AppTextField :model-value="contact.name" readonly />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('last_name') }}:</VLabel>
            <AppTextField :model-value="contact.last_name || ''" readonly />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('nickname') }}:</VLabel>
            <AppTextField :model-value="contact.nickname || ''" readonly />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
            <AppTextField
              :model-value="viewContactEmailFormatted"
              type="email"
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
            <VLabel class="text-body-2 mb-1">{{ $t('phone_ddi') }}:</VLabel>
            <AppTextField :model-value="contact.phone_ddi || ''" readonly />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('phone') }}:</VLabel>
            <AppTextField
              :model-value="viewContactPhoneFormatted"
              type="tel"
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
          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">{{ $t('birthday') }}:</VLabel>
            <AppTextField
              :model-value="
                contact.birthday
                  ? new Date(contact.birthday + 'T00:00:00').toLocaleDateString(
                      'pt-BR'
                    )
                  : ''
              "
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <span class="text-body-2 mb-1 d-inline-block">
              {{ $t('label') + ':' }}
            </span>
            <div
              v-if="
                contact.label_templates && contact.label_templates.length > 0
              "
              class="d-flex flex-wrap align-center gap-2 mt-1"
            >
              <VChip
                v-for="labelTemplate in contact.label_templates"
                :key="labelTemplate.label_template_id"
                :color="labelTemplate.color"
                size="small"
                :closable="!useReportStore"
                @click:close="
                  removeLabelTemplate(labelTemplate.label_template_id)
                "
              >
                {{ labelTemplate.label }}
              </VChip>
            </div>
            <div v-else class="text-body-2 text-medium-emphasis mt-1">-</div>
          </VCol>
          <VCol cols="12" md="6" v-if="!useReportStore">
            <span class="text-body-2 mb-1 d-inline-block">
              {{ $t('channels') + ':' }}
            </span>
            <div
              v-if="contactChannelsDisplay.length > 0"
              class="d-flex flex-wrap align-center gap-2 mt-1"
            >
              <VChip
                v-for="(channelName, idx) in contactChannelsDisplay"
                :key="idx"
                size="small"
              >
                {{ channelName }}
              </VChip>
            </div>
            <div v-else class="text-body-2 text-medium-emphasis mt-1">-</div>
          </VCol>
        </VRow>
        <VRow
          v-if="
            contact.contact_document_type &&
            (contact.document_partial || contact.document)
          "
        >
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('document_type') }}:</VLabel>
            <AppTextField
              :model-value="contact.contact_document_type.name"
              readonly
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{
                contact.contact_document_type.name === 'CPF'
                  ? $t('cpf')
                  : $t('cnpj')
              }}:
            </VLabel>
            <AppTextField :model-value="documentFormatted" readonly>
              <template #append-inner>
                <VIcon
                  :icon="
                    isViewDocumentDecrypted ? 'tabler-eye-off' : 'tabler-eye'
                  "
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingViewDocument }"
                  @click="toggleViewDocumentVisibility"
                />
              </template>
            </AppTextField>
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
  margin-inline-end: 8px;
}
</style>
