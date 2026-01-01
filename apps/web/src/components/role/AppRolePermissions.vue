<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePermissionStore } from '@/@webcore/stores/permission';
import {
  ListPermissionGroupsResponse,
  PermissionActionGroupResponse,
  PermissionActionResponse,
} from '@core/schema/permission/listPermissionGroups/response.schema';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';

type PermissionActionWithState = PermissionActionResponse & {
  selected: boolean;
  disabled: boolean;
};

type PermissionGroupWithState = Omit<
  PermissionActionGroupResponse,
  'permissions'
> & {
  selected: boolean;
  disabled: boolean;
  permissions: PermissionActionWithState[];
};

const props = defineProps<{
  modelValue: boolean;
  permissionRoleId: string | null;
  canEdit?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const { t } = useI18n();
const permissionRoleId = toRef(props, 'permissionRoleId');
const permissionStore = usePermissionStore();

const canEdit = computed(() => props.canEdit ?? true);

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const groups = ref<PermissionGroupWithState[]>([]);
const isLoading = ref(false);

const fullAccessGroup = computed(() =>
  groups.value.find(
    (group) => group.action === EGeneralPermissions.full_access_group
  )
);

const fullAccessGroupDefined = computed((): PermissionGroupWithState | null => {
  return fullAccessGroup.value ?? null;
});

const otherGroups = computed(() =>
  groups.value.filter(
    (group) => group.action !== EGeneralPermissions.full_access_group
  )
);

const mapGroupsToState = (
  data: ListPermissionGroupsResponse
): PermissionGroupWithState[] =>
  data.map((group) => ({
    ...group,
    selected: false,
    disabled: false,
    permissions: group.permissions.map((permission) => ({
      ...permission,
      selected: false,
      disabled: false,
    })),
  }));

const updatePermissionsState = (
  permissions: PermissionActionWithState[],
  value: boolean
) => {
  for (const permission of permissions) {
    permission.selected = value;
    permission.disabled = value;
  }
};

const updateOtherGroupsForFullAccess = (
  currentGroup: PermissionGroupWithState,
  value: boolean
) => {
  for (const otherGroup of groups.value) {
    if (
      otherGroup.permission_action_group_id ===
      currentGroup.permission_action_group_id
    ) {
      continue;
    }

    otherGroup.selected = value;
    otherGroup.disabled = value;

    if (otherGroup.permissions.length) {
      updatePermissionsState(otherGroup.permissions, value);
    }
  }
};

const toggleGroup = (group: PermissionGroupWithState, value: boolean) => {
  group.selected = value;

  if (group.action === EGeneralPermissions.full_access_group) {
    updateOtherGroupsForFullAccess(group, value);

    if (group.permissions.length) {
      updatePermissionsState(group.permissions, value);
    }

    return;
  }

  if (!group.permissions.length) {
    return;
  }

  updatePermissionsState(group.permissions, value);
};

const togglePermission = (
  group: PermissionGroupWithState,
  permission: PermissionActionWithState,
  value: boolean
) => {
  permission.selected = value;

  if (!value && fullAccessGroup.value && fullAccessGroup.value.selected) {
    toggleGroup(fullAccessGroup.value, false);
    return;
  }

  if (!group.permissions.length) {
    group.selected = value;
    return;
  }

  const allSelected = group.permissions.every((item) => item.selected);

  if (allSelected) {
    toggleGroup(group, true);
    return;
  }

  group.selected = false;
  for (const item of group.permissions) {
    item.disabled = false;
  }
};

const hasFullAccessInRole = (
  rolePermissions: ListPermissionGroupsResponse
): boolean => {
  return rolePermissions.some(
    (roleGroup) =>
      roleGroup.action === EGeneralPermissions.full_access_group &&
      (!roleGroup.permissions.length ||
        roleGroup.permissions.some(
          (p) => p.action === EGeneralPermissions.full_access
        ))
  );
};

const applyFullAccessSelection = (): void => {
  const fullAccessGroupItem = groups.value.find(
    (g) => g.action === EGeneralPermissions.full_access_group
  );

  if (!fullAccessGroupItem) {
    return;
  }

  toggleGroup(fullAccessGroupItem, true);
};

const applyGroupWithoutPermissions = (
  group: PermissionGroupWithState
): void => {
  group.selected = true;
  group.disabled = false;
};

const applyGroupWithOnlyGroupPermission = (
  group: PermissionGroupWithState
): void => {
  toggleGroup(group, true);
};

const applyIndividualPermissions = (
  group: PermissionGroupWithState,
  roleGroup: PermissionActionGroupResponse
): void => {
  const selectedPermissions = new Set(
    roleGroup.permissions.map((permission) => permission.permission_action_id)
  );

  for (const permission of group.permissions) {
    permission.selected = selectedPermissions.has(
      permission.permission_action_id
    );
    permission.disabled = false;
  }

  const allSelected = group.permissions.every(
    (permission) => permission.selected
  );

  if (allSelected) {
    toggleGroup(group, true);
    return;
  }

  group.selected = false;
  group.disabled = false;
};

const applyGroupSelections = (
  group: PermissionGroupWithState,
  roleGroup: PermissionActionGroupResponse
): void => {
  if (!group.permissions.length) {
    applyGroupWithoutPermissions(group);
    return;
  }

  if (!roleGroup.permissions.length) {
    applyGroupWithOnlyGroupPermission(group);
    return;
  }

  applyIndividualPermissions(group, roleGroup);
};

const applyRoleSelections = (rolePermissions: ListPermissionGroupsResponse) => {
  if (hasFullAccessInRole(rolePermissions)) {
    applyFullAccessSelection();
    return;
  }

  for (const group of groups.value) {
    const roleGroup = rolePermissions.find(
      (item) =>
        item.permission_action_group_id === group.permission_action_group_id
    );

    if (!roleGroup) {
      continue;
    }

    applyGroupSelections(group, roleGroup);
  }
};

const loadPermissions = async () => {
  isLoading.value = true;

  const userPermissions = await permissionStore.listPermissionGroupsByUser();

  if (!userPermissions) {
    groups.value = [];
    isLoading.value = false;
    return;
  }

  groups.value = mapGroupsToState(userPermissions);

  if (permissionRoleId.value) {
    const rolePermissions =
      await permissionStore.listPermissionGroupsByPermissionRoleId(
        permissionRoleId.value
      );

    if (rolePermissions) {
      applyRoleSelections(rolePermissions);
    }
  }

  isLoading.value = false;
};

const resetState = () => {
  groups.value = [];
};

const prepareGroupsForSave = (): PermissionGroupRequest[] => {
  return groups.value.map((group) => ({
    permission_action_group_id: group.permission_action_group_id,
    action: group.action,
    selected: group.selected,
    permissions: group.permissions.map((permission) => ({
      permission_action_id: permission.permission_action_id,
      action: permission.action,
      selected: permission.selected,
    })),
  }));
};

const handleSave = async () => {
  if (!permissionRoleId.value) {
    return;
  }

  const groupsToSave = prepareGroupsForSave();

  const result = await permissionStore.updateRolePermissions(
    permissionRoleId.value,
    groupsToSave
  );

  if (result) {
    isVisible.value = false;
  }
};

watch(
  () => isVisible.value,
  async (visible) => {
    if (visible) {
      await loadPermissions();
      return;
    }

    resetState();
  },
  { immediate: true }
);

watch(
  () => permissionRoleId.value,
  async (newValue, oldValue) => {
    if (!isVisible.value) {
      return;
    }

    if (newValue === oldValue) {
      return;
    }

    await loadPermissions();
  }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="720">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="$t('permissions')">
      <VCardText
        class="position-relative"
        :style="{ minHeight: isLoading ? '400px' : 'auto' }"
      >
        <VOverlay
          :model-value="isLoading"
          class="align-center justify-center"
          contained
          scrim="rgba(var(--v-theme-surface), 0.8)"
        >
          <VProgressCircular indeterminate color="primary" size="64" />
        </VOverlay>

        <template v-if="!isLoading">
          <div
            v-if="!groups.length"
            class="text-center text-medium-emphasis py-8"
          >
            {{ $t('permission_groups_empty') }}
          </div>

          <template v-if="groups.length">
            <div class="d-flex flex-column gap-4">
              <template v-if="fullAccessGroupDefined">
                <div
                  :key="fullAccessGroupDefined!.permission_action_group_id"
                  class="permission-group-full-access pa-4 rounded border"
                >
                  <VCheckbox
                    :model-value="fullAccessGroupDefined!.selected"
                    :label="fullAccessGroupDefined!.name"
                    :disabled="!canEdit || fullAccessGroupDefined!.disabled"
                    hide-details
                    density="compact"
                    class="font-weight-medium"
                    @update:model-value="
                      (value) =>
                        toggleGroup(fullAccessGroupDefined!, Boolean(value))
                    "
                  />

                  <p
                    v-if="fullAccessGroupDefined!.description"
                    class="text-body-2 text-medium-emphasis ms-8 mb-2"
                  >
                    {{ fullAccessGroupDefined!.description }}
                  </p>

                  <VDivider
                    v-if="fullAccessGroupDefined!.permissions.length"
                    class="my-3"
                  />

                  <div
                    v-if="fullAccessGroupDefined!.permissions.length"
                    class="d-flex flex-column gap-2 ms-4"
                  >
                    <VCheckbox
                      v-for="permission in fullAccessGroupDefined!.permissions"
                      :key="permission.permission_action_id"
                      :model-value="permission.selected"
                      :label="permission.name"
                      :disabled="!canEdit || permission.disabled"
                      hide-details
                      density="compact"
                      @update:model-value="
                        (value) =>
                          togglePermission(
                            fullAccessGroupDefined!,
                            permission,
                            Boolean(value)
                          )
                      "
                    />
                  </div>

                  <template v-if="!fullAccessGroupDefined!.permissions.length">
                    <p class="text-body-2 text-medium-emphasis ms-1 mt-2">
                      {{ $t('permission_group_only_parent') }}
                    </p>
                  </template>
                </div>

                <VDivider v-if="otherGroups.length" class="my-2" />
              </template>

              <div
                v-for="group in otherGroups"
                :key="group.permission_action_group_id"
                class="permission-group pa-4 rounded border"
              >
                <VCheckbox
                  :model-value="group.selected"
                  :label="group.name"
                  :disabled="!canEdit || group.disabled"
                  hide-details
                  density="compact"
                  @update:model-value="
                    (value) => toggleGroup(group, Boolean(value))
                  "
                />

                <p
                  v-if="group.description"
                  class="text-body-2 text-medium-emphasis ms-8 mb-2"
                >
                  {{ group.description }}
                </p>

                <VDivider v-if="group.permissions.length" class="my-3" />

                <div
                  v-if="group.permissions.length"
                  class="d-flex flex-column gap-2 ms-4"
                >
                  <div
                    v-for="permission in group.permissions"
                    :key="permission.permission_action_id"
                    class="d-flex flex-column"
                  >
                    <VCheckbox
                      :model-value="permission.selected"
                      :label="permission.name"
                      :disabled="!canEdit || permission.disabled"
                      hide-details
                      density="compact"
                      @update:model-value="
                        (value) =>
                          togglePermission(group, permission, Boolean(value))
                      "
                    />
                    <p
                      v-if="permission.description"
                      class="text-body-2 text-medium-emphasis ms-8 mb-1"
                    >
                      {{ permission.description }}
                    </p>
                  </div>
                </div>

                <template v-if="!group.permissions.length">
                  <p class="text-body-2 text-medium-emphasis ms-1 mt-2">
                    {{ $t('permission_group_only_parent') }}
                  </p>
                </template>
              </div>
            </div>
          </template>
        </template>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3">
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('close') }}
        </VBtn>
        <VBtn
          v-if="permissionRoleId && canEdit"
          color="primary"
          :loading="permissionStore.loading"
          @click="handleSave"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped lang="scss">
.permission-group {
  border-color: rgba(var(--v-theme-on-surface), 0.12);
}

.permission-group-full-access {
  border-color: rgba(var(--v-theme-primary), 0.5);
  border-width: 2px;
  background-color: rgba(var(--v-theme-primary), 0.05);
}
</style>
