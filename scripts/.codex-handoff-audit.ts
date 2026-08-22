import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { createHash } from 'node:crypto';

import { config } from 'dotenv';
import pg from 'pg';
import protobuf from 'protobufjs/minimal.js';

config({ quiet: true });

const { Pool } = pg;
const WORKER_ID_PATTERN = /^[0-9a-f-]{36}$/u;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

async function main(): Promise<void> {
  const [mode, workerId, revisionA, revisionB] = process.argv.slice(2);
  if (
    ![
      'snapshot',
      'build-status',
      'warm-status',
      'recreate-status',
      'wwebjs-workers',
      'server-workers',
      'compare-canonical',
      'sender-key-shape',
      'logs',
      'logs-all',
      'logs-race',
      'logs-api',
      'logs-failed-wwebjs',
      'proof',
      'health',
      'inspect-runtime',
      'inspect-runtime-resources',
      'inspect-wwebjs-pools',
      'inspect-baileys-pools',
      'deploy-wwebjs',
      'cancel-wwebjs-pull',
      'deploy-baileys',
      'restore-socket-tags',
      'disk',
      'prune-unused-images',
      'stop-runtime',
      'start-runtime',
    ].includes(mode ?? '') ||
    !workerId ||
    !WORKER_ID_PATTERN.test(workerId)
  ) {
    throw new Error(
      'usage: snapshot|build-status|logs|logs-all|proof|health|inspect-runtime|inspect-wwebjs-pools|deploy-wwebjs|disk|prune-unused-images|stop-runtime|start-runtime <worker_id>'
    );
  }

  const pool = new Pool({
    host: required('DB_HOST_RW'),
    port: Number(required('DB_PORT_RW')),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_DATABASE'),
    max: 1,
  });

  try {
    if (mode === 'sender-key-shape') {
      const { Reader } = protobuf;
      const rows = await pool.query(
        `select revision_id::text, sender_key
           from whatsapp_sender_keys
          where session_id = $1
          order by revision_id desc
          limit 16`,
        [workerId]
      );
      const nested = (reader: InstanceType<typeof Reader>) =>
        Reader.create(reader.bytes());
      const parseFields = (
        reader: InstanceType<typeof Reader>,
        parsers: Record<number, (reader: InstanceType<typeof Reader>) => unknown>
      ): Record<string, unknown[]> => {
        const output: Record<string, unknown[]> = {};
        while (reader.pos < reader.len) {
          const tag = reader.uint32();
          const field = tag >>> 3;
          const parser = parsers[field];
          if (!parser) throw new Error(`unexpected_field_${field}`);
          (output[field] ??= []).push(parser(reader));
        }
        return output;
      };
      const parseChain = (reader: InstanceType<typeof Reader>) =>
        parseFields(reader, {
          1: (input) => input.uint32(),
          2: (input) => ({ bytes: input.bytes().byteLength }),
        });
      const parseSigning = (reader: InstanceType<typeof Reader>) =>
        parseFields(reader, {
          1: (input) => ({ bytes: input.bytes().byteLength }),
          2: (input) => ({ bytes: input.bytes().byteLength }),
        });
      const parseState = (reader: InstanceType<typeof Reader>) =>
        parseFields(reader, {
          1: (input) => input.uint32(),
          2: (input) => parseChain(nested(input)),
          3: (input) => parseSigning(nested(input)),
          4: (input) => parseChain(nested(input)),
        });
      console.log(
        JSON.stringify(
          rows.rows.map((row) => ({
            revision_id: row.revision_id,
            bytes: row.sender_key.byteLength,
            structure: parseFields(Reader.create(row.sender_key), {
              1: (input) => parseState(nested(input)),
            }),
          }))
        )
      );
      return;
    }

    if (mode === 'compare-canonical') {
      if (!/^\d+$/u.test(revisionA ?? '') || !/^\d+$/u.test(revisionB ?? '')) {
        throw new Error('compare-canonical requires two revision ids');
      }
      const tables = [
        ['device', 'whatsapp_device'],
        ['identities', 'whatsapp_identity_keys'],
        ['pre_keys', 'whatsapp_pre_keys'],
        ['pq_pre_keys', 'whatsapp_pq_pre_keys'],
        ['pq_state', 'whatsapp_pq_pre_key_state'],
        ['sessions', 'whatsapp_signal_sessions'],
        ['sender_keys', 'whatsapp_sender_keys'],
        ['sync_keys', 'whatsapp_app_state_sync_keys'],
        ['versions', 'whatsapp_app_state_version'],
        ['mutation_macs', 'whatsapp_app_state_mutation_macs'],
      ] as const;
      const canonical = (value: unknown): unknown => {
        if (Buffer.isBuffer(value)) return value.toString('hex');
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
          return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([key]) => !['session_id', 'revision_id'].includes(key))
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, entry]) => [key, canonical(entry)])
          );
        }
        return value;
      };
      const report: Record<string, unknown> = {};
      for (const [label, table] of tables) {
        const result = await pool.query(
          `select * from ${table} where session_id = $1 and revision_id = any($2::bigint[])`,
          [workerId, [revisionA, revisionB]]
        );
        const revisions: Record<string, { count: number; checksum: string }> =
          {};
        for (const revision of [revisionA, revisionB]) {
          const rows = result.rows
            .filter((row) => String(row.revision_id) === revision)
            .map(canonical)
            .map((row) => JSON.stringify(row))
            .sort();
          revisions[revision] = {
            count: rows.length,
            checksum: createHash('sha256')
              .update(rows.join('\n'))
              .digest('hex'),
          };
        }
        report[label] = {
          ...revisions,
          equal:
            revisions[revisionA].checksum === revisions[revisionB].checksum,
        };
      }
      console.log(JSON.stringify(report));
      return;
    }

    if (mode === 'build-status') {
      const result = await pool.query(
        `select job.server_build_job_id::text,
                job.version,
                job.status,
                job.error_message,
                job.created_at,
                job.started_at,
                job.finished_at,
                item.build_type,
                item.status as item_status,
                item.image_reference,
                item.error_message as item_error
           from server_build_job job
           join server_build_job_item item
             on item.server_build_job_id = job.server_build_job_id
          order by job.created_at desc, item.build_type
          limit 4`
      );
      console.log(JSON.stringify(result.rows));
      return;
    }

    if (mode === 'warm-status') {
      const result = await pool.query(
        `select wp.warm_pool_id::text,
                wt.type as worker_type,
                wp.state,
                wp.server_id::text,
                wp.container_id,
                wp.container_name,
                wp.last_error,
                wp.created_at,
                wp.updated_at
           from worker_warm_pool wp
           join worker_type wt on wt.worker_type_id = wp.worker_type_id
          where wt.type = 'wwebjs'
          order by wp.updated_at desc
          limit 24`
      );
      console.log(JSON.stringify(result.rows));
      return;
    }

    if (mode === 'recreate-status') {
      const result = await pool.query(
        `select w.worker_id::text,
                ws.status as worker_status,
                w.lifecycle_operation_id::text,
                w.recreate_completed_operation_id::text,
                w.recreate_completed_runtime_generation,
                w.recreate_completed_at,
                w.updated_at as worker_status_observed_at,
                wr.runtime_generation,
                wr.container_id as runtime_container_id,
                wr.native_connection_public_status->>'status' as native_status,
                wr.native_connection_public_status->>'connected' as connected,
                wr.native_connection_public_status->>'authenticated' as authenticated,
                wr.native_connection_public_status->>'sessionValid' as session_valid,
                wr.native_connection_public_status->>'qrAvailable' as qr_available,
                wr.native_connection_public_status->>'reason' as reason,
                wr.native_connection_public_status->>'changedAt' as changed_at,
                wr.native_connection_online_acknowledged as central_ack,
                wr.connection_epoch,
                s.provider as session_provider,
                s.state as session_state,
                s.active_revision_id::text,
                s.generation as session_generation,
                encode(s.active_device_fingerprint, 'hex') as fingerprint,
                r.writer_generation,
                (select count(*)::int from whatsapp_session_handoff h
                  where h.session_id = w.worker_id
                    and h.state in ('requested','draining','transforming','hydrating','validating','promoting','activating')) as active_handoffs,
                (select count(*)::int from whatsapp_session_handoff h
                  where h.session_id = w.worker_id
                    and h.state = 'failed'
                    and h.recovery_state in ('pending','dispatching','running')) as active_recoveries,
                (select count(*)::int from whatsapp_session_handoff_resolution hr
                  where hr.session_id = w.worker_id and hr.state = 'running') as active_resolutions
           from worker w
           join worker_status ws on ws.worker_status_id = w.worker_status_id
           join worker_runtime wr on wr.worker_id = w.worker_id
           left join whatsapp_session s on s.session_id = w.worker_id
           left join whatsapp_session_revision r
             on r.session_id = s.session_id and r.revision_id = s.active_revision_id
          where w.worker_id = $1 and w.deleted_at is null`,
        [workerId]
      );
      console.log(JSON.stringify(result.rows[0] ?? null));
      return;
    }

    if (mode === 'wwebjs-workers') {
      const result = await pool.query(
        `select w.worker_id::text,
                w.server_id::text,
                ws.status,
                wr.container_id
           from worker w
           join worker_type wt on wt.worker_type_id = w.worker_type_id
           join worker_status ws on ws.worker_status_id = w.worker_status_id
           join worker_runtime wr on wr.worker_id = w.worker_id
          where wt.type = 'wwebjs'
            and w.deleted_at is null
            and wr.container_id is not null
          order by w.server_id, w.updated_at desc`
      );
      console.log(JSON.stringify(result.rows));
      return;
    }

    if (mode === 'server-workers') {
      const result = await pool.query(
        `select distinct on (w.server_id)
                w.worker_id::text,
                w.server_id::text,
                wt.type,
                ws.status,
                wr.container_id
           from worker w
           join worker_type wt on wt.worker_type_id = w.worker_type_id
           join worker_status ws on ws.worker_status_id = w.worker_status_id
           join worker_runtime wr on wr.worker_id = w.worker_id
          where w.deleted_at is null
            and wr.container_id is not null
          order by w.server_id, w.updated_at desc`
      );
      console.log(JSON.stringify(result.rows));
      return;
    }

    if (
      mode === 'logs' ||
      mode === 'logs-all' ||
      mode === 'logs-race' ||
      mode === 'logs-api' ||
      mode === 'logs-failed-wwebjs' ||
      mode === 'proof' ||
      mode === 'health' ||
      mode === 'inspect-runtime' ||
      mode === 'inspect-runtime-resources' ||
      mode === 'inspect-wwebjs-pools' ||
      mode === 'inspect-baileys-pools' ||
      mode === 'deploy-wwebjs' ||
      mode === 'cancel-wwebjs-pull' ||
      mode === 'deploy-baileys' ||
      mode === 'restore-socket-tags' ||
      mode === 'disk' ||
      mode === 'prune-unused-images' ||
      mode === 'stop-runtime' ||
      mode === 'start-runtime'
    ) {
      const remote = await pool.query(
        `select w.container_id,
                wr.container_id as runtime_container_id,
                ss.ssh_ip,
                ss.ssh_port,
                ss.ssh_username,
                ss.ssh_password
           from worker w
           join worker_runtime wr on wr.worker_id = w.worker_id
           join lateral (
             select *
               from server_ssh candidate
              where candidate.server_id = w.server_id
                and candidate.deleted_at is null
              order by candidate.created_at desc
              limit 1
           ) ss on true
          where w.worker_id = $1 and w.deleted_at is null`,
        [workerId]
      );
      const row = remote.rows[0];
      if (!row?.container_id) throw new Error('worker_remote_not_found');
      const key = scryptSync(
        required('CRYPTO_KEY_START'),
        required('CRYPTO_KEY_END'),
        32
      );
      const decrypt = (ciphertext: string): string => {
        const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          key,
          Buffer.from(ivHex, 'hex')
        );
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        return Buffer.concat([
          decipher.update(Buffer.from(encryptedHex, 'hex')),
          decipher.final(),
        ]).toString('utf8');
      };
      const user = decrypt(row.ssh_username);
      const password = decrypt(row.ssh_password);
      const command =
        mode === 'deploy-wwebjs'
          ? `deploy_config=$(mktemp -d) && chmod 700 "$deploy_config" && trap 'rm -rf -- "$deploy_config"' EXIT && docker --config "$deploy_config" login harbor.devunder.com --username '${required('HARBOR_USERNAME')}' --password-stdin >/dev/null && docker --config "$deploy_config" pull harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814164455675 && docker tag harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814164455675 under-worker-wwebjs:latest && docker image inspect under-worker-wwebjs:latest --format 'wwebjs_latest={{.Id}}' && docker image inspect harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814164455675 --format 'wwebjs_release={{.Id}}'`
          : mode === 'cancel-wwebjs-pull'
            ? `for proc in /proc/[0-9]*; do args=$(tr '\\0' ' ' < "$proc/cmdline" 2>/dev/null || true); case "$args" in docker\\ --config\\ */*\\ pull\\ harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814164455675*) kill -TERM "\${proc##*/}" ;; esac; done; sleep 1; ps -eo pid,etimes,args | grep '[d]ocker.*pull' || true`
            : mode === 'deploy-baileys'
              ? `deploy_config=$(mktemp -d) && chmod 700 "$deploy_config" && trap 'rm -rf -- "$deploy_config"' EXIT && docker --config "$deploy_config" login harbor.devunder.com --username '${required('HARBOR_USERNAME')}' --password-stdin >/dev/null && docker --config "$deploy_config" pull -q harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814122621406 >/dev/null && docker tag harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814122621406 under-worker-baileys:latest && docker image inspect under-worker-baileys:latest --format 'baileys_latest={{.Id}}' && docker image inspect harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814122621406 --format 'baileys_release={{.Id}}'`
              : mode === 'restore-socket-tags'
                ? `docker tag harbor.devunder.com/underchat/balance/under-worker-baileys:v20260814122621406 under-worker-baileys:latest && docker tag harbor.devunder.com/underchat/balance/under-worker-whatsmeow:v20260813171406259 under-worker-whatsmeow:latest && docker image inspect under-worker-baileys:latest --format 'baileys_latest={{.Id}}' && docker image inspect under-worker-whatsmeow:latest --format 'whatsmeow_latest={{.Id}}'`
                : mode === 'prune-unused-images'
                  ? `docker image prune -a -f; docker system df; df -h /`
                  : mode === 'disk'
                    ? `ps -eo pid,etimes,args | grep '[d]ocker.*pull' || true; df -h / /var/lib/docker /var/lib/containerd 2>/dev/null; docker system df; docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}} {{.CreatedSince}}' | head -100`
                    : mode === 'health'
                      ? `docker exec '${row.runtime_container_id}' node -e "fetch('http://127.0.0.1:3005/v1/connection/health/check').then(async response => { console.log(response.status, await response.text()) }).catch(error => { console.error(error.message); process.exit(1) })"`
                      : mode === 'logs-all'
                        ? `docker logs --since=45m '${row.runtime_container_id}' 2>&1 | tail -6000`
                        : mode === 'logs-race'
                          ? `docker logs --since='2026-08-14T00:16:00Z' --until='2026-08-14T00:16:25Z' '${row.runtime_container_id}' 2>&1 | grep -vE '^\\[(CONNECTION_FLOW|LOCAL_CONNECTION_STATUS|connection-lifecycle-debug)\\]' | tail -1600`
                          : mode === 'logs-api'
                            ? `docker logs --since=30m under-balance-api 2>&1 | tail -10000`
                            : mode === 'logs-failed-wwebjs'
                              ? `for container_id in $(docker ps -aq); do matched=$(docker logs --since=30m "$container_id" 2>&1 | grep -E 'sender_key_validation|import_sender_key|canonical_(projection|activation)|initialization_failed|client.failure_primary' | tail -240); if test -n "$matched"; then docker inspect --format 'container={{.Id}} name={{.Name}} image={{.Image}} status={{.State.Status}}' "$container_id"; printf '%s\n' "$matched"; fi; done`
                            : mode === 'proof'
                              ? `docker logs --since=45m '${row.runtime_container_id}' 2>&1 | grep -E 'handoff.prepared|handoff.stable_profile_checkpoint_oversize_fallback|handoff.reusable_profile_signal_table_equivalence_evaluated|browser_bridge.canonical_projection_imported|browser_bridge.canonical_projection_import_progress|canonical_activation.finalized' | tail -320`
                              : mode === 'inspect-wwebjs-pools'
                                ? `for container_id in $(docker ps -q); do package_version=$(docker exec "$container_id" node -p "try { require('@wwebjs/whatsapp-web.js/package.json').version } catch { '' }" 2>/dev/null || true); if test -n "$package_version"; then docker inspect --format '{{.Id}} {{.Name}} {{.Config.Image}} {{.Image}} {{.State.Status}}' "$container_id"; printf 'package=%s\n' "$package_version"; fi; done`
                                : mode === 'inspect-baileys-pools'
                                  ? `for container_id in $(docker ps -q); do package_version=$(docker exec "$container_id" node -p "try { require('@whiskeysockets/baileys/package.json').version } catch { '' }" 2>/dev/null || true); if test -n "$package_version"; then docker inspect --format '{{.Id}} {{.Name}} {{.Config.Image}} {{.Image}} {{.State.Status}}' "$container_id"; printf 'package=%s\n' "$package_version"; fi; done`
                                    : mode === 'inspect-runtime-resources'
                                      ? `docker inspect --format 'runtime={{.Id}} memory={{.HostConfig.Memory}} memory_swap={{.HostConfig.MemorySwap}} oom_kill_disable={{.HostConfig.OomKillDisable}} pids_limit={{.HostConfig.PidsLimit}} oom_killed={{.State.OOMKilled}} restart_count={{.RestartCount}}' '${row.runtime_container_id}'; docker stats --no-stream --format 'container={{.Container}} mem={{.MemUsage}} mem_percent={{.MemPerc}} pids={{.PIDs}} cpu={{.CPUPerc}}' '${row.runtime_container_id}'; docker exec '${row.runtime_container_id}' sh -lc 'for event_file in /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.events.local; do if test -r "$event_file"; then echo "$event_file"; sed -n "1,20p" "$event_file"; fi; done'`
                                    : mode === 'inspect-runtime'
                                    ? `docker inspect --format 'runtime={{.Id}} image={{.Image}} restart={{.HostConfig.RestartPolicy.Name}} status={{.State.Status}} labels={{json .Config.Labels}}' '${row.runtime_container_id}'; docker exec '${row.runtime_container_id}' sh -lc 'find /tmp /app -name DevToolsActivePort -type f 2>/dev/null | head -5; ps -ef | grep -E "chrome|chromium" | grep -v grep | head -5'`
                                    : mode === 'stop-runtime'
                                      ? `resolved=$(docker inspect --format '{{.Id}} {{.Name}}' '${row.runtime_container_id}' 2>/dev/null) && test "$resolved" = '${row.runtime_container_id} /${workerId}' && docker stop --time 20 '${row.runtime_container_id}' >/dev/null && docker inspect --format 'runtime={{.Id}} status={{.State.Status}}' '${row.runtime_container_id}'`
                                      : mode === 'start-runtime'
                                        ? `resolved=$(docker inspect --format '{{.Id}} {{.Name}}' '${row.runtime_container_id}' 2>/dev/null) && test "$resolved" = '${row.runtime_container_id} /${workerId}' && docker start '${row.runtime_container_id}' >/dev/null && docker inspect --format 'runtime={{.Id}} status={{.State.Status}} image={{.Image}}' '${row.runtime_container_id}'`
                        : `docker ps -a --no-trunc --filter name=^/${workerId}$ --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}'; docker image inspect under-worker-wwebjs:latest --format 'wwebjs_latest={{.Id}}' 2>/dev/null || true; docker image inspect harbor.devunder.com/underchat/balance/under-worker-wwebjs:v20260814131741688 --format 'wwebjs_release={{.Id}}' 2>/dev/null || true; docker logs --since=30m ${workerId} 2>&1 | grep -Ei 'canonical_activation|app_state_(catch_up|sync_(completed|timed)|pre_ready)|activation_ready|activation_finalized|initialization_failed|client.failure_primary|provider.status_staged|command_ingress|jetstream|nats|runtime_status_rejected|self_monitor.unhealthy' | tail -1200`;
      const result = spawnSync(
        'sshpass',
        [
          '-e',
          'ssh',
          '-p',
          String(row.ssh_port),
          '-o',
          'StrictHostKeyChecking=no',
          '-o',
          'UserKnownHostsFile=/dev/null',
          '-o',
          'ConnectTimeout=10',
          `${user}@${row.ssh_ip}`,
          command,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, SSHPASS: password },
          input:
            mode === 'deploy-wwebjs' || mode === 'deploy-baileys'
              ? `${required('HARBOR_PASSWORD')}\n`
              : undefined,
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      if (result.status !== 0)
        throw new Error(result.stderr || `ssh_exit_${result.status}`);
      process.stdout.write(result.stdout);
      return;
    }

    const [
      worker,
      handoffs,
      activeOperations,
      outbox,
      pools,
      records,
      canonicalMeta,
      senderKeyDigests,
      anchors,
      handoffProofs,
    ] = await Promise.all([
      pool.query(
        `select w.worker_id::text,
                  w.name,
                  wt.type as worker_type,
                  ws.status as worker_status,
                  w.server_id::text,
                  w.lifecycle_operation_id::text,
                  w.container_id,
                  wr.container_id as runtime_container_id,
                  wr.container_name as runtime_container_name,
                  wr.warm_pool_id::text,
                  wr.runtime_generation,
                  wr.source_provider,
                  wr.native_connection_public_status->>'status' as native_status,
                  wr.native_connection_public_status->>'connected' as connected,
                  wr.native_connection_public_status->>'authenticated' as authenticated,
                  wr.native_connection_public_status->>'sessionValid' as session_valid,
                  wr.native_connection_public_status->>'qrAvailable' as qr_available,
                  wr.native_connection_online_acknowledged as central_ack,
                  wr.runtime_capability_hash,
                  wr.connection_epoch,
                  s.provider as session_provider,
                  s.state as session_state,
                  s.active_revision_id::text,
                  s.previous_revision_id::text,
                  s.generation as session_generation,
                  encode(s.active_device_fingerprint, 'hex') as fingerprint,
                  s.active_device_fingerprint_version as fingerprint_version,
                  r.status as revision_status,
                  r.source as revision_source,
                  r.checksum_sha256,
                  r.size_bytes::text,
                  r.writer_generation
             from worker w
             join worker_type wt on wt.worker_type_id = w.worker_type_id
             join worker_status ws on ws.worker_status_id = w.worker_status_id
             join worker_runtime wr on wr.worker_id = w.worker_id
             left join whatsapp_session s on s.session_id = w.worker_id
             left join whatsapp_session_revision r
               on r.session_id = s.session_id and r.revision_id = s.active_revision_id
            where w.worker_id = $1 and w.deleted_at is null`,
        [workerId]
      ),
      pool.query(
        `select handoff_id::text,
                  lifecycle_operation_id::text,
                  source_provider,
                  target_provider,
                  source_revision_id::text,
                  target_revision_id::text,
                  state,
                  attempt_count,
                  handoff.error_code,
                  recovery_state,
                  source_checkpoint_checksum_sha256,
                  source_checkpoint_size_bytes::text,
                  source_checkpoint_record_count::text,
                  source_drained_at,
                  point_of_no_return_at,
                  target_revision.persisted_at as target_persisted_at,
                  target_revision.validated_at as target_validated_at,
                  target_revision.promoted_at as target_promoted_at,
                  handoff.created_at,
                  handoff.completed_at,
                  case when handoff.completed_at is not null
                    then round(extract(epoch from (handoff.completed_at - handoff.created_at))::numeric, 3)
                    else null end as duration_seconds
             from whatsapp_session_handoff handoff
             left join whatsapp_session_revision target_revision
               on target_revision.session_id = handoff.session_id
              and target_revision.revision_id = handoff.target_revision_id
            where handoff.session_id = $1
            order by handoff.created_at desc
            limit 8`,
        [workerId]
      ),
      pool.query(
        `select
             (select count(*)::int from whatsapp_session_handoff
               where state in ('requested','draining','transforming','hydrating','validating','promoting','activating')) as active_handoffs,
             (select count(*)::int from whatsapp_session_handoff
               where state = 'failed' and recovery_state in ('pending','dispatching','running')) as active_recoveries,
             (select count(*)::int
                from whatsapp_session_handoff_resolution hr
                join worker w on w.worker_id = hr.session_id
               where hr.state = 'running' and w.deleted_at is null) as active_resolutions`
      ),
      pool.query(
        `select state, event_type, count(*)::int as count
             from worker_runtime_event_outbox
            where worker_id = $1 and created_at >= '2026-08-13T21:00:00Z'::timestamptz
            group by state, event_type
            order by state, event_type`,
        [workerId]
      ),
      pool.query(
        `select wt.type as worker_type, wp.state,
                  wp.server_id::text,
                  wp.container_id,
                  count(*)::int as count
             from worker_warm_pool wp
             join worker_type wt on wt.worker_type_id = wp.worker_type_id
            group by wt.type, wp.state, wp.server_id, wp.container_id
            order by wt.type, wp.state, wp.server_id, wp.container_id`
      ),
      pool.query(
        `select revision_id::text, namespace, count(*)::int as record_count,
                  sum(octet_length(payload))::int as payload_bytes
             from whatsapp_provider_record
            where session_id = $1
              and revision_id in (
                select active_revision_id from whatsapp_session where session_id = $1
                union
                select previous_revision_id from whatsapp_session where session_id = $1
              )
            group by revision_id, namespace
            order by revision_id desc, namespace`,
        [workerId]
      ),
      pool.query(
        `select revision_id::text, payload
             from whatsapp_provider_record
            where session_id = $1
              and namespace = '_wwebjs_canonical'
              and record_key = 'v1'
            order by revision_id desc
            limit 2`,
        [workerId]
      ),
      pool.query(
        `select revision_id::text,
                count(*)::int as row_count,
                sum(octet_length(sender_key))::int as payload_bytes,
                encode(digest(string_agg(encode(sender_key, 'hex'), '' order by chat_id, sender_id), 'sha256'), 'hex') as rows_sha256
           from whatsapp_sender_keys
          where session_id = $1
          group by revision_id
          order by revision_id desc
          limit 12`,
        [workerId]
      ),
      pool.query(
        `select anchor.revision_id::text,
                  anchor.anchor_generation::text,
                  anchor.artifact_id::text,
                  anchor.state,
                  anchor.checkpoint_mode,
                  anchor.canonical_generation::text,
                  anchor.baseline_app_state_checksum_sha256,
                  anchor.current_app_state_checksum_sha256,
                  anchor.app_state_overlay_required,
                  anchor.canonical_checksum_sha256,
                  anchor.source,
                  anchor.retain_until,
                  artifact.status as artifact_status,
                  artifact.checksum_sha256,
                  artifact.size_bytes::text,
                  exists (
                    select 1 from whatsapp_session_handoff handoff
                     where handoff.session_id = anchor.session_id
                       and handoff.pre_activation_artifact_id = anchor.artifact_id
                  ) as protected_by_handoff
             from whatsapp_wwebjs_profile_anchor anchor
             join whatsapp_artifact artifact
               on artifact.session_id = anchor.session_id
              and artifact.artifact_id = anchor.artifact_id
            where anchor.session_id = $1
            order by anchor.revision_id desc, anchor.anchor_generation desc`,
        [workerId]
      ),
      pool.query(
        `select artifact.artifact_id::text as handoff_id,
                artifact.revision_id::text,
                artifact.checksum_sha256,
                artifact.size_bytes::text,
                artifact.manifest->>'profile_checkpoint_mode' as profile_checkpoint_mode,
                artifact.manifest->>'profile_artifact_id' as profile_artifact_id,
                artifact.manifest->>'profile_checkpoint_duration_ms' as profile_checkpoint_duration_ms,
                artifact.manifest->>'profile_uploaded_bytes' as profile_uploaded_bytes,
                artifact.manifest->>'profile_reused_bytes' as profile_reused_bytes,
                artifact.persisted_at
           from whatsapp_artifact artifact
          where artifact.session_id = $1
            and artifact.kind = 'provider_handoff_checkpoint'
          order by artifact.persisted_at desc
          limit 12`,
        [workerId]
      ),
    ]);

    console.log(
      JSON.stringify({
        worker: worker.rows[0] ?? null,
        handoffs: handoffs.rows,
        operations: activeOperations.rows[0] ?? null,
        outbox: outbox.rows,
        pools: pools.rows,
        records: records.rows,
        canonical_meta: canonicalMeta.rows.map((row) => {
          try {
            const parsed = JSON.parse(row.payload.toString('utf8'));
            return {
              revision_id: row.revision_id,
              capabilities: parsed?.capabilities ?? null,
              provider: parsed?.provider ?? null,
              record_count: parsed?.record_count ?? null,
              size_bytes: parsed?.size_bytes ?? null,
            };
          } catch {
            return { revision_id: row.revision_id, decoded: false };
          }
        }),
        sender_key_digests: senderKeyDigests.rows,
        anchors: anchors.rows,
        handoff_proofs: handoffProofs.rows,
      })
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
