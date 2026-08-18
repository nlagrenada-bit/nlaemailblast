# NLA Results Desk

Results entry and email blast tool for the National Lotteries Authority.
React + Vite on Netlify, Postgres + Auth on Supabase, transactional email
through Resend.

An operator enters a draw result, watches the email build itself in the panel
alongside, and sends it after a typed confirmation. At 9pm the complete day's
results are assembled automatically and staged for approval.

---

## What it covers

| Game | Result | Draw times |
|---|---|---|
| Cash Pop | one number, 1–15 | 8:45am Kick-Off · 11:45am Mid-Rush · 2:45pm Lunch · 5:45pm After-Work · 8:45pm Prime-Time |
| Play Way | one number, 1–36, with its chart symbol | 9:45am · 12:45pm · 4:45pm · 7:45pm |
| Daily Pick 3 | three digits, 000–999 | same four periods |
| Daily Cash 4 | four digits, 0000–9999 | same four periods |
| Multi-X | FP, 2X, 3X, 5X, 7X, 10X on each daily game | with each daily draw |
| Lotto | 5 from 1–34 plus free ticket letter A–O | Mon, Wed, Fri |
| Super 6 | 6 from 1–28 plus free ticket letter A–O | Tue, Fri |

Daily games run Monday to Saturday. Any of it can be moved or dropped for a
given day — see **Disruptions** below.

---

## First run

### 1. Supabase

Create a project, then in the SQL editor run, in order:

```
supabase/schema.sql
supabase/seed.sql
```

Add yourself to the desk. Create the user under **Authentication → Users**,
then:

```sql
insert into staff (id, email, full_name, role)
values ('<the-user-uuid>', 'you@nla.gd', 'Your Name', 'admin');
```

Roles:

- `operator` — enters results, saves drafts, cannot send
- `approver` — everything an operator does, plus sending
- `admin` — same as approver

### 2. Assets

The email references logos, Play Way symbols and ball images by absolute URL.
They ship in `public/assets`, so the simplest option is to serve them from the
Netlify site itself:

```
VITE_ASSET_BASE_URL=https://your-site.netlify.app/assets
```

If you would rather host them on Supabase Storage, create a **public** bucket
called `nla-assets`, run `npm run upload-assets`, and point the variable at
the bucket's public URL instead.

### 3. Resend

Verify your sending domain, create an API key, and set `MAIL_FROM` to an
address on that domain. Anything else will be rejected or land in spam.

### 4. Netlify

Connect the repository, then set the environment variables from
`.env.example` under **Site configuration → Environment variables**. Deploy.

The nightly job registers itself from `netlify/functions/eod-blast.mjs` — no
extra setup.

### Local development

```bash
npm install
cp .env.example .env      # fill it in
npm run dev               # netlify dev, so /api/* works
```

---

## How a blast gets sent

1. Pick a draw from the left rail. The rail is the day in the order it
   actually happens, Cash Pop and the daily draws interleaved, with a marker on
   whichever draw is due next.
2. Enter the draw number, the winning numbers, the Multi-X ball and the payout.
   Everything saves as you go.
3. The right panel rebuilds the email on every keystroke. Toggle between the
   HTML and plain-text bodies — both are sent, and recipients see whichever
   their client prefers.
4. Anything missing shows up as a warning. Warnings do not block sending;
   errors do.
5. **Review and send** opens the confirmation: subject, audience, live
   recipient count, outstanding gaps, and a typed `SEND`. Nothing leaves
   without passing through it.

The browser never talks to the email provider. It saves the blast — subject,
HTML, text, audience — and calls `/api/send-blast`, which re-reads that row and
sends exactly those bytes. What was approved is what goes out.

Recipients are always BCC'd, in batches of 45 with a pause between, so nobody
sees anyone else's address and the provider's rate limit is respected.

---

## Draw numbers

Every game keeps its own running sequence: Play Way, Pick 3, Cash 4, Cash Pop,
Lotto and Super 6 each count separately.

Draw numbers are **stored on the result, not derived from the date**. That is
deliberate. When a draw is postponed, cancelled, or run out of its usual slot,
the number has to follow what actually happened rather than what the calendar
expected. The app suggests the next number in each sequence and offers a
one-click **Use 14208**, but the operator can type anything.

Two safety nets, neither of which blocks you:

- A **skip** is flagged (`3 numbers skipped since 14203`). After a cancelled
  draw that is the correct answer — the warning just makes sure it was
  deliberate.
- A **repeat or step backwards** is flagged more firmly. Database-level unique
  indexes make an actual duplicate impossible.

For month-end reconciliation, the `draw_number_gaps` view lists every break in
every sequence with the date it happened around:

```sql
select * from draw_number_gaps;
```

---

## Disruptions

Set the day status in the left rail:

- **Running normally** — the weekly schedule applies.
- **Disrupted** — some draws moved or dropped. Write a notice; it appears in a
  highlighted band at the top of every blast that day, in both HTML and text.
- **Cancelled** — no draws. The nightly job skips the day entirely.

Individual games can be switched on or off for a date through the
`daily_on` / `cash_pop_on` / `lotto_on` / `super6_on` columns on `draw_days`.
That covers a Super 6 pushed from Tuesday to Wednesday: turn it off on the
Tuesday, on for the Wednesday, and carry its draw number across unchanged.

---

## Recipients

- **Add one** — address and optional name.
- **Add a batch** — paste a list or a CSV. Handles `name, email`,
  `email, name`, and `"Name" <email>`. Duplicates are skipped rather than
  overwritten; unreadable lines are reported back rather than silently dropped.
- **Groups** — Media, Agents, Internal and so on. A blast can go to everyone or
  to selected groups, chosen at the moment of sending.
- **Pause** an address to stop mail without losing the record. Bounced and
  unsubscribed addresses are excluded automatically.
- **Export CSV** of whatever the current filter shows.

The audience is resolved when the blast sends, not when it is drafted, so
somebody removed at 8:50pm will not receive the 9pm summary.

---

## The nightly complete-day blast

Runs at 9:00pm AST, Monday to Saturday (`0 1 * * 2-7` in UTC).

Default behaviour is **stage a draft**: it assembles the complete day, saves it
as a draft, and emails whoever is listed in `DESK_NOTIFY_TO` to say it is ready,
including any gaps it noticed. Someone opens History and sends it.

Switch to **send automatically** in Settings once you trust the day's entries to
be complete by 9pm. If results are missing it does not send a broken email — it
emails the desk to say what is missing.

---

## Email rendering

Some choices worth knowing about if you edit the template.

**Balls are pre-rendered PNGs, not CSS circles.** Outlook renders mail through
Word, which ignores `border-radius`. CSS balls arrive as squares for a large
share of corporate and media recipients — exactly the people on this list. All
154 balls are generated once by `scripts/generate_balls.py` and committed. Each
is about 2KB, so a full day's blast stays well under the 102KB threshold at
which Gmail clips a message.

To restyle them, edit the `STYLES` map in that script and run `npm run balls`.

**Play Way symbols** were cut from the quick-reference chart by
`scripts/extract_symbols.py` and sit on transparent backgrounds at
`public/assets/playway/01.png` through `36.png`.

**The markup is tables and inline styles only.** No flexbox, no grid, no
dependence on a `<style>` block surviving. Every image carries width, height and
alt text so a blocked-images inbox still reads correctly.

To preview a change without touching the database:

```bash
ASSET_BASE="file://$PWD/public/assets" node scripts/sample-email.mjs eod > /tmp/preview.html
node scripts/sample-email.mjs eod --text
```

Valid arguments: `eod`, `daily_period`, `cash_pop`, `lotto`, `super6`.

---

## Wording

Settings holds the pieces that change without a deploy:

- **Free ticket letters** — the word read with each letter, so `G` prints as
  `G as in GRAND`.
- **Greeting** — `Dear All,` by default.
- **Footer** — the provisional-results disclaimer.

Sentence construction handles the awkward cases: a tier with no winners drops
out entirely, and whichever tier leads takes the `There was` / `There were`
opener, so `There were 70 Match-3 winners paying $13.00` reads correctly even
when there were no Match-4 winners.

---

## Security

- The browser holds only the Supabase **anon** key. Row level security limits
  every table to signed-in staff.
- The **service role** key and the Resend key exist only in Netlify's
  environment, used by the functions. Neither is prefixed `VITE_`, so neither
  can reach the bundle.
- Sending requires the `approver` or `admin` role, checked server-side in
  `send-blast.mjs` — not just hidden in the UI.
- A blast is claimed before sending, so a double-click cannot send twice.

---

## Layout

```
shared/          domain model, email builder, document builder
                 imported by both the browser and the functions, so the
                 preview and the send path cannot drift apart
  config.js         games, periods, symbols, schedule, formatting
  emailTemplate.js  HTML and plain-text builders
  buildDoc.js       database rows -> normalised document, plus validation

src/             the React app
  components/       Ball, DrawNumber, Rail, Preview, SendDialog, Toast
  views/            Results, Recipients, History, Settings, SignIn
  lib/              Supabase client, data access, date helpers

netlify/functions/
  send-blast.mjs    approved blast -> provider, with delivery records
  eod-blast.mjs     scheduled nightly complete-day blast

supabase/
  schema.sql        tables, RLS, draw-number helpers, gap view
  seed.sql          default settings and recipient groups

scripts/
  generate_balls.py   the 154 ball images
  extract_symbols.py  Play Way chart -> 36 transparent symbols
  sample-email.mjs    render a sample blast without a database
```
