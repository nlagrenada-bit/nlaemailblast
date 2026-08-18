import React, { useEffect, useMemo, useState } from 'react';
import {
  DAILY_PERIODS, CASH_POP_PERIODS, MULTIPLIERS, GAMES, LETTERS,
  gamesScheduledOn, longDate, symbolFor,
} from '../../shared/config.js';
import { buildDoc, validateDoc } from '../../shared/buildDoc.js';
import { buildEmail } from '../../shared/emailTemplate.js';
import { ASSET_BASE } from '../lib/supabase.js';
import { todayLocal } from '../lib/dates.js';
import * as api from '../lib/api.js';
import Rail from '../components/Rail.jsx';
import Preview from '../components/Preview.jsx';
import SendDialog from '../components/SendDialog.jsx';
import { Ball, BallInput, DigitRow, MultiXPicker, SymbolChip } from '../components/Ball.jsx';
import DrawNumber from '../components/DrawNumber.jsx';
import { useToast } from '../components/Toast.jsx';

const logo = (file) => `${ASSET_BASE}/${file}`;
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export default function ResultsView({ date, settings, groups, canSend }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [selected, setSelected] = useState(null);
  const [includeEarlierPops, setIncludeEarlierPops] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [nextNos, setNextNos] = useState({});
  const reload = () => {
    api.nextDrawNumbers().then(setNextNos).catch(() => {});
    return api.loadDay(date).then(setState).catch((e) => toast(e.message, 'bad'));
  };
  useEffect(() => { setState(null); reload(); /* eslint-disable-next-line */ }, [date]);

  const scheduled = useMemo(() => gamesScheduledOn(date, state?.day && {
    daily: state.day.daily_on, cash_pop: state.day.cash_pop_on,
    lotto: state.day.lotto_on, super6: state.day.super6_on,
    cancelled: state.day.status === 'cancelled',
  }), [date, state?.day]);

  useEffect(() => {
    if (!state || selected) return;
    setSelected(scheduled.daily ? 'daily:mid_morning'
      : scheduled.cash_pop ? 'pop:kick_off'
      : scheduled.lotto ? 'lotto' : scheduled.super6 ? 'super6' : 'eod');
  }, [state, selected, scheduled]);

  if (!state) return <div className="main"><div className="empty">Loading the day…</div></div>;

  // ------------------------------------------------------------- mutations

  const patchDaily = async (period, patch) => {
    const existing = state.daily.find((r) => r.period === period) || {};
    const row = { ...existing, draw_date: date, period, ...patch };
    delete row.id; delete row.created_at; delete row.updated_at;
    setSaving(true);
    try {
      const saved = await api.saveDaily(row);
      setState((s) => ({
        ...s,
        daily: [...s.daily.filter((r) => r.period !== period), saved],
      }));
    } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  };

  const patchPop = async (period, patch) => {
    const existing = state.cashPops.find((r) => r.period === period) || {};
    const row = { ...existing, draw_date: date, period, ...patch };
    delete row.id; delete row.created_at; delete row.updated_at;
    setSaving(true);
    try {
      const saved = await api.saveCashPop(row);
      setState((s) => ({
        ...s, cashPops: [...s.cashPops.filter((r) => r.period !== period), saved],
      }));
    } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  };

  const patchJackpotGame = async (which, patch) => {
    const existing = (which === 'lotto' ? state.lotto : state.super6) || {};
    const row = { ...existing, draw_date: date, ...patch };
    delete row.created_at; delete row.updated_at;
    if (!row.numbers?.length) row.numbers = which === 'lotto' ? [] : [];
    setSaving(true);
    try {
      const saved = which === 'lotto' ? await api.saveLotto(row) : await api.saveSuper6(row);
      setState((s) => ({ ...s, [which]: saved }));
    } catch (e) { toast(e.message, 'bad'); } finally { setSaving(false); }
  };

  const patchDay = async (patch) => {
    try {
      const saved = await api.saveDayStatus(date, { ...state.day, ...patch });
      setState((s) => ({ ...s, day: saved }));
    } catch (e) { toast(e.message, 'bad'); }
  };

  // -------------------------------------------------------- what to render

  const [kind, code] = (selected || '').split(':');
  const dailyRow = code ? state.daily.find((r) => r.period === code) : null;
  const popRow = code ? state.cashPops.find((r) => r.period === code) : null;

  // ------------------------------------------------------- preview & email

  const scope = useMemo(() => {
    if (selected === 'eod') {
      return {
        kind: 'eod', label: 'Complete day results',
        daily: state.daily, cashPops: state.cashPops,
        lotto: state.lotto, super6: state.super6,
      };
    }
    if (kind === 'daily') {
      return {
        kind: 'daily_period',
        label: DAILY_PERIODS.find((p) => p.code === code)?.label,
        daily: dailyRow ? [dailyRow] : [], cashPops: [], lotto: null, super6: null,
      };
    }
    if (kind === 'pop') {
      const order = CASH_POP_PERIODS.map((p) => p.code);
      const upto = order.indexOf(code);
      const pops = includeEarlierPops
        ? state.cashPops.filter((r) => order.indexOf(r.period) <= upto)
        : (popRow ? [popRow] : []);
      return {
        kind: 'cash_pop',
        label: CASH_POP_PERIODS.find((p) => p.code === code)?.label,
        daily: [], cashPops: pops, lotto: null, super6: null,
      };
    }
    if (selected === 'lotto') {
      return { kind: 'lotto', label: 'Lotto Draw', daily: [], cashPops: [], lotto: state.lotto, super6: null };
    }
    if (selected === 'super6') {
      return { kind: 'super6', label: 'Super 6 Draw', daily: [], cashPops: [], lotto: null, super6: state.super6 };
    }
    return { kind: 'custom', label: '', daily: [], cashPops: [], lotto: null, super6: null };
  }, [selected, state, includeEarlierPops, kind, code, dailyRow, popRow]);

  const doc = useMemo(() => buildDoc({
    date, kind: scope.kind, daily: scope.daily, cashPops: scope.cashPops,
    lotto: scope.lotto, super6: scope.super6, settings, day: state.day,
  }), [date, scope, settings, state.day]);

  const check = useMemo(() => validateDoc(doc), [doc]);
  const email = useMemo(
    () => buildEmail(doc, { assetBase: ASSET_BASE, footer: settings.footer }),
    [doc, settings.footer],
  );

  // -------------------------------------------------------------- sending

  async function confirmSend(groupIds) {
    setBusy(true);
    try {
      const blast = await api.createBlast({
        draw_date: date, kind: scope.kind, label: scope.label,
        subject: email.subject, html: email.html, text_body: email.text,
        group_ids: groupIds.length ? groupIds : null, status: 'draft',
      });
      const res = await api.sendBlast(blast.id);
      toast(`Sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}.`, 'good');
      setDialog(false);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally { setBusy(false); }
  }

  async function saveDraft() {
    try {
      await api.createBlast({
        draw_date: date, kind: scope.kind, label: scope.label,
        subject: email.subject, html: email.html, text_body: email.text, status: 'draft',
      });
      toast('Saved as a draft. Find it under History.', 'good');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ----------------------------------------------------------------- view

  return (
    <>
      <Rail
        date={date} isToday={date === todayLocal()} selected={selected}
        onSelect={(k) => { setSelected(k); setIncludeEarlierPops(false); }}
        day={state.day} onDayChange={patchDay}
        results={state} scheduled={scheduled}
      />

      <div className="main">
        <div className="pagehead">
          <h1>{scope.label || 'Results'}</h1>
          <span className="sub">{longDate(date)}{saving ? ' · saving…' : ''}</span>
        </div>

        {state.day?.status === 'cancelled' && (
          <div className="notice warn">
            This day is marked cancelled. Nothing will be scheduled until you change the status.
          </div>
        )}

        {kind === 'daily' && (
          <DailyEntry row={dailyRow} period={code} nextNos={nextNos}
            onPatch={(p) => patchDaily(code, p)} />
        )}

        {kind === 'pop' && (
          <PopEntry
            row={popRow} period={code} nextNos={nextNos} onPatch={(p) => patchPop(code, p)}
            includeEarlier={includeEarlierPops} setIncludeEarlier={setIncludeEarlierPops}
          />
        )}

        {selected === 'lotto' && (
          <JackpotEntry
            which="lotto" row={state.lotto} nextNos={nextNos}
            onPatch={(p) => patchJackpotGame('lotto', p)}
            settings={settings}
          />
        )}

        {selected === 'super6' && (
          <JackpotEntry
            which="super6" row={state.super6} nextNos={nextNos}
            onPatch={(p) => patchJackpotGame('super6', p)}
            settings={settings}
          />
        )}

        {selected === 'eod' && <EodSummary state={state} scheduled={scheduled} />}
      </div>

      <Preview email={email} warnings={check.warnings} errors={check.errors}>
        <div className="actions">
          <button className="btn" onClick={saveDraft}>Save draft</button>
          <div style={{ marginLeft: 'auto' }} />
          <button
            className="btn primary"
            disabled={!check.ok || !canSend}
            onClick={() => setDialog(true)}
            title={canSend ? undefined : 'Your account can enter results but not send blasts.'}
          >
            Review and send
          </button>
        </div>
      </Preview>

      <SendDialog
        open={dialog} onClose={() => setDialog(false)} onConfirm={confirmSend}
        email={email} date={date} label={scope.label} groups={groups}
        warnings={check.warnings} busy={busy}
      />
    </>
  );
}

// ------------------------------------------------------------- entry forms

function GameCard({ logoFile, title, hint, children }) {
  return (
    <section className="card">
      <header>
        <img src={logo(logoFile)} alt="" />
        <h3>{title}</h3>
        {hint && <span className="hint">{hint}</span>}
      </header>
      <div className="body">{children}</div>
    </section>
  );
}

function MoneyField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="money" type="text" inputMode="decimal"
        value={value ?? ''} placeholder="0.00"
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
      />
    </div>
  );
}

function DailyEntry({ row, period, onPatch, nextNos }) {
  const p = DAILY_PERIODS.find((x) => x.code === period);
  const [payouts, setPayouts] = useState({});
  useEffect(() => setPayouts({}), [period, row?.id]);

  const pay = (key) => payouts[key] ?? row?.[key] ?? '';
  const commitPay = (key) => {
    if (payouts[key] === undefined) return;
    onPatch({ [key]: payouts[key] === '' ? null : Number(payouts[key]) });
  };

  return (
    <>
      <GameCard logoFile={GAMES.play_way.logo} title={`Play Way — ${p.label}`} hint="1 to 36">
        <DrawNumber
          value={row?.play_way_draw_no} suggestion={nextNos?.play_way}
          onChange={(v) => onPatch({ play_way_draw_no: v })}
        />
        <div className="row">
          <div className="field">
            <label>Winning number</label>
            <div className="balls">
              <BallInput
                style="playway" value={row?.play_way_number ?? ''} min={1} max={36} width={2}
                label="Play Way winning number"
                onChange={(v) => onPatch({ play_way_number: num(v) })}
              />
              <SymbolChip number={row?.play_way_number} />
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 20 }}>
          <div className="field">
            <label>Multi-X ball</label>
            <MultiXPicker
              label="Play Way Multi-X" options={MULTIPLIERS}
              value={row?.play_way_multiplier}
              onChange={(v) => onPatch({ play_way_multiplier: v })}
            />
          </div>
          <MoneyField
            label="Play Way payout" value={pay('play_way_payout')}
            onChange={(v) => setPayouts((x) => ({ ...x, play_way_payout: v }))}
          />
          <button className="btn sm" onClick={() => commitPay('play_way_payout')}>Save payout</button>
        </div>
      </GameCard>

      <GameCard logoFile={GAMES.pick3.logo} title={`Daily Pick 3 — ${p.label}`} hint="000 to 999">
        <DrawNumber
          value={row?.pick3_draw_no} suggestion={nextNos?.pick3}
          onChange={(v) => onPatch({ pick3_draw_no: v })}
        />
        <div className="row">
          <div className="field">
            <label>Winning numbers</label>
            <DigitRow
              count={3} style="pick3" label="Pick 3" digits={row?.pick3_digits}
              onChange={(d) => onPatch({ pick3_digits: d.length ? d.map(Number) : null })}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 20 }}>
          <div className="field">
            <label>Multi-X ball</label>
            <MultiXPicker
              label="Pick 3 Multi-X" options={MULTIPLIERS} value={row?.pick3_multiplier}
              onChange={(v) => onPatch({ pick3_multiplier: v })}
            />
          </div>
          <MoneyField
            label="Pick 3 payout" value={pay('pick3_payout')}
            onChange={(v) => setPayouts((x) => ({ ...x, pick3_payout: v }))}
          />
          <button className="btn sm" onClick={() => commitPay('pick3_payout')}>Save payout</button>
        </div>
      </GameCard>

      <GameCard logoFile={GAMES.cash4.logo} title={`Daily Cash 4 — ${p.label}`} hint="0000 to 9999">
        <DrawNumber
          value={row?.cash4_draw_no} suggestion={nextNos?.cash4}
          onChange={(v) => onPatch({ cash4_draw_no: v })}
        />
        <div className="row">
          <div className="field">
            <label>Winning numbers</label>
            <DigitRow
              count={4} style="cash4" label="Cash 4" digits={row?.cash4_digits}
              onChange={(d) => onPatch({ cash4_digits: d.length ? d.map(Number) : null })}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 20 }}>
          <div className="field">
            <label>Multi-X ball</label>
            <MultiXPicker
              label="Cash 4 Multi-X" options={MULTIPLIERS} value={row?.cash4_multiplier}
              onChange={(v) => onPatch({ cash4_multiplier: v })}
            />
          </div>
          <MoneyField
            label="Cash 4 payout" value={pay('cash4_payout')}
            onChange={(v) => setPayouts((x) => ({ ...x, cash4_payout: v }))}
          />
          <button className="btn sm" onClick={() => commitPay('cash4_payout')}>Save payout</button>
        </div>
      </GameCard>
    </>
  );
}

function PopEntry({ row, period, onPatch, nextNos, includeEarlier, setIncludeEarlier }) {
  const p = CASH_POP_PERIODS.find((x) => x.code === period);
  const [payout, setPayout] = useState(undefined);
  useEffect(() => setPayout(undefined), [period, row?.id]);

  return (
    <GameCard logoFile={GAMES.cash_pop.logo} title={`Cash Pop — ${p.label}`} hint="1 to 15">
      <DrawNumber
        value={row?.draw_no} suggestion={nextNos?.cash_pop}
        onChange={(v) => onPatch({ draw_no: v })}
      />
      <div className="row">
        <div className="field">
          <label>Winning number</label>
          <div className="balls">
            <BallInput
              style="cashpop" value={row?.number ?? ''} min={1} max={15} width={2}
              label="Cash Pop winning number"
              onChange={(v) => onPatch({ number: num(v) })}
            />
          </div>
        </div>
        <MoneyField
          label="Payout" value={payout ?? row?.payout ?? ''}
          onChange={setPayout}
        />
        <button
          className="btn sm"
          onClick={() => payout !== undefined && onPatch({ payout: payout === '' ? null : Number(payout) })}
        >Save payout</button>
      </div>

      <label style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 22, fontSize: 13 }}>
        <input
          type="checkbox" checked={includeEarlier}
          onChange={(e) => setIncludeEarlier(e.target.checked)}
        />
        Include every Cash Pop drawn so far today in this blast
      </label>
    </GameCard>
  );
}

function JackpotEntry({ which, row, onPatch, settings, nextNos }) {
  const isLotto = which === 'lotto';
  const cfg = isLotto ? GAMES.lotto : GAMES.super6;
  const pick = isLotto ? 5 : 6;
  const max = isLotto ? 34 : 28;
  const style = isLotto ? 'lotto' : 'super6';
  const secondTier = isLotto ? 'match3' : 'match5';
  const secondLabel = isLotto ? 'Match-3' : 'Match-5';

  const [draft, setDraft] = useState({});
  useEffect(() => setDraft({}), [which, row?.draw_date]);
  const val = (k) => draft[k] ?? row?.[k] ?? '';
  const commit = (k, cast = Number) =>
    draft[k] !== undefined && onPatch({ [k]: draft[k] === '' ? null : cast(draft[k]) });

  const numbers = Array.from({ length: pick }, (_, i) => row?.numbers?.[i] ?? '');
  const setNumber = (i, v) => {
    const next = [...numbers];
    next[i] = v;
    onPatch({ numbers: next.filter((n) => n !== '' && n !== null).map(Number) });
  };

  const words = settings.letter_words || {};

  return (
    <>
      <GameCard logoFile={cfg.logo} title={`${cfg.name} — winning numbers`} hint={`${pick} from 1 to ${max}`}>
        <DrawNumber
          value={row?.draw_no} suggestion={nextNos?.[which]}
          onChange={(v) => onPatch({ draw_no: v })}
        />
        <div className="row">
          <div className="field">
            <label>Winning numbers</label>
            <div className="balls">
              {numbers.map((n, i) => (
                <BallInput
                  key={i} style={style} value={n} min={1} max={max} width={2}
                  label={`${cfg.name} number ${i + 1}`}
                  onChange={(v) => setNumber(i, v)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 22 }}>
          <div className="field">
            <label>Free ticket letter</label>
            <div className="balls">
              <Ball value={row?.free_ticket_letter || ''} style="letter" />
              <select
                value={row?.free_ticket_letter || ''}
                onChange={(e) => onPatch({ free_ticket_letter: e.target.value || null })}
                style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8 }}
                aria-label="Free ticket letter"
              >
                <option value="">—</option>
                {LETTERS.map((L) => (
                  <option key={L} value={L}>{L} as in {words[L] || ''}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </GameCard>

      <GameCard logoFile={cfg.logo} title={`${cfg.name} — winners and jackpot`}>
        <div className="row">
          <div className="field">
            <label>Match-4 winners</label>
            <input type="number" min="0" value={val('match4_winners')}
              onChange={(e) => setDraft((d) => ({ ...d, match4_winners: e.target.value }))}
              onBlur={() => commit('match4_winners')} />
          </div>
          <MoneyField label="Match-4 paying" value={val('match4_payout')}
            onChange={(v) => setDraft((d) => ({ ...d, match4_payout: v }))} />
          <button className="btn sm" onClick={() => commit('match4_payout')}>Save</button>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <div className="field">
            <label>{secondLabel} winners</label>
            <input type="number" min="0" value={val(`${secondTier}_winners`)}
              onChange={(e) => setDraft((d) => ({ ...d, [`${secondTier}_winners`]: e.target.value }))}
              onBlur={() => commit(`${secondTier}_winners`)} />
          </div>
          <MoneyField label={`${secondLabel} paying`} value={val(`${secondTier}_payout`)}
            onChange={(v) => setDraft((d) => ({ ...d, [`${secondTier}_payout`]: v }))} />
          <button className="btn sm" onClick={() => commit(`${secondTier}_payout`)}>Save</button>
        </div>

        <div className="row" style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line-2)' }}>
          <div className="field">
            <label>Jackpot winners</label>
            <input type="number" min="0" value={val('jackpot_winners') || 0}
              onChange={(e) => setDraft((d) => ({ ...d, jackpot_winners: e.target.value }))}
              onBlur={() => commit('jackpot_winners')} />
          </div>
          <MoneyField label="Next estimated jackpot" value={val('jackpot_amount')}
            onChange={(v) => setDraft((d) => ({ ...d, jackpot_amount: v }))} />
          <button className="btn sm" onClick={() => commit('jackpot_amount')}>Save jackpot</button>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
          Leave jackpot winners at 0 and the blast reads “There was NO {cfg.banner} JACKPOT WINNER”.
        </p>
      </GameCard>
    </>
  );
}

function EodSummary({ state, scheduled }) {
  const entered = {
    daily: state.daily.length,
    pops: state.cashPops.filter((r) => r.number != null).length,
    lotto: !!state.lotto, super6: !!state.super6,
  };
  return (
    <section className="card">
      <header><h3>What goes out tonight</h3></header>
      <div className="body">
        <table className="list">
          <thead><tr><th>Game</th><th>Entered</th><th>Result</th></tr></thead>
          <tbody>
            {DAILY_PERIODS.map((p) => {
              const r = state.daily.find((x) => x.period === p.code);
              return (
                <tr key={p.code}>
                  <td>{p.label}</td>
                  <td>{r ? <span className="pill sent">In</span> : <span className="pill">Missing</span>}</td>
                  <td className="num">
                    {r ? `PW ${r.play_way_number ?? '–'} ${symbolFor(r.play_way_number) || ''} · P3 ${(r.pick3_digits || []).join('') || '–'} · C4 ${(r.cash4_digits || []).join('') || '–'}` : '—'}
                  </td>
                </tr>
              );
            })}
            {CASH_POP_PERIODS.map((p) => {
              const r = state.cashPops.find((x) => x.period === p.code);
              return (
                <tr key={p.code}>
                  <td>{p.label}</td>
                  <td>{r?.number != null ? <span className="pill sent">In</span> : <span className="pill">Missing</span>}</td>
                  <td className="num">{r?.number != null ? String(r.number).padStart(2, '0') : '—'}</td>
                </tr>
              );
            })}
            {scheduled.lotto && (
              <tr>
                <td>Lotto</td>
                <td>{entered.lotto ? <span className="pill sent">In</span> : <span className="pill">Missing</span>}</td>
                <td className="num">{(state.lotto?.numbers || []).map((n) => String(n).padStart(2, '0')).join(',') || '—'}</td>
              </tr>
            )}
            {scheduled.super6 && (
              <tr>
                <td>Super 6</td>
                <td>{entered.super6 ? <span className="pill sent">In</span> : <span className="pill">Missing</span>}</td>
                <td className="num">{(state.super6?.numbers || []).map((n) => String(n).padStart(2, '0')).join(',') || '—'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
