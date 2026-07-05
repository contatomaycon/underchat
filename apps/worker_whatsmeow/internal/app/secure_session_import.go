package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type secureSessionPackage struct {
	FormatVersion  string          `json:"format_version"`
	Source         string          `json:"source"`
	TargetProvider string          `json:"target_provider"`
	CreatedAt      string          `json:"created_at"`
	WebVersion     string          `json:"web_version"`
	AccountHint    string          `json:"account_hint"`
	Checksum       string          `json:"checksum"`
	Payload        json.RawMessage `json:"payload"`
	PayloadRef     string          `json:"payload_ref"`
}

type secureSessionPayloadFile struct {
	Data     string `json:"data"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

type secureSessionWhatsmeowSQLStorePayload struct {
	StoreDBBase64 string                              `json:"store_db_base64"`
	StoreDB       string                              `json:"store_db"`
	Files         map[string]secureSessionPayloadFile `json:"files"`
}

func (m *WhatsAppManager) importSecureSessionPackage(ctx context.Context, req SecureSessionImportRequest) (ConnectionState, error) {
	if req.DebugTraceID != "" {
		m.setDebugTraceID(req.DebugTraceID)
	}
	if req.WorkerID != "" && req.WorkerID != m.cfg.WorkerID {
		return ConnectionState{}, fmt.Errorf("request worker_id %s does not match %s", req.WorkerID, m.cfg.WorkerID)
	}
	if req.AccountID != "" && req.AccountID != m.cfg.AccountID {
		return ConnectionState{}, fmt.Errorf("request account_id %s does not match %s", req.AccountID, m.cfg.AccountID)
	}

	connectionFlowLog("whatsmeow.provider.secure_import.start", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"format_version":        req.FormatVersion,
		"target_provider":       req.TargetProvider,
		"has_payload_ref":       req.PayloadRef != "",
		"has_payload_json":      req.PayloadJSON != "",
	})

	pkg, err := m.resolveSecureSessionPackage(ctx, req)
	if err != nil {
		return m.secureImportFailureState(req, "secure_session_payload_unavailable", err.Error()), nil
	}

	storeDB, err := extractWhatsmeowStoreDB(pkg)
	if err != nil {
		connectionFlowLog("whatsmeow.provider.secure_import.unsupported_payload", map[string]any{
			"trace_id":              req.DebugTraceID,
			"layer":                 "worker_whatsmeow.provider",
			"worker_id":             firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
			"account_id":            firstNonEmpty(req.AccountID, m.cfg.AccountID),
			"worker_type_id":        WorkerTypeWhatsmeow,
			"connection_attempt_id": req.ConnectionAttemptID,
			"runtime_generation":    req.RuntimeGeneration,
			"format_version":        pkg.FormatVersion,
			"target_provider":       pkg.TargetProvider,
			"reason":                err.Error(),
			"payload_bytes":         len(pkg.Payload),
		})
		return m.secureImportFailureState(req, "secure_session_payload_unsupported", err.Error()), nil
	}

	state, err := m.restoreWhatsmeowSQLStore(ctx, req, storeDB)
	if err != nil {
		return m.secureImportFailureState(req, "secure_session_import_failed", err.Error()), nil
	}
	return state, nil
}

func (m *WhatsAppManager) resolveSecureSessionPackage(ctx context.Context, req SecureSessionImportRequest) (secureSessionPackage, error) {
	raw := strings.TrimSpace(req.PayloadJSON)
	if raw == "" && strings.TrimSpace(req.PayloadRef) != "" {
		if m.redis == nil {
			return secureSessionPackage{}, fmt.Errorf("redis client is required to resolve secure session payload_ref")
		}

		value, err := m.redis.Get(ctx, req.PayloadRef).Result()
		if errors.Is(err, redis.Nil) {
			return secureSessionPackage{}, fmt.Errorf("secure session payload_ref not found or expired")
		}
		if err != nil {
			return secureSessionPackage{}, fmt.Errorf("read secure session payload_ref: %w", err)
		}
		raw = value
	}

	if raw == "" {
		return secureSessionPackage{}, fmt.Errorf("secure session payload is required")
	}

	var pkg secureSessionPackage
	if err := json.Unmarshal([]byte(raw), &pkg); err != nil {
		return secureSessionPackage{}, fmt.Errorf("decode secure session package: %w", err)
	}
	if strings.TrimSpace(pkg.FormatVersion) == "" {
		pkg.FormatVersion = req.FormatVersion
	}
	if strings.TrimSpace(pkg.TargetProvider) == "" {
		pkg.TargetProvider = req.TargetProvider
	}
	if pkg.Source != "whatsapp_web" {
		return secureSessionPackage{}, fmt.Errorf("secure session source %q is not supported", pkg.Source)
	}
	targetProvider := strings.TrimSpace(pkg.TargetProvider)
	if targetProvider != "" && targetProvider != "auto" && targetProvider != "whatsmeow" {
		return secureSessionPackage{}, fmt.Errorf("secure session target provider %q is not compatible with whatsmeow", targetProvider)
	}
	return pkg, nil
}

func extractWhatsmeowStoreDB(pkg secureSessionPackage) ([]byte, error) {
	if len(pkg.Payload) == 0 || string(pkg.Payload) == "null" {
		return nil, fmt.Errorf("secure session payload is empty")
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(pkg.Payload, &payload); err != nil {
		return nil, fmt.Errorf("decode secure session payload: %w", err)
	}

	for _, key := range []string{"whatsmeow_sqlstore", "whatsmeowSqlstore", "sqlstore"} {
		raw := payload[key]
		if len(raw) == 0 {
			continue
		}

		var sqlstorePayload secureSessionWhatsmeowSQLStorePayload
		if err := json.Unmarshal(raw, &sqlstorePayload); err != nil {
			return nil, fmt.Errorf("decode whatsmeow sqlstore payload: %w", err)
		}

		if data, err := decodeStoreDBCandidate(sqlstorePayload.StoreDBBase64); err == nil && len(data) > 0 {
			return data, nil
		}
		if data, err := decodeStoreDBCandidate(sqlstorePayload.StoreDB); err == nil && len(data) > 0 {
			return data, nil
		}

		for _, fileName := range []string{"store.db", "./store.db"} {
			file, ok := sqlstorePayload.Files[fileName]
			if !ok {
				continue
			}
			data, err := decodeSecureSessionFile(file)
			if err != nil {
				return nil, fmt.Errorf("decode whatsmeow store.db file: %w", err)
			}
			if len(data) > 0 {
				return data, nil
			}
		}
	}

	if hasPayloadKey(payload, "wwebjs_local_auth", "local_auth", "wwebjsLocalAuth", "browser_storage", "cookies", "local_storage", "indexeddb_databases") {
		return nil, fmt.Errorf("secure session package contains a WhatsApp Web browser profile; whatsmeow requires payload.whatsmeow_sqlstore.store_db_base64")
	}
	if hasPayloadKey(payload, "baileys_multi_file_auth_state") {
		return nil, fmt.Errorf("secure session package contains Baileys auth state; whatsmeow requires payload.whatsmeow_sqlstore.store_db_base64")
	}

	return nil, fmt.Errorf("secure session package does not contain payload.whatsmeow_sqlstore.store_db_base64")
}

func hasPayloadKey(payload map[string]json.RawMessage, keys ...string) bool {
	for _, key := range keys {
		if len(payload[key]) > 0 {
			return true
		}
	}
	return false
}

func decodeStoreDBCandidate(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, fmt.Errorf("empty store db")
	}
	return base64.StdEncoding.DecodeString(value)
}

func decodeSecureSessionFile(file secureSessionPayloadFile) ([]byte, error) {
	value := file.Data
	if value == "" {
		value = file.Content
	}
	encoding := strings.ToLower(strings.TrimSpace(file.Encoding))
	if encoding == "" {
		encoding = "base64"
	}
	if encoding != "base64" {
		return nil, fmt.Errorf("unsupported store.db encoding %q", encoding)
	}
	return decodeStoreDBCandidate(value)
}

func (m *WhatsAppManager) restoreWhatsmeowSQLStore(ctx context.Context, req SecureSessionImportRequest, storeDB []byte) (ConnectionState, error) {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()

	storeDir := m.sessionDir()
	parentDir := filepath.Dir(storeDir)
	importID := secureImportID()
	tempDir := filepath.Join(parentDir, filepath.Base(storeDir)+".secure-import-"+importID)
	backupDir := filepath.Join(parentDir, filepath.Base(storeDir)+".backup-"+time.Now().UTC().Format("20060102150405")+"-"+importID)
	tempDBPath := filepath.Join(tempDir, "store.db")
	storeDBPath := filepath.Join(storeDir, "store.db")
	backupCreated := false
	replaced := false

	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return ConnectionState{}, fmt.Errorf("create temp secure import dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	if err := os.WriteFile(tempDBPath, storeDB, 0o600); err != nil {
		return ConnectionState{}, fmt.Errorf("write temp whatsmeow store.db: %w", err)
	}
	if err := validateWhatsmeowStoreDB(ctx, tempDBPath); err != nil {
		return ConnectionState{}, err
	}

	m.closeCurrentWhatsmeowClient()

	if _, err := os.Stat(storeDir); err == nil {
		if err := os.RemoveAll(backupDir); err != nil {
			return ConnectionState{}, fmt.Errorf("clear old whatsmeow backup dir: %w", err)
		}
		if err := os.Rename(storeDir, backupDir); err != nil {
			return ConnectionState{}, fmt.Errorf("backup current whatsmeow store: %w", err)
		}
		backupCreated = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return ConnectionState{}, fmt.Errorf("stat current whatsmeow store: %w", err)
	}

	if err := os.Rename(tempDir, storeDir); err != nil {
		if backupCreated {
			_ = os.Rename(backupDir, storeDir)
		}
		return ConnectionState{}, fmt.Errorf("activate imported whatsmeow store: %w", err)
	}
	replaced = true

	restoreBackup := func(reason string) {
		if !replaced || !backupCreated {
			return
		}
		_ = os.RemoveAll(storeDir)
		if err := os.Rename(backupDir, storeDir); err != nil {
			log.Printf("whatsmeow secure import rollback failed worker_id=%s reason=%s error=%v", m.cfg.WorkerID, reason, err)
		}
	}

	if err := m.initClient(ctx); err != nil {
		restoreBackup("init_client_failed")
		_ = m.initClient(ctx)
		return ConnectionState{}, fmt.Errorf("initialize imported whatsmeow store: %w", err)
	}

	client := m.getClient()
	if client == nil || client.Store == nil || client.Store.ID == nil {
		restoreBackup("missing_store_id")
		_ = m.initClient(ctx)
		return ConnectionState{}, fmt.Errorf("imported whatsmeow store has no device identity")
	}

	m.setConnectionAttemptID(req.ConnectionAttemptID)
	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.degradedReason = ""
	m.mu.Unlock()
	m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)

	connectCtx, cancel := context.WithTimeout(ctx, m.cfg.WhatsAppConnectTimeout+5*time.Second)
	defer cancel()
	if err := m.connectClient(connectCtx, client, "secure-session-import"); err != nil {
		restoreBackup("connect_failed")
		_ = m.initClient(ctx)
		return ConnectionState{}, fmt.Errorf("connect imported whatsmeow store: %w", err)
	}

	phone := phoneFromOwnID(client.Store.ID)
	if !m.publishConnectedWhenReady(ctx, "secure-session-import", phone, true) {
		state := m.currentConnectionState()
		state.ConnectionAttemptID = req.ConnectionAttemptID
		state.RuntimeGeneration = req.RuntimeGeneration
		state.DebugTraceID = req.DebugTraceID
		if state.Error == "" {
			state.Error = "Imported whatsmeow store connected, but session readiness was not confirmed."
		}
		return state, nil
	}

	if backupCreated {
		_ = os.RemoveAll(backupDir)
	}

	state := m.currentConnectionState()
	state.Code = CodeConnectionEstablished
	state.Status = "connected"
	state.WorkerStatusID = WorkerStatusOnline
	state.WorkerID = m.cfg.WorkerID
	state.AccountID = m.cfg.AccountID
	state.WorkerTypeID = WorkerTypeWhatsmeow
	state.ConnectionAttemptID = req.ConnectionAttemptID
	state.RuntimeGeneration = req.RuntimeGeneration
	state.DebugTraceID = req.DebugTraceID
	state.Phone = phone
	state.SessionReady = true
	state.Authenticated = true
	state.CanSend = true
	state.CanReceiveRuntime = true
	connectionFlowLog("whatsmeow.provider.secure_import.connected", map[string]any{
		"trace_id":              req.DebugTraceID,
		"layer":                 "worker_whatsmeow.provider",
		"worker_id":             m.cfg.WorkerID,
		"account_id":            m.cfg.AccountID,
		"worker_type_id":        WorkerTypeWhatsmeow,
		"connection_attempt_id": req.ConnectionAttemptID,
		"runtime_generation":    req.RuntimeGeneration,
		"phone_present":         phone != "",
		"store_path":            storeDBPath,
	})
	return state, nil
}

func validateWhatsmeowStoreDB(ctx context.Context, dbPath string) error {
	container, err := sqlstore.New(ctx, "sqlite3", "file:"+dbPath+"?_foreign_keys=on", waLog.Noop)
	if err != nil {
		return fmt.Errorf("validate whatsmeow store.db: %w", err)
	}
	defer container.Close()

	devices, err := container.GetAllDevices(ctx)
	if err != nil {
		return fmt.Errorf("read whatsmeow store devices: %w", err)
	}
	for _, device := range devices {
		if device != nil && device.ID != nil {
			return nil
		}
	}
	return fmt.Errorf("whatsmeow store.db does not contain a saved device identity")
}

func (m *WhatsAppManager) closeCurrentWhatsmeowClient() {
	client := m.getClient()
	if client != nil {
		client.Disconnect()
		if client.Store != nil {
			if container, ok := client.Store.Container.(*sqlstore.Container); ok {
				if err := container.Close(); err != nil {
					log.Printf("whatsmeow close current sqlstore failed worker_id=%s error=%v", m.cfg.WorkerID, err)
				}
			}
		}
	}

	m.mu.Lock()
	m.client = nil
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.mu.Unlock()
}

func (m *WhatsAppManager) secureImportFailureState(req SecureSessionImportRequest, reason string, message string) ConnectionState {
	return ConnectionState{
		Code:                CodeBadSession,
		Status:              "disconnected",
		WorkerID:            firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
		AccountID:           firstNonEmpty(req.AccountID, m.cfg.AccountID),
		WorkerTypeID:        WorkerTypeWhatsmeow,
		WorkerStatusID:      WorkerStatusDisponible,
		ConnectionAttemptID: req.ConnectionAttemptID,
		RuntimeGeneration:   req.RuntimeGeneration,
		DebugTraceID:        req.DebugTraceID,
		Reason:              reason,
		Error:               message,
		SessionReady:        false,
		Authenticated:       false,
		CanSend:             false,
		CanReceiveRuntime:   false,
	}
}

func secureImportID() string {
	var data [6]byte
	if _, err := rand.Read(data[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(data[:])
}
