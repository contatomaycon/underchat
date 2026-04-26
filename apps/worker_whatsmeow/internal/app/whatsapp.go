package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
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

	pendingFreshLogin  *freshLoginRequest
	currentQRCode      string
	currentPairingCode string
}

const (
	whatsmeowPhotoCachePrefix     = "photo:s3:jid:"
	whatsmeowPhotoCacheNoPhoto    = "__no_photo__"
	whatsmeowPhotoCacheTTL        = 24 * time.Hour
	whatsmeowPhotoCacheNoPhotoTTL = 5 * time.Minute
	whatsmeowPhotoFetchTimeout    = 5 * time.Second
	whatsmeowLogoutTimeout        = 30 * time.Second

	whatsmeowPairClientDesktop     whatsmeow.PairClientType = 7
	whatsmeowPairClientDisplayName                          = "Desktop (Mac OS)"
)

type freshLoginRequest struct {
	Type  string
	Phone string
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

func (m *WhatsAppManager) RequestConnection(ctx context.Context, req StatusConnectionRequest) error {
	log.Printf(
		"whatsmeow RequestConnection worker_id=%s status=%s type=%s remove_session=%t phone_connection_set=%t",
		req.WorkerID,
		req.Status,
		req.Type,
		req.RemoveSession,
		req.PhoneConnection != "",
	)
	if req.WorkerID != "" && req.WorkerID != m.cfg.WorkerID {
		return fmt.Errorf("request worker_id %s does not match %s", req.WorkerID, m.cfg.WorkerID)
	}

	if req.RemoveSession || req.Status == WorkerStatusDisponible {
		return m.removeSession(ctx)
	}

	if m.publishConnectedIfAuthenticated(ctx, "request-connection-already-authenticated") {
		return nil
	}

	m.publishState(ctx, "connecting", CodeAwaitConnection, "", "", "", false)

	switch strings.ToLower(req.Type) {
	case "phone":
		return m.connectWithPhonePairing(ctx, req.PhoneConnection)
	case "qrcode", "":
		return m.connectWithQRCode(ctx)
	default:
		return fmt.Errorf("unsupported connection type %q", req.Type)
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
			log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
			return err
		}
	case <-timeout:
		client.Disconnect()
		err := fmt.Errorf("whatsmeow connect timeout after %s", m.cfg.WhatsAppConnectTimeout)
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
		return err
	case <-ctx.Done():
		err := ctx.Err()
		log.Printf("whatsmeow connect failed worker_id=%s stage=%s elapsed=%s error=%v", m.cfg.WorkerID, stage, time.Since(startedAt), err)
		return err
	}

	log.Printf("whatsmeow connect returned worker_id=%s stage=%s elapsed=%s", m.cfg.WorkerID, stage, time.Since(startedAt))
	return nil
}

func (m *WhatsAppManager) connectWithQRCode(ctx context.Context) error {
	return m.connectWithQRCodeInternal(ctx, true)
}

func (m *WhatsAppManager) connectWithQRCodeInternal(ctx context.Context, allowDeletedStoreRetry bool) error {
	client, err := m.ensureUsableClientForLogin(ctx, "qrcode-request")
	if err != nil {
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return err
	}
	connectCtx := m.connectionContext()
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow qrcode request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		go m.markPresenceAvailable(context.Background(), "qrcode-already-authenticated")
		m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return nil
	}
	if client.IsConnected() {
		if client.Store.ID != nil {
			log.Printf("whatsmeow qrcode request authentication in progress worker_id=%s", m.cfg.WorkerID)
			m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
			return nil
		}
		currentQR := m.getCurrentQRCode()
		log.Printf("whatsmeow qrcode request already awaiting scan worker_id=%s has_qr=%t", m.cfg.WorkerID, currentQR != "")
		m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", currentQR, true)
		return nil
	}
	if client.Store.ID != nil {
		log.Printf("whatsmeow qrcode request using stored session worker_id=%s", m.cfg.WorkerID)
		m.armFreshLoginFallback(freshLoginRequest{Type: "qrcode"})
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		if err := m.connectClient(connectCtx, client, "qrcode-stored-session"); err != nil {
			return m.handleStoredSessionConnectError(ctx, err)
		}
		return nil
	}

	log.Printf("whatsmeow qrcode request starting new login worker_id=%s", m.cfg.WorkerID)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	qrChan, err := client.GetQRChannel(connectCtx)
	if err != nil {
		log.Printf("whatsmeow GetQRChannel failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry)
	}
	m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
	if err := m.connectClient(connectCtx, client, "qrcode-new-login"); err != nil {
		return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "qrcode"}, err, allowDeletedStoreRetry)
	}

	go func() {
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				qrImage := qrCodeDataURL(evt.Code)
				m.setCurrentQRCode(qrImage)
				log.Printf("whatsmeow qr code received worker_id=%s timeout=%s", m.cfg.WorkerID, evt.Timeout)
				m.publishState(context.Background(), "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", qrImage, true)
			case "success":
				m.clearLoginArtifacts()
				log.Printf("whatsmeow qr scanned, pairing in progress worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "connecting", CodePairingInProgress, WorkerStatusDisponible, "", "", true)
			case "timeout":
				m.clearLoginArtifacts()
				log.Printf("whatsmeow qr timeout worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true)
			default:
				if evt.Error != nil {
					log.Printf("qr event error: %v", evt.Error)
				} else {
					log.Printf("whatsmeow qr unexpected event worker_id=%s event=%s", m.cfg.WorkerID, evt.Event)
				}
			}
		}
		log.Printf("whatsmeow qr channel closed worker_id=%s", m.cfg.WorkerID)
	}()
	return nil
}

func (m *WhatsAppManager) connectWithPhonePairing(ctx context.Context, phone string) error {
	return m.connectWithPhonePairingInternal(ctx, phone, true)
}

func (m *WhatsAppManager) connectWithPhonePairingInternal(ctx context.Context, phone string, allowDeletedStoreRetry bool) error {
	client, err := m.ensureUsableClientForLogin(ctx, "phone-pairing-request")
	if err != nil {
		m.publishState(ctx, "disconnected", CodeConnectionLost, WorkerStatusDisponible, "", "", false)
		return err
	}
	connectCtx := m.connectionContext()
	if phone = digits(phone); phone == "" {
		return fmt.Errorf("phone_connection is required")
	}
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow phone pairing request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
		go m.markPresenceAvailable(context.Background(), "phone-already-authenticated")
		m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return nil
	}
	if client.IsConnected() && client.Store.ID == nil {
		currentPairingCode := m.getCurrentPairingCode()
		log.Printf("whatsmeow phone pairing request already awaiting pairing worker_id=%s has_pairing_code=%t", m.cfg.WorkerID, currentPairingCode != "")
		m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", currentPairingCode, true)
		return nil
	}
	if client.IsConnected() && client.Store.ID != nil {
		log.Printf("whatsmeow phone pairing request authentication in progress worker_id=%s", m.cfg.WorkerID)
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return nil
	}
	if client.Store.ID != nil {
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
		log.Printf("whatsmeow phone pairing failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return m.handleFreshLoginConnectError(ctx, freshLoginRequest{Type: "phone", Phone: phone}, err, allowDeletedStoreRetry)
	}
	m.setCurrentPairingCode(pairingCode)
	log.Printf("whatsmeow phone pairing code generated worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", pairingCode, true)
	return nil
}

func (m *WhatsAppManager) removeSession(ctx context.Context) error {
	log.Printf("whatsmeow remove session requested worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeLogoutInProgress, "", "", "", false)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	client := m.getClient()
	if client != nil {
		if err := m.logoutAndDeleteDevice(client); err != nil {
			log.Printf("whatsmeow remove session logout failed worker_id=%s error=%v", m.cfg.WorkerID, err)
			client.Disconnect()
			if client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
				if deleteErr := client.Store.Delete(context.Background()); deleteErr != nil {
					log.Printf("whatsmeow remove session local store delete failed worker_id=%s error=%v", m.cfg.WorkerID, deleteErr)
				}
			}
		} else {
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
		log.Printf("whatsmeow remove session local files cleanup failed worker_id=%s error=%v", m.cfg.WorkerID, err)
	}
	if err := m.initClient(context.Background()); err != nil {
		log.Printf("whatsmeow remove session client reinit failed worker_id=%s error=%v", m.cfg.WorkerID, err)
	}
	m.sessionMu.Unlock()

	m.publishStateDisconnectedByUser(ctx, CodeLoggedOut, WorkerStatusDisponible)
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
		log.Printf("whatsmeow event disconnected worker_id=%s", m.cfg.WorkerID)
		m.clearLoginArtifacts()
		m.mu.Lock()
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionLost
		m.mu.Unlock()
		m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
	case *events.LoggedOut:
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
		log.Printf("whatsmeow event connect_failure worker_id=%s reason=%s message=%s", m.cfg.WorkerID, event.Reason.String(), event.Message)
		m.clearLoginArtifacts()
		if event.Reason.IsLoggedOut() && m.startFreshLoginAfterStoredSessionLogout() {
			return
		}
		m.clearFreshLoginFallback()
		m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
	case *events.StreamReplaced:
		log.Printf("whatsmeow event stream_replaced worker_id=%s", m.cfg.WorkerID)
		m.clearLoginArtifacts()
		m.clearFreshLoginFallback()
		m.publishState(context.Background(), "disconnected", CodeConnectionReplaced, WorkerStatusOffline, "", "", false)
	case *events.Message:
		go m.handleIncomingMessage(context.Background(), event)
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

		switch strings.ToLower(req.Type) {
		case "phone":
			return m.connectWithPhonePairingInternal(ctx, req.Phone, false)
		default:
			return m.connectWithQRCodeInternal(ctx, false)
		}
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
	switch strings.ToLower(req.Type) {
	case "phone":
		return m.connectWithPhonePairing(ctx, req.Phone)
	default:
		return m.connectWithQRCode(ctx)
	}
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
	if code == CodeAwaitingReadQRCode {
		state.QRCode = qrOrPair
	}
	if code == CodeAwaitingPairingCode {
		state.PairingCode = qrOrPair
	}
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s has_qr=%t has_pairing_code=%t is_new_login=%t",
		m.cfg.WorkerID,
		status,
		code,
		workerStatusID,
		state.QRCode != "",
		state.PairingCode != "",
		isNewLogin,
	)
	if err := m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), state); err != nil {
		log.Printf("centrifugo publish connection state failed worker_id=%s status=%s code=%d error=%v", m.cfg.WorkerID, status, code, err)
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
	log.Printf(
		"publishing connection state worker_id=%s status=%s code=%d worker_status_id=%s disconnected_user=true has_qr=false has_pairing_code=false is_new_login=false",
		m.cfg.WorkerID,
		state.Status,
		code,
		workerStatusID,
	)
	if err := m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), state); err != nil {
		log.Printf("centrifugo publish connection state failed worker_id=%s status=%s code=%d error=%v", m.cfg.WorkerID, state.Status, code, err)
	}
	if workerStatusID == WorkerStatusOnline || workerStatusID == WorkerStatusOffline || workerStatusID == WorkerStatusDisponible {
		if err := m.balance.NotifyWorkerStatus(ctx, state); err != nil {
			log.Printf("balance notify worker status failed worker_id=%s status=%s code=%d worker_status_id=%s error=%v", m.cfg.WorkerID, state.Status, code, workerStatusID, err)
		}
	}
}

func (m *WhatsAppManager) handleIncomingMessage(ctx context.Context, evt *events.Message) {
	skipReason := incomingSkipReason(evt)
	m.logIncomingMessageDebug(evt, skipReason)

	if skipReason != "" {
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
		log.Printf("failed to map incoming message: %v", err)
		return
	}
	if upsert == nil {
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
	key := fmt.Sprintf("%s:%s", m.cfg.AccountID, valueString(upsert.Message["key"], "id"))
	if err := m.kafka.SendJSON(ctx, topicUpsertMessage, key, upsert); err != nil {
		log.Printf("failed to publish incoming message: %v", err)
		return
	}
	hasMediaURL, mediaFailed := mediaContentPublishStatus(upsert.Content, upsert.Type)
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
		WorkerID:    m.cfg.WorkerID,
		AccountID:   m.cfg.AccountID,
		Type:        MessageTypeSystem,
		Photo:       m.profilePhotoForJIDs(ctx, []types.JID{callFrom, creator}),
		HasQuoted:   false,
		IsCallEvent: true,
		CallPhone:   callPhone,
		CallJID:     callJID,
		CallJIDAlt:  callJIDAlt,
		Message: map[string]any{
			"key":              key,
			"message":          map[string]any{"conversation": callText},
			"messageTimestamp": time.Now().Unix(),
		},
	}
	_ = m.kafka.SendJSON(ctx, topicUpsertMessage, m.cfg.AccountID+":"+callID, upsert)

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

func (m *WhatsAppManager) buildIncomingUpsert(ctx context.Context, evt *events.Message) (*UpsertMessage, error) {
	if incomingSkipReason(evt) != "" {
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
		WorkerID:  m.cfg.WorkerID,
		AccountID: m.cfg.AccountID,
		Type:      messageType,
		Message: map[string]any{
			"key":              key,
			"message":          messageMap,
			"messageTimestamp": evt.Info.Timestamp.Unix(),
			"pushName":         evt.Info.PushName,
		},
		Content:   content,
		Photo:     photo,
		HasQuoted: hasQuoted,
	}, nil
}

func normalizeIncomingMessageMapForBaileys(messageMap map[string]any) {
	if len(messageMap) == 0 {
		return
	}

	normalizeReactionMessagePayload(messageMap, "reactionMessage")
	normalizeReactionMessagePayload(messageMap, "encReactionMessage")

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
			case err == nil && cachedPhoto == whatsmeowPhotoCacheNoPhoto:
				continue
			case err == nil && cachedPhoto != "":
				return cachedPhoto
			case err != nil && !errors.Is(err, redis.Nil):
				log.Printf("whatsmeow profile photo cache read failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			}
		}

		info, err := client.GetProfilePictureInfo(photoCtx, jid, &whatsmeow.GetProfilePictureParams{Preview: false})
		if err != nil {
			if errors.Is(err, whatsmeow.ErrProfilePictureNotSet) || errors.Is(err, whatsmeow.ErrProfilePictureUnauthorized) {
				m.cacheProfilePhotoNoPhoto(photoCtx, cacheKey)
				continue
			}
			log.Printf("whatsmeow profile photo fetch failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			continue
		}
		if info == nil || strings.TrimSpace(info.URL) == "" {
			m.cacheProfilePhotoNoPhoto(photoCtx, cacheKey)
			continue
		}
		photo := strings.TrimSpace(info.URL)
		if m.redis != nil {
			if err := m.redis.Set(photoCtx, cacheKey, photo, whatsmeowPhotoCacheTTL).Err(); err != nil {
				log.Printf("whatsmeow profile photo cache write failed worker_id=%s jid=%s error=%v", m.cfg.WorkerID, jid.String(), err)
			}
		}
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

func (m *WhatsAppManager) cacheProfilePhotoNoPhoto(ctx context.Context, cacheKey string) {
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
	candidates := make([]types.JID, 0, 4)
	seen := map[string]struct{}{}
	add := func(jid types.JID) {
		jid = nonADJID(jid)
		if !isWhatsmeowUserChat(jid) {
			return
		}
		key := jid.String()
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		candidates = append(candidates, jid)
	}

	if evt.Info.IsFromMe {
		add(evt.Info.RecipientAlt)
		add(evt.Info.SenderAlt)
	} else {
		add(evt.Info.SenderAlt)
		add(evt.Info.RecipientAlt)
	}
	add(evt.Info.Chat)
	add(evt.Info.Sender)
	return candidates
}

func incomingProfilePhotoCacheKey(jid types.JID) string {
	jid = nonADJID(jid)
	if jid.IsEmpty() {
		return ""
	}
	return whatsmeowPhotoCachePrefix + jid.String()
}

const incomingMessageRawLogLimit = 12000

func (m *WhatsAppManager) logIncomingMessageDebug(evt *events.Message, skipReason string) {
	rawJSON, rawTruncated, rawErr := incomingRawMessageJSON(evt, incomingMessageRawLogLimit)
	log.Printf(
		"whatsmeow incoming message received worker_id=%s skip_reason=%s chat=%s chat_server=%s sender=%s sender_alt=%s recipient_alt=%s id=%s server_id=%d from_me=%t category=%s info_type=%s media_type=%s edit=%s multicast=%t timestamp=%s retry_count=%d unavailable_request_id=%s source_web_msg=%t is_ephemeral=%t is_view_once=%t is_view_once_v2=%t is_view_once_v2_extension=%t is_document_with_caption=%t is_lottie_sticker=%t is_bot_invoke=%t is_edit=%t kinds=%s text_preview=%q raw_truncated=%t raw_error=%q raw_message_json=%s",
		m.cfg.WorkerID,
		firstNonEmpty(skipReason, "none"),
		incomingChatString(evt),
		incomingChatServer(evt),
		incomingSenderString(evt),
		incomingSenderAltString(evt),
		incomingRecipientAltString(evt),
		incomingMessageID(evt),
		incomingServerID(evt),
		incomingFromMe(evt),
		incomingCategory(evt),
		incomingInfoType(evt),
		incomingMediaType(evt),
		incomingEdit(evt),
		incomingMulticast(evt),
		incomingTimestamp(evt),
		incomingRetryCount(evt),
		incomingUnavailableRequestID(evt),
		evt != nil && evt.SourceWebMsg != nil,
		evt != nil && evt.IsEphemeral,
		evt != nil && evt.IsViewOnce,
		evt != nil && evt.IsViewOnceV2,
		evt != nil && evt.IsViewOnceV2Extension,
		evt != nil && evt.IsDocumentWithCaption,
		evt != nil && evt.IsLottieSticker,
		evt != nil && evt.IsBotInvoke,
		evt != nil && evt.IsEdit,
		strings.Join(incomingMessageKinds(evt), ","),
		incomingTextPreview(evt),
		rawTruncated,
		rawErr,
		rawJSON,
	)
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
	if evt == nil || evt.Message == nil {
		return "empty_message"
	}
	if strings.EqualFold(evt.Info.Category, "peer") {
		return "peer_category"
	}
	if evt.SourceWebMsg != nil && evt.UnavailableRequestID == "" {
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
