(function () {
    const MAIN_PRESET_NAME = 'predefinição mestre';
    const REVIEW_TOKEN_STORAGE_KEY = 'marketplace_github_review_token';

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function safeString(value) {
        return String(value || '').trim();
    }

    function createEmptyReviewSession() {
        return {
            connected: false,
            can_review: false,
            repo: '',
            repo_url: '',
            login: '',
            role_name: '',
            permission_label: '',
            permissions: {}
        };
    }

    Vue.createApp({
        data() {
            return {
                darkMode: true,
                loading: false,
                error: '',
                busyId: '',
                importSaving: false,
                submitSaving: false,
                commandLoading: false,
                searchQuery: '',
                selectedType: 'all',
                selectedSite: 'all',
                sortBy: 'downloads_desc',
                catalog: {
                    source_name: 'Mercado local de plugins',
                    source_url: '',
                    repo_url: '',
                    upload_url: '',
                    warning: '',
                    submit_mode: 'local',
                    submit_label: 'Envio e upload',
                    submit_help: '',
                    submit_target: '',
                    count: 0,
                    approved_count: 0,
                    pending_count: 0,
                    total_downloads: 0,
                    items: []
                },
                previewDetail: null,
                pendingImport: null,
                showPreviewDialog: false,
                showImportDialog: false,
                showSubmitDialog: false,
                showReviewDialog: false,
                importStrategy: 'overwrite',
                importPresetName: '',
                reviewToken: '',
                reviewChecking: false,
                reviewBusyId: '',
                reviewSession: createEmptyReviewSession(),
                siteConfigs: {},
                commandOptions: [],
                submitForm: {
                    item_type: 'site_config',
                    title: '',
                    summary: '',
                    author: 'Postagem principal',
                    site_domain: '',
                    preset_name: '',
                    category: '',
                    version: '1.0.0',
                    compatibility: '',
                    tagsText: '',
                    selected_command_ids: []
                },
                toasts: []
            };
        },

        computed: {
            typeOptions() {
                return [
                    { value: 'all', label: 'todos' },
                    { value: 'site_config', label: 'Configuração do site' },
                    { value: 'command_bundle', label: 'sistema de comando' }
                ];
            },

            siteOptions() {
                const values = new Set();
                for (const item of this.catalog.items || []) {
                    const domain = safeString(item.site_domain || item.domain);
                    if (domain) {
                        values.add(domain);
                    }
                }
                return Array.from(values).sort((a, b) => a.localeCompare(b, 'zh-CN'));
            },

            filteredItems() {
                const search = this.searchQuery.toLowerCase();
                const items = (this.catalog.items || []).filter((item) => {
                    if (this.selectedType !== 'all' && item.item_type !== this.selectedType) {
                        return false;
                    }
                    if (this.selectedType !== 'command_bundle'
                        && this.selectedSite !== 'all'
                        && safeString(item.site_domain) !== this.selectedSite) {
                        return false;
                    }
                    if (!search) {
                        return true;
                    }

                    const haystack = [
                        item.name,
                        item.summary,
                        item.author,
                        item.site_domain,
                        item.category,
                        ...(Array.isArray(item.tags) ? item.tags : [])
                    ]
                        .filter(Boolean)
                        .join(' ')
                        .toLowerCase();
                    return haystack.includes(search);
                });

                items.sort((left, right) => this.compareItems(left, right));
                return items;
            },

            availableSites() {
                return Object.keys(this.siteConfigs || {}).sort((a, b) => a.localeCompare(b, 'zh-CN'));
            },

            availablePresets() {
                const domain = safeString(this.submitForm.site_domain);
                const site = domain ? this.siteConfigs[domain] : null;
                const presets = site && site.presets ? Object.keys(site.presets) : [];
                return presets.sort((a, b) => a.localeCompare(b, 'zh-CN'));
            },

            previewJsonText() {
                return JSON.stringify(this.previewDetail || {}, null, 2);
            },

            submissionPreviewText() {
                try {
                    return JSON.stringify(this.buildSubmissionPayload(), null, 2);
                } catch (error) {
                    return '// A visualização ainda não está disponível: ' + error.message;
                }
            },

            submitIsExternal() {
                return this.catalog.submit_mode !== 'local' && !!safeString(this.catalog.upload_url);
            },

            submitEntryLabel() {
                return safeString(this.catalog.submit_label) || (this.submitIsExternal ? 'Enviar para o mercado público' : 'Envio e upload');
            },

            reviewEntryLabel() {
                if (this.reviewSession.can_review) {
                    return this.reviewSession.login
                        ? ('Permissões de auditoria · ' + this.reviewSession.login)
                        : 'As permissões de auditoria estão conectadas';
                }
                if (this.reviewSession.connected) {
                    return 'GitHub Análise';
                }
                return 'GitHub Análise';
            },

            submitHelpText() {
                return safeString(this.catalog.submit_help)
                    || (this.submitIsExternal
                        ? 'As inscrições serão abertas GitHub Página pública, visualização completa JSON Ele será copiado primeiro para a área de transferência.'
                        : 'As contribuições são enviadas diretamente para o mercado local da instância atual.');
            },

            sourceBadgeLabel() {
                if (this.catalog.source_mode === 'hybrid') {
                    return 'índice público + substituto local';
                }
                if (this.catalog.source_mode === 'remote') {
                    return 'GitHub índice público';
                }
                return 'mercado local';
            },

            emptyStateDescription() {
                return this.submitIsExternal
                    ? 'Você pode primeiro enviar uma configuração de site ou sistema de comando ao mercado público, e ele será exibido aqui após revisão e inclusão.'
                    : 'Você pode fazer upload de uma configuração de site ou sistema de comando primeiro, e a lista aparecerá automaticamente aqui.';
            }
        },

        mounted() {
            this.loadTheme();
            this.reviewToken = localStorage.getItem(REVIEW_TOKEN_STORAGE_KEY) || '';
            this.loadCatalog();
            if (this.reviewToken) {
                this.loadReviewStatus({ silent: true });
            }
            window.addEventListener('keydown', this.handleKeydown);
        },

        beforeUnmount() {
            window.removeEventListener('keydown', this.handleKeydown);
        },

        methods: {
            async apiRequest(url, options = {}) {
                const token = localStorage.getItem('api_token');
                const headers = {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                };

                if (token) {
                    headers.Authorization = 'Bearer ' + token;
                }

                const response = await fetch(url, {
                    ...options,
                    headers
                });

                const rawText = await response.text();
                let payload = null;

                if (rawText) {
                    try {
                        payload = JSON.parse(rawText);
                    } catch (error) {
                        payload = rawText;
                    }
                }

                if (!response.ok) {
                    let message = 'Falha na solicitação';
                    if (payload && typeof payload === 'object') {
                        if (typeof payload.detail === 'string') {
                            message = payload.detail;
                        } else if (payload.error && typeof payload.error.message === 'string') {
                            message = payload.error.message;
                        }
                    } else if (typeof payload === 'string' && payload) {
                        message = payload;
                    }

                    const error = new Error(message);
                    error.status = response.status;
                    throw error;
                }

                return payload;
            },

            loadTheme() {
                const stored = localStorage.getItem('darkMode');
                this.darkMode = stored !== 'false';
                this.applyTheme();
            },

            applyTheme() {
                document.body.classList.toggle('mp-light', !this.darkMode);
            },

            toggleDarkMode() {
                this.darkMode = !this.darkMode;
                localStorage.setItem('darkMode', String(this.darkMode));
                this.applyTheme();
            },

            goDashboard() {
                window.location.href = '/';
            },

            openLink(url) {
                const target = safeString(url);
                if (!target) {
                    return;
                }
                window.open(target, '_blank', 'noopener,noreferrer');
            },

            getReviewHeaders() {
                const token = safeString(this.reviewToken || localStorage.getItem(REVIEW_TOKEN_STORAGE_KEY));
                return token ? { 'X-GitHub-Token': token } : {};
            },

            openReviewDialog() {
                this.reviewToken = safeString(this.reviewToken || localStorage.getItem(REVIEW_TOKEN_STORAGE_KEY));
                this.showReviewDialog = true;
            },

            closeReviewDialog() {
                this.showReviewDialog = false;
            },

            async saveReviewToken() {
                const token = safeString(this.reviewToken);
                if (!token) {
                    this.notify('Por favor cole primeiro GitHub Token', 'warning');
                    return;
                }

                localStorage.setItem(REVIEW_TOKEN_STORAGE_KEY, token);
                await this.loadReviewStatus();
            },

            async loadReviewStatus({ silent = false } = {}) {
                const token = safeString(this.reviewToken || localStorage.getItem(REVIEW_TOKEN_STORAGE_KEY));
                if (!token) {
                    this.reviewSession = createEmptyReviewSession();
                    return;
                }

                this.reviewChecking = true;
                try {
                    const data = await this.apiRequest('/api/marketplace/review/status', {
                        headers: this.getReviewHeaders()
                    });
                    this.reviewSession = {
                        ...createEmptyReviewSession(),
                        ...(data || {}),
                        connected: true
                    };
                    this.reviewToken = token;
                    if (!silent) {
                        if (this.reviewSession.can_review) {
                            this.notify('GitHub As permissões de auditoria estão conectadas', 'success');
                        } else {
                            this.notify('GitHub Conectado, mas a conta corrente não tem permissões de manutenção de armazém', 'warning');
                        }
                    }
                } catch (error) {
                    this.reviewSession = createEmptyReviewSession();
                    if (!silent) {
                        this.notify('GitHub Falha na conexão de auditoria: ' + error.message, 'error');
                    }
                } finally {
                    this.reviewChecking = false;
                }
            },

            clearReviewToken() {
                localStorage.removeItem(REVIEW_TOKEN_STORAGE_KEY);
                this.reviewToken = '';
                this.reviewSession = createEmptyReviewSession();
                this.notify('Limpo salvo localmente GitHub Token', 'success');
            },

            formatNumber(value) {
                const number = Number(value || 0);
                return Number.isFinite(number) ? number.toLocaleString('en-US') : '0';
            },

            typeLabel(type) {
                return type === 'command_bundle' ? 'sistema de comando' : 'Configuração do site';
            },

            reviewLabel(item) {
                if (safeString(item && item.review_label)) {
                    return safeString(item.review_label);
                }
                return safeString(item && item.review_status) === 'pending' ? 'Revisão pendente' : '';
            },

            isPending(item) {
                return safeString(item && item.review_status) === 'pending';
            },

            canImport(item) {
                return !item || !item.import_disabled;
            },

            canReviewItem(item) {
                return this.isPending(item)
                    && !!this.reviewSession.can_review
                    && Number(item && item.issue_number) > 0;
            },

            compareItems(left, right) {
                const leftName = safeString(left.name);
                const rightName = safeString(right.name);

                if (this.sortBy === 'updated_desc') {
                    return safeString(right.updated_at).localeCompare(safeString(left.updated_at)) || leftName.localeCompare(rightName, 'zh-CN');
                }
                if (this.sortBy === 'stars_desc') {
                    return Number(right.stars || 0) - Number(left.stars || 0) || leftName.localeCompare(rightName, 'zh-CN');
                }
                if (this.sortBy === 'name_asc') {
                    return leftName.localeCompare(rightName, 'zh-CN');
                }
                return Number(right.downloads || 0) - Number(left.downloads || 0) || leftName.localeCompare(rightName, 'zh-CN');
            },

            async loadCatalog({ force = false } = {}) {
                this.loading = true;
                this.error = '';

                try {
                    const suffix = force ? '?refresh=true' : '';
                    const data = await this.apiRequest('/api/marketplace' + suffix);
                    this.catalog = {
                        source_name: 'Mercado local de plugins',
                        source_url: '',
                        repo_url: '',
                        upload_url: '',
                        warning: '',
                        submit_mode: 'local',
                        submit_label: 'Envio e upload',
                        submit_help: '',
                        submit_target: '',
                        count: 0,
                        approved_count: 0,
                        pending_count: 0,
                        total_downloads: 0,
                        items: [],
                        ...(data || {})
                    };
                } catch (error) {
                    this.error = error.status === 401
                        ? 'Por favor, configure-o no console primeiro API Token，Abra o mercado de plug-ins novamente.'
                        : error.message;
                } finally {
                    this.loading = false;
                }
            },

            async reviewItem(item, action) {
                if (!this.canReviewItem(item)) {
                    this.notify('Atualmente não há permissão de moderação disponível', 'warning');
                    return;
                }
                if (action === 'approve' && !this.canImport(item)) {
                    this.notify('Este envio está faltando JSON，Não é possível passar diretamente no momento', 'warning');
                    return;
                }

                const actionLabel = action === 'approve' ? 'passar' : 'rejeitar';
                const confirmed = window.confirm(`Confirme para${actionLabel}Enviar isso?`);
                if (!confirmed) {
                    return;
                }

                this.reviewBusyId = action + ':' + item.id;
                try {
                    const result = await this.apiRequest(
                        '/api/marketplace/review/issues/' + encodeURIComponent(item.issue_number) + '/' + action,
                        {
                            method: 'POST',
                            headers: this.getReviewHeaders(),
                            body: JSON.stringify({ note: '' })
                        }
                    );
                    this.notify((result && result.message) || ('já' + actionLabel + 'Publicar'), 'success');
                    await this.loadCatalog({ force: true });
                } catch (error) {
                    this.notify(actionLabel + 'Falha no envio: ' + error.message, 'error');
                } finally {
                    this.reviewBusyId = '';
                }
            },

            async previewItem(item) {
                if (!item || !item.id) {
                    return;
                }

                try {
                    this.previewDetail = await this.apiRequest('/api/marketplace/items/' + encodeURIComponent(item.id));
                    this.showPreviewDialog = true;
                } catch (error) {
                    this.notify('Falha ao carregar visualização: ' + error.message, 'error');
                }
            },

            closePreviewDialog() {
                this.showPreviewDialog = false;
            },

            async copyPreviewJson() {
                await this.copyText(this.previewJsonText, 'Visualização JSON Copiado');
            },

            async startImportFromPreview() {
                const detail = this.previewDetail;
                if (!detail || !detail.id) {
                    return;
                }
                this.closePreviewDialog();
                await this.startImport(detail);
            },

            async startImport(item) {
                if (!item || !item.id) {
                    return;
                }

                this.busyId = item.id;
                try {
                    const detail = await this.apiRequest('/api/marketplace/items/' + encodeURIComponent(item.id));
                    if (detail.item_type === 'command_bundle') {
                        await this.importCommandBundle(detail);
                        return;
                    }

                    this.pendingImport = detail;
                    this.importStrategy = 'overwrite';
                    this.importPresetName = safeString(detail.name || detail.preset_name || 'inadimplência de mercado');
                    this.showImportDialog = true;
                } catch (error) {
                    this.notify('Falha ao carregar conteúdo importado: ' + error.message, 'error');
                } finally {
                    this.busyId = '';
                }
            },

            closeImportDialog() {
                this.showImportDialog = false;
                this.pendingImport = null;
                this.importStrategy = 'overwrite';
                this.importPresetName = '';
            },

            async confirmImport() {
                if (!this.pendingImport) {
                    return;
                }

                this.importSaving = true;
                try {
                    await this.loadSiteConfigs();
                    if (this.importStrategy === 'save_as_preset') {
                        await this.applySiteSaveAsPreset();
                    } else {
                        await this.applySiteOverwrite();
                    }
                    this.closeImportDialog();
                } catch (error) {
                    this.notify('Falha na importação: ' + error.message, 'error');
                } finally {
                    this.importSaving = false;
                }
            },

            async loadSiteConfigs() {
                const data = await this.apiRequest('/api/config');
                this.siteConfigs = this.normalizeConfig(data);
                return this.siteConfigs;
            },

            async saveSiteConfigs(config) {
                await this.apiRequest('/api/config', {
                    method: 'POST',
                    body: JSON.stringify({ config })
                });
                this.siteConfigs = this.normalizeConfig(config);
            },

            validateSingleSiteConfig(config) {
                if (typeof config !== 'object' || config === null || Array.isArray(config)) {
                    return false;
                }

                if (config.presets !== undefined) {
                    if (typeof config.presets !== 'object' || config.presets === null || Array.isArray(config.presets)) {
                        return false;
                    }

                    for (const presetData of Object.values(config.presets)) {
                        if (typeof presetData !== 'object' || presetData === null || Array.isArray(presetData)) {
                            return false;
                        }
                    }
                }

                return true;
            },

            validateImportedConfig(config) {
                if (typeof config !== 'object' || config === null || Array.isArray(config)) {
                    return false;
                }

                for (const [domain, siteConfig] of Object.entries(config)) {
                    if (!domain || typeof domain !== 'string') {
                        return false;
                    }
                    if (!this.validateSingleSiteConfig(siteConfig)) {
                        return false;
                    }
                }

                return true;
            },

            normalizeConfig(raw) {
                const normalized = {};
                const presetFields = [
                    'selectors',
                    'workflow',
                    'stealth',
                    'stream_config',
                    'image_extraction',
                    'file_paste',
                    'extractor_id',
                    'extractor_verified'
                ];

                for (const [domain, value] of Object.entries(raw || {})) {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) {
                        continue;
                    }

                    if (value.presets && typeof value.presets === 'object' && !Array.isArray(value.presets)) {
                        const presets = {};
                        for (const [presetName, presetData] of Object.entries(value.presets)) {
                            presets[presetName] = {
                                ...deepClone(presetData),
                                selectors: presetData && typeof presetData.selectors === 'object' && !Array.isArray(presetData.selectors)
                                    ? deepClone(presetData.selectors)
                                    : {},
                                workflow: Array.isArray(presetData && presetData.workflow)
                                    ? deepClone(presetData.workflow)
                                    : [],
                                stealth: !!(presetData && presetData.stealth)
                            };
                        }

                        const presetKeys = Object.keys(presets);
                        const configuredDefault = typeof value.default_preset === 'string' ? value.default_preset : '';
                        const defaultPreset = configuredDefault && presets[configuredDefault]
                            ? configuredDefault
                            : (presets[MAIN_PRESET_NAME] ? MAIN_PRESET_NAME : (presetKeys[0] || MAIN_PRESET_NAME));

                        const siteConfig = {
                            presets,
                            default_preset: defaultPreset
                        };

                        for (const [field, fieldValue] of Object.entries(value)) {
                            if (field !== 'presets' && field !== 'default_preset' && !presetFields.includes(field)) {
                                siteConfig[field] = deepClone(fieldValue);
                            }
                        }

                        normalized[domain] = siteConfig;
                        continue;
                    }

                    normalized[domain] = {
                        default_preset: MAIN_PRESET_NAME,
                        presets: {
                            [MAIN_PRESET_NAME]: {
                                ...deepClone(value),
                                selectors: value && typeof value.selectors === 'object' && !Array.isArray(value.selectors)
                                    ? deepClone(value.selectors)
                                    : {},
                                workflow: Array.isArray(value && value.workflow)
                                    ? deepClone(value.workflow)
                                    : [],
                                stealth: !!value.stealth
                            }
                        }
                    };
                }

                return normalized;
            },

            getSingleImportedSite(detail) {
                const siteConfig = detail && detail.site_config;
                if (!this.validateImportedConfig(siteConfig)) {
                    throw new Error('O formato de configuração do mercado é inválido');
                }

                const domains = Object.keys(siteConfig || {});
                if (domains.length !== 1) {
                    throw new Error('Atualmente, apenas há suporte para importação de configuração de site único.');
                }

                const domain = domains[0];
                const normalized = this.normalizeConfig(siteConfig);
                const site = normalized[domain];
                if (!site) {
                    throw new Error('Falha na análise da configuração do site');
                }

                return { domain, site };
            },

            async applySiteOverwrite() {
                const imported = this.getSingleImportedSite(this.pendingImport);
                const nextConfig = deepClone(this.siteConfigs);
                nextConfig[imported.domain] = imported.site;
                await this.saveSiteConfigs(nextConfig);
                this.notify('A configuração do site foi substituída e importada: ' + imported.domain, 'success');
            },

            async applySiteSaveAsPreset() {
                const imported = this.getSingleImportedSite(this.pendingImport);
                const newPresetName = safeString(this.importPresetName);
                if (!newPresetName) {
                    throw new Error('Preencha o nome padrão de Salvar como');
                }

                const nextConfig = deepClone(this.siteConfigs);
                const targetSite = nextConfig[imported.domain]
                    ? deepClone(nextConfig[imported.domain])
                    : { default_preset: newPresetName, presets: {} };

                if (targetSite.presets && targetSite.presets[newPresetName]) {
                    throw new Error('O nome padrão já existe, altere o nome');
                }

                const importedPresets = imported.site.presets || {};
                const sourcePresetName = imported.site.default_preset && importedPresets[imported.site.default_preset]
                    ? imported.site.default_preset
                    : Object.keys(importedPresets)[0];

                if (!sourcePresetName) {
                    throw new Error('O conteúdo importado não contém predefinições');
                }

                targetSite.presets = targetSite.presets || {};
                targetSite.presets[newPresetName] = deepClone(importedPresets[sourcePresetName]);
                if (!targetSite.default_preset || !targetSite.presets[targetSite.default_preset]) {
                    targetSite.default_preset = newPresetName;
                }

                nextConfig[imported.domain] = targetSite;
                await this.saveSiteConfigs(nextConfig);
                this.notify('Configuração do site salva como predefinida: ' + newPresetName, 'success');
            },

            async loadCommands() {
                this.commandLoading = true;
                try {
                    const data = await this.apiRequest('/api/commands');
                    const commands = Array.isArray(data && data.commands) ? data.commands : [];
                    commands.sort((a, b) => safeString(a.name).localeCompare(safeString(b.name), 'zh-CN'));
                    this.commandOptions = commands;
                    return commands;
                } catch (error) {
                    this.notify('Falha ao carregar a lista de comandos: ' + error.message, 'error');
                    return [];
                } finally {
                    this.commandLoading = false;
                }
            },

            prepareCommandImportPayload(command) {
                const payload = deepClone(command || {});
                delete payload.id;
                delete payload.last_triggered;
                delete payload.trigger_count;
                return payload;
            },

            async importCommandBundle(detail) {
                const bundle = detail && detail.command_bundle;
                const commands = Array.isArray(bundle && bundle.commands) ? bundle.commands : [];
                if (!commands.length) {
                    throw new Error('O conteúdo do pacote de comandos está vazio');
                }

                const idMap = {};
                const importedCommands = [];

                for (const command of commands) {
                    const originalId = command.id;
                    const payload = this.prepareCommandImportPayload(command);
                    const response = await this.apiRequest('/api/commands', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    const created = response.command;
                    importedCommands.push(created);
                    if (originalId && created && created.id) {
                        idMap[originalId] = created.id;
                    }
                }

                for (let index = 0; index < commands.length; index += 1) {
                    const original = commands[index];
                    const created = importedCommands[index];
                    if (!original || !created || !original.trigger) {
                        continue;
                    }

                    const trigger = deepClone(original.trigger);
                    if (trigger.command_id && idMap[trigger.command_id]) {
                        trigger.command_id = idMap[trigger.command_id];
                    }
                    if (Array.isArray(trigger.command_ids)) {
                        trigger.command_ids = trigger.command_ids.map((commandId) => idMap[commandId] || commandId);
                    }

                    await this.apiRequest('/api/commands/' + encodeURIComponent(created.id), {
                        method: 'PUT',
                        body: JSON.stringify({ trigger })
                    });
                }

                this.notify('O sistema de comando foi importado, um total de ' + importedCommands.length + ' comando', 'success');
            },

            resetSubmitForm() {
                this.submitForm = {
                    item_type: 'site_config',
                    title: '',
                    summary: '',
                    author: 'Postagem principal',
                    site_domain: '',
                    preset_name: '',
                    category: '',
                    version: '1.0.0',
                    compatibility: '',
                    tagsText: '',
                    selected_command_ids: []
                };
            },

            async openSubmitDialog() {
                this.resetSubmitForm();
                this.showSubmitDialog = true;
                try {
                    await this.loadSiteConfigs();
                    if (this.availableSites.length > 0) {
                        this.submitForm.site_domain = this.availableSites[0];
                        this.syncPresetSelection();
                    }
                } catch (error) {
                    this.notify('Falha ao carregar a configuração do site: ' + error.message, 'error');
                }
            },

            closeSubmitDialog() {
                this.showSubmitDialog = false;
            },

            async setSubmitType(type) {
                this.submitForm.item_type = type;
                if (type === 'command_bundle') {
                    this.submitForm.category = 'sistema de comando';
                    if (!this.commandOptions.length) {
                        await this.loadCommands();
                    }
                    return;
                }

                if (this.availableSites.length > 0 && !this.submitForm.site_domain) {
                    this.submitForm.site_domain = this.availableSites[0];
                }
                this.syncPresetSelection();
            },

            syncPresetSelection() {
                if (this.submitForm.item_type !== 'site_config') {
                    return;
                }

                if (!this.submitForm.category
                    || this.submitForm.category === 'sistema de comando'
                    || this.availableSites.includes(this.submitForm.category)) {
                    this.submitForm.category = this.submitForm.site_domain || '';
                }

                const presets = this.availablePresets;
                if (!presets.includes(this.submitForm.preset_name)) {
                    this.submitForm.preset_name = presets[0] || '';
                }
            },

            parseTags(text) {
                return String(text || '')
                    .split(/[,\n，]/)
                    .map((item) => item.trim())
                    .filter(Boolean);
            },

            sanitizeCommandForBundle(command) {
                const payload = deepClone(command || {});
                delete payload.last_triggered;
                delete payload.trigger_count;
                return payload;
            },

            getSelectedCommands() {
                const selectedIds = new Set(this.submitForm.selected_command_ids || []);
                return (this.commandOptions || [])
                    .filter((command) => selectedIds.has(command.id))
                    .map((command) => this.sanitizeCommandForBundle(command));
            },

            buildSubmissionPayload() {
                const title = safeString(this.submitForm.title);
                const summary = safeString(this.submitForm.summary);
                const author = safeString(this.submitForm.author || 'Postagem principal') || 'Postagem principal';
                const category = safeString(this.submitForm.category);
                const compatibility = safeString(this.submitForm.compatibility);
                const version = safeString(this.submitForm.version || '1.0.0') || '1.0.0';
                const tags = this.parseTags(this.submitForm.tagsText);

                if (!title) {
                    throw new Error('Por favor preencha o título');
                }
                if (!summary) {
                    throw new Error('Por favor preencha a introdução');
                }

                if (this.submitForm.item_type === 'command_bundle') {
                    const commands = this.getSelectedCommands();
                    if (!commands.length) {
                        throw new Error('Selecione pelo menos um comando');
                    }

                    return {
                        item_type: 'command_bundle',
                        title,
                        summary,
                        author,
                        category: category || 'sistema de comando',
                        compatibility,
                        version,
                        tags,
                        command_bundle: {
                            group_name: '',
                            commands
                        }
                    };
                }

                const siteDomain = safeString(this.submitForm.site_domain);
                if (!siteDomain) {
                    throw new Error('Selecione um site');
                }

                const siteConfig = this.siteConfigs[siteDomain];
                if (!siteConfig || !siteConfig.presets) {
                    throw new Error('O site atual não tem nenhuma configuração com a qual contribuir.');
                }

                const presetName = safeString(this.submitForm.preset_name || siteConfig.default_preset || MAIN_PRESET_NAME);
                const presetConfig = siteConfig.presets[presetName];
                if (!presetConfig) {
                    throw new Error('Selecione uma predefinição disponível');
                }

                return {
                    item_type: 'site_config',
                    title,
                    summary,
                    author,
                    category: category || siteDomain,
                    site_domain: siteDomain,
                    preset_name: presetName,
                    compatibility,
                    version,
                    tags,
                    site_config: {
                        [siteDomain]: {
                            default_preset: presetName,
                            presets: {
                                [presetName]: deepClone(presetConfig)
                            }
                        }
                    }
                };
            },

            async copySubmissionPreview() {
                await this.copyText(this.submissionPreviewText, 'Visualização do envio copiada');
            },

            buildSubmissionJsonBlock(payload) {
                return [
                    '```json',
                    JSON.stringify(payload, null, 2),
                    '```'
                ].join('\n');
            },

            async submitItem() {
                let payload = null;
                try {
                    payload = this.buildSubmissionPayload();
                } catch (error) {
                    this.notify(error.message, 'warning');
                    return;
                }

                this.submitSaving = true;
                try {
                    const result = await this.apiRequest('/api/marketplace/items', {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });

                    if (result && result.mode === 'external' && safeString(result.submission_url)) {
                        const copied = await this.tryCopyText(this.buildSubmissionJsonBlock(payload));
                        this.openLink(result.submission_url);
                        this.notify(
                            copied
                                ? (result.message || 'Aberto GitHub Página de submissão pública, por favor coloque a cópia JSON Cole o bloco de código em“Visualização JSON”sob')
                                : 'Aberto GitHub Página de envio público, mas a cópia da área de transferência falhou, copie manualmente JSON Visualização',
                            copied ? 'success' : 'warning'
                        );
                        this.closeSubmitDialog();
                        return;
                    }

                    this.notify((result && result.message) || 'O envio foi adicionado ao mercado local', 'success');
                    this.closeSubmitDialog();
                    await this.loadCatalog({ force: true });
                } catch (error) {
                    this.notify('Falha no envio: ' + error.message, 'error');
                } finally {
                    this.submitSaving = false;
                }
            },

            async tryCopyText(text) {
                try {
                    await navigator.clipboard.writeText(text);
                    return true;
                } catch (error) {
                    return false;
                }
            },

            async copyText(text, successMessage) {
                const copied = await this.tryCopyText(text);
                if (copied) {
                    this.notify(successMessage, 'success');
                } else {
                    this.notify('Falha na cópia, verifique as permissões do navegador', 'error');
                }
            },

            handleKeydown(event) {
                if (event.key !== 'Escape') {
                    return;
                }
                if (this.showReviewDialog) {
                    this.closeReviewDialog();
                    return;
                }
                if (this.showSubmitDialog) {
                    this.closeSubmitDialog();
                    return;
                }
                if (this.showImportDialog) {
                    this.closeImportDialog();
                    return;
                }
                if (this.showPreviewDialog) {
                    this.closePreviewDialog();
                }
            },

            notify(message, type = 'info') {
                const id = Date.now() + Math.random();
                this.toasts.push({ id, message, type });
                window.setTimeout(() => {
                    this.toasts = this.toasts.filter((toast) => toast.id !== id);
                }, 3200);
            }
        }
    }).mount('#marketplace-app');
})();
