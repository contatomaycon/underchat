package app

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const workerConfigRevisionKeyPrefix = "worker-config:revision:v1"
const maxRedisExactInteger = uint64(1<<53 - 1)

const validateCurrentWorkerConfigRevisionScript = `
local current_raw = redis.call('GET', KEYS[1])
local incoming_raw = ARGV[1]

-- Legacy events without a revision are accepted only while no revisioned
-- configuration has ever been observed for this worker. The applied key is
-- read solely as a rollout guard for deployments that used the old claim
-- protocol; this validator never mutates it.
if incoming_raw == '' then
  if current_raw == false and redis.call('EXISTS', KEYS[2]) == 0 then
    return 1
  end
  return 0
end

if current_raw == false then
  return 0
end

local current = tonumber(current_raw)
local incoming = tonumber(incoming_raw)
if current == nil or incoming == nil or incoming <= 0 then
  return 0
end

if current == incoming then
  return 1
end
return 0
`

func workerConfigCurrentRevisionKey(workerID string) string {
	return fmt.Sprintf("%s:%s:current", workerConfigRevisionKeyPrefix, strings.TrimSpace(workerID))
}

func workerConfigAppliedRevisionKey(workerID string) string {
	return fmt.Sprintf("%s:%s:applied", workerConfigRevisionKeyPrefix, strings.TrimSpace(workerID))
}

func normalizeWorkerConfigRevision(raw string) (string, error) {
	normalized := strings.TrimSpace(raw)
	if normalized == "" {
		return "", errors.New("worker config revision is required")
	}
	revision, err := strconv.ParseUint(normalized, 10, 64)
	if err != nil || revision == 0 || revision > maxRedisExactInteger {
		return "", errors.New("worker config revision is invalid")
	}
	return strconv.FormatUint(revision, 10), nil
}

func (w *Worker) validateCurrentWorkerConfigRevision(
	ctx context.Context,
	workerID string,
	rawRevision string,
) (bool, error) {
	workerID = strings.TrimSpace(workerID)
	if workerID == "" {
		return false, errors.New("worker id is required for worker config revision")
	}

	revision := ""
	if strings.TrimSpace(rawRevision) != "" {
		normalized, err := normalizeWorkerConfigRevision(rawRevision)
		if err != nil {
			return false, nil
		}
		revision = normalized
	}
	if w.workerConfigRevisionValidator != nil {
		return w.workerConfigRevisionValidator(ctx, workerID, revision)
	}
	if w.redis == nil {
		return false, errors.New("redis is required for worker config revision")
	}

	result, err := w.redis.Eval(
		ctx,
		validateCurrentWorkerConfigRevisionScript,
		[]string{
			workerConfigCurrentRevisionKey(workerID),
			workerConfigAppliedRevisionKey(workerID),
		},
		revision,
	).Int()
	if err != nil {
		return false, fmt.Errorf("validate worker config revision: %w", err)
	}
	return result == 1, nil
}
