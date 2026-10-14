#!/usr/bin/env bash
# Spins up a throwaway Postgres 17 with Supabase auth/storage stubs, applies 001..016, seeds pre-017 data, applies 017 twice, runs the RLS tests.
set -e; B=/usr/lib/postgresql/17/bin; D=/tmp/pgfam; H=$(cd "$(dirname "$0")" && pwd); M=$H/../migrations
[ -f $D/d/postmaster.pid ] && $B/pg_ctl -D $D/d stop -m fast >/dev/null || true; rm -rf $D/d; mkdir -p $D
$B/initdb -D $D/d -U postgres -A trust >/dev/null; $B/pg_ctl -D $D/d -o "-p 55432 -k $D" -l $D/log start >/dev/null
P="psql -h $D -p 55432 -U postgres -q -v ON_ERROR_STOP=1"
$P -f $H/stubs.sql
for f in $M/0*.sql; do case $f in *017_family.sql) continue;; esac; $P -f $f >/dev/null 2>&1 || echo "note: $(basename $f) partially applied on the stub DB"; done
$P -c "create table if not exists private.google_tokens(user_id uuid)" >/dev/null 2>&1 || true
$P -f $H/017_seed.sql
$P -f $M/017_family.sql >/dev/null 2>$D/017.log && $P -f $M/017_family.sql >/dev/null 2>>$D/017.log && echo "017 applied (and re-applied) OK"
$P -o /dev/null -f $H/017_family_rls.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
if [ -f $M/020_sync_devices.sql ]; then
  $P -f $M/020_sync_devices.sql >/dev/null && $P -f $M/020_sync_devices.sql >/dev/null && echo "020 applied (and re-applied) OK"
  $P -o /dev/null -f $H/020_sync_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
fi
