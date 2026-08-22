package whatsmeow

import (
	"bytes"
	"context"
	"errors"
	"testing"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/store"
	waLog "go.mau.fi/whatsmeow/util/log"
)

type routingInfoTestStore struct {
	putCalls int
	payload  []byte
	err      error
}

func (s *routingInfoTestStore) PutTransportRoutingInfo(_ context.Context, payload []byte) error {
	s.putCalls++
	s.payload = payload
	return s.err
}

func (s *routingInfoTestStore) GetTransportRoutingInfo(context.Context) ([]byte, error) {
	return append([]byte(nil), s.payload...), s.err
}

func (s *routingInfoTestStore) DeleteTransportRoutingInfo(context.Context) error {
	return s.err
}

func edgeRoutingIB(content any) *waBinary.Node {
	return &waBinary.Node{Tag: "ib", Content: []waBinary.Node{{
		Tag: "edge_routing",
		Content: []waBinary.Node{{
			Tag: "routing_info", Content: content,
		}},
	}}}
}

func TestHandleIBPersistsOpaqueTransportRoutingInfo(t *testing.T) {
	transport := &routingInfoTestStore{}
	client := &Client{Store: &store.Device{Transport: transport}, Log: waLog.Noop}
	routingInfo := []byte{0x08, 0xff, 0x12, 0x02, 0x00, 0x7f}

	client.handleIB(context.Background(), edgeRoutingIB(routingInfo))
	if transport.putCalls != 1 || !bytes.Equal(transport.payload, routingInfo) {
		t.Fatalf("opaque route was not persisted exactly: calls=%d size=%d", transport.putCalls, len(transport.payload))
	}
	routingInfo[0] ^= 0xff
	if transport.payload[0] != 0x08 {
		t.Fatal("persisted route aliases the binary decoder buffer")
	}
}

func TestHandleIBRejectsInvalidTransportRoutingInfo(t *testing.T) {
	for _, fixture := range []struct {
		name string
		node *waBinary.Node
	}{
		{name: "wrong content type", node: edgeRoutingIB("not-bytes")},
		{name: "empty", node: edgeRoutingIB([]byte{})},
		{name: "oversized", node: edgeRoutingIB(make([]byte, store.MaxWhatsAppTransportRoutingInfoSize+1))},
		{name: "missing", node: &waBinary.Node{Tag: "ib", Content: []waBinary.Node{{Tag: "edge_routing"}}}},
		{name: "duplicate", node: &waBinary.Node{Tag: "ib", Content: []waBinary.Node{{
			Tag: "edge_routing", Content: []waBinary.Node{
				{Tag: "routing_info", Content: []byte{1}},
				{Tag: "routing_info", Content: []byte{2}},
			},
		}}}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			transport := &routingInfoTestStore{}
			client := &Client{Store: &store.Device{Transport: transport}, Log: waLog.Noop}
			client.handleIB(context.Background(), fixture.node)
			if transport.putCalls != 0 {
				t.Fatalf("invalid route reached store: calls=%d", transport.putCalls)
			}
		})
	}
}

func TestHandleIBDoesNotRetainRouteWhenStoreRejectsMutation(t *testing.T) {
	transport := &routingInfoTestStore{err: errors.New("lease fenced")}
	client := &Client{Store: &store.Device{Transport: transport}, Log: waLog.Noop}
	client.handleIB(context.Background(), edgeRoutingIB([]byte{1, 2, 3}))
	if transport.putCalls != 1 {
		t.Fatalf("store mutation call count=%d, want 1", transport.putCalls)
	}
}
