package socket

import (
	"bytes"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

func TestBuildRoutingIntroHeaderPreservesNoisePrologue(t *testing.T) {
	routingInfo := []byte{0xde, 0xad, 0xbe, 0xef}
	header, err := BuildRoutingIntroHeader(routingInfo)
	if err != nil {
		t.Fatal(err)
	}
	expectedPrefix := []byte{'E', 'D', 0, 1, 0, 0, byte(len(routingInfo))}
	if !bytes.Equal(header[:7], expectedPrefix) ||
		!bytes.Equal(header[7:7+len(routingInfo)], routingInfo) ||
		!bytes.Equal(header[7+len(routingInfo):], WAConnHeader) {
		t.Fatal("edge-routing wire intro does not match the canonical format")
	}
	frame := NewFrameSocket(nil, nil)
	frame.WireHeader = header
	if !bytes.Equal(frame.Header, WAConnHeader) {
		t.Fatal("edge-routing wire intro changed the Noise prologue")
	}
}

func TestURLWithRoutingInfoUsesUnpaddedBase64URLAndSafeLogURL(t *testing.T) {
	routingInfo := []byte{0xfb, 0xff, 0x01, 0x02}
	routed, err := URLWithRoutingInfo("wss://example.test/ws?existing=1", routingInfo)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(routed)
	if err != nil {
		t.Fatal(err)
	}
	want := base64.RawURLEncoding.EncodeToString(routingInfo)
	if got := parsed.Query().Get("ED"); got != want || strings.Contains(got, "=") {
		t.Fatalf("unexpected ED query encoding %q", got)
	}
	safe := safeDialURL(routed)
	if strings.Contains(safe, want) || strings.Contains(safe, "ED=") || strings.Contains(safe, "existing=1") {
		t.Fatalf("safe dial URL exposed query material: %s", safe)
	}
}

func TestRoutingTransportRejectsOutOfBoundsPayloads(t *testing.T) {
	for _, payload := range [][]byte{nil, make([]byte, 65536)} {
		if _, err := BuildRoutingIntroHeader(payload); err == nil {
			t.Fatalf("wire intro accepted payload size %d", len(payload))
		}
		if _, err := URLWithRoutingInfo("wss://example.test/ws", payload); err == nil {
			t.Fatalf("URL accepted payload size %d", len(payload))
		}
	}
}
