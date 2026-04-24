package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type CentrifugoClient struct {
	url    string
	apiKey string
	client *http.Client
}

func NewCentrifugoClient(cfg Config) *CentrifugoClient {
	return &CentrifugoClient{
		url:    strings.TrimSpace(cfg.CentrifugoHTTPAPIURL),
		apiKey: strings.TrimSpace(cfg.CentrifugoHTTPAPIKey),
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *CentrifugoClient) Publish(ctx context.Context, channel string, data any) error {
	if c.url == "" || c.apiKey == "" || channel == "" {
		return nil
	}

	body, err := json.Marshal(map[string]any{
		"method": "publish",
		"params": map[string]any{
			"channel": channel,
			"data":    data,
		},
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "apikey "+c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("centrifugo publish failed: %s", resp.Status)
	}
	return nil
}

func workerCentrifugoQueue(accountID string) string {
	return "worker:account#" + accountID
}

func channelsConfigCentrifugo() string {
	return "channels:config"
}
