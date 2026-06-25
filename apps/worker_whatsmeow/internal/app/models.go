package app

import "time"

const (
	WorkerTypeWhatsmeow = "e80ad183-2b46-4628-9105-a036f2d28720"

	WorkerStatusOnline     = "019a930d-c6f6-766d-9c84-30af6ecc33b2"
	WorkerStatusOffline    = "019a930d-c6f6-766d-9c84-3696c2cd5ed8"
	WorkerStatusDisponible = "019a930d-c6f6-766d-9c84-3904383fe742"
	WorkerStatusError      = "019a930d-c6f6-766d-9c84-48cb970a9f21"
	WorkerStatusMismatched = "019a930d-c6f6-766d-9c84-5056ccf66633"

	CodeConnectionEstablished = 200
	CodeAwaitingReadQRCode    = 202
	CodeAwaitConnection       = 203
	CodeAwaitingPairingCode   = 204
	CodeLogoutInProgress      = 205
	CodePairingInProgress     = 206
	CodeLoggedOut             = 401
	CodeConnectionLost        = 408
	CodeConnectionClosed      = 428
	CodeConnectionReplaced    = 440
	CodeUnavailableService    = 503
	CodeInfo                  = 1000
)

const (
	MessageTypeText                    = "text"
	MessageTypeLocation                = "location"
	MessageTypeContact                 = "contact_card"
	MessageTypeContacts                = "contacts"
	MessageTypeReact                   = "react"
	MessageTypeImage                   = "image"
	MessageTypeVideo                   = "video"
	MessageTypeVideoNote               = "video_note"
	MessageTypeAudio                   = "audio"
	MessageTypeSticker                 = "sticker"
	MessageTypeDocument                = "document"
	MessageTypeViewOnce                = "view_once"
	MessageTypeDelete                  = "delete_message"
	MessageTypeEditText                = "edit_text"
	MessageTypeSetDisappearingMessages = "set_disappearing_messages"
	MessageTypeSystem                  = "system"
)

const (
	WorkerProfileStatusTypeText  = "019a9d00-0001-7000-8000-000000000001"
	WorkerProfileStatusTypeImage = "019a9d00-0002-7000-8000-000000000002"
	WorkerProfileStatusTypeVideo = "019a9d00-0003-7000-8000-000000000003"
	WorkerProfileStatusTypeAudio = "019a9d00-0004-7000-8000-000000000004"
)

type ConnectionState struct {
	Code                    int    `json:"code"`
	Status                  string `json:"status"`
	WorkerID                string `json:"worker_id"`
	AccountID               string `json:"account_id"`
	WorkerTypeID            string `json:"worker_type_id,omitempty"`
	QRCode                  string `json:"qrcode,omitempty"`
	IsNewLogin              bool   `json:"is_new_login,omitempty"`
	Time                    int64  `json:"time,omitempty"`
	Phone                   string `json:"phone,omitempty"`
	DisconnectedUser        bool   `json:"disconnected_user,omitempty"`
	PairingCode             string `json:"pairing_code,omitempty"`
	SecondsUntilNextAttempt int    `json:"seconds_until_next_attempt,omitempty"`
	WorkerStatusID          string `json:"worker_status_id,omitempty"`
	Attempt                 int    `json:"attempt,omitempty"`
	MaxAttempts             int    `json:"max_attempts,omitempty"`
	ConnectionAttemptID     string `json:"connection_attempt_id,omitempty"`
	QRPending               bool   `json:"qr_pending,omitempty"`
	QRGeneratedAt           string `json:"qr_generated_at,omitempty"`
	ExpiresAt               string `json:"expires_at,omitempty"`
	Reason                  string `json:"reason,omitempty"`
	Error                   string `json:"error,omitempty"`
	TimeToFirstQRMS         int    `json:"time_to_first_qr_ms,omitempty"`
	ContainerID             string `json:"container_id,omitempty"`
	RuntimeGeneration       int    `json:"runtime_generation,omitempty"`
	WarmPoolID              string `json:"warm_pool_id,omitempty"`
	ProxyStatus             string `json:"proxy_status,omitempty"`
	ProxyErrorCode          string `json:"proxy_error_code,omitempty"`
	ProxyFallback           string `json:"proxy_fallback,omitempty"`
	ProxyBypassed           bool   `json:"proxy_bypassed,omitempty"`
	DebugTraceID            string `json:"debug_trace_id,omitempty"`
	SessionReady            bool   `json:"session_ready,omitempty"`
	CanSend                 bool   `json:"can_send,omitempty"`
	CanReceiveRuntime       bool   `json:"can_receive_runtime,omitempty"`
	Authenticated           bool   `json:"authenticated,omitempty"`
	ProviderState           string `json:"provider_state,omitempty"`
	DegradedReason          string `json:"degraded_reason,omitempty"`
	LastProbeAt             string `json:"last_probe_at,omitempty"`
	ProbeLatencyMS          int    `json:"probe_latency_ms,omitempty"`
}

type StatusConnectionRequest struct {
	WorkerID            string `json:"worker_id"`
	Status              string `json:"status"`
	Type                string `json:"type"`
	PhoneConnection     string `json:"phone_connection"`
	RemoveSession       bool   `json:"remove_session"`
	ConnectionAttemptID string `json:"connection_attempt_id"`
	RuntimeGeneration   int    `json:"runtime_generation"`
	WarmPoolID          string `json:"warm_pool_id"`
	DebugTraceID        string `json:"debug_trace_id"`
}

type WorkerConnectionQRCodeQueueMessage struct {
	RequestID           string `json:"request_id"`
	ConnectionAttemptID string `json:"connection_attempt_id"`
	WorkerID            string `json:"worker_id"`
	AccountID           string `json:"account_id"`
	WorkerTypeID        string `json:"worker_type_id"`
	RuntimeGeneration   int    `json:"runtime_generation,omitempty"`
	Source              string `json:"source"`
	RequestedAt         string `json:"requested_at"`
	ExpiresAt           string `json:"expires_at,omitempty"`
	DebugTraceID        string `json:"debug_trace_id,omitempty"`
}

type PhoneValidationRequest struct {
	RequestID string `json:"request_id"`
	AccountID string `json:"account_id"`
	WorkerID  string `json:"worker_id"`
	Phone     string `json:"phone"`
	PhoneDDI  string `json:"phone_ddi"`
}

type PhoneValidationResponse struct {
	RequestID string `json:"request_id"`
	AccountID string `json:"account_id"`
	WorkerID  string `json:"worker_id"`
	Valid     bool   `json:"valid"`
	JID       string `json:"jid,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Error     string `json:"error,omitempty"`
}

type WorkerRuntimeActivationRequest struct {
	WorkerID          string `json:"worker_id"`
	AccountID         string `json:"account_id"`
	WorkerTypeID      string `json:"worker_type_id"`
	WarmPoolID        string `json:"warm_pool_id"`
	SessionVolumeName string `json:"session_volume_name"`
	BalancerGRPCHost  string `json:"balancer_grpc_host"`
	BalancerGRPCPort  int    `json:"balancer_grpc_port"`
	RuntimeGeneration int    `json:"runtime_generation,omitempty"`
}

type WorkerRuntimeActivationResponse struct {
	Activated     bool   `json:"activated"`
	AlreadyActive bool   `json:"already_active,omitempty"`
	WorkerID      string `json:"worker_id,omitempty"`
	AccountID     string `json:"account_id,omitempty"`
	WarmPoolID    string `json:"warm_pool_id,omitempty"`
	Error         string `json:"error,omitempty"`
}

type WorkerRuntimeHealthRequest struct {
	WorkerID   string `json:"worker_id"`
	WarmPoolID string `json:"warm_pool_id"`
}

type WorkerRuntimeHealthResponse struct {
	Ready             bool   `json:"ready"`
	Standby           bool   `json:"standby"`
	Activated         bool   `json:"activated"`
	WorkerID          string `json:"worker_id,omitempty"`
	AccountID         string `json:"account_id,omitempty"`
	WarmPoolID        string `json:"warm_pool_id,omitempty"`
	HasSession        bool   `json:"has_session,omitempty"`
	HasQR             bool   `json:"has_qr,omitempty"`
	WorkerTypeID      string `json:"worker_type_id,omitempty"`
	RuntimeGeneration int    `json:"runtime_generation,omitempty"`
	RuntimeState      string `json:"runtime_state,omitempty"`
	QRStreamReady     bool   `json:"qr_stream_ready,omitempty"`
	SessionReady      bool   `json:"session_ready,omitempty"`
	CanSend           bool   `json:"can_send,omitempty"`
	CanReceiveRuntime bool   `json:"can_receive_runtime,omitempty"`
	Authenticated     bool   `json:"authenticated,omitempty"`
	ProviderState     string `json:"provider_state,omitempty"`
	DegradedReason    string `json:"degraded_reason,omitempty"`
	LastProbeAt       string `json:"last_probe_at,omitempty"`
	ProbeLatencyMS    int    `json:"probe_latency_ms,omitempty"`
	Error             string `json:"error,omitempty"`
}

type MessageKey struct {
	RemoteJID       string `json:"remote_jid,omitempty"`
	RemoteJIDAlt    string `json:"remote_jid_alt,omitempty"`
	RemoteJIDC      string `json:"remoteJid,omitempty"`
	RemoteJIDAltC   string `json:"remoteJidAlt,omitempty"`
	FromMe          *bool  `json:"from_me,omitempty"`
	FromMeC         *bool  `json:"fromMe,omitempty"`
	ID              string `json:"id,omitempty"`
	Participant     string `json:"participant,omitempty"`
	ParticipantAlt  string `json:"participant_alt,omitempty"`
	ParticipantAltC string `json:"participantAlt,omitempty"`
	IsViewOnce      bool   `json:"is_view_once,omitempty"`
	IsViewOnceC     bool   `json:"isViewOnce,omitempty"`
	AddressingMode  string `json:"addressing_mode,omitempty"`
}

func (k MessageKey) Remote() string {
	if k.RemoteJID != "" {
		return k.RemoteJID
	}
	if k.RemoteJIDC != "" {
		return k.RemoteJIDC
	}
	if k.RemoteJIDAlt != "" {
		return k.RemoteJIDAlt
	}
	return k.RemoteJIDAltC
}

func (k MessageKey) FromMeValue() bool {
	if k.FromMe != nil {
		return *k.FromMe
	}
	if k.FromMeC != nil {
		return *k.FromMeC
	}
	return false
}

func firstNonZero(values ...int) int {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

type ChatMessage struct {
	MessageID  string         `json:"message_id"`
	ChatID     string         `json:"chat_id"`
	MessageKey *MessageKey    `json:"message_key"`
	TypeUser   string         `json:"type_user"`
	Account    map[string]any `json:"account"`
	Worker     map[string]any `json:"worker"`
	User       map[string]any `json:"user"`
	Phone      string         `json:"phone"`
	PhoneDDI   string         `json:"phone_ddi"`
	Content    map[string]any `json:"content"`
	Summary    map[string]any `json:"summary"`
	Date       string         `json:"date"`
	Deleted    bool           `json:"deleted"`
	HasQuoted  bool           `json:"has_quoted"`
	Hash       string         `json:"hash"`
	Raw        map[string]any `json:"-"`
}

type ProfileStatusMessage struct {
	WorkerID                  string         `json:"worker_id"`
	AccountID                 string         `json:"account_id"`
	WorkerProfileStatusID     string         `json:"worker_profile_status_id"`
	WorkerProfileStatusTypeID string         `json:"worker_profile_status_type_id"`
	Value                     string         `json:"value"`
	IsPermanent               bool           `json:"is_permanent"`
	StatusJIDList             []string       `json:"statusJidList,omitempty"`
	Raw                       map[string]any `json:"-"`
}

type ProfileStatusDeleteMessage struct {
	WorkerID              string         `json:"worker_id"`
	AccountID             string         `json:"account_id"`
	WorkerProfileStatusID string         `json:"worker_profile_status_id"`
	ExternalID            string         `json:"external_id"`
	StatusJIDList         []string       `json:"statusJidList,omitempty"`
	Raw                   map[string]any `json:"-"`
}

type ProfileInfoMessage struct {
	WorkerID     string         `json:"worker_id"`
	AccountID    string         `json:"account_id"`
	Name         string         `json:"name,omitempty"`
	Message      string         `json:"message,omitempty"`
	Photo        string         `json:"photo,omitempty"`
	PhotoPresent bool           `json:"-"`
	PhotoRemove  bool           `json:"-"`
	Raw          map[string]any `json:"-"`
}

type ScheduleMessage struct {
	ScheduleID  string      `json:"schedule_id"`
	AccountID   string      `json:"account_id,omitempty"`
	ContactID   string      `json:"contact_id"`
	Message     ChatMessage `json:"message"`
	IsValidated bool        `json:"is_validated"`
}

type ScheduleStatusUpdate struct {
	ScheduleID  string `json:"schedule_id"`
	ContactID   string `json:"contact_id"`
	MessageID   string `json:"message_id"`
	ProcessedAt string `json:"processed_at,omitempty"`
	Status      string `json:"status"`
}

type NotificationMessage struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	NotificationID string `json:"notification_id"`
	MessageKey     struct {
		RemoteJID   string `json:"remote_jid"`
		PhoneDDI    string `json:"phone_ddi"`
		PhoneNumber string `json:"phone_number"`
	} `json:"message_key"`
	Account         map[string]any `json:"account"`
	Worker          map[string]any `json:"worker"`
	MessageWhatsApp string         `json:"message_whatsapp"`
}

type WorkerConfigUpdateEvent struct {
	WorkerID   string `json:"worker_id"`
	RejectCall *bool  `json:"reject_call"`
}

type TypingSimulationConfig struct {
	Enabled bool `json:"enabled"`
	Speed   int  `json:"speed"`
}

type MarkReadRequest struct {
	AccountID string       `json:"account_id"`
	WorkerID  string       `json:"worker_id"`
	Keys      []MessageKey `json:"keys"`
}

type UpsertMessage struct {
	WorkerID             string         `json:"worker_id"`
	AccountID            string         `json:"account_id"`
	SourceProvider       string         `json:"source_provider,omitempty"`
	Type                 string         `json:"type"`
	Message              map[string]any `json:"message"`
	Content              map[string]any `json:"content,omitempty"`
	Photo                string         `json:"photo,omitempty"`
	HasQuoted            bool           `json:"has_quoted"`
	IsCallEvent          bool           `json:"is_call_event,omitempty"`
	CallPhone            string         `json:"call_phone,omitempty"`
	CallJID              string         `json:"call_jid,omitempty"`
	CallJIDAlt           string         `json:"call_jid_alt,omitempty"`
	CallName             string         `json:"call_name,omitempty"`
	WebhookMessageType   string         `json:"webhook_message_type,omitempty"`
	WebhookChatbotID     string         `json:"webhook_chatbot_id,omitempty"`
	TransferSectorID     string         `json:"transfer_sector_id,omitempty"`
	TransferSectorUserID string         `json:"transfer_sector_user_id,omitempty"`
	TransferUserID       string         `json:"transfer_user_id,omitempty"`
	FromHistorySync      bool           `json:"from_history_sync,omitempty"`
}

type UpdateMessage struct {
	Message map[string]any `json:"message"`
	Data    ChatMessage    `json:"data"`
}

type MessageStatusUpdate struct {
	AccountID string         `json:"account_id"`
	MessageID string         `json:"message_id"`
	Patch     map[string]any `json:"patch"`
	Key       map[string]any `json:"key,omitempty"`
}

type S3BackupFallbackUpload struct {
	AccountID       string `json:"account_id"`
	Bucket          string `json:"bucket"`
	ObjectKey       string `json:"object_key"`
	FileName        string `json:"file_name"`
	ContentType     string `json:"content_type"`
	SizeBytes       int64  `json:"size_bytes"`
	PrimaryAttempts int32  `json:"primary_attempts"`
	BackupAttempts  int32  `json:"backup_attempts"`
	PrimaryError    string `json:"primary_error"`
	BackupError     string `json:"backup_error"`
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
