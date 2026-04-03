#!/usr/bin/env bash
# elastic-reindex-bare-to-rollover.sh
#
# Migrates bare (pre-rollover) Elasticsearch indices into the ILM-managed
# rollover alias pipeline. Idempotent and safe to rerun.
#
# Strategy:
#   - dest.op_type=create  → never overwrites existing docs in rollover
#   - conflicts=proceed    → skips 409s silently (safe overlap)
#   - wait_for_completion=false + polling → handles large datasets without timeout
#   - Alias cutover is atomic and only executed if all reindexes pass validation
#
# Usage:
#   ES_URL=https://user:pass@host:9200 ./scripts/elastic-reindex-bare-to-rollover.sh
#   ./scripts/elastic-reindex-bare-to-rollover.sh https://user:pass@host:9200
#   ./scripts/elastic-reindex-bare-to-rollover.sh --dry-run           (pre-flight only)
#
# After running:
#   1. Observe logs for 24-48h (no illegal_argument_exception, no unexpected 404s)
#   2. If clear, delete bare indices (commands printed at end)
#   3. Deploy code cleanup removing the _search workaround

set -euo pipefail
IFS=$'\n\t'

# ── Args ────────────────────────────────────────────────────────────────────

DRY_RUN=0
ONLY_INDEX=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)  DRY_RUN=1 ;;
    --only)     shift; ONLY_INDEX="$1" ;;
    --only=*)   ONLY_INDEX="${arg#--only=}" ;;
    http*)      ES_URL="$arg" ;;
  esac
done

ES_URL="${ES_URL:-}"

if [[ -z "$ES_URL" ]]; then
  echo "ERROR: ES_URL not set." >&2
  echo "Usage: ES_URL=https://user:pass@host:9200 $0 [--dry-run]" >&2
  exit 1
fi

# ── Logging ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
info()  { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $*"; }
abort() { echo -e "${RED}[$(date '+%H:%M:%S')] ABORT:${NC} $*" >&2; exit 1; }

SAFE_URL="${ES_URL//:*@/:***@}"
log "Elasticsearch: ${SAFE_URL}"
[[ "$DRY_RUN" == "1" ]] && warn "DRY RUN MODE — no changes will be made"
echo ""

# ── Helpers ──────────────────────────────────────────────────────────────────

es() {
  local method="$1" path="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -sf --max-time 60 -X "$method" "${ES_URL}${path}" \
      -H 'Content-Type: application/json' -d "$data"
  else
    curl -sf --max-time 30 -X "$method" "${ES_URL}${path}"
  fi
}

es_status() {
  curl -s -o /dev/null -w "%{http_code}" "${ES_URL}${1}"
}

jval() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"
}

count_index() {
  local idx="$1"
  [[ "$(es_status "/${idx}")" != "200" ]] && echo -1 && return
  es GET "/${idx}/_count" | jval "d['count']"
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

INDICES=("chat" "message" "wpp-connection")

if [[ -n "$ONLY_INDEX" ]]; then
  INDICES=("$ONLY_INDEX")
  info "Scope: running only for index '${ONLY_INDEX}'"
fi

info "=== PRE-FLIGHT CHECK ==="

declare -A BARE_COUNT
declare -A ROLLOVER_BEFORE

PREFLIGHT_OK=1

for base in "${INDICES[@]}"; do
  bare_n=$(count_index "$base")
  BARE_COUNT[$base]=$bare_n

  if [[ "$bare_n" == "-1" ]]; then
    log "  [$base] Bare index not found — will skip"
    ROLLOVER_BEFORE[$base]=0
    continue
  fi

  # Verify write alias exists
  if [[ "$(es_status "/_alias/${base}-write")" != "200" ]]; then
    warn "  [$base] Write alias '${base}-write' NOT FOUND — bootstrap required"
    PREFLIGHT_OK=0
    ROLLOVER_BEFORE[$base]=0
    continue
  fi

  rollover_n=$(count_index "${base}-write")
  ROLLOVER_BEFORE[$base]=$rollover_n

  # Confirm bare is currently in the read alias (the bug we're fixing)
  alias_resp=$(es_status "/${base}/_alias/${base}-read")
  in_alias="no"
  [[ "$alias_resp" == "200" ]] && in_alias="yes"

  info "  [$base]  bare=${bare_n}  rollover-before=${rollover_n}  bare-in-read-alias=${in_alias}"
done

echo ""

if [[ "$PREFLIGHT_OK" != "1" ]]; then
  abort "Pre-flight failed. Fix the issues above before retrying."
fi

[[ "$DRY_RUN" == "1" ]] && log "Dry run complete. Exiting without changes." && exit 0

# ── Phase 1: Reindex ─────────────────────────────────────────────────────────

info "=== PHASE 1: REINDEX (bare → rollover write alias) ==="
echo ""

FAILED=()

reindex_one() {
  local base="$1"
  local bare_count="${BARE_COUNT[$base]}"
  local before="${ROLLOVER_BEFORE[$base]}"

  if [[ "$bare_count" == "-1" ]]; then
    log "[$base] No bare index — skipping"
    return 0
  fi

  log "[$base] Dispatching reindex: ${bare_count} docs → ${base}-write"

  # ── Build per-index reindex payload ────────────────────────────────────────
  # message bare index stored external_ad_reply.media_type as string ('IMAGE'/'VIDEO')
  # but message-000001 mapping defines it as integer.
  # WhatsApp proto enum: IMAGE=1, VIDEO=2 — conversion is lossless.
  local payload
  if [[ "$base" == "message" ]]; then
    payload="{
      \"conflicts\": \"proceed\",
      \"source\": { \"index\": \"${base}\", \"size\": 500 },
      \"dest\":   { \"index\": \"${base}-write\", \"op_type\": \"create\" },
      \"script\": {
        \"lang\": \"painless\",
        \"source\": \"def content = ctx._source.get('content'); if (content != null) { List items = content instanceof List ? (List)content : Collections.singletonList(content); for (def item : items) { if (item instanceof Map) { def ctxInfo = item.get('context_info'); if (ctxInfo instanceof Map) { def adReply = ctxInfo.get('external_ad_reply'); if (adReply instanceof Map) { def mt = adReply.get('media_type'); if (mt instanceof String) { String s = (String)mt; if ('IMAGE'.equals(s)) adReply.put('media_type', 1); else if ('VIDEO'.equals(s)) adReply.put('media_type', 2); else adReply.remove('media_type'); } } } } } }\"
      }
    }"
  else
    payload="{
      \"conflicts\": \"proceed\",
      \"source\": { \"index\": \"${base}\", \"size\": 500 },
      \"dest\":   { \"index\": \"${base}-write\", \"op_type\": \"create\" }
    }"
  fi

  local task_id
  task_id=$(es POST "/_reindex?wait_for_completion=false" "$payload" | jval "d['task']")
  log "[$base] Task ID: ${task_id}"

  # Poll until complete
  local resp complete created total elapsed=0
  while true; do
    sleep 10
    elapsed=$(( elapsed + 10 ))

    resp=$(es GET "/_tasks/${task_id}")
    complete=$(echo "$resp" | jval "d['completed']")

    created=$(echo "$resp" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('task',{}).get('status',{}).get('created',0))" \
      2>/dev/null || echo "?")
    total=$(echo "$resp" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('task',{}).get('status',{}).get('total',0))" \
      2>/dev/null || echo "?")

    printf '\r  [%s] %ds  created=%s / total=%s ...' "$base" "$elapsed" "$created" "$total"

    if [[ "$complete" == "True" ]]; then
      echo ""
      break
    fi
  done

  # Check for task-level error (ES rejected the task entirely)
  local task_error
  task_error=$(echo "$resp" | python3 -c \
    "import sys,json; d=json.load(sys.stdin); e=d.get('error',''); print('' if not e or e is None else str(e)[:200])" \
    2>/dev/null || echo "")

  if [[ -n "$task_error" ]]; then
    warn "[$base] Task-level error: ${task_error}"
    return 1
  fi

  # Parse response stats
  local r_created r_conflicts r_failures
  r_created=$(echo "$resp"   | jval "d['response']['created']")
  r_conflicts=$(echo "$resp" | jval "d['response']['version_conflicts']")
  r_failures=$(echo "$resp"  | jval "len(d['response']['failures'])")

  log "[$base] created=${r_created}  conflicts=${r_conflicts}  failures=${r_failures}"

  # Hard fail on any document-level failures
  if [[ "$r_failures" != "0" ]]; then
    warn "[$base] Document failures (first 10):"
    echo "$resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for f in d['response']['failures'][:10]:
    print('  id=%s  reason=%s' % (f.get('id','?'), f.get('cause',{}).get('reason','?')))
"
    return 1
  fi

  [[ "$r_conflicts" != "0" ]] && \
    warn "[$base] ${r_conflicts} conflicts skipped (docs already existed in rollover — expected)"

  # ── Count validation ──────────────────────────────────────────────────────

  local after_rollover
  after_rollover=$(count_index "${base}-write")
  local expected=$(( before + r_created ))

  log "[$base] Count check — rollover: before=${before}  after=${after_rollover}  expected>=${expected}"

  if [[ "$after_rollover" -lt "$expected" ]]; then
    # ILM may have rotated to a new index mid-reindex; count via read alias
    warn "[$base] Rollover single-index count ${after_rollover} < expected ${expected}."
    warn "[$base] ILM rotation may have occurred. Recounting via ${base}-read alias..."
    local after_alias
    after_alias=$(count_index "${base}-read")
    log "[$base] ${base}-read total: ${after_alias}  bare was: ${bare_count}"

    if [[ "$after_alias" -lt "$bare_count" ]]; then
      warn "[$base] Alias total ${after_alias} < bare count ${bare_count}. Migration appears incomplete."
      return 1
    fi
    log "[$base] ✅ Read alias covers all bare docs. Validation passed."
  else
    log "[$base] ✅ Count validation passed."
  fi

  return 0
}

for base in "${INDICES[@]}"; do
  if ! reindex_one "$base"; then
    FAILED+=("$base")
  fi
  echo ""
done

if [[ "${#FAILED[@]}" -gt 0 ]]; then
  abort "Reindex failed for: ${FAILED[*]}. Alias cutover SKIPPED. Fix the issues and rerun."
fi

# ── Phase 2: Atomic alias cutover ────────────────────────────────────────────

info "=== PHASE 2: ALIAS CUTOVER (atomic) ==="

ACTIONS="["
SEP=""
for base in "${INDICES[@]}"; do
  [[ "${BARE_COUNT[$base]}" == "-1" ]] && continue
  ACTIONS+="${SEP}{\"remove\":{\"index\":\"${base}\",\"alias\":\"${base}-read\"}}"
  SEP=","
done
ACTIONS+="]"

if [[ "$ACTIONS" == "[]" ]]; then
  log "No bare indices to remove from aliases. Nothing to do."
else
  resp=$(es POST "/_aliases" "{\"actions\":${ACTIONS}}")
  ack=$(echo "$resp" | jval "d.get('acknowledged', False)")

  if [[ "$ack" != "True" ]]; then
    abort "Alias update failed: ${resp}"
  fi

  log "✅ Bare indices removed from read aliases atomically."
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
info "=== POST-MIGRATION STATE ==="
for base in "${INDICES[@]}"; do
  [[ "${BARE_COUNT[$base]}" == "-1" ]] && continue
  after=$(count_index "${base}-read")
  log "  ${base}-read → ${after} docs (rollover pipeline only)"
done

echo ""
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
warn "NEXT STEPS — execute after 24-48h observation window with no errors:"
warn ""
warn "  1. Monitor production logs:"
warn "     grep -i 'illegal_argument_exception' <logs>"
warn ""
warn "  2. Delete bare indices (only after observation is clean):"
for base in "${INDICES[@]}"; do
  [[ "${BARE_COUNT[$base]}" == "-1" ]] && continue
  warn "     curl -X DELETE '${SAFE_URL}/${base}'"
done
warn ""
warn "  3. Deploy code cleanup:"
warn "     - Revert view/getDocumentMeta/getBulkDocumentMeta to client.get() / client.mget()"
warn "     - Remove ensure_bare_in_read_alias from docker-compose.yml"
warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log "🎉 Migration complete."
