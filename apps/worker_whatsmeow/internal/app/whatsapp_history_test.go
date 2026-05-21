package app

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
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
