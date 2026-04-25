package app

import (
	"reflect"
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestBuildPhoneValidationCandidatesMatchesBaileysOrder(t *testing.T) {
	tests := []struct {
		name     string
		ddi      string
		phone    string
		expected []string
	}{
		{
			name:     "brazil input with ninth digit",
			ddi:      "55",
			phone:    "(61) 9 5999-0400",
			expected: []string{"5561959990400", "556159990400"},
		},
		{
			name:     "brazil input without ninth digit",
			ddi:      "55",
			phone:    "6199990400",
			expected: []string{"556199990400", "5561999990400"},
		},
		{
			name:     "non brazil",
			ddi:      "1",
			phone:    "(555) 010-0200",
			expected: []string{"15550100200"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expected := uniqueStrings(tt.expected)
			if got := buildPhoneValidationCandidates(tt.ddi, tt.phone); !reflect.DeepEqual(got, expected) {
				t.Fatalf("unexpected candidates: got %#v want %#v", got, expected)
			}
		})
	}
}

func TestNormalizeValidationJIDMatchesSharedContract(t *testing.T) {
	if got := normalizeValidationJID(types.NewJID("5511999990000", types.LegacyUserServer)); got != "5511999990000@s.whatsapp.net" {
		t.Fatalf("unexpected legacy normalization %q", got)
	}
	if got := normalizeValidationJID(types.JID{User: "5511999990000", Device: 42, Server: types.DefaultUserServer}); got != "5511999990000@s.whatsapp.net" {
		t.Fatalf("unexpected device normalization %q", got)
	}
	if got := normalizeValidationJID(types.NewJID("158733669765176", types.HiddenUserServer)); got != "158733669765176@lid" {
		t.Fatalf("unexpected lid normalization %q", got)
	}
}

func TestPhoneFromJIDStripsDevice(t *testing.T) {
	if got := phoneFromJID("5511999990000:42@s.whatsapp.net"); got != "5511999990000" {
		t.Fatalf("unexpected phone %q", got)
	}
}

func TestReliablePhoneForLIDRequiresCandidateMatch(t *testing.T) {
	lid := types.NewJID("158733669765176", types.HiddenUserServer)
	candidates := []string{"5561959990400", "556159990400"}

	if !isReliablePhoneForLID(lid, "556159990400", candidates) {
		t.Fatal("expected candidate phone to be reliable")
	}
	if isReliablePhoneForLID(types.NewJID("556159990400", types.HiddenUserServer), "556159990400", candidates) {
		t.Fatal("lid-equivalent phone must not be reliable")
	}
	if isReliablePhoneForLID(lid, "5511888887777", candidates) {
		t.Fatal("candidate mismatch must not be reliable")
	}
}
