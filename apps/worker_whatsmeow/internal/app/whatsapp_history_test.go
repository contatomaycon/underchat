package app

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/proto/waWeb"
	"go.mau.fi/whatsmeow/types"
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

func TestBuildHistorySyncCandidateFiltersBeforeLimit(t *testing.T) {
	manager := &WhatsAppManager{
		cfg: Config{
			HistoryReconciliationMaxAge: time.Hour,
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
			MessageTimestamp: proto.Uint64(now - 61*60),
		},
	}
	if _, ok := manager.buildHistorySyncCandidate(chatJID, oldIncoming); ok {
		t.Fatalf("messages older than the configured history window must be skipped")
	}
}
