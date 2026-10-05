#!/bin/sh
# One-off job of the `migrate` service: apply migrations, then seed ONLY an empty database.
set -e
echo "[bootstrap] applying migrations"
npx prisma migrate deploy
set +e
npx tsx scripts/bootstrap-status.ts
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "[bootstrap] database already seeded — skipping seed (restart-safe)"
elif [ "$status" -eq 10 ]; then
  echo "[bootstrap] empty database — loading curriculum and approved release content"
  npx prisma db seed
else
  echo "[bootstrap] database check failed" >&2
  exit "$status"
fi
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  echo "[bootstrap] ensuring configured application admin exists"
  npx tsx scripts/bootstrap-admin.ts
else
  echo "[bootstrap] no application admin bootstrap credentials configured — skipping"
fi
echo "[bootstrap] done"
