package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/encoding/protojson"
)

type WhatsAppManager struct {
	cfg        Config
	kafka      *KafkaClient
	centrifugo *CentrifugoClient
	balance    *BalanceGRPCClient
	storage    *StorageClient
	redis      *redis.Client
	runtimeCtx context.Context

	mu          sync.RWMutex
	sessionMu   sync.Mutex
	client      *whatsmeow.Client
	connected   bool
	status      string
	code        int
	rejectCalls bool

	pendingFreshLogin   *freshLoginRequest
	currentQRCode       string
	currentPairingCode  string
	qrGenerationCount   int
	qrReadSessionLocked bool
	qrHash              string
}

const (
	whatsmeowPhotoCachePrefix        = "photo:jid:"
	whatsmeowPhotoNoPhotoCachePrefix = "photo:no-photo:whatsmeow:jid:"
	whatsmeowPhotoCacheNoPhoto       = "__no_photo__"
	whatsmeowPhotoCacheTTL           = 24 * time.Hour
	whatsmeowPhotoCacheNoPhotoTTL    = 5 * time.Minute
	whatsmeowPhotoFetchTimeout       = 5 * time.Second
	whatsmeowLogoutTimeout           = 30 * time.Second

	whatsmeowPairClientDesktop     whatsmeow.PairClientType = 7
	whatsmeowPairClientDisplayName                          = "Desktop (Mac OS)"
	maxQRCodeGenerations                                    = 3
)

type freshLoginRequest struct {
	Type  string
	Phone string
}

type historySyncCandidate struct {
	chatJID   types.JID
	message   *waHistorySync.HistorySyncMsg
	timestamp uint64
}

func NewWhatsAppManager(ctx context.Context, cfg Config, kafka *KafkaClient, centrifugo *CentrifugoClient, balance *BalanceGRPCClient, storage *StorageClient, redisClient *redis.Client) (*WhatsAppManager, error) {
	manager := &WhatsAppManager{
		cfg:        cfg,
		kafka:      kafka,
		centrifugo: centrifugo,
		balance:    balance,
		storage:    storage,
		redis:      redisClient,
		runtimeCtx: ctx,
		status:     "initial",
		code:       CodeInfo,
	}
	if err := manager.initClient(ctx); err != nil {
		return nil, err
	}
	return manager, nil
}

func (m *WhatsAppManager) sessionDir() string {
	return filepath.Join(m.cfg.DataDir, "whatsmeow", m.cfg.WorkerID)
}

func (m *WhatsAppManager) initClient(ctx context.Context) error {
	storeDir := m.sessionDir()
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		return err
	}
	dbPath := filepath.Join(storeDir, "store.db")
	log.Printf("initializing whatsmeow client worker_id=%s store=%s", m.cfg.WorkerID, dbPath)
	container, err := sqlstore.New(ctx, "sqlite3", "file:"+dbPath+"?_foreign_keys=on", waLog.Noop)
	if err != nil {
		return err
	}
	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		return err
	}
	client := whatsmeow.NewClient(deviceStore, waLog.Stdout("Whatsmeow", "INFO", true))
	if proxy := m.cfg.ProxyURL(); proxy != "" {
		if err := client.SetProxyAddress(proxy); err != nil {
			log.Printf("failed to configure proxy: %v", err)
		} else {
			log.Printf("whatsmeow proxy configured worker_id=%s protocol=%s host=%s port=%d", m.cfg.WorkerID, m.cfg.ProxyProtocol, m.cfg.ProxyHost, m.cfg.ProxyPort)
		}
	}
	client.AddEventHandler(m.handleEvent)

	m.mu.Lock()
	m.client = client
	m.mu.Unlock()
	log.Printf("whatsmeow client initialized worker_id=%s has_store_id=%t", m.cfg.WorkerID, deviceStore.ID != nil)
	return nil
}

func (m *WhatsAppManager) Bootstrap(ctx context.Context) {
	client := m.getClient()
	if client == nil || client.Store.ID == nil {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s has_client=%t has_store_id=%t", m.cfg.WorkerID, client != nil, client != nil && client.Store.ID != nil)
		return
	}
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s reason=already_authenticated", m.cfg.WorkerID)
		m.mu.Lock()
		m.connected = true
		m.status = "connected"
		m.code = CodeConnectionEstablished
		m.mu.Unlock()
		go m.markPresenceAvailable(context.Background(), "bootstrap-already-authenticated")
		m.publishState(context.Background(), "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return
	}
	if client.IsConnected() {
		log.Printf("whatsmeow bootstrap skipped worker_id=%s reason=already_connected", m.cfg.WorkerID)
		m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return
	}
	go func() {
		log.Printf("whatsmeow bootstrap connect starting worker_id=%s", m.cfg.WorkerID)
		m.setState("connecting", CodeAwaitConnection, "")
		if err := m.connectClient(ctx, client, "bootstrap"); err != nil {
			log.Printf("whatsmeow bootstrap connect failed: %v", err)
			m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
		}
	}()
}

func (m *WhatsAppManager) getClient() *whatsmeow.Client {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.client
}

func hasDeletedStore(client *whatsmeow.Client) bool {
	return client != nil && client.Store != nil && client.Store.Deleted
}

func (m *WhatsAppManager) ensureUsableClientForLogin(ctx context.Context, reason string) (*whatsmeow.Client, error) {
	client := m.getClient()
	if client != nil && client.Store != nil && !client.Store.Deleted {
		return client, nil
	}

	log.Printf(
		"whatsmeow login client reinit required worker_id=%s reason=%s has_client=%t has_store=%t store_deleted=%t",
		m.cfg.WorkerID,
		reason,
		client != nil,
		client != nil && client.Store != nil,
		hasDeletedStore(client),
	)

	if err := m.resetLocalSession(ctx); err != nil {
		return nil, err
	}

	client = m.getClient()
	if client == nil || client.Store == nil || client.Store.Deleted {
		return nil, fmt.Errorf("client is not initialized")
	}

	return client, nil
}

func (m *WhatsAppManager) clearLocalSessionFiles() error {
	storeDir := m.sessionDir()
	if err := os.RemoveAll(storeDir); err != nil {
		return err
	}
	return os.MkdirAll(storeDir, 0o755)
}

func (m *WhatsAppManager) IsConnected() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.connected
}

func (m *WhatsAppManager) currentConnectionState() ConnectionState {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return ConnectionState{
		Code:        m.code,
		Status:      m.status,
		WorkerID:    m.cfg.WorkerID,
		AccountID:   m.cfg.AccountID,
		QRCode:      m.currentQRCode,
		PairingCode: m.currentPairingCode,
		Time:        time.Now().Unix(),
	}
}

func (m *WhatsAppManager) RequestConnection(ctx context.Context, req StatusConnectionRequest) (state ConnectionState, err error) {
	if _, ok := connectionLifecycleFromContext(ctx); !ok {
		lifecycle := connectionLifecycleFromRequest(m.cfg, req, "request_connection")
		var finishLifecycleSpan func(error)
		ctx, finishLifecycleSpan = startConnectionLifecycleSpan(ctx, m.cfg, lifecycle)
		defer func() {
			finishLifecycleSpan(err)
		}()
	}
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":                "connection.whatsmeow.manager.request_received",
		"decision":             "request_connection",
		"outcome":              "received",
		"status":               req.Status,
		"connection_type":      req.Type,
		"remove_session":       req.RemoveSession,
		"has_phone_connection": req.PhoneConnection != "",
	})
	log.Printf(
		"whatsmeow RequestConnection worker_id=%s status=%s type=%s remove_session=%t phone_connection_set=%t",
		req.WorkerID,
		req.Status,
		req.Type,
		req.RemoveSession,
		req.PhoneConnection != "",
	)
	if req.WorkerID != "" && req.WorkerID != m.cfg.WorkerID {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.manager.request_rejected",
			"decision": "worker_id_validation",
			"outcome":  "error",
			"reason":   "worker_id_mismatch",
			"level":    "warn",
			"value":    req.WorkerID,
		})
		return ConnectionState{}, fmt.Errorf("request worker_id %s does not match %s", req.WorkerID, m.cfg.WorkerID)
	}

	connectionType := strings.ToLower(req.Type)
	if connectionType == "phone" {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":           "connection.whatsmeow.manager.request_rejected",
			"decision":        "connection_type_validation",
			"outcome":         "error",
			"reason":          "phone_connection_disabled",
			"level":           "warn",
			"connection_type": connectionType,
		})
		return ConnectionState{}, fmt.Errorf("phone connection is disabled; use qrcode")
	}

	if req.RemoveSession || req.Status == WorkerStatusDisponible {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":          "connection.whatsmeow.manager.remove_session_branch",
			"decision":       "remove_session_or_disponible",
			"outcome":        "entered",
			"status":         req.Status,
			"remove_session": req.RemoveSession,
		})
		if err := m.removeSession(ctx); err != nil {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":    "connection.whatsmeow.manager.remove_session_error",
				"decision": "remove_session",
				"outcome":  "error",
				"reason":   "remove_session_failed",
				"level":    "error",
				"error":    err.Error(),
			})
			return ConnectionState{}, err
		}
		state = ConnectionState{
			Code:             CodeConnectionClosed,
			Status:           "disconnected",
			WorkerID:         m.cfg.WorkerID,
			AccountID:        m.cfg.AccountID,
			DisconnectedUser: true,
			Time:             time.Now().Unix(),
			WorkerStatusID:   WorkerStatusDisponible,
		}
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":             "connection.whatsmeow.manager.remove_session_success",
			"decision":          "remove_session",
			"outcome":           "success",
			"status":            state.Status,
			"code":              state.Code,
			"worker_status_id":  state.WorkerStatusID,
			"disconnected_user": state.DisconnectedUser,
		})
		return state, nil
	}

	if m.publishConnectedIfAuthenticated(ctx, "request-connection-already-authenticated") {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.manager.short_circuit",
			"decision": "publish_connected_if_authenticated",
			"outcome":  "success",
			"reason":   "already_authenticated",
		})
		return m.currentConnectionState(), nil
	}

	switch connectionType {
	case "qrcode", "":
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":           "connection.whatsmeow.manager.qrcode_branch",
			"decision":        "connection_type_route",
			"outcome":         "entered",
			"connection_type": connectionType,
		})
		return m.connectWithQRCode(ctx)
	default:
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":           "connection.whatsmeow.manager.request_rejected",
			"decision":        "connection_type_route",
			"outcome":         "error",
			"reason":          "unsupported_connection_type",
			"level":           "warn",
			"connection_type": connectionType,
		})
		return ConnectionState{}, fmt.Errorf("unsupported connection type %q", req.Type)
	}
}

func (m *WhatsAppManager) ValidatePhone(ctx context.Context, req PhoneValidationRequest) (PhoneValidationResponse, error) {
	resp := PhoneValidationResponse{
		RequestID: req.RequestID,
		AccountID: firstNonEmpty(req.AccountID, m.cfg.AccountID),
		WorkerID:  firstNonEmpty(req.WorkerID, m.cfg.WorkerID),
	}
	candidates := buildPhoneValidationCandidates(req.PhoneDDI, req.Phone)
	if len(candidates) == 0 {
		resp.Error = "phone is required"
		return resp, nil
	}
	client := m.getClient()
	if client == nil {
		resp.Error = "client is not initialized"
		return resp, nil
	}

	var deferredLIDFallback *PhoneValidationResponse
	for _, candidate := range candidates {
		results, err := client.IsOnWhatsApp(ctx, []string{"+" + candidate})
		if err != nil {
			resp.Error = err.Error()
			return resp, nil
		}
		if len(results) == 0 {
			log.Printf("whatsmeow phone validation candidate worker_id=%s request_id=%s candidate=%s result=empty", m.cfg.WorkerID, req.RequestID, candidate)
			continue
		}

		result := results[0]
		jid := normalizeValidationJID(result.JID)
		log.Printf(
			"whatsmeow phone validation candidate worker_id=%s request_id=%s candidate=%s query=%s exists=%t jid=%s",
			m.cfg.WorkerID,
			req.RequestID,
			candidate,
			result.Query,
			result.IsIn,
			jid,
		)
		if !result.IsIn || jid == "" {
			continue
		}

		validResponse := resp
		validResponse.Valid = true
		validResponse.JID = jid

		if result.JID.Server == types.HiddenUserServer {
			if phone := m.resolveReliablePhoneFromLID(ctx, client, result.JID.ToNonAD(), candidates); phone != "" {
				validResponse.Phone = phone
				return validResponse, nil
			}
			if deferredLIDFallback == nil {
				fallback := validResponse
				fallback.Phone = candidate
				deferredLIDFallback = &fallback
			}
			continue
		}

		if phone := phoneFromJID(jid); phone != "" {
			validResponse.Phone = phone
		} else {
			validResponse.Phone = candidate
		}
		return validResponse, nil
	}

	if deferredLIDFallback != nil {
		return *deferredLIDFallback, nil
	}

	resp.Valid = false
	return resp, nil
}

func buildPhoneValidationCandidates(phoneDDI, phone string) []string {
	fullNumber := digits(phoneDDI + phone)
	if fullNumber == "" {
		return nil
	}
	if !strings.HasPrefix(fullNumber, "55") {
		return []string{fullNumber}
	}

	rest := fullNumber[2:]
	if len(rest) < 10 {
		return []string{fullNumber}
	}

	ddd := rest[:2]
	local := rest[2:]
	without9Local := local
	if len(local) == 9 && strings.HasPrefix(local, "9") {
		without9Local = local[1:]
	}
	with9Local := local
	if len(local) == 8 {
		with9Local = "9" + local
	}

	without9 := "55" + ddd + without9Local
	with9 := "55" + ddd + with9Local
	fallback := with9
	if fullNumber == with9 {
		fallback = without9
	}
	return uniqueStrings([]string{fullNumber, fallback})
}

func uniqueStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func normalizeValidationJID(jid types.JID) string {
	if jid.IsEmpty() || jid.User == "" {
		return ""
	}
	normalized := jid.ToNonAD()
	if normalized.Server == types.LegacyUserServer {
		normalized.Server = types.DefaultUserServer
	}
	return normalized.String()
}

func (m *WhatsAppManager) resolveReliablePhoneFromLID(ctx context.Context, client *whatsmeow.Client, lid types.JID, candidates []string) string {
	if client == nil || client.Store == nil || client.Store.LIDs == nil || lid.Server != types.HiddenUserServer {
		return ""
	}
	pn, err := client.Store.LIDs.GetPNForLID(ctx, lid)
	if err != nil || pn.IsEmpty() {
		log.Printf("whatsmeow phone validation lid mapping not found worker_id=%s lid=%s error=%v", m.cfg.WorkerID, lid.String(), err)
		return ""
	}
	phone := phoneFromJID(normalizeValidationJID(pn))
	if !isReliablePhoneForLID(lid, phone, candidates) {
		log.Printf("whatsmeow phone validation lid mapping discarded worker_id=%s lid=%s resolved_phone=%s", m.cfg.WorkerID, lid.String(), phone)
		return ""
	}
	return phone
}

func isReliablePhoneForLID(lid types.JID, phone string, candidates []string) bool {
	if phone == "" {
		return false
	}
	if digits(lid.User) == digits(phone) {
		return false
	}
	for _, candidate := range candidates {
		if phone == candidate {
			return true
		}
	}
	return false
}

func (m *WhatsAppManager) connectionContext() context.Context {
	if m.runtimeCtx != nil {
		return m.runtimeCtx
	}
	return context.Background()
}

func (m *WhatsAppManager) isAuthenticated(client *whatsmeow.Client) bool {
	return client != nil &&
		client.Store != nil &&
		client.Store.ID != nil &&
		client.IsLoggedIn()
}

func (m *WhatsAppManager) publishConnectedIfAuthenticated(ctx context.Context, reason string) bool {
	client := m.getClient()
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return false
	}

	m.mu.RLock()
	connected := m.connected
	m.mu.RUnlock()

	if !m.isAuthenticated(client) && !connected {
		return false
	}

	phone := phoneFromOwnID(client.Store.ID)
	log.Printf("whatsmeow already connected worker_id=%s reason=%s", m.cfg.WorkerID, reason)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	m.mu.Lock()
	m.connected = true
	m.status = "connected"
	m.code = CodeConnectionEstablished
	m.mu.Unlock()
	go m.markPresenceAvailable(context.Background(), reason)
	m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phone, "", false)
	return true
}

func (m *WhatsAppManager) setCurrentQRCode(qr string) {
	m.mu.Lock()
	m.currentQRCode = qr
	m.mu.Unlock()
}

func (m *WhatsAppManager) getCurrentQRCode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentQRCode
}

func (m *WhatsAppManager) resetQRCodeReadSession(clearQRCode bool) {
	m.mu.Lock()
	m.qrGenerationCount = 0
	m.qrReadSessionLocked = false
	m.qrHash = ""
	if clearQRCode {
		m.currentQRCode = ""
	}
	m.mu.Unlock()
}

func (m *WhatsAppManager) recordQRCodeGeneration(raw string) (int, bool, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.qrReadSessionLocked {
		return maxQRCodeGenerations + 1, false, true
	}

	if raw != "" && raw == m.qrHash {
		return m.qrGenerationCount, true, true
	}

	if m.qrGenerationCount >= maxQRCodeGenerations {
		m.qrReadSessionLocked = true
		m.currentQRCode = ""
		m.currentPairingCode = ""
		m.qrHash = ""
		m.qrGenerationCount = maxQRCodeGenerations + 1
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionClosed
		return m.qrGenerationCount, false, false
	}

	m.qrHash = raw
	m.qrGenerationCount++
	return m.qrGenerationCount, true, false
}

func (m *WhatsAppManager) isQRCodeReadSessionLocked() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.qrReadSessionLocked
}

func (m *WhatsAppManager) setCurrentPairingCode(code string) {
	m.mu.Lock()
	m.currentPairingCode = code
	m.mu.Unlock()
}

func (m *WhatsAppManager) getCurrentPairingCode() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.currentPairingCode
}

func (m *WhatsAppManager) clearLoginArtifacts() {
	m.mu.Lock()
	m.currentQRCode = ""
	m.currentPairingCode = ""
	m.mu.Unlock()
}

func qrCodeDataURL(raw string) string {
	png, err := qrcode.Encode(raw, qrcode.Medium, 256)
	if err != nil {
		log.Printf("failed to render qrcode image: %v", err)
		return raw
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

func (m *WhatsAppManager) connectClient(ctx context.Context, client *whatsmeow.Client, stage string) error {
	startedAt := time.Now()
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":        "connection.whatsmeow.client.connect_start",
		"decision":     "connect_client",
		"outcome":      "started",
		"reason":       stage,
		"has_store_id": client != nil && client.Store != nil && client.Store.ID != nil,
		"deadline_ms":  m.cfg.WhatsAppConnectTimeout.Milliseconds(),
	})
	log.Printf(
		"whatsmeow connect start worker_id=%s stage=%s has_store_id=%t timeout=%s",
		m.cfg.WorkerID,
		stage,
		client != nil && client.Store != nil && client.Store.ID != nil,
		m.cfg.WhatsAppConnectTimeout,
	)

	errCh := make(chan error, 1)
	go func() {
		errCh <- client.ConnectContext(ctx)
	}()

	var timeout <-chan time.Time
	if m.cfg.WhatsAppConnectTimeout > 0 {
		timeout = time.After(m.cfg.WhatsAppConnectTimeout)
	}

	select {
	case err := <-errCh:
		if err != nil {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":       "connection.whatsmeow.client.connect_error",
				"decision":    "connect_client",
				"outcome":     "error",
				"reason":      stage,
				"level":       "error",
				"duration_ms": time.Since(startedAt).Milliseconds(),
				"error":       err.Error(),
			})
			log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
			return err
		}
	case <-timeout:
		client.Disconnect()
		err := fmt.Errorf("whatsmeow connect timeout after %s", m.cfg.WhatsAppConnectTimeout)
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":       "connection.whatsmeow.client.connect_error",
			"decision":    "connect_client",
			"outcome":     "error",
			"reason":      "timeout",
			"level":       "error",
			"duration_ms": time.Since(startedAt).Milliseconds(),
			"error":       err.Error(),
		})
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
		return err
	case <-ctx.Done():
		err := ctx.Err()
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":       "connection.whatsmeow.client.connect_error",
			"decision":    "connect_client",
			"outcome":     "error",
			"reason":      "context_done",
			"level":       "error",
			"duration_ms": time.Since(startedAt).Milliseconds(),
			"error":       err.Error(),
		})
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
		return err
	}

	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":       "connection.whatsmeow.client.connect_success",
		"decision":    "connect_client",
		"outcome":     "success",
		"reason":      stage,
		"duration_ms": time.Since(startedAt).Milliseconds(),
	})
	log.Printf("whatsmeow connect returned worker_id=%s stage=%s elapsed=%s", m.cfg.WorkerID, stage, time.Since(startedAt))
	return nil
}

func (m *WhatsAppManager) connectWithQRCode(ctx context.Context) (ConnectionState, error) {
	return m.connectWithQRCodeInternal(ctx, true)
}

func (m *WhatsAppManager) connectWithQRCodeInternal(ctx context.Context, allowDeletedStoreRetry bool) (ConnectionState, error) {
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":    "connection.whatsmeow.qrcode.start",
		"decision": "connect_with_qrcode",
		"outcome":  "started",
	})
	client, err := m.ensureUsableClientForLogin(ctx, "qrcode-request")
	if err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.qrcode.ensure_client_error",
			"decision": "ensure_usable_client",
			"outcome":  "error",
			"reason":   "client_not_usable",
			"level":    "error",
			"error":    err.Error(),
		})
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return ConnectionState{}, err
	}
	connectCtx := m.connectionContext()
	if m.isAuthenticated(client) {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.qrcode.short_circuit",
			"decision": "is_authenticated",
			"outcome":  "success",
			"reason":   "already_authenticated",
		})
		log.Printf("whatsmeow qrcode request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		m.resetQRCodeReadSession(true)
		go m.markPresenceAvailable(context.Background(), "qrcode-already-authenticated")
		m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return m.currentConnectionState(), nil
	}
	m.resetQRCodeReadSession(true)
	if client.IsConnected() {
		if client.Store.ID != nil {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":    "connection.whatsmeow.qrcode.short_circuit",
				"decision": "active_connection_check",
				"outcome":  "skipped",
				"reason":   "authentication_in_progress",
			})
			log.Printf("whatsmeow qrcode request authentication in progress worker_id=%s", m.cfg.WorkerID)
			return m.currentConnectionState(), nil
		}
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.qrcode.active_scan_restart",
			"decision": "active_connection_check",
			"outcome":  "entered",
			"reason":   "connected_without_store_id",
		})
		log.Printf("whatsmeow qrcode request restarting active scan worker_id=%s", m.cfg.WorkerID)
		client.Disconnect()
		m.clearLoginArtifacts()
	}
	if client.Store.ID != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":        "connection.whatsmeow.qrcode.stored_session_branch",
			"decision":     "store_id_check",
			"outcome":      "entered",
			"has_store_id": true,
		})
		log.Printf("whatsmeow qrcode request using stored session worker_id=%s", m.cfg.WorkerID)
		m.armFreshLoginFallback(freshLoginRequest{Type: "qrcode"})
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		if err := m.connectClient(connectCtx, client, "qrcode-stored-session"); err != nil {
			return ConnectionState{}, m.handleStoredSessionConnectError(ctx, err)
		}
		return m.currentConnectionState(), nil
	}

	log.Printf("whatsmeow qrcode request starting new login worker_id=%s", m.cfg.WorkerID)
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":    "connection.whatsmeow.qrcode.new_login_branch",
		"decision": "store_id_check",
		"outcome":  "entered",
	})
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	m.resetQRCodeReadSession(true)
	qrChan, err := client.GetQRChannel(connectCtx)
	if err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.qrcode.channel_error",
			"decision": "get_qr_channel",
			"outcome":  "error",
			"reason":   "get_qr_channel_failed",
			"level":    "error",
			"error":    err.Error(),
		})
		log.Printf("whatsmeow GetQRChannel failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		if err := m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry); err != nil {
			return ConnectionState{}, err
		}
		return m.currentConnectionState(), nil
	}
	m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
	if err := m.connectClient(connectCtx, client, "qrcode-new-login"); err != nil {
		if err := m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry); err != nil {
			return ConnectionState{}, err
		}
		return m.currentConnectionState(), nil
	}

	resultCh := make(chan ConnectionState, 1)
	var resultOnce sync.Once
	sendResult := func(state ConnectionState) {
		resultOnce.Do(func() {
			resultCh <- state
		})
	}

	go func() {
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				attempt, allowed, duplicate := m.recordQRCodeGeneration(evt.Code)
				if duplicate {
					recordConnectionLifecycle(ctx, m.cfg, map[string]any{
						"stage":        "connection.whatsmeow.qrcode.duplicate",
						"decision":     "record_qr_generation",
						"outcome":      "skipped",
						"reason":       "duplicate_or_locked",
						"attempt":      attempt,
						"max_attempts": maxQRCodeGenerations,
					})
					continue
				}
				if !allowed {
					recordConnectionLifecycle(ctx, m.cfg, map[string]any{
						"stage":        "connection.whatsmeow.qrcode.limit_reached",
						"decision":     "record_qr_generation",
						"outcome":      "error",
						"reason":       "qr_generation_limit_reached",
						"level":        "warn",
						"attempt":      attempt,
						"max_attempts": maxQRCodeGenerations,
					})
					log.Printf("whatsmeow qr generation limit reached worker_id=%s attempt=%d max_attempts=%d", m.cfg.WorkerID, attempt, maxQRCodeGenerations)
					client.Disconnect()
					m.publishStateWithAttempts(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true, attempt, maxQRCodeGenerations)
					sendResult(ConnectionState{
						Code:           CodeConnectionClosed,
						Status:         "disconnected",
						WorkerID:       m.cfg.WorkerID,
						AccountID:      m.cfg.AccountID,
						IsNewLogin:     true,
						Time:           time.Now().Unix(),
						WorkerStatusID: WorkerStatusDisponible,
						Attempt:        attempt,
						MaxAttempts:    maxQRCodeGenerations,
					})
					return
				}
				qrImage := qrCodeDataURL(evt.Code)
				m.setCurrentQRCode(qrImage)
				recordConnectionLifecycle(ctx, m.cfg, map[string]any{
					"stage":        "connection.whatsmeow.qrcode.generated",
					"decision":     "qr_channel_event",
					"outcome":      "success",
					"qrcode":       evt.Code,
					"attempt":      attempt,
					"max_attempts": maxQRCodeGenerations,
					"deadline_ms":  evt.Timeout.Milliseconds(),
				})
				log.Printf("whatsmeow qr code received worker_id=%s timeout=%s attempt=%d max_attempts=%d", m.cfg.WorkerID, evt.Timeout, attempt, maxQRCodeGenerations)
				m.publishStateWithAttempts(context.Background(), "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", qrImage, true, attempt, maxQRCodeGenerations)
				sendResult(ConnectionState{
					Code:           CodeAwaitingReadQRCode,
					Status:         "connecting",
					WorkerID:       m.cfg.WorkerID,
					AccountID:      m.cfg.AccountID,
					QRCode:         qrImage,
					IsNewLogin:     true,
					Time:           time.Now().Unix(),
					WorkerStatusID: WorkerStatusDisponible,
					Attempt:        attempt,
					MaxAttempts:    maxQRCodeGenerations,
				})
			case "success":
				m.clearLoginArtifacts()
				m.resetQRCodeReadSession(true)
				recordConnectionLifecycle(ctx, m.cfg, map[string]any{
					"stage":    "connection.whatsmeow.qrcode.scanned",
					"decision": "qr_channel_event",
					"outcome":  "success",
					"status":   "connecting",
					"code":     CodePairingInProgress,
				})
				log.Printf("whatsmeow qr scanned, pairing in progress worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "connecting", CodePairingInProgress, WorkerStatusDisponible, "", "", true)
				sendResult(ConnectionState{
					Code:           CodePairingInProgress,
					Status:         "connecting",
					WorkerID:       m.cfg.WorkerID,
					AccountID:      m.cfg.AccountID,
					IsNewLogin:     true,
					Time:           time.Now().Unix(),
					WorkerStatusID: WorkerStatusDisponible,
				})
			case "timeout":
				m.clearLoginArtifacts()
				m.resetQRCodeReadSession(true)
				recordConnectionLifecycle(ctx, m.cfg, map[string]any{
					"stage":    "connection.whatsmeow.qrcode.timeout",
					"decision": "qr_channel_event",
					"outcome":  "error",
					"reason":   "qr_timeout",
					"level":    "warn",
					"status":   "disconnected",
					"code":     CodeConnectionClosed,
				})
				log.Printf("whatsmeow qr timeout worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true)
				sendResult(ConnectionState{
					Code:           CodeConnectionClosed,
					Status:         "disconnected",
					WorkerID:       m.cfg.WorkerID,
					AccountID:      m.cfg.AccountID,
					IsNewLogin:     true,
					Time:           time.Now().Unix(),
					WorkerStatusID: WorkerStatusDisponible,
				})
			default:
				if evt.Error != nil {
					recordConnectionLifecycle(ctx, m.cfg, map[string]any{
						"stage":    "connection.whatsmeow.qrcode.event_error",
						"decision": "qr_channel_event",
						"outcome":  "error",
						"reason":   evt.Event,
						"level":    "error",
						"error":    evt.Error.Error(),
					})
					log.Printf("qr event error: %v", evt.Error)
				} else {
					recordConnectionLifecycle(ctx, m.cfg, map[string]any{
						"stage":    "connection.whatsmeow.qrcode.unexpected_event",
						"decision": "qr_channel_event",
						"outcome":  "skipped",
						"reason":   evt.Event,
						"level":    "warn",
					})
					log.Printf("whatsmeow qr unexpected event worker_id=%s event=%s", m.cfg.WorkerID, evt.Event)
				}
			}
		}
		log.Printf("whatsmeow qr channel closed worker_id=%s", m.cfg.WorkerID)
	}()

	select {
	case state := <-resultCh:
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":            "connection.whatsmeow.qrcode.result",
			"decision":         "qrcode_result",
			"outcome":          "success",
			"status":           state.Status,
			"code":             state.Code,
			"worker_status_id": state.WorkerStatusID,
			"qrcode":           state.QRCode,
		})
		return state, nil
	case <-ctx.Done():
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.qrcode.result_error",
			"decision": "qrcode_result",
			"outcome":  "error",
			"reason":   "context_done",
			"level":    "error",
			"error":    ctx.Err().Error(),
		})
		return ConnectionState{}, ctx.Err()
	case <-time.After(30 * time.Second):
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":       "connection.whatsmeow.qrcode.result_error",
			"decision":    "qrcode_result",
			"outcome":     "error",
			"reason":      "request_timeout",
			"level":       "error",
			"deadline_ms": int64(30000),
		})
		return ConnectionState{}, fmt.Errorf("qrcode request timeout")
	}
}

func (m *WhatsAppManager) connectWithPhonePairing(ctx context.Context, phone string) error {
	return m.connectWithPhonePairingInternal(ctx, phone, true)
}

func (m *WhatsAppManager) connectWithPhonePairingInternal(ctx context.Context, phone string, allowDeletedStoreRetry bool) error {
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":        "connection.whatsmeow.phone_pairing.start",
		"decision":     "connect_with_phone_pairing",
		"outcome":      "started",
		"has_phone":    strings.TrimSpace(phone) != "",
		"phone_digits": len(digits(phone)),
	})
	client, err := m.ensureUsableClientForLogin(ctx, "phone-pairing-request")
	if err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.phone_pairing.ensure_client_error",
			"decision": "ensure_usable_client",
			"outcome":  "error",
			"reason":   "client_not_usable",
			"level":    "error",
			"error":    err.Error(),
		})
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return err
	}
	connectCtx := m.connectionContext()
	if phone = digits(phone); phone == "" {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.phone_pairing.rejected",
			"decision": "phone_validation",
			"outcome":  "error",
			"reason":   "phone_connection_required",
			"level":    "warn",
		})
		return fmt.Errorf("phone_connection is required")
	}
	if m.isAuthenticated(client) {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.phone_pairing.short_circuit",
			"decision": "is_authenticated",
			"outcome":  "success",
			"reason":   "already_authenticated",
		})
		log.Printf("whatsmeow phone pairing request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		go m.markPresenceAvailable(context.Background(), "phone-already-authenticated")
		m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return nil
	}
	if client.IsConnected() && client.Store.ID == nil {
		currentPairingCode := m.getCurrentPairingCode()
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":        "connection.whatsmeow.phone_pairing.short_circuit",
			"decision":     "active_connection_check",
			"outcome":      "skipped",
			"reason":       "already_awaiting_pairing",
			"pairing_code": currentPairingCode,
		})
		log.Printf("whatsmeow phone pairing request already awaiting pairing worker_id=%s has_pairing_code=%t", m.cfg.WorkerID, currentPairingCode != "")
		m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", currentPairingCode, true)
		return nil
	}
	if client.IsConnected() && client.Store.ID != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.phone_pairing.short_circuit",
			"decision": "active_connection_check",
			"outcome":  "skipped",
			"reason":   "authentication_in_progress",
		})
		log.Printf("whatsmeow phone pairing request authentication in progress worker_id=%s", m.cfg.WorkerID)
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return nil
	}
	if client.Store.ID != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":        "connection.whatsmeow.phone_pairing.stored_session_branch",
			"decision":     "store_id_check",
			"outcome":      "entered",
			"has_store_id": true,
		})
		log.Printf("whatsmeow phone pairing request using stored session worker_id=%s", m.cfg.WorkerID)
		m.armFreshLoginFallback(freshLoginRequest{Type: "phone", Phone: phone})
		if err := m.connectClient(connectCtx, client, "phone-stored-session"); err != nil {
			return m.handleStoredSessionConnectError(ctx, err)
		}
		return nil
	}
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", "", true)
	if !client.IsConnected() {
		if err := m.connectClient(connectCtx, client, "phone-new-login"); err != nil {
			return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "phone", Phone: phone}, err, allowDeletedStoreRetry)
		}
	}
	pairingCode, err := client.PairPhone(ctx, phone, true, whatsmeowPairClientDesktop, whatsmeowPairClientDisplayName)
	if err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.phone_pairing.code_error",
			"decision": "pair_phone",
			"outcome":  "error",
			"reason":   "pair_phone_failed",
			"level":    "error",
			"error":    err.Error(),
		})
		log.Printf("whatsmeow phone pairing failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "phone", Phone: phone}, err, allowDeletedStoreRetry)
	}
	m.setCurrentPairingCode(pairingCode)
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":        "connection.whatsmeow.phone_pairing.code_generated",
		"decision":     "pair_phone",
		"outcome":      "success",
		"pairing_code": pairingCode,
	})
	log.Printf("whatsmeow phone pairing code generated worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", pairingCode, true)
	return nil
}

func (m *WhatsAppManager) removeSession(ctx context.Context) error {
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":    "connection.whatsmeow.remove_session.start",
		"decision": "remove_session",
		"outcome":  "started",
	})
	log.Printf("whatsmeow remove session requested worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeLogoutInProgress, "", "", "", false)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	client := m.getClient()
	if client != nil {
		if err := m.logoutAndDeleteDevice(client); err != nil {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":    "connection.whatsmeow.remove_session.logout_error",
				"decision": "logout_and_delete_device",
				"outcome":  "error",
				"reason":   "logout_failed",
				"level":    "warn",
				"error":    err.Error(),
			})
			log.Printf("whatsmeow remove session logout failed worker_id=%s error=%v", m.cfg.WorkerID, err)
			client.Disconnect()
			if client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
				if deleteErr := client.Store.Delete(context.Background()); deleteErr != nil {
					recordConnectionLifecycle(ctx, m.cfg, map[string]any{
						"stage":    "connection.whatsmeow.remove_session.store_delete_error",
						"decision": "delete_local_store",
						"outcome":  "error",
						"reason":   "store_delete_failed",
						"level":    "warn",
						"error":    deleteErr.Error(),
					})
					log.Printf("whatsmeow remove session local store delete failed worker_id=%s error=%v", m.cfg.WorkerID, deleteErr)
				}
			}
		} else {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":    "connection.whatsmeow.remove_session.logout_success",
				"decision": "logout_and_delete_device",
				"outcome":  "success",
			})
			log.Printf("whatsmeow remove session logout sent worker_id=%s", m.cfg.WorkerID)
		}
	}
	m.mu.Lock()
	m.connected = false
	m.status = "disconnected"
	m.code = CodeLoggedOut
	m.mu.Unlock()

	m.sessionMu.Lock()
	if err := m.clearLocalSessionFiles(); err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.remove_session.files_cleanup_error",
			"decision": "clear_local_session_files",
			"outcome":  "error",
			"reason":   "cleanup_failed",
			"level":    "warn",
			"error":    err.Error(),
		})
		log.Printf("whatsmeow remove session local files cleanup failed worker_id=%s error=%v", m.cfg.WorkerID, err)
	}
	if err := m.initClient(context.Background()); err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.remove_session.client_reinit_error",
			"decision": "init_client",
			"outcome":  "error",
			"reason":   "client_reinit_failed",
			"level":    "error",
			"error":    err.Error(),
		})
		log.Printf("whatsmeow remove session client reinit failed worker_id=%s error=%v", m.cfg.WorkerID, err)
	}
	m.sessionMu.Unlock()

	m.publishStateDisconnectedByUser(ctx, CodeLoggedOut, WorkerStatusDisponible)
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":             "connection.whatsmeow.remove_session.success",
		"decision":          "remove_session",
		"outcome":           "success",
		"status":            "disconnected",
		"code":              CodeLoggedOut,
		"worker_status_id":  WorkerStatusDisponible,
		"disconnected_user": true,
	})
	return nil
}

func (m *WhatsAppManager) logoutAndDeleteDevice(client *whatsmeow.Client) error {
	if client == nil {
		return nil
	}
	if client.Store == nil || client.Store.ID == nil {
		log.Printf("whatsmeow remove session skipped logout worker_id=%s reason=no_store_id", m.cfg.WorkerID)
		client.Disconnect()
		return nil
	}

	logoutCtx, cancel := context.WithTimeout(context.Background(), whatsmeowLogoutTimeout)
	defer cancel()

	if !client.IsConnected() {
		log.Printf("whatsmeow remove session connecting before logout worker_id=%s", m.cfg.WorkerID)
		if err := m.connectClient(logoutCtx, client, "remove-session-logout"); err != nil {
			return fmt.Errorf("connect before logout: %w", err)
		}
	}

	if err := client.Logout(logoutCtx); err != nil {
		return fmt.Errorf("send remove-companion-device: %w", err)
	}
	return nil
}

func (m *WhatsAppManager) handleEvent(evt any) {
	switch event := evt.(type) {
	case *events.Connected:
		recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.event.connected",
			"decision": "handle_event",
			"outcome":  "received",
			"status":   "connected",
			"code":     CodeConnectionEstablished,
		})
		log.Printf("whatsmeow event connected worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		client := m.getClient()
		phone := ""
		if client != nil {
			phone = phoneFromOwnID(client.Store.ID)
		}
		m.mu.Lock()
		m.connected = true
		m.status = "connected"
		m.code = CodeConnectionEstablished
		m.mu.Unlock()
		go m.markPresenceAvailable(context.Background(), "connected-event")
		m.publishState(context.Background(), "connected", CodeConnectionEstablished, WorkerStatusOnline, phone, "", false)
	case *events.Disconnected:
		recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.event.disconnected",
			"decision": "handle_event",
			"outcome":  "received",
			"status":   "disconnected",
			"code":     CodeConnectionLost,
		})
		log.Printf("whatsmeow event disconnected worker_id=%s", m.cfg.WorkerID)
		if m.isQRCodeReadSessionLocked() {
			recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
				"stage":    "connection.whatsmeow.event.disconnected_ignored",
				"decision": "qr_limit_guard",
				"outcome":  "skipped",
				"reason":   "qr_read_session_locked",
			})
			log.Printf("whatsmeow disconnected event ignored after qr limit worker_id=%s", m.cfg.WorkerID)
			return
		}
		m.clearLoginArtifacts()
		m.mu.Lock()
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionLost
		m.mu.Unlock()
		m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
	case *events.LoggedOut:
		recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
			"stage":      "connection.whatsmeow.event.logged_out",
			"decision":   "handle_event",
			"outcome":    "received",
			"status":     "disconnected",
			"code":       CodeLoggedOut,
			"on_connect": event.OnConnect,
			"reason":     event.Reason.String(),
		})
		log.Printf("whatsmeow event logged_out worker_id=%s on_connect=%t reason=%s", m.cfg.WorkerID, event.OnConnect, event.Reason.String())
		m.clearLoginArtifacts()
		if m.startFreshLoginAfterStoredSessionLogout() {
			return
		}
		m.mu.Lock()
		m.connected = false
		m.status = "disconnected"
		m.code = CodeLoggedOut
		m.mu.Unlock()
		m.publishStateDisconnectedByUser(context.Background(), CodeLoggedOut, WorkerStatusDisponible)
	case *events.ConnectFailure:
		recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.event.connect_failure",
			"decision": "handle_event",
			"outcome":  "error",
			"reason":   event.Reason.String(),
			"level":    "warn",
			"status":   "disconnected",
			"code":     CodeConnectionLost,
			"error":    event.Message,
		})
		log.Printf("whatsmeow event connect_failure worker_id=%s reason=%s message=%s", m.cfg.WorkerID, event.Reason.String(), event.Message)
		m.clearLoginArtifacts()
		if event.Reason.IsLoggedOut() && m.startFreshLoginAfterStoredSessionLogout() {
			return
		}
		m.clearFreshLoginFallback()
		m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
	case *events.StreamReplaced:
		recordConnectionLifecycle(context.Background(), m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.event.stream_replaced",
			"decision": "handle_event",
			"outcome":  "received",
			"status":   "disconnected",
			"code":     CodeConnectionReplaced,
		})
		log.Printf("whatsmeow event stream_replaced worker_id=%s", m.cfg.WorkerID)
		m.clearLoginArtifacts()
		m.clearFreshLoginFallback()
		m.publishState(context.Background(), "disconnected", CodeConnectionReplaced, WorkerStatusOffline, "", "", false)
	case *events.Message:
		go m.handleIncomingMessage(context.Background(), event)
	case *events.HistorySync:
		go m.handleHistorySync(context.Background(), event)
	case *events.Receipt:
		go m.handleReceipt(context.Background(), event)
	case *events.CallOffer:
		go m.handleCallOffer(context.Background(), event.From, event.CallID, event.CallCreator, strings.EqualFold(event.RemotePlatform, "video"))
	case *events.CallOfferNotice:
		go m.handleCallOffer(context.Background(), event.From, event.CallID, event.CallCreator, event.Media == "video")
	case *events.ChatPresence:
		go m.publishPresence(context.Background(), event)
	}
}

func (m *WhatsAppManager) handleStoredSessionConnectError(ctx context.Context, err error) error {
	if isStoredSessionInvalidError(err) {
		req, ok := m.consumeFreshLoginFallback()
		if ok {
			log.Printf("whatsmeow stored session invalid, restarting fresh login worker_id=%s type=%s error=%v", m.cfg.WorkerID, req.Type, err)
			return m.resetAndStartFreshLogin(ctx, req)
		}
	}
	m.clearFreshLoginFallback()
	return err
}

func (m *WhatsAppManager) handleFreshLoginConnectError(ctx context.Context, req freshLoginRequest, err error, allowDeletedStoreRetry bool) error {
	if allowDeletedStoreRetry && isStoredSessionInvalidError(err) {
		log.Printf("whatsmeow fresh login found invalid local session, resetting worker_id=%s type=%s error=%v", m.cfg.WorkerID, req.Type, err)
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
		if resetErr := m.resetLocalSession(ctx); resetErr != nil {
			log.Printf("whatsmeow fresh login reset failed worker_id=%s error=%v", m.cfg.WorkerID, resetErr)
			m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
			return fmt.Errorf("reset invalid whatsmeow session: %w", resetErr)
		}

		_, err := m.connectWithQRCodeInternal(ctx, false)
		return err
	}

	m.clearLoginArtifacts()
	m.clearFreshLoginFallback()
	m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
	return err
}

func (m *WhatsAppManager) armFreshLoginFallback(req freshLoginRequest) {
	if req.Type == "" {
		req.Type = "qrcode"
	}
	m.mu.Lock()
	m.pendingFreshLogin = &req
	m.mu.Unlock()
}

func (m *WhatsAppManager) clearFreshLoginFallback() {
	m.mu.Lock()
	m.pendingFreshLogin = nil
	m.mu.Unlock()
}

func (m *WhatsAppManager) consumeFreshLoginFallback() (freshLoginRequest, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pendingFreshLogin == nil {
		return freshLoginRequest{}, false
	}
	req := *m.pendingFreshLogin
	m.pendingFreshLogin = nil
	return req, true
}

func (m *WhatsAppManager) startFreshLoginAfterStoredSessionLogout() bool {
	req, ok := m.consumeFreshLoginFallback()
	if !ok {
		return false
	}
	log.Printf("whatsmeow stored session logout fallback triggered worker_id=%s type=%s", m.cfg.WorkerID, req.Type)
	go func() {
		if err := m.resetAndStartFreshLogin(context.Background(), req); err != nil {
			log.Printf("failed to restart whatsmeow fresh login after stale session logout: %v", err)
			m.publishState(context.Background(), "disconnected", CodeLoggedOut, WorkerStatusDisponible, "", "", false)
		}
	}()
	return true
}

func (m *WhatsAppManager) resetAndStartFreshLogin(ctx context.Context, req freshLoginRequest) error {
	log.Printf("whatsmeow reset and start fresh login worker_id=%s type=%s", m.cfg.WorkerID, req.Type)
	m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
	if err := m.resetLocalSession(ctx); err != nil {
		return err
	}
	_, err := m.connectWithQRCode(ctx)
	return err
}

func (m *WhatsAppManager) resetLocalSession(ctx context.Context) error {
	m.sessionMu.Lock()
	defer m.sessionMu.Unlock()

	client := m.getClient()
	if client != nil {
		client.Disconnect()
		if client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
			log.Printf("whatsmeow deleting stale local store worker_id=%s", m.cfg.WorkerID)
			if err := client.Store.Delete(ctx); err != nil {
				log.Printf("whatsmeow stale local store delete failed worker_id=%s error=%v", m.cfg.WorkerID, err)
			}
		}
	}

	if err := m.clearLocalSessionFiles(); err != nil {
		return fmt.Errorf("clear whatsmeow local session files: %w", err)
	}

	m.mu.Lock()
	m.connected = false
	m.status = "connecting"
	m.code = CodeAwaitConnection
	m.mu.Unlock()
	return m.initClient(ctx)
}

func isStoredSessionInvalidError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "logged out") ||
		strings.Contains(msg, "deleted device") ||
		strings.Contains(msg, "invalid use of deleted device") ||
		strings.Contains(msg, "primary device was logged out")
}

func (m *WhatsAppManager) setState(status string, code int, workerStatusID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status = status
	m.code = code
}

func (m *WhatsAppManager) publishState(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool) {
	m.publishStateWithAttempts(ctx, status, code, workerStatusID, phone, qrOrPair, isNewLogin, 0, 0)
}

func (m *WhatsAppManager) publishStateWithAttempts(ctx context.Context, status string, code int, workerStatusID, phone, qrOrPair string, isNewLogin bool, attempt int, maxAttempts int) {
	state := ConnectionState{
		Code:           code,
		Status:         status,
		WorkerID:       m.cfg.WorkerID,
		AccountID:      m.cfg.AccountID,
		IsNewLogin:     isNewLogin,
		Time:           time.Now().Unix(),
		Phone:          phone,
		WorkerStatusID: workerStatusID,
	}
	if attempt > 0 {
		state.Attempt = attempt
	}
	if maxAttempts > 0 {
		state.MaxAttempts = maxAttempts
	}
	if code == CodeAwaitingReadQRCode {
		state.QRCode = qrOrPair
	}
	if code == CodeAwaitingPairingCode {
		state.PairingCode = qrOrPair
	}
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":             "connection.whatsmeow.publish_state.start",
		"decision":          "publish_state",
		"outcome":           "started",
		"status":            status,
		"code":              code,
		"worker_status_id":  workerStatusID,
		"is_new_login":      isNewLogin,
		"attempt":           state.Attempt,
		"max_attempts":      state.MaxAttempts,
		"qrcode":            state.QRCode,
		"pairing_code":      state.PairingCode,
		"has_phone":         phone != "",
		"disconnected_user": state.DisconnectedUser,
	})
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s has_qr=%t has_pairing_code=%t is_new_login=%t attempt=%d max_attempts=%d",
		m.cfg.WorkerID,
		status,
		code,
		workerStatusID,
		state.QRCode != "",
		state.PairingCode != "",
		isNewLogin,
		state.Attempt,
		state.MaxAttempts,
	)
	if code != CodeAwaitingReadQRCode {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":            "connection.whatsmeow.centrifugo.publish_start",
			"decision":         "publish_centrifugo",
			"outcome":          "started",
			"status":           status,
			"code":             code,
			"worker_status_id": workerStatusID,
			"qrcode":           state.QRCode,
			"pairing_code":     state.PairingCode,
		})
		if err := m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), state); err != nil {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":            "connection.whatsmeow.centrifugo.publish_error",
				"decision":         "publish_centrifugo",
				"outcome":          "error",
				"reason":           "centrifugo_publish_failed",
				"level":            "error",
				"status":           status,
				"code":             code,
				"worker_status_id": workerStatusID,
				"error":            err.Error(),
			})
			log.Printf("centrifugo publish connection state failed worker_id=%s status=%s code=%d error=%v", m.cfg.WorkerID, status, code, err)
		} else {
			recordConnectionLifecycle(ctx, m.cfg, map[string]any{
				"stage":            "connection.whatsmeow.centrifugo.publish_success",
				"decision":         "publish_centrifugo",
				"outcome":          "success",
				"status":           status,
				"code":             code,
				"worker_status_id": workerStatusID,
			})
		}
	} else {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "connection.whatsmeow.centrifugo.publish_skipped",
			"decision": "publish_centrifugo",
			"outcome":  "skipped",
			"reason":   "qrcode_state_not_published_to_centrifugo",
			"status":   status,
			"code":     code,
			"qrcode":   state.QRCode,
		})
	}
	if workerStatusID == WorkerStatusOnline || workerStatusID == WorkerStatusOffline || workerStatusID == WorkerStatusDisponible {
		if err := m.balance.NotifyWorkerStatus(ctx, state); err != nil {
			log.Printf("balance notify worker status failed worker_id=%s status=%s code=%d worker_status_id=%s error=%v", m.cfg.WorkerID, status, code, workerStatusID, err)
		}
	}
}

func (m *WhatsAppManager) publishStateDisconnectedByUser(ctx context.Context, code int, workerStatusID string) {
	state := ConnectionState{
		Code:             code,
		Status:           "disconnected",
		WorkerID:         m.cfg.WorkerID,
		AccountID:        m.cfg.AccountID,
		DisconnectedUser: true,
		Time:             time.Now().Unix(),
		WorkerStatusID:   workerStatusID,
	}
	recordConnectionLifecycle(ctx, m.cfg, map[string]any{
		"stage":             "connection.whatsmeow.publish_state.disconnected_user_start",
		"decision":          "publish_state_disconnected_user",
		"outcome":           "started",
		"status":            state.Status,
		"code":              code,
		"worker_status_id":  workerStatusID,
		"disconnected_user": true,
	})
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s disconnected_user=true has_qr=false has_pairing_code=false is_new_login=false",
		m.cfg.WorkerID,
		state.Status,
		code,
		workerStatusID,
	)
	if err := m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), state); err != nil {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":            "connection.whatsmeow.centrifugo.publish_error",
			"decision":         "publish_centrifugo",
			"outcome":          "error",
			"reason":           "centrifugo_publish_failed",
			"level":            "error",
			"status":           state.Status,
			"code":             code,
			"worker_status_id": workerStatusID,
			"error":            err.Error(),
		})
		log.Printf("centrifugo publish connection state failed worker_id=%s status=%s code=%d error=%v", m.cfg.WorkerID, state.Status, code, err)
	} else {
		recordConnectionLifecycle(ctx, m.cfg, map[string]any{
			"stage":            "connection.whatsmeow.centrifugo.publish_success",
			"decision":         "publish_centrifugo",
			"outcome":          "success",
			"status":           state.Status,
			"code":             code,
			"worker_status_id": workerStatusID,
		})
	}
	if workerStatusID == WorkerStatusOnline || workerStatusID == WorkerStatusOffline || workerStatusID == WorkerStatusDisponible {
		if err := m.balance.NotifyWorkerStatus(ctx, state); err != nil {
			log.Printf("balance notify worker status failed worker_id=%s status=%s code=%d worker_status_id=%s error=%v", m.cfg.WorkerID, state.Status, code, workerStatusID, err)
		}
	}
}

func (m *WhatsAppManager) handleIncomingMessage(ctx context.Context, evt *events.Message) {
	skipReason := incomingSkipReason(evt)
	var finishLifecycleSpan func(error)
	ctx, finishLifecycleSpan = startMessageLifecycleSpan(ctx, m.cfg, messageLifecycleFromEvent(m.cfg, incomingLifecycleMessageLike(evt)))
	defer finishLifecycleSpan(nil)
	m.logIncomingMessageDebug(ctx, evt, skipReason)

	if skipReason != "" {
		recordMessageLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "whatsmeow.incoming.skip",
			"decision": "incoming_skip_filter",
			"outcome":  "skipped",
			"reason":   skipReason,
		})
		log.Printf(
			"whatsmeow incoming message skipped worker_id=%s reason=%s chat=%s sender=%s id=%s from_me=%t category=%s source_web_msg=%t",
			m.cfg.WorkerID,
			skipReason,
			incomingChatString(evt),
			incomingSenderString(evt),
			incomingMessageID(evt),
			incomingFromMe(evt),
			incomingCategory(evt),
			evt != nil && evt.SourceWebMsg != nil,
		)
		return
	}
	upsert, err := m.buildIncomingUpsert(ctx, evt)
	if err != nil {
		recordMessageLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "whatsmeow.incoming.map_error",
			"decision": "map_to_upsert",
			"outcome":  "error",
			"reason":   "mapping_failed",
			"level":    "error",
			"error":    err.Error(),
		})
		log.Printf("failed to map incoming message: %v", err)
		return
	}
	if upsert == nil {
		recordMessageLifecycle(ctx, m.cfg, map[string]any{
			"stage":    "whatsmeow.incoming.skip",
			"decision": "map_to_upsert",
			"outcome":  "skipped",
			"reason":   "unmapped_message",
		})
		log.Printf(
			"whatsmeow incoming message ignored worker_id=%s reason=unmapped_message chat=%s sender=%s id=%s from_me=%t category=%s source_web_msg=%t",
			m.cfg.WorkerID,
			incomingChatString(evt),
			incomingSenderString(evt),
			incomingMessageID(evt),
			incomingFromMe(evt),
			incomingCategory(evt),
			evt != nil && evt.SourceWebMsg != nil,
		)
		return
	}
	upsert.SourceProvider = messageLifecycleProvider
	ctx = contextWithMessageLifecycle(ctx, messageLifecycleFromUpsert(m.cfg, upsert))
	recordMessageLifecycle(ctx, m.cfg, map[string]any{
		"stage":                 "whatsmeow.incoming.mapped",
		"decision":              "map_to_upsert",
		"outcome":               "mapped",
		"provider_message_type": incomingInfoType(evt),
		"message_type":          upsert.Type,
		"has_quoted":            upsert.HasQuoted,
		"photo_resolved":        upsert.Photo != "",
		"from_history_sync":     upsert.FromHistorySync,
		"message_text":          incomingTextPreview(evt),
	})
	key := fmt.Sprintf("%s:%s", m.cfg.AccountID, valueString(upsert.Message["key"], "id"))
	recordMessageLifecycle(ctx, m.cfg, map[string]any{
		"stage":     "whatsmeow.kafka.publish.start",
		"decision":  "publish_upsert",
		"outcome":   "started",
		"topic":     topicUpsertMessage,
		"kafka_key": key,
	})
	if err := m.kafka.SendJSON(ctx, topicUpsertMessage, key, upsert); err != nil {
		recordMessageLifecycle(ctx, m.cfg, map[string]any{
			"stage":     "whatsmeow.kafka.publish.error",
			"decision":  "publish_upsert",
			"outcome":   "error",
			"reason":    "producer_send_failed",
			"level":     "error",
			"topic":     topicUpsertMessage,
			"kafka_key": key,
			"error":     err.Error(),
		})
		log.Printf("failed to publish incoming message: %v", err)
		return
	}
	hasMediaURL, mediaFailed := mediaContentPublishStatus(upsert.Content, upsert.Type)
	recordMessageLifecycle(ctx, m.cfg, map[string]any{
		"stage":                 "whatsmeow.kafka.publish.success",
		"decision":              "publish_upsert",
		"outcome":               "published",
		"topic":                 topicUpsertMessage,
		"kafka_key":             key,
		"message_type":          upsert.Type,
		"has_photo":             upsert.Photo != "",
		"has_media_url":         hasMediaURL,
		"media_download_failed": mediaFailed,
	})
	log.Printf(
		"whatsmeow incoming message published worker_id=%s topic=%s key=%s type=%s chat=%s remote_jid_alt=%s sender=%s id=%s from_me=%t has_photo=%t has_media_url=%t media_download_failed=%t",
		m.cfg.WorkerID,
		topicUpsertMessage,
		key,
		upsert.Type,
		incomingChatString(evt),
		valueString(upsert.Message["key"], "remoteJidAlt"),
		incomingSenderString(evt),
		incomingMessageID(evt),
		incomingFromMe(evt),
		upsert.Photo != "",
		hasMediaURL,
		mediaFailed,
	)
}

func (m *WhatsAppManager) handleHistorySync(ctx context.Context, evt *events.HistorySync) {
	if !m.cfg.HistoryReconciliationEnabled || evt == nil || evt.Data == nil {
		return
	}

	client := m.getClient()
	if !m.isAuthenticated(client) {
		return
	}

	candidates := make([]historySyncCandidate, 0)
	for _, conversation := range evt.Data.GetConversations() {
		if conversation == nil {
			continue
		}

		chatJID, err := types.ParseJID(conversation.GetID())
		if err != nil || !isWhatsmeowUserChat(chatJID) {
			continue
		}

		for _, historyMessage := range conversation.GetMessages() {
			candidate, ok := m.buildHistorySyncCandidate(chatJID, historyMessage)
			if !ok {
				continue
			}
			candidates = append(candidates, candidate)
		}
	}

	candidates = selectLatestHistorySyncCandidates(
		candidates,
		m.cfg.HistoryReconciliationMessageLimit,
	)

	published := 0
	for _, candidate := range candidates {
		chatJID := candidate.chatJID
		historyMessage := candidate.message
		webMessage := historyMessage.GetMessage()
		if webMessage == nil || !m.isRecentHistoryWebMessage(webMessage.GetMessageTimestamp()) {
			continue
		}

		messageEvent, err := client.ParseWebMessage(chatJID, webMessage)
		if err != nil {
			log.Printf("whatsmeow history sync parse failed worker_id=%s chat=%s error=%v", m.cfg.WorkerID, chatJID.String(), err)
			continue
		}
		if messageEvent == nil || messageEvent.Info.IsFromMe {
			continue
		}

		upsert, err := m.buildIncomingUpsert(ctx, messageEvent, true)
		if err != nil {
			historyCtx, finishHistorySpan := startMessageLifecycleSpan(ctx, m.cfg, messageLifecycleFromEvent(m.cfg, incomingLifecycleMessageLike(messageEvent)))
			recordMessageLifecycle(historyCtx, m.cfg, map[string]any{
				"stage":    "whatsmeow.history.map_error",
				"decision": "map_history_upsert",
				"outcome":  "error",
				"reason":   "mapping_failed",
				"level":    "error",
				"error":    err.Error(),
			})
			finishHistorySpan(err)
			log.Printf("whatsmeow history sync map failed worker_id=%s chat=%s id=%s error=%v", m.cfg.WorkerID, chatJID.String(), incomingMessageID(messageEvent), err)
			continue
		}
		if upsert == nil {
			historyCtx, finishHistorySpan := startMessageLifecycleSpan(ctx, m.cfg, messageLifecycleFromEvent(m.cfg, incomingLifecycleMessageLike(messageEvent)))
			recordMessageLifecycle(historyCtx, m.cfg, map[string]any{
				"stage":    "whatsmeow.history.skip",
				"decision": "map_history_upsert",
				"outcome":  "skipped",
				"reason":   "unmapped_message",
			})
			finishHistorySpan(nil)
			continue
		}
		upsert.SourceProvider = messageLifecycleProvider

		key := fmt.Sprintf("%s:%s", m.cfg.AccountID, valueString(upsert.Message["key"], "id"))
		historyCtx, finishHistorySpan := startMessageLifecycleSpan(ctx, m.cfg, messageLifecycleFromUpsert(m.cfg, upsert))
		recordMessageLifecycle(historyCtx, m.cfg, map[string]any{
			"stage":     "whatsmeow.history.kafka.publish.start",
			"decision":  "publish_history_upsert",
			"outcome":   "started",
			"topic":     topicUpsertMessageHistory,
			"kafka_key": key,
		})
		if err := m.kafka.SendJSON(historyCtx, topicUpsertMessageHistory, key, upsert); err != nil {
			recordMessageLifecycle(historyCtx, m.cfg, map[string]any{
				"stage":     "whatsmeow.history.kafka.publish.error",
				"decision":  "publish_history_upsert",
				"outcome":   "error",
				"reason":    "producer_send_failed",
				"level":     "error",
				"topic":     topicUpsertMessageHistory,
				"kafka_key": key,
				"error":     err.Error(),
			})
			finishHistorySpan(err)
			log.Printf("whatsmeow history sync publish failed worker_id=%s chat=%s key=%s error=%v", m.cfg.WorkerID, chatJID.String(), key, err)
			continue
		}
		recordMessageLifecycle(historyCtx, m.cfg, map[string]any{
			"stage":     "whatsmeow.history.kafka.publish.success",
			"decision":  "publish_history_upsert",
			"outcome":   "published",
			"topic":     topicUpsertMessageHistory,
			"kafka_key": key,
		})
		finishHistorySpan(nil)
		published++
	}

	if published > 0 {
		log.Printf("whatsmeow history sync candidates published worker_id=%s count=%d", m.cfg.WorkerID, published)
	}
}

func selectLatestHistorySyncCandidates(candidates []historySyncCandidate, limit int) []historySyncCandidate {
	if limit <= 0 {
		return nil
	}

	selected := append([]historySyncCandidate(nil), candidates...)
	sort.SliceStable(selected, func(i, j int) bool {
		return selected[i].timestamp > selected[j].timestamp
	})
	if len(selected) > limit {
		selected = selected[:limit]
	}
	sort.SliceStable(selected, func(i, j int) bool {
		return selected[i].timestamp < selected[j].timestamp
	})
	return selected
}

func (m *WhatsAppManager) buildHistorySyncCandidate(chatJID types.JID, historyMessage *waHistorySync.HistorySyncMsg) (historySyncCandidate, bool) {
	webMessage := historyMessage.GetMessage()
	if webMessage == nil {
		return historySyncCandidate{}, false
	}

	if webMessage.GetKey().GetFromMe() {
		return historySyncCandidate{}, false
	}

	timestamp := webMessage.GetMessageTimestamp()
	if timestamp == 0 || !m.isRecentHistoryWebMessage(timestamp) {
		return historySyncCandidate{}, false
	}

	return historySyncCandidate{
		chatJID:   chatJID,
		message:   historyMessage,
		timestamp: timestamp,
	}, true
}

func (m *WhatsAppManager) isRecentHistoryWebMessage(timestamp uint64) bool {
	if timestamp == 0 {
		return false
	}

	timestampMs := int64(timestamp) * int64(time.Second/time.Millisecond)
	if timestamp > 1_000_000_000_000 {
		timestampMs = int64(timestamp)
	}

	return time.Since(time.UnixMilli(timestampMs)) <= m.cfg.HistoryReconciliationMaxAge
}

func (m *WhatsAppManager) handleReceipt(ctx context.Context, evt *events.Receipt) {
	patch := map[string]any{}
	switch evt.Type {
	case types.ReceiptTypeRead, types.ReceiptTypeReadSelf, types.ReceiptTypePlayed, types.ReceiptTypePlayedSelf:
		patch["is_seen"] = true
	case types.ReceiptTypeDelivered, types.ReceiptTypeSender:
		patch["is_delivered"] = true
	default:
		patch["is_sent"] = true
	}
	for _, id := range evt.MessageIDs {
		update := MessageStatusUpdate{
			AccountID: m.cfg.AccountID,
			MessageID: string(id),
			Patch:     patch,
			Key: map[string]any{
				"id":        string(id),
				"remoteJid": evt.Chat.String(),
				"fromMe":    true,
			},
		}
		_ = m.kafka.SendJSON(ctx, topicUpdateMessageStatus, m.cfg.AccountID+":"+string(id), update)
	}
}

func (m *WhatsAppManager) handleCallOffer(ctx context.Context, callFrom types.JID, callID string, creator types.JID, isVideo bool) {
	callJID := callFrom.String()
	if callJID == "" {
		callJID = creator.String()
	}
	callJIDAlt := callAltJID(callFrom, creator)
	callPhone := callPhoneFromJIDs(callFrom, creator)
	callText := "Ligacao recebida"
	if isVideo {
		callText = "Ligacao de video recebida"
	}
	key := map[string]any{
		"id":        "call_" + firstNonEmpty(callID, fmt.Sprintf("%d", time.Now().UnixMilli())),
		"remoteJid": callJID,
		"fromMe":    false,
	}
	if callJIDAlt != "" {
		key["remoteJidAlt"] = callJIDAlt
	}
	upsert := UpsertMessage{
		WorkerID:       m.cfg.WorkerID,
		AccountID:      m.cfg.AccountID,
		SourceProvider: messageLifecycleProvider,
		Type:           MessageTypeSystem,
		Photo:          m.profilePhotoForJIDs(ctx, []types.JID{callFrom, creator}),
		HasQuoted:      false,
		IsCallEvent:    true,
		CallPhone:      callPhone,
		CallJID:        callJID,
		CallJIDAlt:     callJIDAlt,
		Message: map[string]any{
			"key":              key,
			"message":          map[string]any{"conversation": callText},
			"messageTimestamp": time.Now().Unix(),
		},
	}
	callCtx, finishCallSpan := startMessageLifecycleSpan(ctx, m.cfg, messageLifecycleFromUpsert(m.cfg, &upsert))
	defer finishCallSpan(nil)
	kafkaKey := m.cfg.AccountID + ":" + callID
	recordMessageLifecycle(callCtx, m.cfg, map[string]any{
		"stage":     "whatsmeow.call.kafka.publish.start",
		"decision":  "publish_call_upsert",
		"outcome":   "started",
		"topic":     topicUpsertMessage,
		"kafka_key": kafkaKey,
	})
	if err := m.kafka.SendJSON(callCtx, topicUpsertMessage, kafkaKey, upsert); err != nil {
		recordMessageLifecycle(callCtx, m.cfg, map[string]any{
			"stage":     "whatsmeow.call.kafka.publish.error",
			"decision":  "publish_call_upsert",
			"outcome":   "error",
			"reason":    "producer_send_failed",
			"level":     "error",
			"topic":     topicUpsertMessage,
			"kafka_key": kafkaKey,
			"error":     err.Error(),
		})
	} else {
		recordMessageLifecycle(callCtx, m.cfg, map[string]any{
			"stage":     "whatsmeow.call.kafka.publish.success",
			"decision":  "publish_call_upsert",
			"outcome":   "published",
			"topic":     topicUpsertMessage,
			"kafka_key": kafkaKey,
		})
	}

	reject, showMessage, text, err := m.balance.ResolveIncomingCallAction(ctx, m.cfg.WorkerID, m.cfg.AccountID, callJID, callPhone, isVideo)
	if err != nil {
		log.Printf("failed to resolve call action: %v", err)
	}
	if m.rejectCalls || reject {
		if client := m.getClient(); client != nil && callID != "" {
			_ = client.RejectCall(ctx, callFrom, callID)
		}
	}
	if showMessage && strings.TrimSpace(text) != "" {
		msg := ChatMessage{
			MessageID: "call_autoreply_" + randomHex(8),
			ChatID:    callJID,
			MessageKey: &MessageKey{
				RemoteJID: callJID,
			},
			Content: map[string]any{
				"type":    MessageTypeText,
				"message": text,
			},
		}
		if _, err := m.SendChatMessage(ctx, msg); err != nil {
			log.Printf("failed to send call auto reply: %v", err)
		}
	}
}

func (m *WhatsAppManager) markPresenceAvailable(ctx context.Context, reason string) {
	client := m.getClient()
	if client == nil {
		log.Printf("whatsmeow presence available skipped worker_id=%s reason=%s client_nil=true", m.cfg.WorkerID, reason)
		return
	}
	if client.Store != nil && strings.TrimSpace(client.Store.PushName) == "" {
		client.Store.PushName = "Underchat"
		log.Printf("whatsmeow presence available using fallback push name worker_id=%s reason=%s", m.cfg.WorkerID, reason)
	}

	presenceCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.SendPresence(presenceCtx, types.PresenceAvailable); err != nil {
		log.Printf("whatsmeow presence available failed worker_id=%s reason=%s error=%v", m.cfg.WorkerID, reason, err)
		return
	}
	log.Printf("whatsmeow presence available sent worker_id=%s reason=%s", m.cfg.WorkerID, reason)
}

func chatPresencePayload(cfg Config, evt *events.ChatPresence) (map[string]any, bool) {
	if evt == nil {
		return nil, false
	}

	jid := evt.Chat.String()
	if jid == "" {
		jid = evt.Sender.String()
	}
	if jid == "" {
		return nil, false
	}

	typingState := ""
	isTyping := false
	isRecording := false

	switch evt.State {
	case types.ChatPresenceComposing:
		if evt.Media == types.ChatPresenceMediaAudio {
			typingState = "recording"
			isRecording = true
		} else {
			typingState = "typing"
			isTyping = true
		}
	case types.ChatPresencePaused:
		typingState = "available"
	default:
		return nil, false
	}

	payload := map[string]any{
		"type":         "typing",
		"jid":          jid,
		"is_typing":    isTyping,
		"is_recording": isRecording,
		"typing_state": typingState,
		"account_id":   cfg.AccountID,
		"worker_id":    cfg.WorkerID,
		"provider":     "whatsmeow",
		"chat_jid":     evt.Chat.String(),
		"sender_jid":   evt.Sender.String(),
		"state":        string(evt.State),
		"media":        string(evt.Media),
	}
	if alt := evt.SenderAlt.String(); alt != "" {
		payload["sender_jid_alt"] = alt
	}
	if alt := evt.RecipientAlt.String(); alt != "" {
		payload["recipient_jid_alt"] = alt
	}
	return payload, true
}

func (m *WhatsAppManager) publishPresence(ctx context.Context, evt *events.ChatPresence) {
	payload, ok := chatPresencePayload(m.cfg, evt)
	if !ok {
		if evt != nil {
			log.Printf("whatsmeow chat presence skipped worker_id=%s chat=%s sender=%s state=%s media=%s", m.cfg.WorkerID, evt.Chat.String(), evt.Sender.String(), evt.State, evt.Media)
		}
		return
	}
	log.Printf("whatsmeow chat presence received worker_id=%s jid=%s state=%s media=%s typing_state=%s", m.cfg.WorkerID, payload["jid"], payload["state"], payload["media"], payload["typing_state"])
	if m.centrifugo == nil {
		return
	}
	_ = m.centrifugo.Publish(ctx, chatAccountCentrifugo(m.cfg.AccountID), payload)
}

func (m *WhatsAppManager) buildIncomingUpsert(ctx context.Context, evt *events.Message, fromHistorySync ...bool) (*UpsertMessage, error) {
	isHistorySync := len(fromHistorySync) > 0 && fromHistorySync[0]
	if incomingSkipReasonWithHistory(evt, isHistorySync) != "" {
		return nil, nil
	}
	messageMap := map[string]any{}
	if raw, err := protojson.Marshal(evt.Message); err == nil {
		_ = json.Unmarshal(raw, &messageMap)
		normalizeIncomingMessageMapForBaileys(messageMap)
	}

	messageType, content := m.incomingContent(ctx, evt)
	if messageType == "" {
		return nil, nil
	}
	key := m.buildIncomingMessageKey(evt)
	photo := m.incomingProfilePhoto(ctx, evt)
	_, hasQuoted := content["quoted"]

	return &UpsertMessage{
		WorkerID:       m.cfg.WorkerID,
		AccountID:      m.cfg.AccountID,
		SourceProvider: messageLifecycleProvider,
		Type:           messageType,
		Message: map[string]any{
			"key":              key,
			"message":          messageMap,
			"messageTimestamp": evt.Info.Timestamp.Unix(),
			"pushName":         evt.Info.PushName,
		},
		Content:         content,
		Photo:           photo,
		HasQuoted:       hasQuoted,
		FromHistorySync: isHistorySync,
	}, nil
}

func normalizeIncomingMessageMapForBaileys(messageMap map[string]any) {
	if len(messageMap) == 0 {
		return
	}

	normalizeReactionMessagePayload(messageMap, "reactionMessage")
	normalizeReactionMessagePayload(messageMap, "encReactionMessage")
	normalizeMessageAssociationPayload(messageMap)

	for _, wrapperName := range []string{
		"ephemeralMessage",
		"viewOnceMessage",
		"viewOnceMessageV2",
		"viewOnceMessageV2Extension",
	} {
		wrapper := asMap(messageMap[wrapperName])
		inner := asMap(wrapper["message"])
		if len(inner) > 0 {
			normalizeIncomingMessageMapForBaileys(inner)
		}
	}
}

func normalizeReactionMessagePayload(messageMap map[string]any, field string) {
	reaction := asMap(messageMap[field])
	if len(reaction) == 0 {
		return
	}

	key := asMap(reaction["key"])
	if len(key) > 0 {
		copyCanonicalStringField(key, "id", "ID")
		copyCanonicalStringField(key, "remoteJid", "remoteJID")
	}
	copyCanonicalStringField(reaction, "senderTimestampMs", "senderTimestampMS")
}

func normalizeMessageAssociationPayload(messageMap map[string]any) {
	messageContextInfo := asMap(messageMap["messageContextInfo"])
	association := asMap(messageContextInfo["messageAssociation"])
	parentKey := asMap(association["parentMessageKey"])
	if len(parentKey) == 0 {
		return
	}
	copyCanonicalStringField(parentKey, "id", "ID")
	copyCanonicalStringField(parentKey, "remoteJid", "remoteJID")
}

func copyCanonicalStringField(target map[string]any, canonical string, aliases ...string) {
	if len(target) == 0 || stringValue(target[canonical]) != "" {
		return
	}
	for _, alias := range aliases {
		value, ok := target[alias]
		if !ok || stringValue(value) == "" {
			continue
		}
		target[canonical] = value
		return
	}
}

func (m *WhatsAppManager) buildIncomingMessageKey(evt *events.Message) map[string]any {
	key := map[string]any{
		"id":         evt.Info.ID,
		"remoteJid":  evt.Info.Chat.String(),
		"fromMe":     evt.Info.IsFromMe,
		"isViewOnce": incomingMessageIsViewOnce(evt),
	}
	if remoteJIDAlt := incomingRemoteJIDAlt(evt); remoteJIDAlt != "" {
		key["remoteJidAlt"] = remoteJIDAlt
	}
	if evt.Info.AddressingMode != "" {
		key["addressingMode"] = string(evt.Info.AddressingMode)
	}
	if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
		key["participant"] = evt.Info.Sender.String()
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		key["participantAlt"] = evt.Info.SenderAlt.String()
	}
	return key
}

func incomingMessageIsViewOnce(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	if evt.IsViewOnce || evt.IsViewOnceV2 || evt.IsViewOnceV2Extension {
		return true
	}
	_, wrappedViewOnce := unwrapIncomingMessage(evt.Message)
	return wrappedViewOnce
}

func (m *WhatsAppManager) incomingProfilePhoto(ctx context.Context, evt *events.Message) string {
	return m.profilePhotoForJIDs(ctx, incomingProfilePhotoJIDs(evt))
}

func (m *WhatsAppManager) profilePhotoForJIDs(ctx context.Context, candidates []types.JID) string {
	client := m.getClient()
	if !m.isAuthenticated(client) {
		return ""
	}
	candidates = profilePhotoCandidates(candidates, ownProfilePhotoAliases(client))
	if len(candidates) == 0 {
		return ""
	}
	photoCtx, cancel := context.WithTimeout(ctx, whatsmeowPhotoFetchTimeout)
	defer cancel()

	for _, jid := range candidates {
		cacheKey := incomingProfilePhotoCacheKey(jid)
		if m.redis != nil {
			cachedPhoto, err := m.redis.Get(photoCtx, cacheKey).Result()
			switch {
			case err == nil && cachedPhoto != "":
				if cachedPhoto == whatsmeowPhotoCacheNoPhoto {
					continue
				}
				if !cachedProfilePhotoUsable(photoCtx, cachedPhoto) {
					log.Printf("whatsmeow shared profile photo cache is not usable worker_id=%s jid=%s host=%s", m.cfg.WorkerID, jid.String(), urlHost(cachedPhoto))
					continue
				}
				return cachedPhoto
			case err != nil && !errors.Is(err, redis.Nil):
				log.Printf("whatsmeow profile photo cache read failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			}
		}
	}

	for _, jid := range candidates {
		noPhotoCacheKey := incomingProfilePhotoNoPhotoCacheKey(jid)
		if m.redis != nil {
			cachedNoPhoto, err := m.redis.Get(photoCtx, noPhotoCacheKey).Result()
			switch {
			case err == nil && cachedNoPhoto == whatsmeowPhotoCacheNoPhoto:
				continue
			case err != nil && !errors.Is(err, redis.Nil):
				log.Printf("whatsmeow profile photo no-photo cache read failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			}
		}

		info, err := client.GetProfilePictureInfo(photoCtx, jid, &whatsmeow.GetProfilePictureParams{Preview: false})
		if err != nil {
			if errors.Is(err, whatsmeow.ErrProfilePictureNotSet) || errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) {
				m.cacheProfilePhotoNoPhoto(photoCtx, jid)
				continue
			}
			log.Printf("whatsmeow profile photo fetch failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			continue
		}
		if info == nil || strings.TrimSpace(info.URL) == "" {
			m.cacheProfilePhotoNoPhoto(photoCtx, jid)
			continue
		}
		photo := strings.TrimSpace(info.URL)
		m.cacheProfilePhoto(photoCtx, candidates, photo)
		log.Printf("whatsmeow profile photo fetched worker_id=%s jid=%s photo_id=%s persisted=false", m.cfg.WorkerID, jid.String(), info.ID)
		return photo
	}
	return ""
}

func (m *WhatsAppManager) persistProfilePhoto(ctx context.Context, jid types.JID, rawURL string) string {
	if rawURL == "" {
		return ""
	}
	if m.storage == nil {
		log.Printf("whatsmeow profile photo storage unavailable worker_id=%s jid=%s using_raw_url=true", m.cfg.WorkerID, jid.String())
		return rawURL
	}
	body, contentType, fileName, err := downloadURL(ctx, rawURL)
	if err != nil {
		log.Printf("whatsmeow profile photo download failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
		return rawURL
	}
	if !isImageContentType(contentType) {
		detected := http.DetectContentType(body)
		if isImageContentType(detected) {
			contentType = detected
		} else {
			log.Printf("whatsmeow profile photo ignored non-image worker_id=%s jid=%s content_type=%s detected=%s", m.cfg.WorkerID, jid.String(), contentType, detected)
			return ""
		}
	}
	if fileName == "" || fileName == "." || fileName == "/" {
		fileName = "profile_photo_" + firstNonEmpty(digits(jid.User), randomHex(4)) + extensionFromMime(contentType)
	}
	object, err := m.storage.Upload(ctx, m.cfg.AccountID, body, fileName, contentType)
	if err != nil {
		log.Printf("whatsmeow profile photo upload failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
		return rawURL
	}
	log.Printf("whatsmeow profile photo uploaded worker_id=%s jid=%s url=%s size=%d", m.cfg.WorkerID, jid.String(), object.URL, object.Size)
	return object.URL
}

func isImageContentType(contentType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "image/")
}

func urlHost(rawURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return ""
	}
	return parsed.Host
}

func isLikelyTemporaryProfilePhotoURL(rawURL string) bool {
	host := strings.ToLower(urlHost(rawURL))
	return strings.Contains(host, "whatsapp.net") || strings.Contains(host, "fbcdn.net")
}

func cachedProfilePhotoUsable(ctx context.Context, rawURL string) bool {
	if !isLikelyTemporaryProfilePhotoURL(rawURL) {
		return true
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Range", "bytes=0-0")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return false
	}

	contentType := strings.ToLower(strings.TrimSpace(res.Header.Get("content-type")))
	return contentType == "" || strings.HasPrefix(contentType, "image/")
}

func callAltJID(callFrom, creator types.JID) string {
	primary := nonADJID(callFrom)
	fallback := nonADJID(creator)
	if primary.IsEmpty() || fallback.IsEmpty() || primary == fallback {
		return ""
	}
	return fallback.String()
}

func callPhoneFromJIDs(callFrom, creator types.JID) string {
	candidates := []types.JID{nonADJID(callFrom), nonADJID(creator)}
	for _, jid := range candidates {
		if jid.Server != types.DefaultUserServer && jid.Server != types.LegacyUserServer {
			continue
		}
		if phone := digits(jid.User); phone != "" {
			return phone
		}
	}
	for _, jid := range candidates {
		if phone := digits(jid.User); phone != "" {
			return phone
		}
	}
	return ""
}

func (m *WhatsAppManager) cacheProfilePhoto(ctx context.Context, candidates []types.JID, photo string) {
	if m.redis == nil || strings.TrimSpace(photo) == "" {
		return
	}
	seen := map[string]struct{}{}
	for _, jid := range candidates {
		cacheKey := incomingProfilePhotoCacheKey(jid)
		if cacheKey == "" {
			continue
		}
		if _, ok := seen[cacheKey]; ok {
			continue
		}
		seen[cacheKey] = struct{}{}
		if err := m.redis.Set(ctx, cacheKey, photo, whatsmeowPhotoCacheTTL).Err(); err != nil {
			log.Printf("whatsmeow profile photo cache write failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
		}
	}
}

func (m *WhatsAppManager) cacheProfilePhotoNoPhoto(ctx context.Context, jid types.JID) {
	cacheKey := incomingProfilePhotoNoPhotoCacheKey(jid)
	if m.redis == nil || cacheKey == "" {
		return
	}
	if err := m.redis.Set(ctx, cacheKey, whatsmeowPhotoCacheNoPhoto, whatsmeowPhotoCacheNoPhotoTTL).Err(); err != nil {
		log.Printf("whatsmeow profile photo no-photo cache write failed worker_id=%s error=%v", m.cfg.WorkerID, err)
	}
}

func incomingProfilePhotoJIDs(evt *events.Message) []types.JID {
	if evt == nil {
		return nil
	}
	if evt.Info.IsFromMe {
		return profilePhotoCandidates([]types.JID{
			evt.Info.RecipientAlt,
			evt.Info.SenderAlt,
			evt.Info.Chat,
			evt.Info.Sender,
		}, nil)
	}
	return profilePhotoCandidates([]types.JID{
		evt.Info.SenderAlt,
		evt.Info.RecipientAlt,
		evt.Info.Chat,
		evt.Info.Sender,
	}, nil)
}

func ownProfilePhotoAliases(client *whatsmeow.Client) map[string]struct{} {
	if client == nil || client.Store == nil {
		return nil
	}
	return profilePhotoAliasSet(client.Store.GetJID(), client.Store.GetLID())
}

func profilePhotoCandidates(candidates []types.JID, selfAliases map[string]struct{}) []types.JID {
	normalized := make([]types.JID, 0, len(candidates))
	seen := map[string]struct{}{}
	for _, jid := range candidates {
		jid = nonADJID(jid)
		if !isWhatsmeowUserChat(jid) {
			continue
		}
		if isSelfProfilePhotoJID(jid, selfAliases) {
			continue
		}
		key := jid.String()
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, jid)
	}
	return normalized
}

func profilePhotoAliasSet(jids ...types.JID) map[string]struct{} {
	aliases := map[string]struct{}{}
	for _, jid := range jids {
		for _, alias := range profilePhotoJIDAliases(jid) {
			aliases[alias] = struct{}{}
		}
	}
	if len(aliases) == 0 {
		return nil
	}
	return aliases
}

func isSelfProfilePhotoJID(jid types.JID, selfAliases map[string]struct{}) bool {
	if len(selfAliases) == 0 {
		return false
	}
	for _, alias := range profilePhotoJIDAliases(jid) {
		if _, ok := selfAliases[alias]; ok {
			return true
		}
	}
	return false
}

func profilePhotoJIDAliases(jid types.JID) []string {
	jid = nonADJID(jid)
	if !isWhatsmeowUserChat(jid) {
		return nil
	}
	aliases := []string{jid.String()}
	switch jid.Server {
	case types.DefaultUserServer:
		legacy := jid
		legacy.Server = types.LegacyUserServer
		aliases = append(aliases, legacy.String())
	case types.LegacyUserServer:
		current := jid
		current.Server = types.DefaultUserServer
		aliases = append(aliases, current.String())
	}
	return aliases
}

func incomingProfilePhotoCacheKey(jid types.JID) string {
	jid = nonADJID(jid)
	if jid.IsEmpty() {
		return ""
	}
	return whatsmeowPhotoCachePrefix + jid.String()
}

func incomingProfilePhotoNoPhotoCacheKey(jid types.JID) string {
	jid = nonADJID(jid)
	if jid.IsEmpty() {
		return ""
	}
	return whatsmeowPhotoNoPhotoCachePrefix + jid.String()
}

const incomingMessageRawLogLimit = 12000

func incomingLifecycleMessageLike(evt *events.Message) *eventsMessageLike {
	if evt == nil {
		return &eventsMessageLike{}
	}
	return &eventsMessageLike{
		chat:         incomingChatString(evt),
		remoteJIDAlt: incomingRemoteJIDAlt(evt),
		sender:       incomingSenderString(evt),
		senderAlt:    incomingSenderAltString(evt),
		id:           incomingMessageID(evt),
		fromMe:       incomingFromMe(evt),
	}
}

func (m *WhatsAppManager) logIncomingMessageDebug(ctx context.Context, evt *events.Message, skipReason string) {
	if !m.cfg.MessageLifecycleDebugEnabled || strings.TrimSpace(skipReason) == "" {
		return
	}

	rawJSON, rawTruncated, rawErr := incomingRawMessageJSON(evt, m.cfg.MessageLifecycleDebugRawLimit)
	recordMessageLifecycle(ctx, m.cfg, map[string]any{
		"stage":                        "whatsmeow.incoming.skip_raw",
		"decision":                     "receive_provider_message",
		"outcome":                      "skipped",
		"reason":                       skipReason,
		"skip_reason":                  skipReason,
		"chat_server":                  incomingChatServer(evt),
		"sender":                       incomingSenderString(evt),
		"sender_alt":                   incomingSenderAltString(evt),
		"recipient_alt":                incomingRecipientAltString(evt),
		"server_id":                    incomingServerID(evt),
		"from_me":                      incomingFromMe(evt),
		"category":                     incomingCategory(evt),
		"info_type":                    incomingInfoType(evt),
		"media_type":                   incomingMediaType(evt),
		"edit":                         incomingEdit(evt),
		"multicast":                    incomingMulticast(evt),
		"timestamp":                    incomingTimestamp(evt),
		"retry_count":                  incomingRetryCount(evt),
		"unavailable_request_id":       incomingUnavailableRequestID(evt),
		"source_web_msg":               evt != nil && evt.SourceWebMsg != nil,
		"is_ephemeral":                 evt != nil && evt.IsEphemeral,
		"is_view_once":                 evt != nil && evt.IsViewOnce,
		"is_view_once_v2":              evt != nil && evt.IsViewOnceV2,
		"is_view_once_v2_extension":    evt != nil && evt.IsViewOnceV2Extension,
		"is_document_with_caption":     evt != nil && evt.IsDocumentWithCaption,
		"is_lottie_sticker":            evt != nil && evt.IsLottieSticker,
		"is_bot_invoke":                evt != nil && evt.IsBotInvoke,
		"is_edit":                      evt != nil && evt.IsEdit,
		"kinds":                        strings.Join(incomingMessageKinds(evt), ","),
		"message_text":                 incomingTextPreview(evt),
		"raw_payload":                  rawJSON,
		"raw_payload_source_truncated": rawTruncated,
		"raw_error":                    rawErr,
	})
}

func incomingRawMessageJSON(evt *events.Message, limit int) (string, bool, string) {
	if evt == nil || evt.Message == nil {
		return "null", false, ""
	}
	raw, err := protojson.MarshalOptions{EmitUnpopulated: false}.Marshal(evt.Message)
	if err != nil {
		return "null", false, err.Error()
	}
	value := string(raw)
	truncated := false
	if limit > 0 && len(value) > limit {
		value = value[:limit] + "...<truncated>"
		truncated = true
	}
	return value, truncated, ""
}

func incomingMessageKinds(evt *events.Message) []string {
	if evt == nil || evt.Message == nil {
		return []string{"empty"}
	}
	raw := evt.Message
	msg, _ := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return []string{"empty"}
	}
	kinds := make([]string, 0, 8)
	if raw.GetViewOnceMessage() != nil {
		kinds = append(kinds, "wrapper:view_once")
	}
	if raw.GetViewOnceMessageV2() != nil {
		kinds = append(kinds, "wrapper:view_once_v2")
	}
	if raw.GetViewOnceMessageV2Extension() != nil {
		kinds = append(kinds, "wrapper:view_once_v2_extension")
	}
	if raw.GetEphemeralMessage() != nil {
		kinds = append(kinds, "wrapper:ephemeral")
	}
	if raw.GetDocumentWithCaptionMessage() != nil {
		kinds = append(kinds, "wrapper:document_with_caption")
	}
	if raw.GetLottieStickerMessage() != nil {
		kinds = append(kinds, "wrapper:lottie_sticker")
	}
	if raw.GetEditedMessage() != nil {
		kinds = append(kinds, "wrapper:edited")
	}
	if msg.GetConversation() != "" {
		kinds = append(kinds, "conversation")
	}
	if msg.GetExtendedTextMessage() != nil {
		kinds = append(kinds, "extended_text")
	}
	if protocolMsg := msg.GetProtocolMessage(); protocolMsg != nil {
		if protocolMsg.Type == nil {
			kinds = append(kinds, "protocol:unknown")
		} else {
			kinds = append(kinds, "protocol:"+protocolMsg.GetType().String())
		}
	}
	if msg.GetReactionMessage() != nil {
		kinds = append(kinds, "reaction")
	}
	if msg.GetImageMessage() != nil {
		kinds = append(kinds, "image")
	}
	if msg.GetVideoMessage() != nil {
		kinds = append(kinds, "video")
	}
	if msg.GetPtvMessage() != nil {
		kinds = append(kinds, "ptv")
	}
	if msg.GetAudioMessage() != nil {
		kinds = append(kinds, "audio")
	}
	if msg.GetDocumentMessage() != nil {
		kinds = append(kinds, "document")
	}
	if msg.GetStickerMessage() != nil {
		kinds = append(kinds, "sticker")
	}
	if msg.GetLocationMessage() != nil {
		kinds = append(kinds, "location")
	}
	if msg.GetContactMessage() != nil {
		kinds = append(kinds, "contact")
	}
	if msg.GetContactsArrayMessage() != nil {
		kinds = append(kinds, "contacts")
	}
	if msg.GetDeviceSentMessage() != nil {
		kinds = append(kinds, "device_sent")
	}
	if msg.GetViewOnceMessage() != nil {
		kinds = append(kinds, "view_once")
	}
	if msg.GetViewOnceMessageV2() != nil {
		kinds = append(kinds, "view_once_v2")
	}
	if msg.GetViewOnceMessageV2Extension() != nil {
		kinds = append(kinds, "view_once_v2_extension")
	}
	if msg.GetEphemeralMessage() != nil {
		kinds = append(kinds, "ephemeral")
	}
	if msg.GetDocumentWithCaptionMessage() != nil {
		kinds = append(kinds, "document_with_caption")
	}
	if msg.GetAlbumMessage() != nil {
		kinds = append(kinds, "album")
	}
	if msg.GetPollCreationMessage() != nil || msg.GetPollCreationMessageV2() != nil || msg.GetPollCreationMessageV3() != nil || msg.GetPollCreationMessageV5() != nil || msg.GetPollCreationMessageV6() != nil {
		kinds = append(kinds, "poll_creation")
	}
	if msg.GetPollUpdateMessage() != nil {
		kinds = append(kinds, "poll_update")
	}
	if msg.GetPinInChatMessage() != nil {
		kinds = append(kinds, "pin_in_chat")
	}
	if msg.GetKeepInChatMessage() != nil {
		kinds = append(kinds, "keep_in_chat")
	}
	if len(kinds) == 0 {
		kinds = append(kinds, "unknown")
	}
	return kinds
}

func incomingTextPreview(evt *events.Message) string {
	if evt == nil || evt.Message == nil {
		return ""
	}
	msg, _ := unwrapIncomingMessage(evt.Message)
	if msg == nil {
		return ""
	}
	candidates := []string{
		msg.GetConversation(),
	}
	if ext := msg.GetExtendedTextMessage(); ext != nil {
		candidates = append(candidates, ext.GetText())
	}
	if reaction := msg.GetReactionMessage(); reaction != nil {
		candidates = append(candidates, reaction.GetText())
	}
	if image := msg.GetImageMessage(); image != nil {
		candidates = append(candidates, image.GetCaption())
	}
	if video := msg.GetVideoMessage(); video != nil {
		candidates = append(candidates, video.GetCaption())
	}
	if doc := msg.GetDocumentMessage(); doc != nil {
		candidates = append(candidates, doc.GetCaption(), doc.GetFileName(), doc.GetTitle())
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate != "" {
			return truncateLogValue(candidate, 500)
		}
	}
	return ""
}

func truncateLogValue(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit] + "...<truncated>"
}

func incomingSkipReason(evt *events.Message) string {
	return incomingSkipReasonWithHistory(evt, false)
}

func incomingSkipReasonWithHistory(evt *events.Message, allowHistorySync bool) string {
	if evt == nil || evt.Message == nil {
		return "empty_message"
	}
	if strings.EqualFold(evt.Info.Category, "peer") {
		return "peer_category"
	}
	if !allowHistorySync && evt.SourceWebMsg != nil && evt.UnavailableRequestID == "" {
		return "history_sync_message"
	}
	if evt.Info.IsIncomingBroadcast() {
		return "incoming_broadcast"
	}
	if !isWhatsmeowUserChat(evt.Info.Chat) {
		return "non_user_chat"
	}
	return ""
}

func historySyncMessageTimestamp(message *waHistorySync.HistorySyncMsg) uint64 {
	if message == nil || message.GetMessage() == nil {
		return 0
	}
	return message.GetMessage().GetMessageTimestamp()
}

func incomingRemoteJIDAlt(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	altCandidates := []types.JID{}
	if evt.Info.IsFromMe {
		altCandidates = append(altCandidates, evt.Info.RecipientAlt, evt.Info.SenderAlt)
	} else {
		altCandidates = append(altCandidates, evt.Info.SenderAlt, evt.Info.RecipientAlt)
	}
	chat := nonADJID(evt.Info.Chat)
	for _, candidate := range altCandidates {
		alt := nonADJID(candidate)
		if alt.IsEmpty() || alt == chat {
			continue
		}
		return alt.String()
	}
	return ""
}

func nonADJID(jid types.JID) types.JID {
	if jid.IsEmpty() {
		return jid
	}
	return jid.ToNonAD()
}

func isWhatsmeowUserChat(jid types.JID) bool {
	if jid.User == "" {
		return false
	}
	switch jid.Server {
	case types.DefaultUserServer, types.HiddenUserServer, types.LegacyUserServer:
		return true
	default:
		return false
	}
}

func incomingChatString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Chat.String()
}

func incomingSenderString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Sender.String()
}

func incomingSenderAltString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.SenderAlt.String()
}

func incomingRecipientAltString(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.RecipientAlt.String()
}

func incomingMessageID(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.Info.ID)
}

func incomingFromMe(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	return evt.Info.IsFromMe
}

func incomingCategory(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Category
}

func incomingChatServer(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Chat.Server
}

func incomingInfoType(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.Type
}

func incomingMediaType(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return evt.Info.MediaType
}

func incomingEdit(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.Info.Edit)
}

func incomingMulticast(evt *events.Message) bool {
	if evt == nil {
		return false
	}
	return evt.Info.Multicast
}

func incomingServerID(evt *events.Message) int {
	if evt == nil {
		return 0
	}
	return evt.Info.ServerID
}

func incomingTimestamp(evt *events.Message) string {
	if evt == nil || evt.Info.Timestamp.IsZero() {
		return ""
	}
	return evt.Info.Timestamp.Format(time.RFC3339Nano)
}

func incomingRetryCount(evt *events.Message) int {
	if evt == nil {
		return 0
	}
	return evt.RetryCount
}

func incomingUnavailableRequestID(evt *events.Message) string {
	if evt == nil {
		return ""
	}
	return string(evt.UnavailableRequestID)
}

var digitsRE = regexp.MustCompile(`\D+`)

func digits(value string) string {
	return digitsRE.ReplaceAllString(value, "")
}

func phoneFromJID(jid string) string {
	user := strings.Split(jid, "@")[0]
	if strings.Contains(user, ":") {
		user = strings.Split(user, ":")[0]
	}
	return digits(user)
}

func phoneFromOwnID(jid *types.JID) string {
	if jid == nil {
		return ""
	}
	return digits(jid.User)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
