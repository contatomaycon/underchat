<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import type {
  ChatbotInactivityAction,
  ChatbotInactivityOption,
  ChatbotInactivityRedirectType,
  ChatbotInactivityStatus,
  ChatbotInactivityTargetOption,
} from '@/types/chatbotInactivityAlert';

type SelectValue = string | number | boolean | null | SelectValue[];

const props = defineProps<{
  status: ChatbotInactivityStatus;
  quantity: string;
  time: string;
  quantityError: string | null;
  timeError: string | null;
  action: ChatbotInactivityAction | null;
  redirectType: ChatbotInactivityRedirectType | null;
  selectedUser: string | null;
  selectedSector: string | null;
  selectedSectorUser: string | null;
  selectedChannel: string | null;
  selectedChatbot: string | null;
  users: ChatbotInactivityOption[];
  sectors: ChatbotInactivityOption[];
  sectorUsers: ChatbotInactivityOption[];
  channels: readonly ChatbotInactivityOption[];
  chatbots: readonly ChatbotInactivityTargetOption[];
  loadingUsers: boolean;
  loadingSectors: boolean;
  loadingSectorUsers: boolean;
  loadingChannels: boolean;
  loadingChatbots: boolean;
}>();

const emit = defineEmits<{
  'update:status': [value: ChatbotInactivityStatus];
  'update:quantity': [value: string];
  'update:time': [value: string];
  'update:action': [value: ChatbotInactivityAction | null];
  'update:redirectType': [value: ChatbotInactivityRedirectType | null];
  'update:selectedUser': [value: string | null];
  'update:selectedSector': [value: string | null];
  'update:selectedSectorUser': [value: string | null];
  'update:selectedChannel': [value: string | null];
  'update:selectedChatbot': [value: string | null];
  refreshUsers: [];
  refreshSectors: [];
  refreshSectorUsers: [sectorId: string];
}>();

const { t } = useI18n();
const onlyDigits = (value: string) => value.replaceAll(/\D+/g, '');
const showFields = computed(() => props.status === 'active');
const showRedirect = computed(
  () => showFields.value && props.action === 'redirect'
);
const channelItems = computed(() => [...props.channels]);
const chatbotItems = computed(() => [...props.chatbots]);

function onNumericKeydown(event: KeyboardEvent): void {
  if (
    !/\d/.test(event.key) &&
    ![
      'Backspace',
      'Delete',
      'ArrowLeft',
      'ArrowRight',
      'Tab',
      'Enter',
    ].includes(event.key)
  ) {
    event.preventDefault();
  }
}

function stringValue(value: SelectValue): string | null {
  return typeof value === 'string' ? value : null;
}

function onPaste(event: ClipboardEvent, field: 'quantity' | 'time'): void {
  event.preventDefault();
  const value = onlyDigits(event.clipboardData?.getData('text') ?? '');
  if (field === 'quantity') {
    emit('update:quantity', value);
  } else {
    emit('update:time', value);
  }
}
</script>

<template>
  <VCard variant="outlined" class="mb-4">
    <VCardTitle class="text-body-1 pa-3 pb-0 font-weight-bold">
      {{ t('chatbot_inactivity_alert') }}
    </VCardTitle>
    <VCardSubtitle class="text-caption pa-3 pb-0 pt-0 config-description">
      {{ t('chatbot_inactivity_alert_description') }}
    </VCardSubtitle>
    <VDivider />
    <VCardText>
      <div class="mb-3">
        <VLabel class="mb-1 text-body-2">
          {{ t('chatbot_inactivity_alert') }}
        </VLabel>
        <AppSelectSearch
          :model-value="status"
          :items="[
            { id: 'active', title: t('chatbot_inactivity_alert_active') },
            { id: 'inactive', title: t('chatbot_inactivity_alert_inactive') },
          ]"
          item-value="id"
          item-title="title"
          :clearable="false"
          @update:model-value="
            emit('update:status', $event as ChatbotInactivityStatus)
          "
        />
      </div>

      <div v-if="showFields">
        <div class="mb-3">
          <VLabel class="mb-1 text-body-2">
            {{ t('chatbot_inactivity_alert_quantity') }} *
          </VLabel>
          <VTextField
            :model-value="quantity"
            variant="outlined"
            density="compact"
            hide-details="auto"
            :error-messages="quantityError ? [quantityError] : []"
            inputmode="numeric"
            type="text"
            required
            @update:model-value="
              emit('update:quantity', onlyDigits(String($event)))
            "
            @keydown="onNumericKeydown"
            @paste="onPaste($event, 'quantity')"
          />
        </div>

        <div class="mb-3">
          <VLabel class="mb-1 text-body-2">
            {{ t('chatbot_inactivity_alert_time') }} *
          </VLabel>
          <VTextField
            :model-value="time"
            variant="outlined"
            density="compact"
            hide-details="auto"
            :error-messages="timeError ? [timeError] : []"
            inputmode="numeric"
            type="text"
            required
            @update:model-value="
              emit('update:time', onlyDigits(String($event)))
            "
            @keydown="onNumericKeydown"
            @paste="onPaste($event, 'time')"
          />
        </div>

        <div class="mb-3">
          <VLabel class="mb-1 text-body-2">{{ t('chatbot_action') }}</VLabel>
          <AppSelectSearch
            :model-value="action"
            :items="[
              { id: 'redirect', title: t('chatbot_redirect') },
              { id: 'finish', title: t('chatbot_finish') },
            ]"
            item-value="id"
            item-title="title"
            :clearable="false"
            @update:model-value="
              emit('update:action', $event as ChatbotInactivityAction | null)
            "
          />
        </div>

        <template v-if="showRedirect">
          <div class="mb-3">
            <VLabel class="mb-1 text-body-2">
              {{ t('chatbot_redirect_to') }}
            </VLabel>
            <AppSelectSearch
              :model-value="redirectType"
              :items="[
                { id: 'user', title: t('chatbot_redirect_user') },
                { id: 'sector', title: t('chatbot_redirect_sector') },
                { id: 'chatbot', title: t('chatbot') },
              ]"
              item-value="id"
              item-title="title"
              :clearable="false"
              @update:model-value="
                emit(
                  'update:redirectType',
                  $event as ChatbotInactivityRedirectType | null
                )
              "
            />
          </div>

          <div v-if="redirectType === 'user'" class="mb-3">
            <AppSelectSearch
              :model-value="selectedUser"
              :items="users"
              :label="t('chatbot_user_label')"
              :placeholder="t('chatbot_search')"
              :loading="loadingUsers"
              clearable
              item-value="value"
              item-title="title"
              @update:model-value="
                emit('update:selectedUser', stringValue($event))
              "
              @select="emit('refreshUsers')"
            >
              <template #item-prepend="{ item }">
                <VAvatar
                  size="32"
                  :variant="!item.photo ? 'tonal' : undefined"
                  color="primary"
                >
                  <VImg v-if="item.photo" :src="item.photo" :alt="item.title" />
                  <VIcon v-else icon="tabler-user" size="18" />
                </VAvatar>
              </template>
            </AppSelectSearch>
          </div>

          <div v-if="redirectType === 'sector'" class="mb-3">
            <AppSelectSearch
              :model-value="selectedSector"
              :items="sectors"
              :label="t('chatbot_sector_label')"
              :placeholder="t('chatbot_search')"
              :loading="loadingSectors"
              clearable
              item-value="value"
              item-title="title"
              @update:model-value="
                emit('update:selectedSector', stringValue($event))
              "
              @select="emit('refreshSectors')"
            >
              <template #item-prepend="{ item }">
                <VAvatar
                  size="24"
                  :style="{ backgroundColor: item.color || '#1976D2' }"
                />
              </template>
            </AppSelectSearch>
          </div>

          <div v-if="redirectType === 'sector' && selectedSector" class="mb-3">
            <AppSelectSearch
              :model-value="selectedSectorUser"
              :items="sectorUsers"
              :label="t('chatbot_sector_user_label')"
              :placeholder="t('chatbot_search_optional')"
              :loading="loadingSectorUsers"
              clearable
              item-value="value"
              item-title="title"
              @update:model-value="
                emit('update:selectedSectorUser', stringValue($event))
              "
              @select="emit('refreshSectorUsers', selectedSector)"
            >
              <template #item-prepend="{ item }">
                <VAvatar
                  size="32"
                  :variant="!item.photo ? 'tonal' : undefined"
                  color="primary"
                >
                  <VImg v-if="item.photo" :src="item.photo" :alt="item.title" />
                  <VIcon v-else icon="tabler-user" size="18" />
                </VAvatar>
              </template>
            </AppSelectSearch>
          </div>

          <template v-if="redirectType === 'chatbot'">
            <div class="mb-3">
              <AppSelectSearch
                :model-value="selectedChannel"
                :items="channelItems"
                :label="t('channel')"
                :placeholder="t('select_channel')"
                :loading="loadingChannels"
                clearable
                item-value="value"
                item-title="title"
                @update:model-value="
                  emit('update:selectedChannel', stringValue($event))
                "
              />
            </div>
            <div class="mb-3">
              <AppSelectSearch
                :model-value="selectedChatbot"
                :items="chatbotItems"
                :label="t('chatbot')"
                :placeholder="t('select_chatbot')"
                :loading="loadingChatbots"
                :disabled="!selectedChannel"
                clearable
                item-value="value"
                item-title="title"
                @update:model-value="
                  emit('update:selectedChatbot', stringValue($event))
                "
              />
            </div>
            <VAlert type="info" variant="tonal" density="compact">
              {{ t('chatbot_inactivity_redirect_chatbot_hint') }}
            </VAlert>
          </template>
        </template>
      </div>
    </VCardText>
  </VCard>
</template>
