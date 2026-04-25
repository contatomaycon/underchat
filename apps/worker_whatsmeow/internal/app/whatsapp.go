package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
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

type freshLoginRequest struct {
	Type  string
	Phone string
}

func NewWhatsAppManager(ctx context.Context, cfg Config, kafka *KafkaClient, centrifugo *CentrifugoClient, balance *BalanceGRPCClient, storage *StorageClient) (*WhatsAppManager, error) {
	manager := &WhatsAppManager{
		cfg:        cfg,
		kafka:      kafka,
		centrifugo: centrifugo,
		balance:    balance,
		storage:    storage,
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
	if reason := incomingSkipReason(evt); reason != "" {
		log.Printf(
			"whatsmeow incoming message skipped worker_id=%s reason=%s chat=%s sender=%s id=%s from_me=%t category=%s source_web_msg=%t",
			m.cfg.WorkerID,
			reason,
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
	}
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
	callPhone := phoneFromJID(callJID)
	callText := "Ligacao recebida"
	if isVideo {
		callText = "Ligacao de video recebida"
	}
	upsert := UpsertMessage{
		WorkerID:    m.cfg.WorkerID,
		AccountID:   m.cfg.AccountID,
		Type:        MessageTypeSystem,
		HasQuoted:   false,
		IsCallEvent: true,
		CallPhone:   callPhone,
		CallJID:     callJID,
		Message: map[string]any{
			"key": map[string]any{
				"id":        "call_" + firstNonEmpty(callID, fmt.Sprintf("%d", time.Now().UnixMilli())),
				"remoteJid": callJID,
				"fromMe":    false,
			},
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
	key := map[string]any{
		"id":         evt.Info.ID,
		"remoteJid":  evt.Info.Chat.String(),
		"fromMe":     evt.Info.IsFromMe,
		"isViewOnce": evt.IsViewOnce,
	}
	if !evt.Info.Sender.IsEmpty() && evt.Info.Sender != evt.Info.Chat {
		key["participant"] = evt.Info.Sender.String()
	}
	if !evt.Info.SenderAlt.IsEmpty() {
		key["participantAlt"] = evt.Info.SenderAlt.String()
	}

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
		HasQuoted: false,
	}, nil
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
