// ==================== Configuração Tab componentes (versão dividida) ====================

window.ConfigTab = {
    name: 'ConfigTab',
    props: {
        currentDomain: { type: String, default: null },
        currentConfig: { type: Object, default: null }
    },
    emits: [
        'add-selector', 'remove-selector', 'update-selector-key', 'test-selector',
        'add-step', 'remove-step', 'move-step', 'action-change', 'show-templates',
        'update-image-config', 'test-image-extraction', 'reload-config'
    ],
        // Registre componentes filhos (certifique-se de que o modelo possa ser resolvido)     components: {
        'selector-panel': window.SelectorPanel,
        'image-config-panel': window.ImageConfigPanel,
        'stream-config-panel': window.StreamConfigPanel,
        'workflow-panel': window.WorkflowPanel,
        'file-paste-panel': window.FilePastePanel
    },
    data() {
        return {
            // 🆕 Gerenciamento padrão             selectedPreset: 'predefinição mestre',
            defaultPreset: 'predefinição mestre',
            availablePresets: [],
            presetLoading: false,
            newPresetName: '',
            showNewPresetInput: false,
            renamePresetName: '',
            showRenamePresetInput: false,

            // estado dobrado             selectorCollapsed: true,
            workflowCollapsed: true,
            imageConfigCollapsed: true,
            streamConfigCollapsed: true,
            filePasteCollapsed: true,

            // Configuração padrão             defaultImageConfig: {
                enabled: false,
                selector: 'img',
                container_selector: null,
                debounce_seconds: 2.0,
                wait_for_load: true,
                load_timeout_seconds: 5.0,
                download_blobs: true,
                max_size_mb: 10,
                mode: 'all'
            },
            defaultStreamConfig: {
                mode: 'dom',
                hard_timeout: 300,
                silence_threshold: 2.5,
                initial_wait: 30.0,
                enable_wrapper_search: true,
                network: null
            }
        };
    },
    computed: {
        // 🆕 Dados de configuração padrão atuais         presetConfig() {
            if (!this.currentConfig) return null;
            const presets = this.currentConfig.presets;
            if (!presets) return this.currentConfig; // Compatível com formatos mais antigos             return presets[this.selectedPreset]
                || presets[this.defaultPreset]
                || presets['predefinição mestre']
                || Object.values(presets)[0]
                || null;
        },
        imageConfig() {
            if (!this.presetConfig) return this.defaultImageConfig;
            return { ...this.defaultImageConfig, ...(this.presetConfig.image_extraction || {}) };
        },
        streamConfig() {
            if (!this.presetConfig) return this.defaultStreamConfig;
            return { ...this.defaultStreamConfig, ...(this.presetConfig.stream_config || {}) };
        }
    },
    methods: {
        // Atualização do valor do seletor         updateSelectorValue(key, value) {
            const pc = this.presetConfig;
            if (pc && pc.selectors) {
                pc.selectors[key] = value;
            }
        },

        // Configuração de streaming salva         async saveStreamConfig(config) {
            if (!this.currentDomain) return;
            try {
                const payload = { ...config, preset_name: this.selectedPreset };
                const response = await fetch('/api/sites/' + this.currentDomain + '/stream-config', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (response.ok) {
                    const pc = this.presetConfig;
                    if (pc) pc.stream_config = config;
                }
            } catch (e) {
                console.error('Falha ao salvar a configuração de streaming:', e);
                alert('Falha ao salvar: ' + e.message);
            }
        },

        // ===== 🆕 Método de gerenciamento padrão =====

        async loadPresets() {
            if (!this.currentDomain) return;
            this.presetLoading = true;
            try {
                const response = await fetch('/api/presets/' + encodeURIComponent(this.currentDomain));
                if (response.ok) {
                    const data = await response.json();
                    this.availablePresets = data.presets || ['predefinição mestre'];
                    const apiDefault = data.default_preset;
                    if (apiDefault && this.availablePresets.includes(apiDefault)) {
                        this.defaultPreset = apiDefault;
                    } else if (this.availablePresets.includes('predefinição mestre')) {
                        this.defaultPreset = 'predefinição mestre';
                    } else {
                        this.defaultPreset = this.availablePresets[0] || 'predefinição mestre';
                    }
                } else {
                    this.availablePresets = ['predefinição mestre'];
                    this.defaultPreset = 'predefinição mestre';
                }
                // Certifique-se de que a predefinição selecionada ainda seja válida                 if (!this.availablePresets.includes(this.selectedPreset)) {
                    this.selectedPreset = this.defaultPreset || this.availablePresets[0] || 'predefinição mestre';
                }
            } catch (e) {
                console.error('Falha ao carregar a lista predefinida:', e);
                this.availablePresets = ['predefinição mestre'];
                this.defaultPreset = 'predefinição mestre';
            } finally {
                this.presetLoading = false;
            }
        },

        switchPreset(presetName) {
            this.selectedPreset = presetName;
            // Aciona o componente pai para recarregar a configuração da predefinição             this.$emit('reload-config');
        },

        async setDefaultPreset() {
            if (!this.currentDomain || !this.selectedPreset) return;
            try {
                const response = await fetch('/api/presets/' + encodeURIComponent(this.currentDomain) + '/default', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        preset_name: this.selectedPreset
                    })
                });

                if (response.ok) {
                    this.defaultPreset = this.selectedPreset;
                    this.$emit('reload-config');
                    alert('✅ A predefinição padrão é definida como "' + this.selectedPreset + '"（Apenas cobertura local)');
                } else {
                    const err = await response.json();
                    alert('❌ Falha na configuração da predefinição padrão: ' + (err.detail || 'erro desconhecido'));
                }
            } catch (e) {
                alert('❌ erro de rede: ' + e.message);
            }
        },

        async createPreset() {
            const name = this.newPresetName.trim();
            if (!name) return;
            if (!this.currentDomain) return;
            const sourcePreset = this.selectedPreset;

            try {
                const response = await fetch('/api/presets/' + encodeURIComponent(this.currentDomain), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        new_name: name,
                        source_name: sourcePreset
                    })
                });

                if (response.ok) {
                    this.newPresetName = '';
                    this.showNewPresetInput = false;
                    await this.loadPresets();
                    this.selectedPreset = name;
                    this.$emit('reload-config');
                    alert('✅ Padrão "' + name + '" Criado (clonado de "' + sourcePreset + '"）');
                } else {
                    const err = await response.json();
                    alert('❌ Falha na criação: ' + (err.detail || 'erro desconhecido'));
                }
            } catch (e) {
                alert('❌ erro de rede: ' + e.message);
            }
        },

        async renamePreset() {
            const newName = this.renamePresetName.trim();
            if (!newName) return;
            if (!this.currentDomain) return;
            if (!this.selectedPreset) return;
            if (newName === this.selectedPreset) {
                this.showRenamePresetInput = false;
                this.renamePresetName = '';
                return;
            }

            try {
                const response = await fetch('/api/presets/' + encodeURIComponent(this.currentDomain) + '/rename', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        old_name: this.selectedPreset,
                        new_name: newName
                    })
                });

                if (response.ok) {
                    this.showRenamePresetInput = false;
                    this.renamePresetName = '';
                    await this.loadPresets();
                    this.selectedPreset = newName;
                    this.$emit('reload-config');
                    alert('✅ A predefinição foi renomeada para "' + newName + '"');
                } else {
                    const err = await response.json();
                    alert('❌ Falha ao renomear: ' + (err.detail || 'erro desconhecido'));
                }
            } catch (e) {
                alert('❌ erro de rede: ' + e.message);
            }
        },

        async deletePreset() {
            if (this.availablePresets.length <= 1) {
                alert('Não é possível excluir a última predefinição');
                return;
            }
            if (!confirm('Confirme que deseja excluir a predefinição "' + this.selectedPreset + '" ? Esta ação não pode ser desfeita.')) {
                return;
            }

            try {
                const response = await fetch(
                    '/api/presets/' + encodeURIComponent(this.currentDomain) + '/' + encodeURIComponent(this.selectedPreset),
                    { method: 'DELETE' }
                );

                if (response.ok) {
                    await this.loadPresets();
                    this.selectedPreset = this.defaultPreset || this.availablePresets[0] || 'predefinição mestre';
                    this.$emit('reload-config');
                    alert('✅ Predefinição excluída');
                } else {
                    const err = await response.json();
                    alert('❌ Falha na exclusão: ' + (err.detail || 'erro desconhecido'));
                }
            } catch (e) {
                alert('❌ erro de rede: ' + e.message);
            }
        }
    },
    watch: {
        currentDomain: {
            handler(newDomain) {
                if (newDomain) {
                    // Forçar a inicialização por padrão do site ao trocar de site                     this.selectedPreset = '';
                    this.defaultPreset = 'predefinição mestre';
                    this.showNewPresetInput = false;
                    this.showRenamePresetInput = false;
                    this.newPresetName = '';
                    this.renamePresetName = '';
                    this.loadPresets();
                } else {
                    this.availablePresets = [];
                    this.selectedPreset = 'predefinição mestre';
                    this.defaultPreset = 'predefinição mestre';
                    this.showNewPresetInput = false;
                    this.showRenamePresetInput = false;
                    this.newPresetName = '';
                    this.renamePresetName = '';
                }
            },
            immediate: true
        }
    },
    template: `
        <div class="h-full overflow-auto p-4">
            <!-- Estado vazio -->
            <div v-if="!currentDomain || !currentConfig" class="h-full flex items-center justify-center">
                <div class="text-center text-gray-400 dark:text-gray-500">
                    <div class="text-4xl mb-4">📝</div>
                    <div class="text-lg">Selecione ou adicione uma nova configuração de site</div>
                </div>
            </div>

            <!-- Conteúdo de configuração -->
            <div v-else class="space-y-4">

                <!-- 🆕 Seletor predefinido -->
                <div class="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-sm px-4 py-3">
                    <div class="flex items-center justify-between flex-wrap gap-3">
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">🎛️ Padrão:</span>
                            <select v-model="selectedPreset"
                                    @change="switchPreset(selectedPreset)"
                                    :disabled="presetLoading"
                                    class="border dark:border-gray-600 px-3 py-1.5 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-400 focus:border-transparent min-w-[140px]">
                                <option v-for="p in availablePresets" :key="p" :value="p">{{ p }}</option>
                            </select>
                            <span class="text-xs text-gray-400 dark:text-gray-500">
                                ({{ availablePresets.length }} predefinições)
                            </span>
                            <span class="text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                padrão: {{ defaultPreset || 'predefinição mestre' }}
                            </span>
                        </div>

                        <div class="flex items-center gap-2">
                            <!-- Definir como padrão -->
                            <button @click="setDefaultPreset"
                                    :disabled="!selectedPreset || selectedPreset === defaultPreset"
                                    class="px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-30">
                                ⭐ Definir como padrão                             </button>

                            <!-- Nova predefinição -->
                            <div v-if="showNewPresetInput" class="flex items-center gap-2">
                                <input v-model="newPresetName"
                                       @keyup.enter="createPreset"
                                       @keyup.escape="showNewPresetInput = false; newPresetName = ''"
                                       placeholder="Insira o nome padrão"
                                       class="border dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white w-32 focus:ring-2 focus:ring-blue-400"
                                       autofocus>
                                <button @click="createPreset"
                                        :disabled="!newPresetName.trim()"
                                        class="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50">
                                    criar                                 </button>
                                <button @click="showNewPresetInput = false"
                                        class="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-400 dark:hover:bg-gray-500">
                                    Cancelar                                 </button>
                            </div>
                            <button v-else @click="showNewPresetInput = true; showRenamePresetInput = false; renamePresetName = ''"
                                    class="px-3 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1">
                                ＋ Nova predefinição                             </button>

                            <!-- Renomear predefinição -->
                            <div v-if="showRenamePresetInput" class="flex items-center gap-2">
                                <input v-model="renamePresetName"
                                       @keyup.enter="renamePreset"
                                       @keyup.escape="showRenamePresetInput = false; renamePresetName = ''"
                                       :placeholder="'Renomear ' + selectedPreset"
                                       class="border dark:border-gray-600 px-2 py-1 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white w-36 focus:ring-2 focus:ring-amber-400">
                                <button @click="renamePreset"
                                        :disabled="!renamePresetName.trim()"
                                        class="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-50">
                                    Renomear                                 </button>
                                <button @click="showRenamePresetInput = false; renamePresetName = ''"
                                        class="px-2 py-1 text-xs bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-400 dark:hover:bg-gray-500">
                                    Cancelar                                 </button>
                            </div>
                            <button v-else
                                    @click="showRenamePresetInput = true; renamePresetName = selectedPreset; showNewPresetInput = false; newPresetName = ''"
                                    :disabled="!selectedPreset"
                                    class="px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30 disabled:opacity-30">
                                ✎ Renomear                             </button>

                            <!-- Excluir predefinição -->
                            <button @click="deletePreset"
                                    :disabled="availablePresets.length <= 1"
                                    class="px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:cursor-not-allowed"
                                    :title="availablePresets.length <= 1 ? 'Não é possível excluir a última predefinição' : 'Excluir predefinição atual'">
                                🗑️ excluir                             </button>
                        </div>
                    </div>
                    <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        A criação de uma nova predefinição clonará a configuração predefinida atualmente selecionada. Diferentes predefinições podem ser selecionadas para diferentes guias no conjunto de guias. Será usado automaticamente se não for especificado manualmente“Predefinição padrão”。
                    </p>
                </div>

                <!-- painel seletor -->
                <selector-panel v-if="presetConfig"
                    :selectors="presetConfig.selectors || {}"
                    :collapsed="selectorCollapsed"
                    @update:collapsed="selectorCollapsed = $event"
                    @add-selector="$emit('add-selector', $event)"
                    @remove-selector="$emit('remove-selector', $event)"
                    @update-selector-key="(oldKey, newKey) => $emit('update-selector-key', oldKey, newKey)"
                    @update-selector-value="updateSelectorValue"
                    @test-selector="(key, val) => $emit('test-selector', key, val)"
                />

                <!-- Painel de configuração de imagem -->
                <image-config-panel v-if="presetConfig"
                    :image-config="imageConfig"
                    :current-domain="currentDomain"
                    :collapsed="imageConfigCollapsed"
                    @update:collapsed="imageConfigCollapsed = $event"
                    @update-image-config="$emit('update-image-config', $event)"
                    @test-image-extraction="$emit('test-image-extraction')"
                    @reload-config="$emit('reload-config')"
                />

                <!-- Painel de configuração de streaming -->
                <stream-config-panel v-if="presetConfig"
                    :stream-config="streamConfig"
                    :current-domain="currentDomain"
                    :collapsed="streamConfigCollapsed"
                    @update:collapsed="streamConfigCollapsed = $event"
                    @save-stream-config="saveStreamConfig"
                />
                <!-- Painel de configuração de colagem de arquivo -->
                <file-paste-panel v-if="presetConfig"
                    :sites="$parent.sites"
                    :current-domain="currentDomain"
                    :collapsed="filePasteCollapsed"
                    @update:collapsed="filePasteCollapsed = $event"
                />
                <!-- Painel de fluxo de trabalho -->
                <workflow-panel v-if="presetConfig"
                    :workflow="presetConfig.workflow || []"
                    :selectors="presetConfig.selectors || {}"
                    :current-domain="currentDomain"
                    :selected-preset="selectedPreset"
                    :collapsed="workflowCollapsed"
                    @update:collapsed="workflowCollapsed = $event"
                    @add-step="$emit('add-step')"
                    @remove-step="$emit('remove-step', $event)"
                    @move-step="(index, dir) => $emit('move-step', index, dir)"
                    @action-change="$emit('action-change', $event)"
                    @show-templates="$emit('show-templates')"
                />
            </div>
        </div>
    `
};
