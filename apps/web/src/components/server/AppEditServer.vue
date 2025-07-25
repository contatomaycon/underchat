<script lang="ts" setup>
import { useServerStore } from '@/@webcore/stores/server';
import { EColor } from '@core/common/enums/EColor';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { VForm } from 'vuetify/components/VForm';

const { t } = useI18n();

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: number | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');

const name = ref<string | null>(null);
const ip = ref<string | null>(null);
const port = ref<number | null>(null);
const username = ref<string | null>(null);
const password = ref<string | null>(null);

const refFormEditServer = ref<VForm>();

const updateServer = async () => {
  if (!serverId.value || !name.value || !ip.value || !port.value) {
    return;
  }

  const validateForm = await refFormEditServer?.value?.validate();
  if (!validateForm?.valid) return;

  const payload: EditServerRequest = {
    name: name.value,
    ssh_ip: ip.value,
    ssh_port: port.value,
    ssh_username: username.value,
    ssh_password: password.value,
  };

  const result = await serverStore.updateServer(serverId.value, payload);

  if (result) {
    isVisible.value = false;

    await serverStore.listServers();
  }
};

watch(serverId, async (id) => {
  if (!id) return;

  const server = await serverStore.getServerById(id);
  if (server) {
    name.value = server.name;
    ip.value = server.ssh.ssh_ip;
    port.value = server.ssh.ssh_port;
    username.value = null;
    password.value = null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditServer" @submit.prevent>
      <VCard :title="$t('edit_server')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name_server')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="ip"
                :label="$t('ip') + ':'"
                :placeholder="$t('ip')"
                :rules="[
                  requiredValidator(ip, $t('ip_required')),
                  isValidIP(ip, $t('ip_invalid')),
                ]"
                v-maska="ipMask"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="port"
                :label="$t('port') + ':'"
                :placeholder="$t('port')"
                :rules="[requiredValidator(port, $t('port_required'))]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="username"
                :label="$t('username') + ':'"
                :placeholder="$t('username')"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <AppTextField
                v-model="password"
                :label="$t('password') + ':'"
                :placeholder="$t('password')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateServer"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
