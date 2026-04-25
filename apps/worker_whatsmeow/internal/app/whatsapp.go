package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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
	whatsmeowPhotoCachePrefix     = "photo:jid:"
	whatsmeowPhotoCacheNoPhoto    = "__no_photo__"
	whatsmeowPhotoCacheTTL        = 24 * time.Hour
	whatsmeowPhotoCacheNoPhotoTTL = 5 * time.Minute
	whatsmeowPhotoFetchTimeout    = 5 * time.Second
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

func (m *WhatsAppManager) initClient(ctx context.Context) error {
	storeDir := filepath.Join(m.cfg.DataDir, "whatsmeow", m.cfg.WorkerID)
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

	if req.RemoveSession {
		return m.removeSession(ctx)
	}

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
	phone := digits(req.PhoneDDI + req.Phone)
	if phone == "" {
		resp.Error = "phone is required"
		return resp, nil
	}
	client := m.getClient()
	if client == nil {
		resp.Error = "client is not initialized"
		return resp, nil
	}
	results, err := client.IsOnWhatsApp(ctx, []string{"+" + phone})
	if err != nil {
		resp.Error = err.Error()
		return resp, nil
	}
	if len(results) == 0 || !results[0].IsIn {
		resp.Valid = false
		resp.Phone = phone
		return resp, nil
	}
	resp.Valid = true
	resp.JID = results[0].JID.String()
	resp.Phone = phone
	return resp, nil
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
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	connectCtx := m.connectionContext()
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow qrcode request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
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
		return err
	}
	m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
	if err := m.connectClient(connectCtx, client, "qrcode-new-login"); err != nil {
		return err
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
				log.Printf("whatsmeow qr pairing success worker_id=%s", m.cfg.WorkerID)
				m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
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
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	connectCtx := m.connectionContext()
	if phone = digits(phone); phone == "" {
		return fmt.Errorf("phone_connection is required")
	}
	if m.isAuthenticated(client) {
		log.Printf("whatsmeow phone pairing request already authenticated worker_id=%s", m.cfg.WorkerID)
		m.clearFreshLoginFallback()
		m.clearLoginArtifacts()
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
			return err
		}
	}
	pairingCode, err := client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		log.Printf("whatsmeow phone pairing failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return err
	}
	m.setCurrentPairingCode(pairingCode)
	log.Printf("whatsmeow phone pairing code generated worker_id=%s", m.cfg.WorkerID)
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", pairingCode, true)
	return nil
}

func (m *WhatsAppManager) removeSession(ctx context.Context) error {
	log.Printf("whatsmeow remove session requested worker_id=%s", m.cfg.WorkerID)
	m.clearFreshLoginFallback()
	m.clearLoginArtifacts()
	client := m.getClient()
	if client != nil {
		if client.IsConnected() || client.IsLoggedIn() {
			_ = client.Logout(ctx)
		}
		client.Disconnect()
	}
	m.mu.Lock()
	m.connected = false
	m.mu.Unlock()
	m.publishState(ctx, "disconnected", CodeLoggedOut, WorkerStatusDisponible, "", "", false)
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
		m.publishState(context.Background(), "disconnected", CodeLoggedOut, WorkerStatusDisponible, "", "", false)
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
	client := m.getClient()
	if client != nil {
		client.Disconnect()
		if client.Store != nil && client.Store.ID != nil && !client.Store.Deleted {
			log.Printf("whatsmeow deleting stale local store worker_id=%s", m.cfg.WorkerID)
			if err := client.Store.Delete(ctx); err != nil {
				return fmt.Errorf("delete stale whatsmeow store: %w", err)
			}
		}
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
	log.Printf(
		"whatsmeow incoming message published worker_id=%s topic=%s key=%s type=%s chat=%s remote_jid_alt=%s sender=%s id=%s from_me=%t has_photo=%t",
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

func (m *WhatsAppManager) publishPresence(ctx context.Context, evt *events.ChatPresence) {
	payload := map[string]any{
		"worker_id":  m.cfg.WorkerID,
		"account_id": m.cfg.AccountID,
		"chat_jid":   evt.Chat.String(),
		"sender_jid": evt.Sender.String(),
		"state":      string(evt.State),
		"media":      string(evt.Media),
		"provider":   "whatsmeow",
	}
	_ = m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), payload)
}

func (m *WhatsAppManager) buildIncomingUpsert(ctx context.Context, evt *events.Message) (*UpsertMessage, error) {
	if incomingSkipReason(evt) != "" {
		return nil, nil
	}
	messageMap := map[string]any{}
	if raw, err := protojson.Marshal(evt.Message); err == nil {
		_ = json.Unmarshal(raw, &messageMap)
	}

	messageType, content := m.incomingContent(ctx, evt)
	if messageType == "" {
		return nil, nil
	}
	key := m.buildIncomingMessageKey(evt)
	photo := m.incomingProfilePhoto(ctx, evt)

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
		HasQuoted: false,
	}, nil
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
		log.Printf("whatsmeow profile photo fetched worker_id=%s jid=%s photo_id=%s", m.cfg.WorkerID, jid.String(), info.ID)
		return photo
	}
	return ""
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
