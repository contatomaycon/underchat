// ==================== Componente do conjunto de guias ====================
window.TabPoolTabComponent = {
    name: 'TabPoolTabComponent',
    props: {
        darkMode: { type: Boolean, default: false }
    },
    data() {
        return {
            tabs: [],
            loading: false,
            error: null,
            autoRefresh: true,
            refreshInterval: null,
            lastUpdate: null,
            baseUrl: '',
            presetUpdating: {}  // { tabIndex: true } Alternando guias padrão         };
    },
    computed: {
        statusColor() {
            return (status) => {
                switch (status) {
                    case 'idle': return 'bg-green-500';
                    case 'busy': return 'bg-yellow-500';
                    case 'error': return 'bg-red-500';
                    default: return 'bg-gray-500';
                }
            };
        },
        statusText() {
            return (status) => {
                switch (status) {
                    case 'idle': return 'parado';
                    case 'busy': return 'Ocupado';
                    case 'error': return 'erro';
                    default: return status;
                }
            };
        }
    },
    methods: {
        async fetchTabs() {
            this.loading = true;
            try {
                const token = localStorage.getItem('api_token');
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
                
                const response = await fetch('/api/tab-pool/tabs', { headers });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const data = await response.json();
                this.tabs = data.tabs || [];
                this.lastUpdate = new Date().toLocaleTimeString();
                this.error = null;
            } catch (e) {
                this.error = e.message;
            } finally {
                this.loading = false;
            }
        },
        
        startAutoRefresh() {
            if (this.refreshInterval) return;
            this.refreshInterval = setInterval(() => {
                if (this.autoRefresh) {
                    this.fetchTabs();
                }
            }, 1000);
        },
        
        stopAutoRefresh() {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        },
        
        copyEndpoint(routePrefix, successMessage = 'Endereço do endpoint copiado') {
            const endpoint = `${this.baseUrl}${routePrefix}/v1/chat/completions`;
            navigator.clipboard.writeText(endpoint).then(() => {
                this.$emit('notify', { type: 'success', message: successMessage });
            });
        },

        getDomainRoutePrefix(tab) {
            return tab.domain_route_prefix || '';
        },

        getFixedTabRoutePrefix(tab) {
            return tab.tab_route_prefix || `/tab/${tab.persistent_index}`;
        },
        
        truncateUrl(url, maxLen = 50) {
            if (!url) return '(nulo)';
            return url.length > maxLen ? url.substring(0, maxLen) + '...' : url;
        },

        getDomainLabel(tab) {
            return tab.current_domain || 'Nome de domínio não reconhecido';
        },

        getDefaultPresetOptionValue() {
            return '__DEFAULT__';
        },

        getDefaultPresetLabel(tab) {
            const fallback = tab.default_preset || tab.effective_preset_name || 'predefinição mestre';
            return `Siga o padrão do site (${fallback}）`;
        },

        getDisplayedPreset(tab) {
            return tab.effective_preset_name || tab.preset_name || tab.default_preset || 'predefinição mestre';
        },

        getPresetStatusText(tab) {
            if (tab.is_using_default_preset) {
                return 'Atualmente em vigor: ' + this.getDisplayedPreset(tab) + '（Siga o padrão do site)';
            }
            return 'Atualmente em vigor: ' + this.getDisplayedPreset(tab) + '（Especificado manualmente)';
        },

        async changePreset(tab, newPresetName) {
            const tabIndex = tab.persistent_index;
            this.presetUpdating = { ...this.presetUpdating, [tabIndex]: true };

            try {
                const token = localStorage.getItem('api_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;

                const response = await fetch('/api/tab-pool/tabs/' + tabIndex + '/preset', {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ preset_name: newPresetName })
                });

                if (!response.ok) throw new Error('HTTP ' + response.status);

                const presetLabel = newPresetName === this.getDefaultPresetOptionValue()
                    ? this.getDefaultPresetLabel(tab)
                    : newPresetName;
                this.$emit('notify', { type: 'success', message: 'Padrão alterado: ' + presetLabel });
                await this.fetchTabs();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha ao mudar a predefinição: ' + e.message });
            } finally {
                const updated = { ...this.presetUpdating };
                delete updated[tabIndex];
                this.presetUpdating = updated;
            }
        },

        async terminateTask(tab) {
            const tabIndex = tab.persistent_index;
            const task = tab.current_task || '(nenhum task_id)';
            if (!confirm(`OK para encerrar a guia #${tabIndex} tarefa atual?\ntarefa atual: ${task}`)) return;

            try {
                const token = localStorage.getItem('api_token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = 'Bearer ' + token;

                const response = await fetch('/api/tab-pool/tabs/' + tabIndex + '/terminate', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        reason: 'manual_terminate_from_tab_pool',
                        clear_page: true
                    })
                });

                if (!response.ok) throw new Error('HTTP ' + response.status);
                const data = await response.json();
                const msg = data.cancelled
                    ? `página da guia #${tabIndex} Terminado e liberado`
                    : `página da guia #${tabIndex} Liberado (nenhuma solicitação de cancelamento disponível)`;
                this.$emit('notify', { type: 'success', message: msg });
                await this.fetchTabs();
            } catch (e) {
                this.$emit('notify', { type: 'error', message: 'Falha ao encerrar a tarefa: ' + e.message });
            }
        },

        getCurrentPreset(tab) {
            return tab.is_using_default_preset
                ? this.getDefaultPresetOptionValue()
                : (tab.preset_name || 'predefinição mestre');
        }
    },
    mounted() {
        this.baseUrl = window.location.origin;
        this.fetchTabs();
        this.startAutoRefresh();
    },
    beforeUnmount() {
        this.stopAutoRefresh();
    },
    template: `
        <div class="p-6">
            <!-- barra de título -->
            <div class="flex items-center justify-between mb-6">
                <div>
                    <h2 class="text-xl font-bold dark:text-white">🗂️ conjunto de guias</h2>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Gerencie guias no navegador, cada guia possui um prefixo de roteamento independente                     </p>
                </div>
                <div class="flex items-center gap-4">
                    <label class="flex items-center gap-2 text-sm dark:text-gray-300">
                        <input type="checkbox" v-model="autoRefresh" class="rounded">
                        Atualização automática                     </label>
                    <button @click="fetchTabs" 
                            :disabled="loading"
                            class="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50">
                        {{ loading ? 'Refrescante...' : 'Atualizar agora' }}
                    </button>
                </div>
            </div>
            
            <!-- informações de status -->
            <div class="mb-4 flex items-center gap-4 text-sm">
                <span class="dark:text-gray-300">
                    comum <strong class="text-blue-600 dark:text-blue-400">{{ tabs.length }}</strong> guias                 </span>
                <span v-if="lastUpdate" class="text-gray-500 dark:text-gray-400">
                    última atualização: {{ lastUpdate }}
                </span>
                <span v-if="error" class="text-red-500">
                    ⚠️ {{ error }}
                </span>
            </div>
            
            <!-- Instruções de uso -->
            <div class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <h3 class="font-semibold text-blue-800 dark:text-blue-300 mb-2">💡 Uso</h3>
                <ul class="text-sm text-blue-700 dark:text-blue-200 space-y-1">
                    <li>• <strong>Rota padrão</strong>：<code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">/v1/chat/completions</code> - Selecione automaticamente guias gratuitas</li>
                    <li>• <strong>Especifique o nome de domínio do site</strong>：<code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">/url/gemini.com/v1/chat/completions</code> - Combine automaticamente as guias do site</li>
                    <li>• <strong>Especifique a página da guia</strong>：<code class="bg-blue-100 dark:bg-blue-800 px-1 rounded">/tab/{número de série}/v1/chat/completions</code> - Use guias específicas</li>
                    <li>• O número da guia permanece inalterado enquanto o script está em execução. Fechar a guia não afetará outros números.</li>
                </ul>
            </div>
            
            <!-- Lista de guias -->
            <div v-if="tabs.length === 0 && !loading" 
                 class="text-center py-12 text-gray-500 dark:text-gray-400">
                <div class="text-4xl mb-4">📭</div>
                <p>Nenhuma guia disponível ainda</p>
                <p class="text-sm mt-2">Por favor, abra-o no seu navegador AI site</p>
            </div>
            
            <div v-else class="space-y-3">
                <div v-for="tab in tabs" :key="tab.persistent_index"
                     class="p-4 rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-md transition-shadow">
                    <div class="flex items-start justify-between">
                        <!-- Informações à esquerda -->
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-3 mb-2">
                                <!-- crachá numerado -->
                                <span class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 font-bold text-lg">
                                    {{ tab.persistent_index }}
                                </span>
                                
                                <!-- indicador de status -->
                                <span class="flex items-center gap-1.5">
                                    <span :class="['w-2.5 h-2.5 rounded-full', statusColor(tab.status)]"></span>
                                    <span class="text-sm font-medium dark:text-white">{{ statusText(tab.status) }}</span>
                                </span>
                                
                                <!-- sessão ID -->
                                <span class="text-xs text-gray-500 dark:text-gray-400 font-mono">
                                    {{ tab.id }}
                                </span>
                            </div>
                            
                            <div class="flex flex-wrap items-center gap-2 mb-1 text-sm">
                                <span class="text-gray-500 dark:text-gray-400">🏷️</span>
                                <span class="font-medium text-gray-800 dark:text-gray-100">{{ getDomainLabel(tab) }}</span>
                                <a v-if="tab.domain_url"
                                   :href="tab.domain_url"
                                   target="_blank"
                                   rel="noreferrer"
                                   class="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-mono">
                                    {{ tab.domain_url }}
                                </a>
                            </div>

                            <!-- URL -->
                            <div class="text-sm text-gray-600 dark:text-gray-300 truncate mb-2" :title="tab.url">
                                🌐 {{ truncateUrl(tab.url, 72) }}
                            </div>
                            
                            <!-- ponto final de roteamento -->
                            <div class="space-y-2">
                                <div v-if="getDomainRoutePrefix(tab)" class="flex flex-wrap items-center gap-2">
                                    <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Roteamento de nome de domínio do site</span>
                                    <code class="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-700 dark:text-gray-300">
                                        {{ getDomainRoutePrefix(tab) }}/v1/chat/completions
                                    </code>
                                    <button @click="copyEndpoint(getDomainRoutePrefix(tab), 'Rota do nome de domínio do site copiada')"
                                            class="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">
                                        📋 cópia                                     </button>
                                </div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Roteamento de guias fixo</span>
                                    <code class="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-700 dark:text-gray-300">
                                        {{ getFixedTabRoutePrefix(tab) }}/v1/chat/completions
                                    </code>
                                    <button @click="copyEndpoint(getFixedTabRoutePrefix(tab), 'Rota de guia fixa copiada')"
                                            class="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400">
                                        📋 cópia                                     </button>
                                </div>
                            </div>

                            <!-- 🆕 Seletor predefinido -->
                            <div v-if="tab.available_presets && tab.available_presets.length > 0"
                                 class="flex items-center gap-2 mt-2">
                                <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">🎛️ Padrão:</span>
                                <select :value="getCurrentPreset(tab)"
                                        @change="changePreset(tab, $event.target.value)"
                                        :disabled="presetUpdating[tab.persistent_index]"
                                        class="text-xs border dark:border-gray-600 px-2 py-1 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:opacity-50 min-w-[100px]">
                                    <option :value="getDefaultPresetOptionValue()">
                                        {{ getDefaultPresetLabel(tab) }}
                                    </option>
                                    <option v-for="preset in tab.available_presets" :key="preset" :value="preset">
                                        {{ preset }}
                                    </option>
                                </select>
                                <span v-if="presetUpdating[tab.persistent_index]" class="text-xs text-blue-500 dark:text-blue-400">
                                    Troca...
                                </span>
                            </div>
                            <div v-if="tab.available_presets && tab.available_presets.length > 0" class="mt-1">
                                <span class="text-xs text-gray-400 dark:text-gray-500">{{ getPresetStatusText(tab) }}</span>
                            </div>
                            <div v-else-if="tab.current_domain" class="mt-2">
                                <span class="text-xs text-gray-400 dark:text-gray-500">🎛️ Padrão: {{ getDisplayedPreset(tab) }}（apenas um)</span>
                            </div>
                        </div>

                        <!-- Estatísticas à direita -->
                        <div class="text-right text-xs text-gray-500 dark:text-gray-400 ml-4">
                            <div>Número de solicitações: {{ tab.request_count }}</div>
                            <div v-if="tab.busy_duration" class="text-yellow-600 dark:text-yellow-400">
                                Já ocupado: {{ tab.busy_duration }}s
                            </div>
                            <div v-if="tab.current_task" class="text-blue-600 dark:text-blue-400 truncate max-w-32">
                                Tarefa: {{ tab.current_task }}
                            </div>
                            <button v-if="tab.status === 'busy' || tab.current_task"
                                    @click="terminateTask(tab)"
                                    class="mt-2 px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 text-xs">
                                terminar e desbloquear                             </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `
};
