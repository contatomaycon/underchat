package app

import (
	"context"
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

	mu          sync.RWMutex
	client      *whatsmeow.Client
	connected   bool
	status      string
	code        int
	rejectCalls bool
}

func NewWhatsAppManager(ctx context.Context, cfg Config, kafka *KafkaClient, centrifugo *CentrifugoClient, balance *BalanceGRPCClient, storage *StorageClient) (*WhatsAppManager, error) {
	manager := &WhatsAppManager{
		cfg:        cfg,
		kafka:      kafka,
		centrifugo: centrifugo,
		balance:    balance,
		storage:    storage,
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
		}
	}
	client.AddEventHandler(m.handleEvent)

	m.mu.Lock()
	m.client = client
	m.mu.Unlock()
	return nil
}

func (m *WhatsAppManager) Bootstrap(ctx context.Context) {
	client := m.getClient()
	if client == nil || client.Store.ID == nil {
		return
	}
	go func() {
		m.setState("connecting", CodeAwaitConnection, "")
		if err := client.ConnectContext(ctx); err != nil {
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

func (m *WhatsAppManager) connectWithQRCode(ctx context.Context) error {
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if client.IsConnected() {
		m.publishState(ctx, "connected", CodeConnectionEstablished, WorkerStatusOnline, phoneFromOwnID(client.Store.ID), "", false)
		return nil
	}
	if client.Store.ID != nil {
		m.publishState(ctx, "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", false)
		return client.ConnectContext(ctx)
	}

	qrChan, err := client.GetQRChannel(ctx)
	if err != nil {
		return err
	}
	m.publishState(ctx, "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", "", true)
	if err := client.ConnectContext(ctx); err != nil {
		return err
	}

	go func() {
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				m.publishState(context.Background(), "connecting", CodeAwaitingReadQRCode, WorkerStatusDisponible, "", evt.Code, true)
			case "success":
				m.publishState(context.Background(), "connecting", CodeAwaitConnection, WorkerStatusDisponible, "", "", true)
			case "timeout":
				m.publishState(context.Background(), "disconnected", CodeConnectionClosed, WorkerStatusDisponible, "", "", true)
			default:
				if evt.Error != nil {
					log.Printf("qr event error: %v", evt.Error)
				}
			}
		}
	}()
	return nil
}

func (m *WhatsAppManager) connectWithPhonePairing(ctx context.Context, phone string) error {
	client := m.getClient()
	if client == nil {
		return fmt.Errorf("client is not initialized")
	}
	if phone = digits(phone); phone == "" {
		return fmt.Errorf("phone_connection is required")
	}
	if client.Store.ID != nil {
		return client.ConnectContext(ctx)
	}
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", "", true)
	if !client.IsConnected() {
		if err := client.ConnectContext(ctx); err != nil {
			return err
		}
	}
	pairingCode, err := client.PairPhone(ctx, phone, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return err
	}
	m.publishState(ctx, "connecting", CodeAwaitingPairingCode, WorkerStatusDisponible, "", pairingCode, true)
	return nil
}

func (m *WhatsAppManager) removeSession(ctx context.Context) error {
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
		m.mu.Lock()
		m.connected = false
		m.status = "disconnected"
		m.code = CodeConnectionLost
		m.mu.Unlock()
		m.publishState(context.Background(), "disconnected", CodeConnectionLost, WorkerStatusOffline, "", "", false)
	case *events.LoggedOut:
		m.mu.Lock()
		m.connected = false
		m.status = "disconnected"
		m.code = CodeLoggedOut
		m.mu.Unlock()
		m.publishState(context.Background(), "disconnected", CodeLoggedOut, WorkerStatusDisponible, "", "", false)
	case *events.StreamReplaced:
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
	_ = m.centrifugo.Publish(ctx, workerCentrifugoQueue(m.cfg.AccountID), state)
	if workerStatusID == WorkerStatusOnline || workerStatusID == WorkerStatusOffline || workerStatusID == WorkerStatusDisponible {
		_ = m.balance.NotifyWorkerStatus(ctx, state)
	}
}

func (m *WhatsAppManager) handleIncomingMessage(ctx context.Context, evt *events.Message) {
	upsert, err := m.buildIncomingUpsert(ctx, evt)
	if err != nil {
		log.Printf("failed to map incoming message: %v", err)
		return
	}
	if upsert == nil {
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
	if evt.Message == nil {
		return nil, nil
	}
	messageMap := map[string]any{}
	if raw, err := protojson.Marshal(evt.Message); err == nil {
		_ = json.Unmarshal(raw, &messageMap)
	}

	messageType, content := m.incomingContent(ctx, evt)
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
