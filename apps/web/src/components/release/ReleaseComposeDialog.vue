<script lang="ts" setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EReleaseType } from '@core/common/enums/EReleaseType';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { can } from '@/@layouts/plugins/casl';
import { useReleaseStore } from '@/@webcore/stores/release';
import { getUser } from '@/@webcore/localStorage/user';
import { EColor } from '@core/common/enums/EColor';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created'): void;
}>();

const { t } = useI18n();
const releaseStore = useReleaseStore();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const type = ref<EReleaseType>(EReleaseType.informative);
const title = ref('');
const message = ref('');
const recipientType = ref<'all' | 'account' | 'permission_role' | 'user'>(
  'all'
);
const selectedAccountId = ref<string | null>(null);
const selectedPermissionRoleId = ref<string | null>(null);
const selectedUserId = ref<string | null>(null);
const loading = ref(false);

const currentUser = computed(() => getUser());
const hasFullAccess = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const recipientTypeOptions = computed(() => {
  const options = [
    { value: 'all', title: t('all') },
    { value: 'permission_role', title: t('permission_groups') },
    { value: 'user', title: t('user') },
  ];

  if (hasFullAccess.value) {
    options.splice(1, 0, { value: 'account', title: t('account') });
  }

  return options;
});

const accountOptions = ref<{ id: string; name: string }[]>([]);
const permissionRoleOptions = ref<{ id: string; name: string }[]>([]);
const userOptions = ref<{ id: string; name: string }[]>([]);

const loadAccounts = async () => {
  if (!hasFullAccess.value) return;

  try {
    const accounts = await releaseStore.listReleaseAccounts();
    if (accounts) {
      accountOptions.value = accounts.map((acc) => ({
        id: acc.account_id,
        name: acc.name,
      }));
    }
  } catch (error) {
    console.error('Error loading accounts:', error);
  }
};

const loadPermissionRoles = async () => {
  try {
    const roles = await releaseStore.listReleasePermissionRoles();
    if (roles) {
      permissionRoleOptions.value = roles;
    }
  } catch (error) {
    console.error('Error loading permission roles:', error);
  }
};

const loadUsers = async () => {
  try {
    const users = await releaseStore.listReleaseUsers();
    if (users) {
      userOptions.value = users.map((u) => ({
        id: u.user_id,
        name: u.name,
      }));
    }
  } catch (error) {
    console.error('Error loading users:', error);
  }
};

const typeOptions = computed(() => [
  { value: EReleaseType.news, title: t('release_type_news') },
  { value: EReleaseType.informative, title: t('release_type_informative') },
  { value: EReleaseType.maintenance, title: t('release_type_maintenance') },
  { value: EReleaseType.update, title: t('release_type_update') },
  { value: EReleaseType.fix, title: t('release_type_fix') },
  { value: EReleaseType.warning, title: t('release_type_warning') },
]);

const resetValues = () => {
  type.value = EReleaseType.informative;
  title.value = '';
  message.value = '';
  recipientType.value = 'all';
  selectedAccountId.value = null;
  selectedPermissionRoleId.value = null;
  selectedUserId.value = null;
};

watch(recipientType, () => {
  selectedAccountId.value = null;
  selectedPermissionRoleId.value = null;
  selectedUserId.value = null;
});

const createRelease = async () => {
  if (!title.value || !message.value) return;

  loading.value = true;

  try {
    const request: Record<string, unknown> = {
      type: type.value,
      title: title.value,
      message: message.value,
    };

    if (recipientType.value === 'all') {
      if (hasFullAccess.value) {
        request.account_id = null;
        request.user_id = null;
        request.permission_role_id = null;
      } else {
        request.account_id = currentUser.value?.account_id || null;
      }
    } else if (recipientType.value === 'account') {
      if (!hasFullAccess.value) {
        releaseStore.showSnackbar(
          t('release_create_account_permission_error'),
          EColor.error
        );
        loading.value = false;
        return;
      }
      request.account_id = selectedAccountId.value;
      request.user_id = null;
      request.permission_role_id = null;
    } else if (recipientType.value === 'permission_role') {
      request.permission_role_id = selectedPermissionRoleId.value;
      request.account_id = null;
      request.user_id = null;
    } else if (recipientType.value === 'user') {
      request.user_id = selectedUserId.value;
      request.account_id = null;
      request.permission_role_id = null;
    }

    const response = await releaseStore.createRelease(
      request as CreateReleaseRequest
    );

    if (response) {
      resetValues();
      emit('created');
      isVisible.value = false;
    }
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (hasFullAccess.value) {
    await loadAccounts();
  }
  await loadPermissionRoles();
  await loadUsers();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" scrollable>
    <DialogCloseBtn @click="isVisible = false" />

    <VCard class="release-compose-dialog">
      <VCardItem class="py-3 px-6">
        <h5 class="text-h5">
          {{ $t('add_release') }}
        </h5>
      </VCardItem>

    <VDivider />

    <div class="px-6 py-4">
      <AppSelectSearch
        v-model="type"
        :items="typeOptions"
        :label="$t('type')"
        item-value="value"
        item-title="title"
      />
    </div>

    <VDivider />

    <div class="px-6 py-4">
      <AppSelectSearch
        v-model="recipientType"
        :items="recipientTypeOptions"
        :label="$t('recipient')"
        item-value="value"
        item-title="title"
      />
    </div>

    <VDivider v-if="recipientType === 'account'" />

    <div v-if="recipientType === 'account'" class="px-6 py-4">
      <AppSelectSearch
        v-model="selectedAccountId"
        :items="accountOptions"
        :label="$t('account')"
        item-value="id"
        item-title="name"
      />
    </div>

    <VDivider v-if="recipientType === 'permission_role'" />

    <div v-if="recipientType === 'permission_role'" class="px-6 py-4">
      <AppSelectSearch
        v-model="selectedPermissionRoleId"
        :items="permissionRoleOptions"
        :label="$t('permission_groups')"
        item-value="id"
        item-title="name"
      />
    </div>

    <VDivider v-if="recipientType === 'user'" />

    <div v-if="recipientType === 'user'" class="px-6 py-4">
      <AppSelectSearch
        v-model="selectedUserId"
        :items="userOptions"
        :label="$t('user')"
        item-value="id"
        item-title="name"
      />
    </div>

    <VDivider />

    <div class="px-6 py-4">
      <VTextField v-model="title" :label="$t('title')" density="compact" />
    </div>

    <VDivider />

    <div class="px-6 py-4">
      <TiptapEditor v-model="message" :placeholder="$t('message')" />
    </div>

    <VCardText class="d-flex justify-end flex-wrap gap-3">
      <VBtn
        variant="tonal"
        color="secondary"
        :disabled="loading"
        @click="
          isVisible = false;
          resetValues();
        "
      >
        {{ $t('close') }}
      </VBtn>
      <VBtn
        color="primary"
        append-icon="tabler-send"
        :disabled="
          title === '' ||
          message === '' ||
          loading ||
          (recipientType === 'account' && !selectedAccountId) ||
          (recipientType === 'permission_role' && !selectedPermissionRoleId) ||
          (recipientType === 'user' && !selectedUserId)
        "
        :loading="loading"
        @click="createRelease"
      >
        {{ $t('save') }}
      </VBtn>
    </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss">
@use '@webcore/scss/base/mixins';

.release-compose-dialog {
  .v-card-item {
    background-color: rgba(var(--v-theme-on-surface), var(--v-hover-opacity));
  }

  .v-field__outline {
    display: none;
  }
}

.release-compose-dialog {
  .ProseMirror {
    p {
      margin-block-end: 0;
    }

    padding: 1.5rem;
    block-size: 100px;
    overflow-y: auto;
    padding-block: 0.5rem;

    &:focus-visible {
      outline: none;
    }

    p.is-editor-empty:first-child::before {
      block-size: 0;
      color: #adb5bd;
      content: attr(data-placeholder);
      float: inline-start;
      pointer-events: none;
    }

    ul,
    ol {
      padding-inline: 1.125rem;
    }

    &-focused {
      outline: none;
    }
  }
}
</style>
