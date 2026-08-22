package app

import "testing"

func TestInboundEventIdentityPrefersPhoneParticipantOverLID(t *testing.T) {
	first := inboundIdentityFixture("group-stanza-1")
	firstKey := first.Message["key"].(map[string]any)
	firstKey["remoteJid"] = "120363000000000000@g.us"
	firstKey["participant"] = "5511999999999:7@s.whatsapp.net"
	firstKey["participantAlt"] = "158733669765176@lid"

	second := inboundIdentityFixture("group-stanza-1")
	secondKey := second.Message["key"].(map[string]any)
	secondKey["remoteJid"] = "120363000000000000@g.us"
	secondKey["participant"] = "158733669765176@lid"
	secondKey["participantAlt"] = "5511999999999@s.whatsapp.net"

	firstID := ensureInboundEventIdentity(&first, "incoming_message")
	secondID := ensureInboundEventIdentity(&second, "incoming_message")
	if firstID == "" {
		t.Fatal("expected a physical inbound event id")
	}
	if firstID != secondID {
		t.Fatalf("phone/LID participant variants diverged: %s != %s", firstID, secondID)
	}
}
