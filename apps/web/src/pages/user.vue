<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { DataTableHeader, useTheme } from 'vuetify';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';
import { useUsersStore } from '@/@webcore/stores/user';
import { ListUserResponse } from '@core/schema/user/listUser/response.schema';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { resolveAvatarBadgeVariant } from '@webcore/utils/formatters';
import { getUser } from '@/@webcore/localStorage/user';
import { can } from '@/@layouts/plugins/casl';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useAccountStore } from '@/@webcore/stores/account';
import { useAuthStore } from '@/@webcore/stores/auth';
import { applyLayoutTheme } from '@/@webcore/utils/applyLayoutTheme';
import { useConfigStore } from '@webcore/stores/config';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { resetConnection } from '@/@webcore/centrifugo';
import { resetPresencePermissionError } from '@/@webcore/presence';
import { useChatStore } from '@/@webcore/stores/chat';
import { EColor } from '@core/common/enums/EColor';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { EAccountFilterStatus } from '@core/common/enums/EAccountFilterStatus';
import { useRouter } from 'vue-router';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EUserPermissions.user_group,
      EUserPermissions.user_view,
      EUserPermissions.user_create,
      EUserPermissions.user_update,
      EUserPermissions.user_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_create,
];
const permissionsAssignRole = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERolePermissions.role_group,
  ERolePermissions.role_view,
];

const { t } = useI18n();
const { global } = useTheme();
const router = useRouter();
const userStore = useUsersStore();
const accountStore = useAccountStore();
const authStore = useAuthStore();
const configStore = useConfigStore();
const layoutStore = useLayoutConfigStore();
const vuetifyTheme = useTheme();
const chatStore = useChatStore();
useSnackbarCleanup(userStore);

const currentUser = computed(() => getUser());
const currentUserRoleId = computed(
  () => currentUser.value?.type?.user_type_id ?? null
);
const hasFullAccess = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);
const isCurrentUserAdministrator = computed(
  () => currentUserRoleId.value === EPermissionRole.administrator
);

const permissionsSessionLogin = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
];

const canAssignRole = (userId: string) => {
  if (!can(permissionsAssignRole)) {
    return false;
  }

  return currentUser.value?.user_id !== userId;
};

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
]);

const itemsStatus = ref([
  { id: '', text: t('all') },
  { id: EUserStatus.active, text: t('active') },
  { id: EUserStatus.inactive, text: t('inactive') },
  { id: EUserStatus.blocked, text: t('blocked') },
]);

const itemsAccount = ref<Array<{ id: string; text: string }>>([]);
const accountsLoading = ref(false);
const itemsPermissionRole = ref<Array<{ id: string; text: string }>>([]);
const rolesLoading = ref(false);

const loadAccounts = async () => {
  if (!hasFullAccess.value || itemsAccount.value.length > 0) return;

  accountsLoading.value = true;
  try {
    const accounts = await accountStore.listAllAccounts();
    itemsAccount.value = [
      { id: '', text: t('all') },
      ...accounts.map((acc) => ({
        id: acc.account_id,
        text: acc.name,
      })),
    ];
  } catch (error) {
    console.error('Erro ao carregar accounts:', error);
  } finally {
    accountsLoading.value = false;
  }
};

type SelectValue = string | number | boolean | null;
type SelectModelValue = SelectValue | SelectValue[];

const handleAccountIdChange = (value: SelectModelValue) => {
  const singleValue = Array.isArray(value) ? (value[0] ?? null) : value;

  if (singleValue === null || singleValue === undefined) {
    options.value.account_id = undefined;
  } else if (singleValue === '' || singleValue === 0) {
    options.value.account_id = 'all';
  } else {
    options.value.account_id = String(singleValue);
  }

  if (options.value.account_id === 'all') {
    options.value.permission_role_id = null;
  }

  options.value.page = 1;
};

const isDialogDeleterShow = ref(false);
const userToDelete = ref<string | null>(null);

const isDialogEditUserShow = ref(false);
const isAddUserVisible = ref(false);
const userToEdit = ref<string | null>(null);

const isAssignRoleDialogShow = ref(false);
const userToAssignRole = ref<string | null>(null);
const isAttendanceHoursDialogShow = ref(false);
const userToAttendanceHours = ref<string | null>(null);

const photoViewerOpen = ref(false);
const photoViewerSrc = ref<string>('');
const photoViewerDownloadName = ref<string>('user-photo.jpg');
const switchingSession = ref(false);
const isDialogSessionLoginShow = ref(false);
const userToSessionLogin = ref<string | null>(null);

const resolvePresenceLabel = (status?: EChatUserStatus | null): string => {
  if (!status) {
    return t('offline');
  }

  return t(status);
};

const headers = computed<DataTableHeader<ListUserResponse>[]>(() => {
  const baseHeaders: DataTableHeader<ListUserResponse>[] = [
    { title: '', key: 'photo', sortable: false, width: '80px' },
  ];

  if (hasFullAccess.value) {
    baseHeaders.push(
      { title: t('account'), key: 'account' },
      { title: t('name'), key: 'name' }
    );
  } else {
    baseHeaders.push(
      { title: t('name'), key: 'name' },
      { title: t('cargo'), key: 'permission_role' }
    );
  }

  baseHeaders.push(
    { title: t('status'), key: 'status' },
    { title: t('email'), key: 'email_partial' },
    { title: t('phone'), key: 'phone_partial' },
    { title: t('document'), key: 'document_partial' },
    { title: t('created_at'), key: 'created_at' },
    { title: t('actions'), key: 'actions', sortable: false }
  );

  return baseHeaders;
});

const options = ref({
  page: 1,
  itemsPerPage: 10,
  sortBy: [] as SortRequest[],
  user_status: null as string | null,
  permission_role_id: null as string | null,
  account_id: undefined as string | null | undefined,
  search: null as string | null,
});

const roleFilterDisabled = computed(
  () => hasFullAccess.value && options.value.account_id === 'all'
);

const roleFilterAccountId = computed(() => {
  if (!hasFullAccess.value) {
    return null;
  }

  if (options.value.account_id === 'all') {
    return null;
  }

  if (options.value.account_id) {
    return options.value.account_id;
  }

  return currentUser.value?.account_id ?? null;
});

const includeMasterRoleOption = (
  items: Array<{ id: string; text: string }>
): Array<{ id: string; text: string }> => {
  if (!isCurrentUserAdministrator.value) {
    return items;
  }

  const hasMasterOption = items.some(
    (item) => item.id === EPermissionRole.master
  );

  if (hasMasterOption) {
    return items;
  }

  return [
    ...items,
    {
      id: EPermissionRole.master,
      text: 'Master',
    },
  ];
};

const loadPermissionRoles = async () => {
  if (roleFilterDisabled.value) {
    itemsPermissionRole.value = includeMasterRoleOption([
      { id: '', text: t('all') },
    ]);
    return;
  }

  rolesLoading.value = true;
  try {
    const roles = await userStore.listUserRoles(roleFilterAccountId.value);
    itemsPermissionRole.value = includeMasterRoleOption([
      { id: '', text: t('all') },
      ...(roles ?? []).map((role) => ({
        id: role.id,
        text: role.name,
      })),
    ]);

    if (
      options.value.permission_role_id &&
      !itemsPermissionRole.value.some(
        (item) => item.id === options.value.permission_role_id
      )
    ) {
      options.value.permission_role_id = null;
    }
  } catch (error) {
    console.error('Erro ao carregar grupos de acesso:', error);
    itemsPermissionRole.value = includeMasterRoleOption([
      { id: '', text: t('all') },
    ]);
  } finally {
    rolesLoading.value = false;
  }
};

const debouncedSearch = refDebounced(
  computed(() => options.value.search),
  500
);

const query = computed(() => {
  const q: any = {
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    user_status: options.value.user_status,
    search: debouncedSearch.value,
  };

  if (options.value.permission_role_id) {
    q.permission_role_id = options.value.permission_role_id;
  }

  if (hasFullAccess.value && options.value.account_id !== undefined) {
    q.account_id = options.value.account_id;
  }

  return q;
});

const userDisplayName = (item: ListUserResponse): string => {
  if (!item.user_info?.name) {
    return '-';
  }

  return `${item.user_info.name} ${item.user_info.last_name || ''}`.trim();
};

const isMasterUser = (item: ListUserResponse): boolean =>
  item.permission_role?.permission_role_id === EPermissionRole.master;

const openAccountFiltered = (item: ListUserResponse) => {
  const accountId = item.account?.account_id;

  if (!accountId) {
    return;
  }

  router.push({
    name: 'account-all',
    query: {
      account_id: accountId,
      filter_status: EAccountFilterStatus.all,
    },
  });
};

const handleTableChange = (o: {
  page: number;
  itemsPerPage: number;
  sortBy: SortRequest[];
}) => {
  options.value.page = o.page;
  options.value.itemsPerPage = o.itemsPerPage;
  options.value.sortBy = o.sortBy;
};

const deleteUser = async (id: string) => {
  userToDelete.value = id;

  isDialogDeleterShow.value = true;
};

const handleDelete = async () => {
  if (!userToDelete.value) return;

  const result = await userStore.deleteUser(userToDelete.value);
  if (result) {
    await userStore.listUsers(query.value);
  }

  userToDelete.value = null;
};

const handleUserCreated = async () => {
  await userStore.listUsers(query.value);
};

const handleUserUpdated = async () => {
  await userStore.listUsers(query.value);
};

const handleRoleAssigned = async () => {
  await userStore.listUsers(query.value);
};

const handleAttendanceHoursUpdated = async () => {
  await userStore.listUsers(query.value);
};

const openEditDialog = (id: string) => {
  userToEdit.value = id;

  isDialogEditUserShow.value = true;
};

const openAssignRoleDialog = (id: string) => {
  userToAssignRole.value = id;
  isAssignRoleDialogShow.value = true;
};

const openAttendanceHoursDialog = (id: string) => {
  userToAttendanceHours.value = id;
  isAttendanceHoursDialogShow.value = true;
};

const openPhotoViewer = (photoUrl: string | null) => {
  if (!photoUrl) return;
  photoViewerSrc.value = photoUrl;
  photoViewerDownloadName.value = `user-photo-${Date.now()}.jpg`;
  photoViewerOpen.value = true;
};

const downloadPhoto = async (url: string, filename?: string | null) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'user-photo.jpg';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    console.error('Erro ao baixar imagem:', error);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'user-photo.jpg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const openSessionLoginDialog = (userId: string) => {
  userToSessionLogin.value = userId;
  isDialogSessionLoginShow.value = true;
};

const handleSessionLogin = async () => {
  if (!userToSessionLogin.value || switchingSession.value) return;

  switchingSession.value = true;

  try {
    const success = await authStore.userSessionLogin(userToSessionLogin.value);

    if (!success) {
      const errorMessage = authStore.snackbar.message || t('login_error');
      userStore.showSnackbar(errorMessage, authStore.snackbar.color);
      userToSessionLogin.value = null;

      return;
    }

    try {
      applyLayoutTheme(authStore.layout, {
        configStore,
        layoutStore,
        vuetifyTheme,
      });
    } catch (error) {
      console.error('Failed to apply layout/theme after login', error);
    }

    resetConnection();
    resetPresencePermissionError();

    chatStore.updateUser();
    const permissions = authStore.permissions;

    const userAbilityRules = permissions.map((permission) => ({
      action: permission,
      subject: permission,
    }));

    try {
      const { ability: abilityInstance } =
        await import('@/plugins/0.casl/ability');
      abilityInstance.update(userAbilityRules);
    } catch (error) {
      console.error('Failed to update permissions after login', error);
    }

    await nextTick();
    userToSessionLogin.value = null;

    setTimeout(() => {
      globalThis.location.reload();
    }, 100);
  } catch (error) {
    console.error('Error switching session', error);
    const errorMessage = authStore.snackbar.message || t('login_error');
    userStore.showSnackbar(errorMessage, EColor.error);
  } finally {
    switchingSession.value = false;
  }
};

watch(
  hasFullAccess,
  async (hasAccess) => {
    if (hasAccess) {
      await loadAccounts();
    }
  },
  { immediate: true }
);

watch(
  [hasFullAccess, () => options.value.account_id],
  async () => {
    if (options.value.account_id === 'all') {
      options.value.permission_role_id = null;
    }

    await loadPermissionRoles();
  },
  { immediate: true }
);

watch(
  query,
  async (q) => {
    await userStore.listUsers(q);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div>
    <VCard :title="$t('users')" no-padding>
      <VCardText>
        <div class="d-flex justify-space-between flex-wrap gap-4">
          <div class="d-flex gap-4 align-center mt-5">
            <div class="d-flex align-center gap-x-2">
              <div>{{ $t('show') }}</div>
              <AppSelect
                :model-value="options.itemsPerPage"
                :items="itemsPerPage"
                @update:model-value="
                  options.itemsPerPage = parseInt($event, 10)
                "
              />
            </div>

            <VBtn
              v-if="$canPermission(permissionsCreate)"
              prepend-icon="tabler-plus"
              @click="isAddUserVisible = true"
            >
              {{ $t('add') }}
            </VBtn>
          </div>
          <div class="d-flex align-center flex-wrap gap-4">
            <div v-if="hasFullAccess" class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('account') }}:</VLabel>
              <AppSelectSearch
                :model-value="
                  options.account_id === 'all' ? '' : options.account_id || null
                "
                @update:modelValue="handleAccountIdChange"
                :items="itemsAccount"
                :placeholder="$t('select_account')"
                :loading="accountsLoading"
                :clearable="true"
                item-value="id"
                item-title="text"
              />
            </div>
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('status') }}:</VLabel>
              <AppSelectSearch
                v-model="options.user_status"
                :items="itemsStatus"
                :placeholder="$t('select_state')"
                :clearable="true"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
            <div class="status-filter">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('access_group') }}:</VLabel
              >
              <AppSelectSearch
                v-model="options.permission_role_id"
                :items="itemsPermissionRole"
                :placeholder="$t('select_role')"
                :clearable="true"
                :loading="rolesLoading"
                :disabled="roleFilterDisabled"
                item-value="id"
                item-title="text"
                @update:modelValue="options.page = 1"
              />
            </div>
            <div class="invoice-list-filter">
              <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
              <AppTextField
                :placeholder="$t('search') + '...'"
                append-inner-icon="tabler-search"
                single-line
                hide-details
                dense
                outlined
                v-model="options.search"
              />
            </div>
          </div>
        </div>

        <VDivider class="my-4" />

        <div>
          <VDataTableServer
            class="data-table"
            v-model:page="options.page"
            v-model:items-per-page="options.itemsPerPage"
            :headers="headers"
            :items="userStore.list"
            :items-length="userStore.pagings.total"
            :loading="userStore.loading"
            :sort-by="options.sortBy"
            @update:options="handleTableChange"
            :loading-text="$t('loading_text')"
          >
            <template #item.photo="{ item }">
              <VTooltip location="top" transition="scale-transition">
                <template #activator="{ props }">
                  <VBadge
                    v-bind="props"
                    dot
                    location="bottom right"
                    offset-x="3"
                    offset-y="3"
                    bordered
                    :color="
                      resolveAvatarBadgeVariant(
                        (item.chat_user?.status as EChatUserStatus) ||
                          EChatUserStatus.offline,
                        global.name.value === 'dark'
                      )
                    "
                  >
                    <div
                      class="user-photo-square"
                      :class="{ 'cursor-pointer': item.user_info?.photo }"
                      @click="
                        item.user_info?.photo &&
                        openPhotoViewer(item.user_info.photo)
                      "
                    >
                      <VImg
                        v-if="item.user_info?.photo"
                        :src="item.user_info.photo"
                        alt="User photo"
                        cover
                      />
                      <VImg
                        v-else
                        :src="'/images/svg/avatar-default.svg'"
                        alt="Default avatar"
                        cover
                      />
                    </div>
                  </VBadge>
                </template>
                <span>
                  {{
                    resolvePresenceLabel(
                      (item.chat_user?.status as EChatUserStatus) ||
                        EChatUserStatus.offline
                    )
                  }}
                </span>
              </VTooltip>
            </template>

            <template #item.account="{ item }">
              <button
                v-if="item.account?.account_id && item.account?.name"
                type="button"
                class="account-link"
                @click="openAccountFiltered(item)"
              >
                {{ item.account.name }}
              </button>
              <span v-else>-</span>
            </template>

            <template #item.name="{ item }">
              <div class="d-flex align-center gap-1">
                <VIcon
                  v-if="isMasterUser(item)"
                  icon="tabler-crown"
                  size="16"
                  color="warning"
                />
                <span>{{ userDisplayName(item) }}</span>
              </div>
            </template>

            <template #item.permission_role="{ item }">
              {{ item.permission_role?.name || '-' }}
            </template>

            <template #item.status="{ item }">
              <VChip
                v-if="item.user_status"
                :color="
                  item.user_status.user_status_id === EUserStatus.active
                    ? 'success'
                    : item.user_status.user_status_id === EUserStatus.blocked
                      ? 'error'
                      : 'warning'
                "
                size="small"
                variant="tonal"
              >
                {{
                  item.user_status.user_status_id === EUserStatus.active
                    ? $t('active')
                    : item.user_status.user_status_id === EUserStatus.blocked
                      ? $t('blocked')
                      : $t('inactive')
                }}
              </VChip>
              <span v-else class="text-medium-emphasis">-</span>
            </template>

            <template #item.phone_partial="{ item }">
              {{ item.user_info?.phone_partial || '-' }}
            </template>

            <template #item.document_partial="{ item }">
              {{ item.user_document?.document_partial || '-' }}
            </template>

            <template #item.created_at="{ item }">
              <span>{{ formatDateTime(item.created_at ?? null) }}</span>
            </template>

            <template #item.actions="{ item }">
              <div class="d-flex gap-1">
                <IconBtn
                  v-if="
                    $canPermission(permissionsSessionLogin) &&
                    currentUser?.user_id !== item.user_id
                  "
                  :disabled="switchingSession"
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('login_as_user') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-login"
                    @click="openSessionLoginDialog(item.user_id)"
                  />
                </IconBtn>

                <IconBtn v-if="canAssignRole(item.user_id)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('assign_role') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-user-plus"
                    @click="openAssignRoleDialog(item.user_id)"
                  />
                </IconBtn>

                <IconBtn v-if="$canPermission(permissionsEdit)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('edit_user') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-edit"
                    @click="openEditDialog(item.user_id)"
                  />
                </IconBtn>

                <IconBtn v-if="$canPermission(permissionsEdit)">
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('attendance_hours_action') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-clock"
                    @click="openAttendanceHoursDialog(item.user_id)"
                  />
                </IconBtn>

                <IconBtn
                  v-if="
                    $canPermission(permissionsDelete) &&
                    currentUser?.user_id !== item.user_id
                  "
                >
                  <VTooltip
                    location="top"
                    transition="scale-transition"
                    activator="parent"
                  >
                    <span>{{ $t('delete_user') }}</span>
                  </VTooltip>
                  <VIcon
                    icon="tabler-trash"
                    @click="deleteUser(item.user_id)"
                  />
                </IconBtn>
              </div>
            </template>

            <template #no-data>
              {{ $t('no_data_available') }}
            </template>

            <template #bottom>
              <TablePagination
                v-model:page="options.page"
                :items-per-page="options.itemsPerPage"
                :total-items="userStore.pagings.total"
              />
            </template>
          </VDataTableServer>
        </div>
      </VCardText>

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_user')"
        :message="$t('delete_user_confirmation')"
        @confirm="handleDelete"
      />

      <VDialogHandler
        v-if="isDialogSessionLoginShow"
        v-model="isDialogSessionLoginShow"
        :title="$t('login_as_user')"
        :message="$t('login_as_user_confirmation')"
        @confirm="handleSessionLogin"
      />

      <AppEditUser
        v-if="isDialogEditUserShow"
        v-model="isDialogEditUserShow"
        :user-id="userToEdit"
        @user-updated="handleUserUpdated"
      />

      <AppAddUser
        v-if="isAddUserVisible"
        v-model="isAddUserVisible"
        @user-created="handleUserCreated"
      />

      <AppAssignUserRole
        v-if="isAssignRoleDialogShow"
        v-model="isAssignRoleDialogShow"
        :user-id="userToAssignRole"
        @role-assigned="handleRoleAssigned"
      />

      <AppUserAttendanceHours
        v-if="isAttendanceHoursDialogShow"
        v-model="isAttendanceHoursDialogShow"
        :user-id="userToAttendanceHours"
        @updated="handleAttendanceHoursUpdated"
      />
    </VCard>

    <VDialog
      v-model="photoViewerOpen"
      fullscreen
      scrim="rgba(0,0,0,.9)"
      :scrollable="false"
    >
      <div class="viewer-wrap" @click="photoViewerOpen = false">
        <div class="viewer-box" @click.stop>
          <div class="viewer-media-container">
            <img
              v-if="photoViewerSrc"
              :src="photoViewerSrc"
              alt="User"
              class="viewer-img"
              loading="eager"
              decoding="async"
            />

            <div class="viewer-actions">
              <VBtn
                v-if="photoViewerSrc"
                class="viewer-download"
                icon
                size="36"
                variant="text"
                @click.stop="
                  downloadPhoto(photoViewerSrc, photoViewerDownloadName)
                "
              >
                <VIcon size="20">tabler-download</VIcon>
              </VBtn>
              <VBtn
                class="viewer-close"
                icon
                size="36"
                variant="text"
                @click="photoViewerOpen = false"
              >
                <VIcon size="20">tabler-x</VIcon>
              </VBtn>
            </div>
          </div>
        </div>
      </div>
    </VDialog>

    <VSnackbar
      v-model="userStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="userStore.snackbar.color"
    >
      {{ userStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.status-filter {
  inline-size: 12rem;
}

.invoice-list-filter {
  inline-size: 20rem;
}

.account-link {
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  &:hover {
    opacity: 0.85;
  }
}

.user-photo-square {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  display: inline-block;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 0.8;
  }

  :deep(.v-img) {
    width: 100%;
    height: 100%;
  }
}

.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 90vh;
}

.viewer-media-container {
  position: relative;
  display: inline-block;
  max-width: 100%;
  max-height: 100%;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 10;
}

.viewer-close,
.viewer-download {
  color: white !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 50%;
  min-width: 36px;
  height: 36px;

  &:hover {
    background: rgba(0, 0, 0, 0.7) !important;
  }
}

.data-table {
  :deep(.v-table__wrapper > table > thead) {
    background-color: rgba(var(--v-theme-on-surface), 0.04);
  }

  :deep(.v-table__wrapper > table > thead > tr > th) {
    background-color: transparent;
    color: rgb(var(--v-theme-primary));
    font-weight: 700;
    border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
  }

  :deep(
    .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
  ) {
    color: inherit;
  }
}
</style>
