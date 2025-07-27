<script lang="ts" setup>
import { useServerStore } from '@/@webcore/stores/server';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { VForm } from 'vuetify/components/VForm';

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

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
const quantityWorkers = ref<number | null>(null);
const webDomain = ref<string | null>(null);
const webPort = ref<number | null>(null);
const webProtocol = ref<EServerWebProtocol.http | EServerWebProtocol.https>(
  EServerWebProtocol.http
);

const itemsWebProtocol = ref([
  { value: EServerWebProtocol.http, title: 'HTTP' },
  { value: EServerWebProtocol.https, title: 'HTTPS' },
]);

const refFormEditServer = ref<VForm>();

const updateServer = async () => {
  const validateForm = await refFormEditServer?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !serverId.value ||
    !name.value ||
    !ip.value ||
    !port.value ||
    !quantityWorkers.value ||
    !webDomain.value ||
    !webPort.value ||
    !webProtocol.value
  ) {
    return;
  }

  const payload: EditServerRequest = {
    name: name.value,
    ssh_ip: ip.value,
    ssh_port: port.value,
    ssh_username: username.value,
    ssh_password: password.value,
    quantity_workers: quantityWorkers.value,
    web_domain: webDomain.value,
    web_port: webPort.value,
    web_protocol: webProtocol.value,
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
    quantityWorkers.value = server.quantity_workers;
    webDomain.value = server.web.web_domain;
    webPort.value = server.web.web_port;
    webProtocol.value = server.web.web_protocol as EServerWebProtocol;
    username.value = null;
    password.value = null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="serverStore.loading">
      <VOverlay
        :model-value="serverStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

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

            <VCol cols="12" sm="4" md="4">
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

            <VCol cols="12" sm="4" md="4">
              <AppTextField
                v-model="port"
                :label="$t('port') + ':'"
                :placeholder="$t('port')"
                :rules="[requiredValidator(port, $t('port_required'))]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <AppTextField
                v-model="quantityWorkers"
                :label="$t('workers_allowed') + ':'"
                :placeholder="$t('workers_allowed')"
                :rules="[
                  requiredValidator(
                    quantityWorkers,
                    $t('workers_allowed_required')
                  ),
                ]"
                type="number"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <AppSelect
                :items="itemsWebProtocol"
                v-model="webProtocol"
                :label="$t('web_protocol') + ':'"
                :placeholder="$t('web_protocol')"
                :rules="[
                  requiredValidator(webProtocol, $t('web_protocol_required')),
                ]"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <AppTextField
                v-model="webDomain"
                :label="$t('web_domain') + ':'"
                :placeholder="$t('web_domain')"
                :rules="[
                  requiredValidator(webDomain, $t('web_domain_required')),
                ]"
              />
            </VCol>

            <VCol cols="12" sm="4" md="4">
              <AppTextField
                v-model="webPort"
                :label="$t('web_port') + ':'"
                :placeholder="$t('web_port')"
                :rules="[requiredValidator(webPort, $t('web_port_required'))]"
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
