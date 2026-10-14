#!/usr/bin/env bash
# Runs 012_mail.sql against a throwaway local Postgres 17 with a Supabase auth/storage shim and checks RLS + claim.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; tmp="$(mktemp -d)"; bin=/usr/lib/postgresql/17/bin; port=55433
$bin/initdb -D "$tmp/d" -U postgres -A trust >/dev/null; $bin/pg_ctl -D "$tmp/d" -o "-p $port -k $tmp" -l "$tmp/log" start -w >/dev/null
trap '$bin/pg_ctl -D "$tmp/d" stop -m fast >/dev/null; rm -rf "$tmp"' EXIT
P="psql -h $tmp -p $port -U postgres -X -q -v ON_ERROR_STOP=1"
$P -f "$here/supabase_shim.sql" >/dev/null
$P -f "$here/../../supabase/migrations/012_mail.sql" >/dev/null
$P -f "$here/../../supabase/migrations/012_mail.sql" >/dev/null   # idempotent re-run
out="$(psql -h $tmp -p $port -U postgres -X -tA -f "$here/rls.sql" 2>&1)"; echo "$out"
fail=0; for want in anon_msgs=0 anon_outbox=0 anon_objs=0 u1_msgs=1 u1_objs=1 u1_read=true "only is_read can be changed" \
  "row-level security" u1_insert_status=queued u1_cancel=cancelled regen=true "only recipients, subject, body and status" "draft_sent=queued regen=false" style_edits=1 \
  "permission denied for function mail_outbox_claim" u2_outbox=0 u2_style=0 u2_objs=1 claim1=2 claim2=0 drafts_never_claimed=0 marked=sent; do
  grep -qF -- "$want" <<<"$out" || { echo "MISSING: $want"; fail=1; }; done
n=$(grep -c "row-level security" <<<"$out"); [ "$n" -ge 2 ] || { echo "expected 2 RLS insert rejections, got $n"; fail=1; }
[ $fail = 0 ] && echo "SQL TESTS PASS" || { echo "SQL TESTS FAIL"; exit 1; }
