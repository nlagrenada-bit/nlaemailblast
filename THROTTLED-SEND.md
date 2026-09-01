# Throttled blast — what changed and how to deploy

Rebuilt against Microsoft's guidance: keep the mailbox **under 30 messages/min**,
spread sends over time, and **stop the single large BCC blast**. The old blast
was one BCC message; it now sends **individually, throttled to 20/min**, with
internal staff CC'd separately. Per-recipient sending is what removes the
"compromised account" behavioural signal that was triggering the restriction.

## The sending profile

| Leg | How it sends | Rate |
|---|---|---|
| External (media, public) | one message each, 5 per 15s burst | 20/min (a third under the 30 ceiling) |
| Pause | 60s | — |
| Internal `@nla.gd` staff | ONE message, To info@nla.gd, staff in CC | not throttled* |

\* Tenant-internal mail (nla.gd → nla.gd) stays inside Microsoft 365 and never
crosses the outbound spam filter, so only the external leg needs throttling.

~6 minutes for 100 external recipients. The send runs **server-side in a
background function** and continues even if the operator closes the tab.

## Deploy order

1. Run `supabase/02_blast_runs.sql` in the Supabase SQL editor.
2. Deploy the code (the two functions + UI changes):
   ```
   git add -A && git commit -m "Throttled per-recipient send (Microsoft <30/min)" && git push
   ```
3. Add env vars in Netlify (see below), then redeploy.

## Environment variables

Existing (unchanged): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_REPLY_TO`, `WEBSITE_WEBHOOK_URL`,
`WEBSITE_WEBHOOK_SECRET`.

New / tunable (all optional — defaults shown):
```
BATCH_SIZE          = 5        # messages per burst
BATCH_INTERVAL_MS   = 15000    # gap between bursts -> 20/min at size 5
INTERNAL_DELAY_MS   = 60000    # pause before the internal CC leg
INTERNAL_CC_CHUNK   = 0        # 0 = one CC message; set e.g. 15 to chunk
BLAST_FROM          = info@nla.gd   # becomes results.nla.gd after the relay migration
```
**Do not raise BATCH_SIZE or lower BATCH_INTERVAL_MS** without recomputing the
rate: `BATCH_SIZE / (BATCH_INTERVAL_MS/1000) * 60` must stay well under 30.

## Verify before you trust it

- **No background function needed.** The send uses a self-chaining regular
  function (`send-blast-slice`): each call sends ~6 messages in ~18s, then
  re-invokes itself for the next slice until done. Works on any Netlify plan and
  stays under the 26s function limit. Progress moves in the UI as slices land.
- **First live run**, watch a run row fill in:
  ```sql
  select status, sent_count, failed_count, error_message
  from blast_runs order by started_at desc limit 1;
  ```

## The evidence trail Microsoft asked for

Every recipient's exact SMTP response is captured. Pull the failures with:
```sql
select email, error_text, sent_at
from blast_recipients
where run_id = '<run-id>' and status = 'failed';
```
If the mailbox is restricted mid-run, the first `550 5.1.8` **halts the run
immediately** (continuing only deepens the detection), marks it `failed` with
the count that got through, and leaves the rest `pending` — so a retry after
unblocking resumes rather than restarts.

## This is a stopgap — the real fix is the subdomain

Microsoft's second recommendation was a dedicated bulk-mail subdomain with SPF,
DKIM and DMARC. That can't happen while `info@nla.gd` sends from Exchange Online.
This build keeps results flowing and produces the ticket evidence, but the
underlying trigger remains until the **`results.nla.gd` relay** lands. When it
does: point `BLAST_FROM` at the relay, keep `info@nla.gd` as Reply-To, and
`BATCH_INTERVAL_MS` can drop to near zero — the 30/min ceiling is a Microsoft
mailbox limit that stops applying off Exchange Online. Note also that SMTP AUTH
basic authentication is disabled by default from December 2026, so the relay
migration is required regardless.
