# Incident runbooks

What to do when something breaks. Each entry covers how you'll notice, what
to check, what to do, and what clients and suppliers see meanwhile.

**Fill in before December:**

| | |
|---|---|
| On call this week | _name, phone_ |
| Second | _name, phone_ |
| Supabase project | _dashboard URL_ |
| Portainer (media + cron) | _URL_ |
| Vercel project | _URL_ |
| Uptime monitor on `/api/saude` | _service, who receives alerts_ |

Two tools for every incident:

- **`/api/saude`**: `expire`, `notify`, `outbox`, `database`. A 503 names the
  failing check. The admin dashboard shows the same under "Tarefas
  agendadas".
- **Emergency switches** (admin dashboard, "Interruptores de emergência"):
  - **Suspender novos pedidos de reserva** stops all new booking requests
    within seconds. The database refuses them, so an open tab can't slip
    one in. Existing bookings carry on, and suppliers can still block dates.
  - **Suspender a criação de contas** stops new accounts. Existing users
    sign in as normal.
  - Both show a public message you can write, and every flip is in the
    audit log under your name. Turn them off again from the same place.

---

## The expiry sweep or the mailer has stopped

**You notice:** `/api/saude` returns 503 with `expire` or `notify`
("último sucesso há N min"), or the monitor alerts.

**Effect:**
- `expire` stopped: dates nobody paid for stay held, and past bookings never
  complete, so reviews never unlock.
- `notify` stopped: no email goes out at all.

**Check:** the `ngueza-cron-expire` and `ngueza-cron-notify` containers in
Portainer: running? `docker logs -f ngueza-cron-expire`. A 401 means
`CRON_SECRET` differs between the app and the container. A 503 from the app
means `CRON_SECRET` isn't set on Vercel.

**Do:** restart the container. To catch up immediately:

```bash
curl -fsS -X POST -H "authorization: Bearer $CRON_SECRET" https://ngueza.com/api/cron/expire
curl -fsS -X POST -H "authorization: Bearer $CRON_SECRET" https://ngueza.com/api/cron/notify
```

Both are safe to run as often as you like.

## Emails are not being delivered

**You notice:** `/api/saude` shows `outbox` unhealthy ("N por enviar, M
falhados"), or people say they got nothing.

**Check:** the latest failed runs on the admin dashboard show the SMTP
error. Typical causes are an expired password, a sending limit reached, or
the provider blocking the domain.

**Do:** fix the credentials in Vercel (`SMTP_*`) and redeploy. Queued emails
go out on the next `notify` run; nothing is lost. Rows that reached
`failed` are not retried automatically.

**Note:** Supabase Auth's own emails (sign-up confirmation, password reset)
use a separate mailer, configured in the Supabase dashboard. See
`docs/supabase.md`.

## The database is unreachable

**You notice:** `/api/saude` returns `database: sem resposta`, and every
page that reads data errors.

**Check:** the Supabase status page and the project's dashboard.
`DATABASE_URL` must point at the **pooler**; `db.<ref>.supabase.co` is
IPv6-only (`docs/supabase.md`).

**Do:** wait for Supabase, or fix the connection string. Nothing to restore:
writes that failed were never committed.

## A scam wave, or a fraudulent supplier

**You notice:** help requests about "fraude" in `/admin/apoio` (they're
listed first), or reports in `/admin/denuncias`.

**Do, in order:**
1. **Suspend the supplier** from their admin page. Their listing and photos
   disappear, and new requests to them are refused.
2. If it's spreading, or you don't yet know how, switch on **Suspender
   novos pedidos de reserva**, with a message such as "Estamos a rever
   pedidos por razões de segurança. Volte dentro de algumas horas."
3. Write to the affected clients (their emails are on each booking in the
   admin): "não pague", and what to do if they already did.
4. Police complaints and any data-protection (APD) notification are
   NGUEZA's legal decision, not an engineering one.

Remember the model: NGUEZA never holds money. There is nothing to refund
from the platform; the record of what happened is `booking_events`,
`payments`, and `refund_attestations` (what the supplier says they returned,
and whether the client confirmed or disputed it, slice 47).

## Two clients say they have the same date

**Check:** this should be impossible for a space: the database refuses
overlapping holds (`bookings_no_double_booking`). Look at both bookings'
history (`booking_events`). Usually one was only "aceite", and slice 28
(0033) now closes it the moment the other takes the date. If two
*confirmed* overlapping bookings exist for one space, it's a bug: switch on
**Suspender novos pedidos de reserva** and escalate to engineering.

**Do:** contact both clients and the supplier. The one confirmed first
keeps the date. Any refund is agreed with the supplier, as always.

## A bad deploy

**You notice:** errors in Sentry right after a deploy, or pages failing.

**Do:** roll back to the previous deployment in Vercel (instant).
**Migrations can't be rolled back.** They're append-only by design, so a
schema problem is fixed with a new migration. If a migration is the
problem, pause bookings while it's fixed.

## Uploads or photos are failing

**You notice:** suppliers report "o armazenamento de fotografias não está
disponível", clients can't send payment proof, or listings show
placeholders.

**Check:** `ngueza-minio` and `ngueza-imgproxy` in Portainer
(`deploy/media/README.md`), and `https://media.ngueza.com/minio/health/live`.

**Do:** restart the stack. `minio-init` re-runs and keeps both buckets
private. Confirm that `GET /ngueza-media/` still answers 403.

## "Demasiadas tentativas" for everyone

**Cause:** Supabase Auth's own per-IP limit. Every sign-in reaches it from
the app's servers. Slice 33 forwards the visitor's IP, but whether hosted
Supabase honours it is unverified.

**Do:** raise the limits in the Supabase dashboard (Auth → Rate Limits) and
make sure custom SMTP is configured there. The built-in mailer's limit is a
few emails per hour.

## Suspected data exposure

**Do immediately:**
- Rotate whatever may be exposed: Supabase service-role key, database
  password, `CRON_SECRET`, MinIO keys, `IMGPROXY_KEY`/`SALT`, SMTP password.
- Redeploy with the new values.
- Check `audit_log` and Supabase's logs for what was touched.

**Then:** whether and how to notify the APD and the people affected is a
legal decision for NGUEZA, with counsel. Write down a timeline as you go.
