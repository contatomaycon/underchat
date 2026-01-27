<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useCountryCodes } from '@/composables/useCountryCodes';

const { t } = useI18n();
const integrationStore = useIntegrationStore();
const { items: countryCodesItems } = useCountryCodes();

const props = defineProps<{
  modelValue: boolean;
  apiKeyId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const webhookMapping = ref<Record<string, string | string[] | null>>({});
const webhookDataKeys = ref<string[]>([]);
const phoneDdiMode = ref<'depara' | 'select'>('select');
const messageMode = ref<'textarea' | 'depara'>('textarea');
const chatbotMessageMode = ref<'textarea' | 'depara'>('depara');
const messageType = ref<'message' | 'chatbot'>('chatbot');
const transferType = ref<'sector' | 'user' | null>(null);
const selectedSector = ref<string | null>(null);
const selectedUser = ref<string | null>(null);
const selectedSectorUser = ref<string | null>(null);
const selectedChatbot = ref<string | null>(null);

const users = ref<
  Array<{
    value: string;
    title: string;
    photo: string | null;
    status: string | null;
  }>
>([]);
const sectors = ref<
  Array<{
    value: string;
    title: string;
    color: string | null;
  }>
>([]);
const sectorUsers = ref<
  Array<{
    value: string;
    title: string;
    photo: string | null;
    status: string | null;
  }>
>([]);
const inputChatbots = ref<
  Array<{
    value: string;
    title: string;
  }>
>([]);

const isLoadingUsers = ref(false);
const isLoadingSectors = ref(false);
const isLoadingSectorUsers = ref(false);
const isLoadingChatbots = ref(false);

const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ name }}',
    description: t('tag_name_description'),
  },
  {
    tag: '{{ protocol }}',
    description: t('tag_protocol_description'),
  },
  {
    tag: '{{ date }}',
    description: t('tag_date_description'),
  },
  {
    tag: '{{ time }}',
    description: t('tag_time_description'),
  },
  {
    tag: '{{ account_name }}',
    description: t('tag_account_name_description'),
  },
  {
    tag: '{{ phone }}',
    description: t('tag_phone_description'),
  },
  {
    tag: '{{ channel_name }}',
    description: t('tag_channel_name_description'),
  },
]);
const expectedFields = computed(() => [
  { key: 'first_name', label: t('webhook_field_first_name'), required: true },
  { key: 'last_name', label: t('webhook_field_last_name'), required: false },
  { key: 'nickname', label: t('webhook_field_nickname'), required: false },
  { key: 'birthday', label: t('webhook_field_birthday'), required: false },
  { key: 'email', label: t('webhook_field_email'), required: false },
  { key: 'phone_ddi', label: t('webhook_field_phone_ddi'), required: true },
  { key: 'phone', label: t('webhook_field_phone'), required: true },
  { key: 'notes', label: t('webhook_field_notes'), required: false },
  { key: 'labels', label: t('webhook_field_labels'), required: false },
  { key: 'message', label: t('webhook_field_message'), required: false },
]);

const extractNestedKeys = (
  obj: unknown,
  prefix = '',
  keys: string[] = []
): string[] => {
  if (obj === null || obj === undefined) {
    return keys;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return keys;
    }

    for (let i = 0; i < obj.length; i++) {
      const currentKey = prefix ? `${prefix}[${i}]` : `[${i}]`;
      extractNestedKeys(obj[i], currentKey, keys);
    }

    return keys;
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;

    for (const key in record) {
      const currentKey = prefix ? `${prefix}.${key}` : key;
      const value = record[key];

      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        keys.push(currentKey);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          keys.push(currentKey);
        } else {
          extractNestedKeys(value, currentKey, keys);
        }
      } else if (typeof value === 'object') {
        extractNestedKeys(value, currentKey, keys);
      }
    }

    return keys;
  }

  return keys;
};

const loadWebhookData = async () => {
  if (props.apiKeyId) {
    await integrationStore.viewWebhookData(props.apiKeyId);
  }

  if (integrationStore.webhookData) {
    const allKeys = extractNestedKeys(integrationStore.webhookData);
    webhookDataKeys.value = allKeys.filter((key) => key !== 'account_id');
  }
};

const loadWebhookMapping = async () => {
  if (props.apiKeyId) {
    await integrationStore.viewWebhookMapping(props.apiKeyId);
  }

  if (integrationStore.webhookMapping) {
    const savedMapping = integrationStore.webhookMapping.mapping || {};
    webhookMapping.value = {};
    for (const key in savedMapping) {
      const value = savedMapping[key];
      if (key === 'labels' && typeof value === 'string') {
        try {
          webhookMapping.value[key] = JSON.parse(value) as string[];
        } catch {
          webhookMapping.value[key] = [value];
        }
      } else if (key === 'labels' && Array.isArray(value)) {
        webhookMapping.value[key] = value;
      } else {
        webhookMapping.value[key] = value as string;
      }
    }
  } else {
    webhookMapping.value = {};
  }

  expectedFields.value.forEach((field) => {
    if (webhookMapping.value[field.key] === undefined) {
      if (field.key === 'labels') {
        webhookMapping.value[field.key] = [];
      } else {
        webhookMapping.value[field.key] = null;
      }
    }
  });
};

type SelectValue = string | number | boolean | null;

const handleFieldUpdate = (
  fieldKey: string,
  value: SelectValue | SelectValue[]
): void => {
  if (fieldKey === 'labels') {
    if (Array.isArray(value)) {
      webhookMapping.value[fieldKey] = value.filter(
        (v) => typeof v === 'string'
      ) as string[];
    } else {
      webhookMapping.value[fieldKey] = [];
    }
    return;
  }

  if (typeof value === 'string') {
    webhookMapping.value[fieldKey] = value;
  } else if (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'string'
  ) {
    webhookMapping.value[fieldKey] = value[0];
  } else {
    webhookMapping.value[fieldKey] = null;
  }
};

const handleSaveMapping = async () => {
  if (messageType.value === 'message') {
    if (transferType.value === 'sector' && !selectedSector.value) {
      integrationStore.showSnackbar(
        t('webhook_mapping_transfer_sector_required'),
        EColor.error
      );
      return;
    }

    if (transferType.value === 'user' && !selectedUser.value) {
      integrationStore.showSnackbar(
        t('webhook_mapping_transfer_user_required'),
        EColor.error
      );
      return;
    }
  }

  const mappingToSave: Record<string, string | string[]> = {};
  const transferKeys = [
    'transfer_sector_id',
    'transfer_sector_user_id',
    'transfer_user_id',
  ];

  for (const key in webhookMapping.value) {
    if (transferKeys.includes(key)) {
      continue;
    }
    const value = webhookMapping.value[key];
    if (value !== null && value !== undefined) {
      if (key === 'labels' && Array.isArray(value) && value.length > 0) {
        mappingToSave[key] = value;
      } else if (typeof value === 'string' && value !== '') {
        mappingToSave[key] = value;
      }
    }
  }

  if (messageType.value === 'message') {
    mappingToSave.message_type = 'message';
    if (transferType.value === 'sector' && selectedSector.value) {
      mappingToSave.transfer_sector_id = selectedSector.value;
      if (selectedSectorUser.value) {
        mappingToSave.transfer_sector_user_id = selectedSectorUser.value;
      }
    } else if (transferType.value === 'user' && selectedUser.value) {
      mappingToSave.transfer_user_id = selectedUser.value;
    }
  } else if (messageType.value === 'chatbot' && selectedChatbot.value) {
    mappingToSave.message_type = 'chatbot';
    mappingToSave.chatbot_id = selectedChatbot.value;
    if (webhookMapping.value.message) {
      mappingToSave.message = webhookMapping.value.message as string;
    }
  }

  if (!props.apiKeyId) {
    return;
  }

  const success = await integrationStore.saveWebhookMapping(
    props.apiKeyId,
    mappingToSave
  );

  if (success) {
    isOpen.value = false;
  }
};

const loadUsers = async () => {
  if (isLoadingUsers.value) return;
  isLoadingUsers.value = true;
  try {
    const usersList = await integrationStore.listUsers();
    users.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status || null,
    }));
  } catch (error) {
    console.error('Error loading users:', error);
  } finally {
    isLoadingUsers.value = false;
  }
};

const loadSectors = async () => {
  if (isLoadingSectors.value) return;
  isLoadingSectors.value = true;
  try {
    const sectorsList = await integrationStore.listSectors();
    sectors.value = sectorsList.map((sector) => ({
      value: sector.id,
      title: sector.name,
      color: sector.color || null,
    }));
  } catch (error) {
    console.error('Error loading sectors:', error);
  } finally {
    isLoadingSectors.value = false;
  }
};

const loadSectorUsers = async (sectorId: string) => {
  if (isLoadingSectorUsers.value || !sectorId) return;
  isLoadingSectorUsers.value = true;
  try {
    const usersList = await integrationStore.listSectorUsers(sectorId);
    sectorUsers.value = usersList.map((user) => ({
      value: user.id,
      title: user.name,
      photo: user.photo || null,
      status: user.status || null,
    }));
  } catch (error) {
    console.error('Error loading sector users:', error);
    sectorUsers.value = [];
  } finally {
    isLoadingSectorUsers.value = false;
  }
};

const ensureSectorInList = async (sectorId: string): Promise<void> => {
  if (sectors.value.length === 0) {
    await loadSectors();
  }
};

const ensureUserInList = async (userId: string): Promise<void> => {
  if (users.value.length === 0) {
    await loadUsers();
  }
};

const ensureSectorUserInList = async (
  userId: string,
  sectorId: string
): Promise<void> => {
  if (sectorUsers.value.length === 0) {
    await loadSectorUsers(sectorId);
  }
};

const loadInputChatbots = async () => {
  if (isLoadingChatbots.value) return;
  isLoadingChatbots.value = true;
  try {
    const chatbotsList = await integrationStore.listInputChatbots();
    inputChatbots.value = chatbotsList.map((chatbot) => ({
      value: chatbot.chatbot_id,
      title: chatbot.name,
    }));
  } catch (error) {
    console.error('Error loading chatbots:', error);
  } finally {
    isLoadingChatbots.value = false;
  }
};

watch(messageType, (newType) => {
  if (newType === 'message') {
    selectedChatbot.value = null;
  } else {
    transferType.value = null;
    selectedSector.value = null;
    selectedUser.value = null;
    selectedSectorUser.value = null;
    sectorUsers.value = [];
  }
});

const isRestoringFromLoad = ref(false);

watch(transferType, (newType) => {
  if (isRestoringFromLoad.value) {
    return;
  }
  selectedUser.value = null;
  selectedSector.value = null;
  selectedSectorUser.value = null;
  sectorUsers.value = [];

  if (newType === 'user' && users.value.length === 0) {
    loadUsers();
  } else if (newType === 'sector' && sectors.value.length === 0) {
    loadSectors();
  }
});

watch(selectedSector, (sectorId) => {
  if (isRestoringFromLoad.value) {
    return;
  }
  selectedSectorUser.value = null;
  sectorUsers.value = [];

  if (sectorId) {
    loadSectorUsers(sectorId);
  }
});

watch(isOpen, async (newValue) => {
  if (newValue) {
    isRestoringFromLoad.value = false;
    webhookMapping.value = {};
    webhookDataKeys.value = [];
    phoneDdiMode.value = 'select';
    messageMode.value = 'textarea';
    chatbotMessageMode.value = 'depara';
    messageType.value = 'message';
    transferType.value = null;
    selectedSector.value = null;
    selectedUser.value = null;
    selectedSectorUser.value = null;
    selectedChatbot.value = null;
    users.value = [];
    sectors.value = [];
    sectorUsers.value = [];
    inputChatbots.value = [];

    expectedFields.value.forEach((field) => {
      if (field.key === 'phone_ddi') {
        webhookMapping.value[field.key] = '55';
      } else if (field.key === 'labels') {
        webhookMapping.value[field.key] = [];
      } else {
        webhookMapping.value[field.key] = null;
      }
    });

    await Promise.all([loadWebhookData(), loadWebhookMapping()]);

    const phoneDdiValue =
      typeof webhookMapping.value.phone_ddi === 'string'
        ? webhookMapping.value.phone_ddi
        : null;
    if (phoneDdiValue && !webhookDataKeys.value.includes(phoneDdiValue)) {
      phoneDdiMode.value = 'select';
    } else if (phoneDdiValue && webhookDataKeys.value.includes(phoneDdiValue)) {
      phoneDdiMode.value = 'depara';
    } else if (!phoneDdiValue) {
      webhookMapping.value.phone_ddi = '55';
    }

    const messageValue =
      typeof webhookMapping.value.message === 'string'
        ? webhookMapping.value.message
        : null;
    if (messageValue && webhookDataKeys.value.includes(messageValue)) {
      messageMode.value = 'depara';
    }

    const savedMessageType =
      typeof webhookMapping.value.message_type === 'string'
        ? (webhookMapping.value.message_type as 'message' | 'chatbot')
        : undefined;
    if (savedMessageType === 'chatbot') {
      messageType.value = 'chatbot';
      const chatbotIdValue =
        typeof webhookMapping.value.chatbot_id === 'string'
          ? webhookMapping.value.chatbot_id
          : null;
      if (chatbotIdValue) {
        selectedChatbot.value = chatbotIdValue;
      }
      await loadInputChatbots();
      const chatbotMessageValue =
        typeof webhookMapping.value.message === 'string'
          ? webhookMapping.value.message
          : null;
      if (
        chatbotMessageValue &&
        webhookDataKeys.value.includes(chatbotMessageValue)
      ) {
        chatbotMessageMode.value = 'depara';
      } else if (chatbotMessageValue) {
        chatbotMessageMode.value = 'textarea';
      } else {
        chatbotMessageMode.value = 'depara';
      }
    } else if (savedMessageType === 'message') {
      messageType.value = 'message';
      const transferUserIdValue =
        typeof webhookMapping.value.transfer_user_id === 'string'
          ? webhookMapping.value.transfer_user_id
          : null;
      const transferSectorIdValue =
        typeof webhookMapping.value.transfer_sector_id === 'string'
          ? webhookMapping.value.transfer_sector_id
          : null;
      if (transferUserIdValue) {
        await ensureUserInList(transferUserIdValue);
        isRestoringFromLoad.value = true;
        transferType.value = 'user';
        await nextTick();
        selectedUser.value = transferUserIdValue;
        isRestoringFromLoad.value = false;
      } else if (transferSectorIdValue) {
        await ensureSectorInList(transferSectorIdValue);
        const transferSectorUserIdValue =
          typeof webhookMapping.value.transfer_sector_user_id === 'string'
            ? webhookMapping.value.transfer_sector_user_id
            : null;
        if (transferSectorUserIdValue) {
          await ensureSectorUserInList(
            transferSectorUserIdValue,
            transferSectorIdValue
          );
        }
        isRestoringFromLoad.value = true;
        transferType.value = 'sector';
        await nextTick();
        selectedSector.value = transferSectorIdValue;
        if (transferSectorUserIdValue) {
          await nextTick();
          selectedSectorUser.value = transferSectorUserIdValue;
        }
        isRestoringFromLoad.value = false;
      }
    } else {
      messageType.value = 'chatbot';
      await loadInputChatbots();
      chatbotMessageMode.value = 'depara';
    }
  }
});
</script>

<template>
  <VDialog v-model="isOpen" max-width="800" persistent>
    <DialogCloseBtn @click="isOpen = false" />

    <VCard :title="$t('integration_webhook_mapping')">
      <VCardText>
        <VRow v-if="integrationStore.webhookDataLoading">
          <VCol cols="12">
            <div v-for="field in expectedFields" :key="field.key" class="mb-4">
              <VSkeletonLoader
                type="text"
                width="120"
                height="20"
                class="mb-2"
              />
              <VSkeletonLoader type="text" height="56" />
            </div>
          </VCol>
        </VRow>

        <VRow v-else-if="webhookDataKeys.length === 0">
          <VCol cols="12">
            <div class="d-flex flex-column align-center justify-center py-12">
              <VAvatar size="120" color="primary" variant="tonal" class="mb-6">
                <VIcon icon="tabler-webhook" size="64" />
              </VAvatar>
              <h3 class="text-h5 mb-2">
                {{ $t('integration_webhook_mapping_empty') }}
              </h3>
              <p
                class="text-body-1 text-medium-emphasis text-center max-width-400"
              >
                {{ $t('integration_webhook_mapping_empty_description') }}
              </p>
            </div>
          </VCol>
        </VRow>

        <VRow v-else>
          <VCol cols="12">
            <div v-for="field in expectedFields" :key="field.key" class="mb-4">
              <div
                v-if="field.key === 'phone_ddi'"
                class="d-flex align-center justify-space-between mb-2"
              >
                <VLabel class="text-body-2">
                  {{ field.label }}
                  <span v-if="field.required" class="text-error">*</span>
                </VLabel>
                <VBtn
                  variant="text"
                  size="small"
                  density="compact"
                  @click="
                    phoneDdiMode =
                      phoneDdiMode === 'select' ? 'depara' : 'select'
                  "
                >
                  {{
                    phoneDdiMode === 'select'
                      ? $t('use_mapping')
                      : $t('use_ddi_list')
                  }}
                </VBtn>
              </div>
              <VLabel
                v-else-if="field.key !== 'message'"
                class="text-body-2 mb-2"
              >
                {{ field.label }}
                <span v-if="field.required" class="text-error">*</span>
              </VLabel>
              <AppSelectSearch
                v-if="field.key === 'phone_ddi' && phoneDdiMode === 'depara'"
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
              <AppSelectSearch
                v-else-if="
                  field.key === 'phone_ddi' && phoneDdiMode === 'select'
                "
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="countryCodesItems"
                :placeholder="$t('select_phone_ddi')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
              <AppSelectSearch
                v-else-if="field.key === 'labels'"
                :model-value="webhookMapping[field.key] ?? []"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                multiple
                chips
                closable-chips
                item-value="value"
                item-title="title"
              />
              <AppSelectSearch
                v-else-if="field.key !== 'message'"
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
            </div>

            <VDivider class="my-6" thickness="2" color="primary" />

            <VCard variant="outlined" class="mb-4" elevation="1">
              <VCardText>
                <div class="mb-4">
                  <VLabel class="text-body-1 font-weight-medium mb-3 d-block">{{
                    $t('type')
                  }}</VLabel>
                  <AppSelectSearch
                    v-model="messageType"
                    :items="[
                      { value: 'message', title: $t('message') },
                      { value: 'chatbot', title: $t('chatbot') },
                    ]"
                    :placeholder="$t('select_type')"
                    item-value="value"
                    item-title="title"
                  />
                </div>

                <div v-if="messageType === 'message'">
                  <div class="mb-4">
                    <VLabel class="text-body-2 mb-2">{{
                      $t('transfer_to')
                    }}</VLabel>
                    <AppSelectSearch
                      v-model="transferType"
                      :items="[
                        { value: 'sector', title: $t('sector') },
                        { value: 'user', title: $t('user') },
                      ]"
                      :placeholder="$t('transfer_to_placeholder')"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                    />
                  </div>

                  <div v-if="transferType === 'sector'" class="mb-4">
                    <VLabel class="text-body-2 mb-2">
                      {{ $t('sector') }}
                      <span class="text-error">*</span>
                    </VLabel>
                    <AppSelectSearch
                      v-model="selectedSector"
                      :items="sectors"
                      :placeholder="$t('select_sector')"
                      :loading="isLoadingSectors"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                      @select="loadSectors()"
                    >
                      <template #item-prepend="{ item }">
                        <VAvatar
                          size="24"
                          :style="{
                            backgroundColor: item.color || '#1976D2',
                          }"
                        />
                      </template>
                    </AppSelectSearch>
                  </div>

                  <div
                    v-if="transferType === 'sector' && selectedSector"
                    class="mb-4"
                  >
                    <VLabel class="text-body-2 mb-2">{{ $t('user') }}</VLabel>
                    <AppSelectSearch
                      v-model="selectedSectorUser"
                      :items="sectorUsers"
                      :placeholder="$t('select_user')"
                      :loading="isLoadingSectorUsers"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                    >
                      <template #item-prepend="{ item }">
                        <VAvatar
                          size="32"
                          :variant="!item.photo ? 'tonal' : undefined"
                          color="primary"
                        >
                          <VImg
                            v-if="item.photo"
                            :src="item.photo"
                            :alt="item.title"
                          />
                          <VIcon v-else icon="tabler-user" size="18" />
                        </VAvatar>
                      </template>
                    </AppSelectSearch>
                  </div>

                  <div v-if="transferType === 'user'" class="mb-4">
                    <VLabel class="text-body-2 mb-2">
                      {{ $t('user') }}
                      <span class="text-error">*</span>
                    </VLabel>
                    <AppSelectSearch
                      v-model="selectedUser"
                      :items="users"
                      :placeholder="$t('select_user')"
                      :loading="isLoadingUsers"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                      @select="loadUsers()"
                    >
                      <template #item-prepend="{ item }">
                        <VAvatar
                          size="32"
                          :variant="!item.photo ? 'tonal' : undefined"
                          color="primary"
                        >
                          <VImg
                            v-if="item.photo"
                            :src="item.photo"
                            :alt="item.title"
                          />
                          <VIcon v-else icon="tabler-user" size="18" />
                        </VAvatar>
                      </template>
                    </AppSelectSearch>
                  </div>

                  <div class="mb-4">
                    <div class="d-flex align-center justify-space-between mb-2">
                      <VLabel class="text-body-2">
                        {{ $t('webhook_field_message') }}
                      </VLabel>
                      <VBtn
                        variant="text"
                        size="small"
                        density="compact"
                        @click="
                          messageMode =
                            messageMode === 'textarea' ? 'depara' : 'textarea'
                        "
                      >
                        {{
                          messageMode === 'textarea'
                            ? $t('use_mapping')
                            : $t('use_textarea')
                        }}
                      </VBtn>
                    </div>
                    <div v-if="messageMode === 'textarea'">
                      <VTextarea
                        :model-value="webhookMapping.message ?? ''"
                        @update:model-value="
                          webhookMapping.message = $event || null
                        "
                        :placeholder="$t('webhook_field_message')"
                        rows="4"
                      />
                      <VExpansionPanels variant="accordion" class="mt-2">
                        <VExpansionPanel>
                          <VExpansionPanelTitle>
                            <span class="text-caption">{{
                              $t('available_tags')
                            }}</span>
                          </VExpansionPanelTitle>
                          <VExpansionPanelText>
                            <div class="d-flex flex-column gap-1">
                              <div
                                v-for="tag in availableTags"
                                :key="tag.tag"
                                class="text-caption"
                              >
                                <code>{{ tag.tag }}</code
                                >: {{ tag.description }}
                              </div>
                            </div>
                          </VExpansionPanelText>
                        </VExpansionPanel>
                      </VExpansionPanels>
                    </div>
                    <AppSelectSearch
                      v-else
                      :model-value="webhookMapping.message ?? null"
                      @update:model-value="handleFieldUpdate('message', $event)"
                      :items="
                        webhookDataKeys.map((key) => ({
                          value: key,
                          title: key,
                        }))
                      "
                      :placeholder="$t('select_field')"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                    />
                  </div>
                </div>

                <div v-if="messageType === 'chatbot'">
                  <div class="mb-4">
                    <VLabel
                      class="text-body-1 font-weight-medium mb-3 d-block"
                      >{{ $t('chatbot_input_select_label') }}</VLabel
                    >
                    <AppSelectSearch
                      v-model="selectedChatbot"
                      :items="inputChatbots"
                      :placeholder="$t('chatbot_input_select_placeholder')"
                      :loading="isLoadingChatbots"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                      @select="loadInputChatbots()"
                    />
                  </div>

                  <div class="mb-4">
                    <div class="d-flex align-center justify-space-between mb-2">
                      <VLabel class="text-body-2">
                        {{ $t('webhook_field_message') }}
                      </VLabel>
                      <VBtn
                        variant="text"
                        size="small"
                        density="compact"
                        @click="
                          chatbotMessageMode =
                            chatbotMessageMode === 'textarea'
                              ? 'depara'
                              : 'textarea'
                        "
                      >
                        {{
                          chatbotMessageMode === 'textarea'
                            ? $t('use_mapping')
                            : $t('use_textarea')
                        }}
                      </VBtn>
                    </div>
                    <div v-if="chatbotMessageMode === 'textarea'">
                      <VTextarea
                        :model-value="webhookMapping.message ?? ''"
                        @update:model-value="
                          webhookMapping.message = $event || null
                        "
                        :placeholder="$t('webhook_field_message')"
                        rows="4"
                      />
                      <VExpansionPanels variant="accordion" class="mt-2">
                        <VExpansionPanel>
                          <VExpansionPanelTitle>
                            <span class="text-caption">{{
                              $t('available_tags')
                            }}</span>
                          </VExpansionPanelTitle>
                          <VExpansionPanelText>
                            <div class="d-flex flex-column gap-1">
                              <div
                                v-for="tag in availableTags"
                                :key="tag.tag"
                                class="text-caption"
                              >
                                <code>{{ tag.tag }}</code
                                >: {{ tag.description }}
                              </div>
                            </div>
                          </VExpansionPanelText>
                        </VExpansionPanel>
                      </VExpansionPanels>
                    </div>
                    <AppSelectSearch
                      v-else
                      :model-value="webhookMapping.message ?? null"
                      @update:model-value="handleFieldUpdate('message', $event)"
                      :items="
                        webhookDataKeys.map((key) => ({
                          value: key,
                          title: key,
                        }))
                      "
                      :placeholder="$t('select_field')"
                      :clearable="true"
                      item-value="value"
                      item-title="title"
                    />
                  </div>
                </div>
              </VCardText>
            </VCard>
          </VCol>
        </VRow>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn variant="tonal" color="secondary" @click="isOpen = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          v-if="webhookDataKeys.length > 0"
          color="primary"
          :loading="integrationStore.webhookMappingLoading"
          :disabled="
            !$canPermission([
              EGeneralPermissions.full_access,
              EGeneralPermissions.full_access_group,
              EIntegrationPermissions.integration_group,
            ])
          "
          @click="handleSaveMapping"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
