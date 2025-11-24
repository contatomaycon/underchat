<script lang="ts" setup>
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import ChatQueue from './ChatQueue.vue';
import AppAddContact from '@/components/contact/AppAddContact.vue';
import AppEditContact from '@/components/contact/AppEditContact.vue';
import { useChatStore } from '@/@webcore/stores/chat';
import { useContactStore } from '@/@webcore/stores/contact';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useSectorsStore } from '@/@webcore/stores/sector';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { can } from '@layouts/plugins/casl';
import { refDebounced } from '@vueuse/core';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { IChat } from '@core/common/interfaces/IChat';
import { EColor } from '@core/common/enums/EColor';
import VDialogHandler from '@/components/VDialogHandler.vue';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { ListSectorResponse } from '@core/schema/sector/listSector/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { ESectorStatus } from '@core/common/enums/ESectorStatus';

const emit = defineEmits<{
  (e: 'openChat', id: ListChatsResult['chat_id']): void;
  (e: 'showUserProfile'): void;
  (e: 'close'): void;
  (e: 'update:search', value: string): void;
}>();

const props = defineProps<{
  isDrawerOpen: boolean;
  search: string;
}>();

const chatStore = useChatStore();
const contactStore = useContactStore();
const channelsStore = useChannelsStore();
const sectorsStore = useSectorsStore();

const currentPageQueue = ref(1);
const perPageQueue = ref(10);
const currentPageInChat = ref(1);
const perPageInChat = ref(10);

const contactSearchQuery = ref('');
const debouncedContactSearch = refDebounced(contactSearchQuery, 500);
const currentPageContacts = ref(1);
const perPageContacts = ref(50);
const isAddContactModalOpen = ref(false);
const isLoadingMoreContacts = ref(false);
const contactScrollContainer = ref<InstanceType<
  typeof PerfectScrollbar
> | null>(null);
const accumulatedContacts = ref<ListContactResponse[]>([]);
const isValidateContactDialogOpen = ref(false);
const contactToValidate = ref<string | null>(null);
const isEditContactModalOpen = ref(false);
const editContactId = ref<string | null>(null);
const hoveredContactId = ref<string | null>(null);
const editingContactId = ref<string | null>(null);
const validatingContactId = ref<string | null>(null);
const isSelectChannelSectorModalOpen = ref(false);
const selectedContactForChat = ref<ListContactResponse | null>(null);
const selectedWorkerId = ref<string | null>(null);
const selectedSectorId = ref<string | null>(null);
const availableWorkers = ref<ListWorkerResponse[]>([]);
const availableSectors = ref<ListSectorResponse[]>([]);

type FilterType = 'new' | 'all' | 'in_chat' | 'queue' | 'chatbot';

const activeFilter = ref<FilterType>('all');
const expandedFilter = ref<FilterType | null>('all');

const filteredInChat = computed(() => {
  if (activeFilter.value === 'all' || activeFilter.value === 'in_chat') {
    return chatStore.listInChat;
  }
  return [];
});

const filteredQueue = computed(() => {
  if (activeFilter.value === 'all' || activeFilter.value === 'queue') {
    return chatStore.listQueue;
  }
  return [];
});

const showInChatTitle = computed(() => {
  return activeFilter.value === 'all';
});

const showQueueTitle = computed(() => {
  return activeFilter.value === 'all';
});

const queueSelectionPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.pick_queue_chat,
];

const canSelectAnyQueueChat = computed(() => can(queueSelectionPermissions));

const canAccessContacts = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EContactPermissions.contact_group,
    EContactPermissions.contact_view,
  ];
  return can(permissions);
});

const modelSearch = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
});

const isQueueChatSelectable = (index: number): boolean => {
  if (canSelectAnyQueueChat.value) {
    return true;
  }

  return index === 0;
};

const handleQueueClick = (
  chatId: ListChatsResult['chat_id'],
  index: number
): void => {
  if (!isQueueChatSelectable(index)) {
    return;
  }

  emit('openChat', chatId);
};

const handleFilterClick = (filter: FilterType) => {
  if (activeFilter.value === filter && expandedFilter.value === filter) {
    return;
  }

  activeFilter.value = filter;
  expandedFilter.value = filter;

  if (filter === 'all' || filter === 'in_chat' || filter === 'queue') {
    loadChatsByFilter();
  } else if (filter === 'new') {
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];
    loadContacts();
  }
};

const loadChatsByFilter = async () => {
  if (activeFilter.value === 'all') {
    const requestQueue: ListChatsQuery = {
      current_page: currentPageQueue.value,
      per_page: perPageQueue.value,
      status: EChatStatus.queue,
    };

    const requestInChat: ListChatsQuery = {
      current_page: currentPageInChat.value,
      per_page: perPageInChat.value,
      status: EChatStatus.in_chat,
    };

    await Promise.all([
      chatStore.listQueueChats(requestQueue),
      chatStore.listInChatChats(requestInChat),
    ]);
  } else if (activeFilter.value === 'in_chat') {
    const requestInChat: ListChatsQuery = {
      current_page: currentPageInChat.value,
      per_page: perPageInChat.value,
      status: EChatStatus.in_chat,
    };

    await chatStore.listInChatChats(requestInChat);
  } else if (activeFilter.value === 'queue') {
    const requestQueue: ListChatsQuery = {
      current_page: currentPageQueue.value,
      per_page: perPageQueue.value,
      status: EChatStatus.queue,
    };

    await chatStore.listQueueChats(requestQueue);
  }
};

const loadContacts = async (append = false) => {
  if (isLoadingMoreContacts.value || contactStore.loading) return;

  isLoadingMoreContacts.value = true;

  try {
    const result = await contactStore.listContact({
      page: currentPageContacts.value,
      per_page: perPageContacts.value,
      sort_by: [],
      search: debouncedContactSearch.value || undefined,
    });

    if (result) {
      if (append) {
        accumulatedContacts.value.push(...result.results);
      } else {
        accumulatedContacts.value = [...result.results];
      }
    }
  } finally {
    isLoadingMoreContacts.value = false;
  }
};

const hasMoreContacts = computed(() => {
  const pagings = contactStore.pagings;
  return currentPageContacts.value < pagings.total_pages;
});

const handleContactScroll = (e: Event) => {
  const target = e.target as HTMLElement;
  if (!target) return;

  const scrollContainer = target.closest('.ps') as HTMLElement;
  if (!scrollContainer) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
  const threshold = 100;

  if (
    scrollTop + clientHeight >= scrollHeight - threshold &&
    hasMoreContacts.value &&
    !isLoadingMoreContacts.value &&
    !contactStore.loading
  ) {
    currentPageContacts.value += 1;
    loadContacts(true);
  }
};

const handleAddContactModalClose = (isOpen: boolean) => {
  if (!isOpen) {
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];
    loadContacts();
  }
};

const handleValidateContact = (contactId: string, event: Event) => {
  event.stopPropagation();
  contactToValidate.value = contactId;
  validatingContactId.value = contactId;
  isValidateContactDialogOpen.value = true;
};

const handleCancelValidateContact = () => {
  validatingContactId.value = null;
  contactToValidate.value = null;
};

const confirmValidateContact = async () => {
  if (!contactToValidate.value) return;

  const result = await contactStore.validateContact(contactToValidate.value);

  if (result) {
    const contactIndex = accumulatedContacts.value.findIndex(
      (c) => c.contact_id === contactToValidate.value
    );
    if (contactIndex !== -1) {
      accumulatedContacts.value[contactIndex] = {
        ...accumulatedContacts.value[contactIndex],
        is_valided: true,
      };
    }
  }

  contactToValidate.value = null;
  validatingContactId.value = null;
};

const handleEditContact = (contactId: string, event: Event) => {
  event.stopPropagation();
  editContactId.value = contactId;
  editingContactId.value = contactId;
  isEditContactModalOpen.value = true;
};

const handleEditContactModalClose = (isOpen: boolean) => {
  if (!isOpen) {
    editContactId.value = null;
    editingContactId.value = null;
    currentPageContacts.value = 1;
    accumulatedContacts.value = [];

    loadContacts();
  }
};

watch(debouncedContactSearch, () => {
  currentPageContacts.value = 1;
  accumulatedContacts.value = [];
  loadContacts();
});

watch(canAccessContacts, (hasAccess) => {
  if (!hasAccess && activeFilter.value === 'new') {
    activeFilter.value = 'all';
    expandedFilter.value = 'all';
    loadChatsByFilter();
  }
});

const loadActiveWorkers = async () => {
  if (!chatStore.user?.account_id) return;

  const result = await channelsStore.listChannels({
    page: 1,
    per_page: 100,
    sort_by: [],
    status: EWorkerStatus.online,
  });

  if (result) {
    availableWorkers.value = result.results.filter(
      (worker) => worker.status?.id === EWorkerStatus.online
    );
  }
};

const loadActiveSectors = async () => {
  if (!chatStore.user?.account_id) return;

  const result = await sectorsStore.listSectors({
    page: 1,
    per_page: 100,
    sort_by: [],
    sector_status: ESectorStatus.active,
  });

  if (result) {
    availableSectors.value = result.results.filter(
      (sector) => sector.sector_status?.id === ESectorStatus.active
    );
  }
};

const handleContactClick = async (contact: ListContactResponse) => {
  if (!contact.phone_partial) {
    contactStore.showSnackbar(
      chatStore.i18n.global.t('contact_phone_required'),
      EColor.warning
    );
    return;
  }

  if (!contact.is_valided) {
    contactStore.showSnackbar(
      chatStore.i18n.global.t('contact_must_be_validated'),
      EColor.warning
    );
    return;
  }

  selectedContactForChat.value = contact;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;

  await Promise.all([loadActiveWorkers(), loadActiveSectors()]);

  isSelectChannelSectorModalOpen.value = true;
};

const handleOpenConversation = async () => {
  if (!selectedContactForChat.value || !selectedWorkerId.value) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('select_channel_required'),
      EColor.warning
    );
    return;
  }

  if (!selectedContactForChat.value.contact_id) {
    chatStore.showSnackbar(
      chatStore.i18n.global.t('contact_not_found'),
      EColor.error
    );
    return;
  }

  try {
    chatStore.loading = true;

    const requestBody: {
      contact_id: string;
      worker_id: string;
      sector_id?: string;
    } = {
      contact_id: selectedContactForChat.value.contact_id,
      worker_id: selectedWorkerId.value,
    };

    if (selectedSectorId.value) {
      requestBody.sector_id = selectedSectorId.value;
    }

    const response = await axios.post<IApiResponse<IChat>>(
      '/chat/start-with-contact',
      requestBody
    );

    chatStore.loading = false;

    const data = response?.data;

    if (!data?.status || !data?.data) {
      const errorMessage =
        data?.message || chatStore.i18n.global.t('chat_creation_error');
      chatStore.showSnackbar(errorMessage, EColor.error);
      return;
    }

    isSelectChannelSectorModalOpen.value = false;
    selectedContactForChat.value = null;
    selectedWorkerId.value = null;
    selectedSectorId.value = null;

    activeFilter.value = 'in_chat';
    expandedFilter.value = 'in_chat';
    await loadChatsByFilter();

    emit('openChat', data.data.chat_id);
  } catch (error: any) {
    chatStore.loading = false;
    const errorMessage =
      error?.response?.data?.message ||
      chatStore.i18n.global.t('chat_creation_error');
    chatStore.showSnackbar(errorMessage, EColor.error);
  }
};

const handleCancelSelectChannelSector = () => {
  isSelectChannelSectorModalOpen.value = false;
  selectedContactForChat.value = null;
  selectedWorkerId.value = null;
  selectedSectorId.value = null;
};

onMounted(async () => {
  await loadChatsByFilter();
});
</script>

<template>
  <div class="chat-list-header">
    <VBadge
      dot
      location="bottom right"
      offset-x="3"
      offset-y="3"
      bordered
      :color="
        resolveAvatarBadgeVariant(
          chatStore.user?.chat_user?.status as EChatUserStatus
        )
      "
      class="cursor-pointer"
    >
      <VAvatar
        size="40"
        :variant="!chatStore.user?.info.photo ? 'tonal' : undefined"
        :color="
          !chatStore.user?.info.photo
            ? resolveAvatarBadgeVariant(
                chatStore.user?.chat_user?.status as EChatUserStatus
              )
            : undefined
        "
        @click="$emit('showUserProfile')"
      >
        <VImg
          v-if="chatStore.user?.info.photo"
          :src="chatStore.user?.info.photo"
        />
        <VImg v-else :src="'/images/svg/avatar-default.svg'" alt="Avatar" />
      </VAvatar>
    </VBadge>

    <AppTextField
      id="search"
      v-model="modelSearch"
      placeholder="Search..."
      prepend-inner-icon="tabler-search"
      class="ms-4 me-1 chat-list-search"
    />

    <IconBtn v-if="$vuetify.display.smAndDown" @click="$emit('close')">
      <VIcon icon="tabler-x" class="text-medium-emphasis" />
    </IconBtn>
  </div>
  <VDivider />

  <div class="chat-filter-options px-3 py-3">
    <div class="d-flex gap-2 flex-wrap">
      <div v-if="canAccessContacts" class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'new' ? 'flat' : 'text'"
          :color="activeFilter === 'new' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('new')"
        >
          <VIcon size="24">tabler-plus</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'all' ? 'flat' : 'text'"
          :color="activeFilter === 'all' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('all')"
        >
          <VIcon size="24">tabler-list</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'in_chat' ? 'flat' : 'text'"
          :color="activeFilter === 'in_chat' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('in_chat')"
        >
          <VIcon size="24">tabler-message-circle</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'queue' ? 'flat' : 'text'"
          :color="activeFilter === 'queue' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('queue')"
        >
          <VIcon size="24">tabler-clock</VIcon>
        </VBtn>
      </div>
      <div class="chat-filter-item flex-grow-1">
        <VBtn
          :variant="activeFilter === 'chatbot' ? 'flat' : 'text'"
          :color="activeFilter === 'chatbot' ? 'primary' : undefined"
          class="chat-filter-btn w-100"
          @click="handleFilterClick('chatbot')"
        >
          <VIcon size="24">tabler-robot</VIcon>
        </VBtn>
      </div>
    </div>
    <Transition name="expand">
      <div v-if="expandedFilter" class="chat-filter-expanded-full">
        {{
          expandedFilter === 'new'
            ? $t('new', 'Novo')
            : expandedFilter === 'all'
              ? $t('all', 'Todos')
              : expandedFilter === 'in_chat'
                ? $t('in_service')
                : expandedFilter === 'queue'
                  ? $t('waiting_for_service')
                  : $t('chatbot', 'ChatBot')
        }}
      </div>
    </Transition>
  </div>

  <VDivider />

  <template v-if="activeFilter === 'new'">
    <div class="px-3 py-3">
      <div class="d-flex align-center gap-2 mb-3">
        <AppTextField
          v-model="contactSearchQuery"
          :placeholder="$t('search') + '...'"
          prepend-inner-icon="tabler-search"
          single-line
          hide-details
          dense
          class="flex-grow-1"
        />
        <VBtn
          color="primary"
          prepend-icon="tabler-plus"
          @click="isAddContactModalOpen = true"
        >
          {{ $t('add') }}
        </VBtn>
      </div>
    </div>

    <VDivider />

    <PerfectScrollbar
      ref="contactScrollContainer"
      :options="{ wheelPropagation: false }"
      @ps-scroll-y="handleContactScroll"
    >
      <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
        <li
          v-for="contact in accumulatedContacts"
          :key="`contact-${contact.contact_id}`"
          class="contact-item d-flex align-center gap-3 pa-3"
          :class="{
            'contact-item--editing':
              editingContactId === contact.contact_id ||
              validatingContactId === contact.contact_id ||
              (isSelectChannelSectorModalOpen &&
                selectedContactForChat?.contact_id === contact.contact_id),
            'contact-item--not-validated': !contact.is_valided,
            'cursor-pointer': contact.is_valided,
            'cursor-not-allowed': !contact.is_valided,
          }"
          @click="handleContactClick(contact)"
          @mouseenter="hoveredContactId = contact.contact_id"
          @mouseleave="hoveredContactId = null"
        >
          <VAvatar
            size="40"
            :variant="!contact.photo ? 'tonal' : undefined"
            color="primary"
          >
            <VImg
              v-if="contact.photo"
              :src="contact.photo"
              :alt="`${contact.name} ${contact.last_name || ''}`"
            />
            <VIcon v-else size="20">tabler-user</VIcon>
          </VAvatar>
          <div class="flex-grow-1">
            <div class="d-flex align-center gap-2">
              <div class="text-body-1 font-weight-medium">
                {{ contact.name }}
                {{ contact.last_name || '' }}
              </div>
            </div>
            <div
              v-if="contact.phone_partial"
              class="text-caption text-disabled"
            >
              {{ contact.phone_partial }}
            </div>
          </div>
          <div class="d-flex align-center gap-2">
            <template v-if="hoveredContactId === contact.contact_id">
              <IconBtn
                v-if="!contact.is_valided"
                size="small"
                variant="text"
                color="primary"
                class="contact-action-btn"
                @click.stop="handleValidateContact(contact.contact_id, $event)"
              >
                <VIcon size="18">tabler-refresh</VIcon>
                <VTooltip activator="parent" location="top">
                  {{ $t('validate_contact') }}
                </VTooltip>
              </IconBtn>
              <IconBtn
                size="small"
                variant="text"
                color="primary"
                class="contact-action-btn"
                @click.stop="handleEditContact(contact.contact_id, $event)"
              >
                <VIcon size="18">tabler-edit</VIcon>
                <VTooltip activator="parent" location="top">
                  {{ $t('edit_contact') }}
                </VTooltip>
              </IconBtn>
            </template>

            <template v-else>
              <VChip
                v-if="contact.is_valided"
                size="x-small"
                color="success"
                variant="flat"
                class="contact-validation-chip contact-validation-chip--validated"
              >
                <VIcon size="10" class="me-0">tabler-check</VIcon>
              </VChip>
              <VChip
                v-else
                size="x-small"
                color="error"
                variant="flat"
                class="contact-validation-chip contact-validation-chip--not-validated"
              >
                <VIcon size="10" class="me-0">tabler-x</VIcon>
              </VChip>
            </template>
          </div>
        </li>

        <li
          v-if="
            !accumulatedContacts.length &&
            !contactStore.loading &&
            !isLoadingMoreContacts
          "
          class="no-chat-items-text text-disabled"
        >
          {{ $t('no_contacts_found') }}
        </li>

        <li
          v-if="contactStore.loading || isLoadingMoreContacts"
          class="d-flex justify-center pa-4"
        >
          <VProgressCircular indeterminate color="primary" size="32" />
        </li>
      </ul>
    </PerfectScrollbar>
  </template>

  <PerfectScrollbar v-else :options="{ wheelPropagation: false }">
    <ul class="d-flex flex-column gap-y-1 chat-list px-3 py-2 list-none">
      <li v-if="showInChatTitle" class="list-none">
        <h5 class="chat-header text-primary text-h5">
          {{ $t('in_service') }}
        </h5>
      </li>

      <ChatQueue
        v-for="inChat in filteredInChat"
        :key="`chat-${inChat.chat_id}`"
        :user="inChat"
        @click="$emit('openChat', inChat.chat_id)"
      />

      <li
        v-if="
          !filteredInChat.length &&
          (activeFilter === 'all' || activeFilter === 'in_chat')
        "
        class="no-chat-items-text text-disabled"
      >
        {{ $t('no_chat_in_service') }}
      </li>

      <li v-if="showQueueTitle" class="list-none pt-2">
        <h5 class="chat-header text-primary text-h5">
          {{ $t('waiting_for_service') }}
        </h5>
      </li>

      <ChatQueue
        v-for="(queue, index) in filteredQueue"
        :key="`chat-${queue.chat_id}`"
        :user="queue"
        :disabled="!isQueueChatSelectable(index)"
        @click="handleQueueClick(queue.chat_id, index)"
      />

      <li
        v-if="
          !filteredQueue.length &&
          (activeFilter === 'all' || activeFilter === 'queue')
        "
        class="no-chat-items-text text-disabled"
      >
        {{ $t('no_chat_in_queue') }}
      </li>
    </ul>
  </PerfectScrollbar>

  <AppAddContact
    v-model="isAddContactModalOpen"
    @update:model-value="handleAddContactModalClose"
  />

  <AppEditContact
    v-model="isEditContactModalOpen"
    :contact-id="editContactId"
    @update:model-value="handleEditContactModalClose"
  />

  <VDialogHandler
    v-model="isValidateContactDialogOpen"
    :title="$t('validate_contact')"
    :message="$t('validate_contact_confirmation')"
    @confirm="confirmValidateContact"
    @cancel="handleCancelValidateContact"
  />

  <VDialog v-model="isSelectChannelSectorModalOpen" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ $t('select_channel_sector') }}</span>
        <IconBtn @click="handleCancelSelectChannelSector">
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <div class="mb-6">
          <VLabel class="mb-2">{{ $t('channel') }} *</VLabel>
          <VSelect
            v-model="selectedWorkerId"
            :items="availableWorkers"
            item-title="name"
            item-value="id"
            :placeholder="$t('select_channel')"
            variant="outlined"
            density="comfortable"
          >
            <template #item="{ props, item }">
              <VListItem
                v-bind="props"
                :title="item.raw.name"
                :subtitle="item.raw.number || undefined"
              />
            </template>
          </VSelect>
          <div v-if="selectedWorkerId" class="mt-2">
            <VChip
              size="small"
              color="primary"
              variant="tonal"
              class="channel-tag"
            >
              <VIcon size="16" class="me-1">tabler-device-mobile</VIcon>
              {{
                availableWorkers.find((w) => w.id === selectedWorkerId)?.name
              }}
              <span
                v-if="
                  availableWorkers.find((w) => w.id === selectedWorkerId)
                    ?.number
                "
                class="ms-1 text-caption"
              >
                ({{
                  availableWorkers.find((w) => w.id === selectedWorkerId)
                    ?.number
                }})
              </span>
            </VChip>
          </div>
        </div>

        <div class="mb-6">
          <VLabel class="mb-2">{{ $t('sector') }}</VLabel>
          <VSelect
            v-model="selectedSectorId"
            :items="availableSectors"
            item-title="name"
            item-value="sector_id"
            :placeholder="$t('select_sector')"
            variant="outlined"
            density="comfortable"
            clearable
          >
            <template #item="{ props, item }">
              <VListItem v-bind="props" :title="item.raw.name">
                <template #prepend>
                  <VAvatar :color="item.raw.color" size="24" class="me-2" />
                </template>
              </VListItem>
            </template>
          </VSelect>
        </div>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="handleCancelSelectChannelSector"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          :disabled="!selectedWorkerId || chatStore.loading"
          :loading="chatStore.loading"
          @click="handleOpenConversation"
        >
          {{ $t('open_conversation') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss">
.chat-list {
  --chat-content-spacing-x: 16px;

  padding-block-end: 0.75rem;

  .chat-header {
    margin-block: 0.5rem 0.25rem;
  }

  .chat-header,
  .no-chat-items-text {
    margin-inline: var(--chat-content-spacing-x);
  }
}

.chat-list-search {
  .v-field--focused {
    box-shadow: none !important;
  }
}

.contact-item {
  border-radius: 8px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    opacity 0.2s ease;
  border: 1px solid transparent;

  &:hover {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  &--editing {
    background-color: rgba(var(--v-theme-primary), 0.08);
    border-color: rgba(var(--v-theme-primary), 0.3);
  }

  &--not-validated {
    opacity: 0.6;

    &:hover {
      background-color: rgba(var(--v-theme-error), 0.04);
    }
  }
}

.contact-validation-chip {
  font-size: 0.5rem;
  height: 16px;
  min-width: 16px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s ease;

  &--validated {
    background-color: rgba(var(--v-theme-success), 0.12) !important;
    color: rgb(var(--v-theme-success)) !important;
  }

  &--not-validated {
    background-color: rgba(var(--v-theme-error), 0.12) !important;
    color: rgb(var(--v-theme-error)) !important;
  }

  .v-icon {
    font-size: 10px;
    width: 10px;
    height: 10px;
  }
}

.contact-action-btn {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.contact-item:hover .contact-action-btn {
  opacity: 1;
}

.contact-item:hover .contact-validation-chip {
  opacity: 0;
}

.chat-filter-options {
  .d-flex {
    width: 100%;
  }

  .chat-filter-item {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-width: 0;
  }

  .chat-filter-btn {
    min-height: 48px;
    border-radius: 8px;
    padding: 8px;
    text-transform: none;
    font-weight: 400;
    min-width: 0;

    .v-btn__content {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }

  .chat-filter-expanded-full {
    text-align: center;
    padding: 8px 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: rgb(var(--v-theme-on-surface));
    border-radius: 8px;
    background: rgba(var(--v-theme-primary), 0.08);
    margin-top: 8px;
    width: 100%;
  }
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  max-height: 50px;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
