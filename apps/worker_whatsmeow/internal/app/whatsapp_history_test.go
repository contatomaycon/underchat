package app

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestSelectLatestHistorySyncCandidatesLimitsGloballyAndReturnsChronologically(t *testing.T) {
	chatA := types.NewJID("5511999999999", types.DefaultUserServer)
	chatB := types.NewJID("5511888888888", types.DefaultUserServer)

	candidates := make([]historySyncCandidate, 0, 105)
	for i := 0; i < 105; i++ {
		chatJID := chatA
		if i%2 == 1 {
			chatJID = chatB
		}
		candidates = append(candidates, historySyncCandidate{
			chatJID:   chatJID,
			timestamp: uint64(1000 + i),
		})
	}

	selected := selectLatestHistorySyncCandidates(candidates, 100)

	if len(selected) != 100 {
		t.Fatalf("expected 100 candidates, got %d", len(selected))
	}
	if selected[0].timestamp != 1005 {
		t.Fatalf("expected first timestamp 1005, got %d", selected[0].timestamp)
	}
	if selected[len(selected)-1].timestamp != 1104 {
		t.Fatalf("expected last timestamp 1104, got %d", selected[len(selected)-1].timestamp)
	}
	for i := 1; i < len(selected); i++ {
		if selected[i].timestamp < selected[i-1].timestamp {
			t.Fatalf("candidates must be chronological at index %d", i)
		}
	}
}

func TestHistorySyncCandidateSelectorRemainsBoundedWhileScanning(t *testing.T) {
	selector := newHistorySyncCandidateSelector(10)
	for i := 0; i < 10_000; i++ {
		selector.Add(historySyncCandidate{timestamp: uint64(i)})
		if selector.candidates.Len() > 10 {
			t.Fatalf("selector grew past its bound at item %d: %d", i, selector.candidates.Len())
		}
	}
	selected := selector.Selected()
	if len(selected) != 10 || selected[0].timestamp != 9990 || selected[9].timestamp != 9999 {
		t.Fatalf("selector retained the wrong newest window: %#v", selected)
	}
}

func TestHistorySyncCandidateSelectorNormalizesSecondAndMillisecondTimestamps(t *testing.T) {
	selector := newHistorySyncCandidateSelector(1)
	selector.Add(historySyncCandidate{timestamp: 1_784_570_400_000})
	selector.Add(historySyncCandidate{timestamp: 1_784_570_401})
	selected := selector.Selected()
	if len(selected) != 1 || selected[0].timestamp != 1_784_570_401 {
		t.Fatalf("mixed timestamp units selected the wrong newest event: %#v", selected)
	}
}

func TestBoundedHistoryWindowsKeepNewestEdgeInEitherOrder(t *testing.T) {
	message := func(timestamp uint64) *waHistorySync.HistorySyncMsg {
		return &waHistorySync.HistorySyncMsg{Message: &waWeb.WebMessageInfo{MessageTimestamp: proto.Uint64(timestamp)}}
	}
	ascending := make([]*waHistorySync.HistorySyncMsg, 0, 100)
	descending := make([]*waHistorySync.HistorySyncMsg, 0, 100)
	for timestamp := uint64(1); timestamp <= 100; timestamp++ {
		ascending = append(ascending, message(timestamp))
		descending = append([]*waHistorySync.HistorySyncMsg{message(timestamp)}, descending...)
	}
	ascendingWindow := boundedHistoryMessages(ascending, 10)
	if len(ascendingWindow) != 10 || historySyncMessageTimestamp(ascendingWindow[0]) != 91 || historySyncMessageTimestamp(ascendingWindow[9]) != 100 {
		t.Fatalf("ascending history retained the wrong edge: first=%d last=%d", historySyncMessageTimestamp(ascendingWindow[0]), historySyncMessageTimestamp(ascendingWindow[9]))
	}
	descendingWindow := boundedHistoryMessages(descending, 10)
	if len(descendingWindow) != 10 || historySyncMessageTimestamp(descendingWindow[0]) != 100 || historySyncMessageTimestamp(descendingWindow[9]) != 91 {
		t.Fatalf("descending history retained the wrong edge: first=%d last=%d", historySyncMessageTimestamp(descendingWindow[0]), historySyncMessageTimestamp(descendingWindow[9]))
	}

	ascendingConversations := make([]*waHistorySync.Conversation, 0, 100)
	descendingConversations := make([]*waHistorySync.Conversation, 0, 100)
	for timestamp := uint64(1); timestamp <= 100; timestamp++ {
		conversation := &waHistorySync.Conversation{LastMsgTimestamp: proto.Uint64(timestamp)}
		ascendingConversations = append(ascendingConversations, conversation)
		descendingConversations = append([]*waHistorySync.Conversation{conversation}, descendingConversations...)
	}
	if got := boundedHistoryConversations(ascendingConversations, 10); len(got) != 10 || got[0].GetLastMsgTimestamp() != 91 {
		t.Fatalf("ascending conversations retained the wrong edge: %#v", got)
	}
	if got := boundedHistoryConversations(descendingConversations, 10); len(got) != 10 || got[0].GetLastMsgTimestamp() != 100 {
		t.Fatalf("descending conversations retained the wrong edge: %#v", got)
	}
}

func TestHistorySyncSchedulerCoalescesBurstWithoutConcurrentRuns(t *testing.T) {
	manager := &WhatsAppManager{}
	first := &events.HistorySync{}
	middle := &events.HistorySync{}
	latest := &events.HistorySync{}
	started := make(chan *events.HistorySync, 3)
	releaseFirst := make(chan struct{})
	var calls atomic.Int32
	var active atomic.Int32
	var maxActive atomic.Int32
	manager.historyRunner = func(_ context.Context, event *events.HistorySync) {
		call := calls.Add(1)
		concurrent := active.Add(1)
		for {
			maximum := maxActive.Load()
			if concurrent <= maximum || maxActive.CompareAndSwap(maximum, concurrent) {
				break
			}
		}
		started <- event
		if call == 1 {
			<-releaseFirst
		}
		active.Add(-1)
	}

	manager.scheduleHistorySync(context.Background(), first)
	select {
	case got := <-started:
		if got != first {
			t.Fatalf("first scheduled event changed: got=%p want=%p", got, first)
		}
	case <-time.After(time.Second):
		t.Fatal("first history sync did not start")
	}
	manager.scheduleHistorySync(context.Background(), middle)
	manager.scheduleHistorySync(context.Background(), latest)
	close(releaseFirst)

	select {
	case got := <-started:
		if got != latest {
			t.Fatalf("pending burst was not coalesced to latest: got=%p middle=%p latest=%p", got, middle, latest)
		}
	case <-time.After(time.Second):
		t.Fatal("coalesced history sync did not run")
	}
	deadline := time.Now().Add(time.Second)
	for {
		manager.historySyncMu.Lock()
		running := manager.historySyncRunning
		pending := manager.historyPending
		manager.historySyncMu.Unlock()
		if !running && pending == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("history sync scheduler did not become idle")
		}
		time.Sleep(time.Millisecond)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("history burst ran %d jobs, want active + latest pending", got)
	}
	if got := maxActive.Load(); got != 1 {
		t.Fatalf("history sync jobs overlapped: max concurrency=%d", got)
	}
}

func TestHistorySyncSingleFlightSerializesOneConnectionScope(t *testing.T) {
	scope := whatsAppRuntimeFence{
		State:              "active",
		WorkerID:           "worker-1",
		RuntimeGeneration:  7,
		ConnectionEpoch:    "epoch-7",
		ConnectionSequence: 1,
		SourceProvider:     "whatsmeow",
		ActivatedAt:        time.Now().UnixMilli(),
		ActivationOrder:    1,
	}
	manager := &WhatsAppManager{
		cfg:                    Config{WorkerID: "worker-1", RuntimeGeneration: 7},
		inboundConnectionScope: &scope,
	}
	ctx := withInboundConnectionScope(context.Background(), scope)
	firstRelease, ok := manager.acquireHistorySync(ctx)
	if !ok {
		t.Fatal("first history sync did not acquire the gate")
	}

	acquired := make(chan func(), 1)
	go func() {
		release, acquiredOK := manager.acquireHistorySync(ctx)
		if acquiredOK {
			acquired <- release
		}
	}()
	select {
	case release := <-acquired:
		release()
		t.Fatal("second history sync ran concurrently in the same scope")
	case <-time.After(25 * time.Millisecond):
	}
	firstRelease()
	select {
	case release := <-acquired:
		release()
	case <-time.After(time.Second):
		t.Fatal("queued history sync did not proceed after the first released")
	}
}

func TestHistoryMediaReplayKeepsMetadataWithoutDownloadingOrUploading(t *testing.T) {
	chat := types.NewJID("5511999999999", types.DefaultUserServer)
	evt := incomingTextEvent(chat, false, "")
	evt.Info.ID = "history-image-1"
	evt.Message = &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			Caption:       proto.String("foto antiga"),
			Mimetype:      proto.String("image/jpeg"),
			Width:         proto.Uint32(640),
			Height:        proto.Uint32(480),
			JPEGThumbnail: []byte("must-not-be-copied"),
		},
	}
	manager := &WhatsAppManager{cfg: Config{WorkerID: "worker-1", AccountID: "account-1"}}

	upsert, err := manager.buildIncomingUpsert(context.Background(), evt, true)
	if err != nil {
		t.Fatalf("build history upsert: %v", err)
	}
	if upsert == nil || upsert.Type != MessageTypeImage {
		t.Fatalf("unexpected history image upsert: %#v", upsert)
	}
	if upsert.Photo != "" {
		t.Fatalf("history replay unexpectedly fetched a profile photo: %q", upsert.Photo)
	}
	if omitted, _ := upsert.Content["history_media_omitted"].(bool); !omitted {
		t.Fatalf("history media omission was not explicit: %#v", upsert.Content)
	}
	image := asMap(upsert.Content["image"])
	if stringValue(image["url"]) != "" || image["thumbnail"] != nil || image["media_download_failed"] != nil {
		t.Fatalf("history replay enriched media bytes before dedupe: %#v", image)
	}
	if image["width"] != 640 || image["height"] != 480 || stringValue(image["caption"]) != "foto antiga" {
		t.Fatalf("history replay lost lightweight metadata: %#v", image)
	}
	rawImage := asMap(asMap(upsert.Message["message"])["imageMessage"])
	if rawImage["jpegThumbnail"] != nil || rawImage["url"] != nil || rawImage["directPath"] != nil {
		t.Fatalf("history raw payload retained media transport fields: %#v", rawImage)
	}

	evt.IsViewOnce = true
	viewOnceUpsert, err := manager.buildIncomingUpsert(context.Background(), evt, true)
	if err != nil {
		t.Fatalf("build view-once history upsert: %v", err)
	}
	if viewOnceUpsert == nil || viewOnceUpsert.Type != MessageTypeViewOnce {
		t.Fatalf("view-once history semantics were lost: %#v", viewOnceUpsert)
	}
	if omitted, _ := viewOnceUpsert.Content["history_media_omitted"].(bool); !omitted {
		t.Fatalf("view-once history media was not omitted: %#v", viewOnceUpsert.Content)
	}
}

func TestHistoryPayloadScrubbingPreservesTextualLinks(t *testing.T) {
	payload := map[string]any{
		"cta": map[string]any{"url": "https://example.com/help"},
		"image": map[string]any{
			"url":           "https://provider.invalid/media",
			"directPath":    "/temporary/media",
			"jpegThumbnail": "base64-thumbnail",
			"caption":       "foto",
		},
	}
	stripHistoryMediaTransportFields(payload)
	if got := stringValue(asMap(payload["cta"])["url"]); got != "https://example.com/help" {
		t.Fatalf("textual URL was removed: %q", got)
	}
	image := asMap(payload["image"])
	if image["url"] != nil || image["directPath"] != nil || image["jpegThumbnail"] != nil {
		t.Fatalf("media transport survived history scrub: %#v", image)
	}
	if stringValue(image["caption"]) != "foto" {
		t.Fatalf("media metadata was removed: %#v", image)
	}
}

func TestBuildHistorySyncCandidateFiltersBeforeLimit(t *testing.T) {
	activatedAt := time.Now().Add(-time.Minute).UnixMilli()
	manager := &WhatsAppManager{
		cfg: Config{WorkerID: "worker-1", RuntimeGeneration: 7},
		inboundConnectionScope: &whatsAppRuntimeFence{
			State:              "active",
			WorkerID:           "worker-1",
			RuntimeGeneration:  7,
			ConnectionEpoch:    "epoch-7",
			ConnectionSequence: 1,
			SourceProvider:     "whatsmeow",
			ActivatedAt:        activatedAt,
			ActivationOrder:    1,
		},
	}
	chatJID := types.NewJID("5511999999999", types.DefaultUserServer)
	now := uint64(time.Now().Unix())

	recentIncoming := &waHistorySync.HistorySyncMsg{
		Message: &waWeb.WebMessageInfo{
			Key: &waCommon.MessageKey{
				FromMe: proto.Bool(false),
			},
			MessageTimestamp: proto.Uint64(now - 30),
		},
	}
	candidate, ok := manager.buildHistorySyncCandidate(chatJID, recentIncoming)
	if !ok {
		t.Fatalf("expected recent incoming message to be eligible")
	}
	if candidate.timestamp != now-30 {
		t.Fatalf("expected timestamp %d, got %d", now-30, candidate.timestamp)
	}

	preConnectionIncoming := &waHistorySync.HistorySyncMsg{
		Message: &waWeb.WebMessageInfo{
			Key: &waCommon.MessageKey{
				FromMe: proto.Bool(false),
			},
			MessageTimestamp: proto.Uint64(now - 2*60*60),
		},
	}
	preConnectionCandidate, ok := manager.buildHistorySyncCandidate(chatJID, preConnectionIncoming)
	if !ok {
		t.Fatalf("messages from before the current connection must remain eligible inside the six hour window")
	}
	if !manager.isUpsertWithinConnectionCutoff(&UpsertMessage{
		FromHistorySync: true,
		Message: map[string]any{
			"messageTimestamp": preConnectionCandidate.timestamp,
		},
	}, *manager.inboundConnectionScope) {
		t.Fatalf("eligible pre-connection history must also pass the final inbound spool cutoff")
	}

	ownMessage := &waHistorySync.HistorySyncMsg{
		Message: &waWeb.WebMessageInfo{
			Key: &waCommon.MessageKey{
				FromMe: proto.Bool(true),
			},
			MessageTimestamp: proto.Uint64(now - 20),
		},
	}
	if _, ok := manager.buildHistorySyncCandidate(chatJID, ownMessage); ok {
		t.Fatalf("own messages must not count against the history limit")
	}

	oldIncoming := &waHistorySync.HistorySyncMsg{
		Message: &waWeb.WebMessageInfo{
			Key: &waCommon.MessageKey{
				FromMe: proto.Bool(false),
			},
			MessageTimestamp: proto.Uint64(now - 6*60*60 - 60),
		},
	}
	if _, ok := manager.buildHistorySyncCandidate(chatJID, oldIncoming); ok {
		t.Fatalf("messages older than the six hour reconciliation window must be skipped")
	}
}
