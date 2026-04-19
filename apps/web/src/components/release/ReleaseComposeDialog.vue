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
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import DialogCloseBtn from '@/@webcore/components/DialogCloseBtn.vue';
import ReleaseHtmlEditor from './ReleaseHtmlEditor.vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    release?: ViewReleaseResponse | null;
  }>(),
  { release: null }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'created'): void;
  (e: 'updated'): void;
}>();

const { t } = useI18n();
const releaseStore = useReleaseStore();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isEditMode = computed(() => !!props.release);

const type = ref<EReleaseType>(EReleaseType.informative);
const title = ref('');
const message = ref('');
const reminderAtLocal = ref('');
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
  { value: EReleaseType.reminder, title: t('release_type_reminder') },
]);

const isoToDatetimeLocalValue = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const resetValues = () => {
  type.value = EReleaseType.informative;
  title.value = '';
  message.value = '';
  reminderAtLocal.value = '';
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

watch(type, (next) => {
  if (next !== EReleaseType.reminder) {
    reminderAtLocal.value = '';
  }
});

watch(
  () => [props.modelValue, props.release] as const,
  ([visible, r]) => {
    if (visible && r) {
      type.value = r.type;
      title.value = r.title ?? '';
      message.value = r.message ?? '';
      reminderAtLocal.value =
        r.type === EReleaseType.reminder && r.reminder_at
          ? isoToDatetimeLocalValue(r.reminder_at)
          : '';
    }
    if (visible && !r) {
      resetValues();
    }
  },
  { immediate: true }
);

const submit = async () => {
  if (!title.value || !message.value) return;
  if (type.value === EReleaseType.reminder && !reminderAtLocal.value) return;

  loading.value = true;

  try {
    if (isEditMode.value && props.release) {
      const ok = await releaseStore.updateRelease(props.release.release_id, {
        type: type.value,
        title: title.value,
        message: message.value,
        ...(type.value === EReleaseType.reminder
          ? {
              reminder_at: new Date(reminderAtLocal.value).toISOString(),
            }
          : {}),
      });
      if (ok) {
        resetValues();
        emit('updated');
        isVisible.value = false;
      }
      return;
    }

    const request: Record<string, unknown> = {
      type: type.value,
      title: title.value,
      message: message.value,
    };

    if (type.value === EReleaseType.reminder) {
      request.reminder_at = new Date(reminderAtLocal.value).toISOString();
    }

    if (recipientType.value === 'all') {
      request.account_id = null;
      request.user_id = null;
      request.permission_role_id = null;
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
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard class="release-compose-dialog compose-dialog-card d-flex flex-column">
      <VCardItem class="py-3 px-6 flex-shrink-0">
        <h5 class="text-h5">
          {{ isEditMode ? $t('edit_release') : $t('add_release') }}
        </h5>
      </VCardItem>

      <VDivider class="flex-shrink-0" />

      <VCardText class="compose-dialog-scroll flex-grow-1 overflow-y-auto pa-0">
        <div class="px-6 py-4">
          <AppSelectSearch
            v-model="type"
            :items="typeOptions"
            :label="$t('type')"
            item-value="value"
            item-title="title"
          />
        </div>

        <template v-if="type === EReleaseType.reminder">
          <VDivider />

          <div class="px-6 py-4">
            <VTextField
              v-model="reminderAtLocal"
              type="datetime-local"
              :label="$t('release_reminder_datetime')"
              density="compact"
            />
          </div>
        </template>

        <template v-if="!isEditMode">
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
        </template>

        <VDivider />

        <div class="px-6 py-4">
          <VTextField v-model="title" :label="$t('title')" density="compact" />
        </div>

        <VDivider />

        <div class="px-6 py-4">
          <ReleaseHtmlEditor v-model="message" :placeholder="$t('message')" />
        </div>
      </VCardText>

      <VDivider class="flex-shrink-0" />

      <VCardActions class="compose-dialog-actions flex-shrink-0 flex-wrap justify-end gap-3 pa-4">
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
          variant="elevated"
          :disabled="
            title === '' ||
            message === '' ||
            loading ||
            (type === EReleaseType.reminder && reminderAtLocal === '') ||
            (!isEditMode &&
              ((recipientType === 'account' && !selectedAccountId) ||
                (recipientType === 'permission_role' &&
                  !selectedPermissionRoleId) ||
                (recipientType === 'user' && !selectedUserId)))
          "
          :loading="loading"
          @click="submit"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style lang="scss">
@use '@webcore/scss/base/mixins';

.compose-dialog-card {
  max-block-size: min(90vh, 52rem);
}

.compose-dialog-scroll {
  min-block-size: 0;
}

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
