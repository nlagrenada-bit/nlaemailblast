// Builds the HTML and plain-text bodies for every blast.
// Shared by the browser preview and the send function so what an operator
// approves on screen is byte-for-byte what recipients receive.
//
// Email-client notes that drove the markup:
//  - Tables and inline styles only. No flexbox, no <style> dependency.
//  - Balls are pre-rendered PNGs, because Outlook's Word engine drops
//    border-radius and would deliver square "balls".
//  - Every image carries width/height/alt so a blocked-images inbox still
//    reads correctly.
//  - 640px shell, single column, so it holds up on a phone.

import {
  GAMES, longDate, money, symbolFor, symbolImage, joinDigits, joinPadded, drawNo,
} from './config.js';

const C = {
  navy: '#0B2C63',
  blue: '#12489E',
  rule: '#DCE3EE',
  ink: '#16202F',
  soft: '#5A6B84',
  yellow: '#FFD200',
  paper: '#F3F6FB',
};

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------- ball helpers

const pad = (v) => String(v).padStart(2, '0');

/** Maps a value onto its pre-rendered ball asset. */
function ballSrc(base, style, value) {
  const padded = ['playway', 'cashpop', 'lotto', 'super6'].includes(style);
  return `${base}/balls/${style}-${padded ? pad(value) : value}.png`;
}

function ball(base, style, value, size = 52) {
  return `<td style="padding:0 7px 0 0;" valign="middle">`
    + `<img src="${ballSrc(base, style, value)}" width="${size}" height="${size}"`
    + ` alt="${esc(value)}" style="display:block;border:0;outline:none;text-decoration:none;" /></td>`;
}

function ballRow(base, style, values, size = 52, trailing = '') {
  const cells = values.map((v) => ball(base, style, v, size)).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + cells + (trailing || '') + `</tr></table>`;
}

// ------------------------------------------------------------ block helpers

const logo = (base, file, w, alt) =>
  `<img src="${base}/${file}" width="${w}" alt="${esc(alt)}"`
  + ` style="display:block;border:0;max-width:${w}px;height:auto;" />`;

function statement(text) {
  return `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;`
    + `line-height:22px;color:${C.ink};">${text}</p>`;
}

function payout(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<p style="margin:10px 0 0;font-family:${FONT};font-size:15px;`
    + `line-height:20px;color:${C.ink};">${esc(label)} `
    + `<strong style="color:${C.navy};">${money(value)}</strong></p>`;
}

/** One game inside a draw period: logo, draw number, sentence, balls, payout. */
function gameCard(base, { logoFile, logoWidth, body, draw }) {
  const stamp = draw
    ? `<td align="right" valign="middle" style="font-family:${FONT};font-size:11px;
         letter-spacing:.08em;color:${C.soft};white-space:nowrap;">
         <span style="background:${C.paper};border:1px solid ${C.rule};border-radius:999px;
                      padding:4px 10px;display:inline-block;">${esc(drawNo(draw))}</span></td>`
    : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${C.rule};border-radius:8px;background:#FFFFFF;margin:0 0 14px;">
    <tr><td style="padding:16px 18px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="margin:0 0 12px;"><tr>
        <td valign="middle">${logo(base, logoFile, logoWidth, '')}</td>
        ${stamp}
      </tr></table>
      ${body}
    </td></tr>
  </table>`;
}

function periodHeading(banner, dateLong, kind = 'Draw') {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 14px;">
    <tr><td style="border-left:5px solid ${C.yellow};padding:2px 0 2px 12px;">
      <div style="font-family:${FONT};font-size:19px;line-height:24px;font-weight:bold;
                  color:${C.navy};letter-spacing:.4px;">${esc(banner)} ${esc(kind.toUpperCase())} RESULTS</div>
      <div style="font-family:${FONT};font-size:13px;line-height:18px;color:${C.soft};
                  padding-top:3px;">${esc(dateLong)}</div>
    </td></tr>
  </table>
  <p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};">
    The following are the National Lotteries Authority <strong>${esc(banner)}</strong>
    ${esc(kind)} results for ${esc(dateLong)}:
  </p>`;
}

// --------------------------------------------------------------- HTML parts

function dailyPeriodHtml(base, p, dateLong) {
  let out = periodHeading(p.banner, dateLong);

  if (p.playWay?.number) {
    const sym = symbolFor(p.playWay.number);
    const symCell = `<td style="padding:0 0 0 6px;" valign="middle">`
      + `<img src="${base}/${symbolImage(p.playWay.number)}" width="48" height="48" alt="${esc(sym)}"`
      + ` style="display:block;border:0;" /></td>`
      + `<td style="padding:0 0 0 8px;font-family:${FONT};font-size:15px;font-weight:bold;`
      + `color:${C.navy};letter-spacing:.3px;" valign="middle">${esc(sym)}</td>`;
    out += gameCard(base, {
      logoFile: GAMES.play_way.logo, logoWidth: 78, draw: p.playWay.drawNo,
      body: statement(`The Winning Number for the <strong>PLAY WAY ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'playway', [p.playWay.number], 52, symCell),
    });
  }
  if (p.playWay?.multiplier) {
    out += gameCard(base, {
      logoFile: GAMES.multix.logo, logoWidth: 118, draw: p.playWay.drawNo,
      body: statement(`The Winning Ball for the <strong>PLAY WAY Multi-X ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'multix', [p.playWay.multiplier])
        + payout('Payout:', p.playWay.payout),
    });
  }
  if (p.pick3?.digits?.length) {
    out += gameCard(base, {
      logoFile: GAMES.pick3.logo, logoWidth: 132, draw: p.pick3.drawNo,
      body: statement(`The Winning Numbers for <strong>DAILY PICK 3 ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'pick3', p.pick3.digits),
    });
  }
  if (p.pick3?.multiplier) {
    out += gameCard(base, {
      logoFile: GAMES.multix.logo, logoWidth: 118, draw: p.pick3.drawNo,
      body: statement(`The Winning Ball for the <strong>PICK 3 Multi-X ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'multix', [p.pick3.multiplier])
        + payout('Payout:', p.pick3.payout),
    });
  }
  if (p.cash4?.digits?.length) {
    out += gameCard(base, {
      logoFile: GAMES.cash4.logo, logoWidth: 132, draw: p.cash4.drawNo,
      body: statement(`The Winning Numbers for <strong>DAILY CASH 4 ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'cash4', p.cash4.digits),
    });
  }
  if (p.cash4?.multiplier) {
    out += gameCard(base, {
      logoFile: GAMES.multix.logo, logoWidth: 118, draw: p.cash4.drawNo,
      body: statement(`The Winning Ball for the <strong>CASH 4 Multi-X ${esc(p.banner)}</strong> Draw:`)
        + ballRow(base, 'multix', [p.cash4.multiplier])
        + payout('Payout:', p.cash4.payout),
    });
  }
  return out;
}

function cashPopHtml(base, pops, dateLong) {
  let out = periodHeading('CASH POP', dateLong);
  for (const pop of pops) {
    if (!pop.number) continue;
    out += gameCard(base, {
      logoFile: GAMES.cash_pop.logo, logoWidth: 96, draw: pop.drawNo,
      body: statement(`The Winning Number for the <strong>${esc(pop.banner)}</strong> Draw:`)
        + ballRow(base, 'cashpop', [pop.number])
        + payout('Payout:', pop.payout),
    });
  }
  return out;
}

function freeTicketRow(base, letter, word) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>`
    + ball(base, 'letter', letter, 46)
    + `<td style="padding-left:4px;font-family:${FONT};font-size:15px;color:${C.ink};" valign="middle">`
    + `Free Ticket Letter: <strong style="color:${C.navy};">${esc(letter)}</strong>`
    + (word ? ` as in <strong style="color:${C.navy};">${esc(word)}</strong>` : '')
    + `</td></tr></table>`;
}

/**
 * Builds "There were 39 Match-4 winners paying $25.00 and 1 Match-5 winner
 * paying $500.00". Tiers with no winners drop out, and whichever tier leads
 * takes the "There was/were" opener so the sentence still reads.
 */
function winnersSentence(tiers, html = true) {
  const kept = tiers.filter((t) => Number(t.winners) > 0);
  if (!kept.length) return '';
  const b = (v) => (html ? `<strong>${esc(v)}</strong>` : String(v));
  const parts = kept.map((t) => {
    const n = Number(t.winners);
    return `${b(n)} ${t.label} winner${n === 1 ? '' : 's'} paying ${b(money(t.payout))}`;
  });
  const lead = Number(kept[0].winners) === 1 ? 'There was' : 'There were';
  return `${lead} ${parts.join(' and ')}`;
}

function winnersLine(sentence) {
  if (!sentence) return '';
  return `<p style="margin:14px 0 0;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};">`
    + sentence + `</p>`;
}

function jackpotBox(label, winners, amount) {
  const w = Number(winners) || 0;
  const headline = w > 0
    ? `There ${w === 1 ? 'was' : 'were'} <strong>${w} ${esc(label)} JACKPOT WINNER${w === 1 ? '' : 'S'}</strong>`
    : `There was <strong>NO ${esc(label)} JACKPOT WINNER</strong>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin:16px 0 0;background:${C.paper};border-radius:8px;">
    <tr><td style="padding:14px 16px;font-family:${FONT};font-size:15px;line-height:22px;color:${C.ink};">
      ${headline}
      ${amount !== null && amount !== undefined && amount !== ''
      ? `<div style="margin-top:6px;">Current estimated ${esc(label)} Jackpot is now
           <strong style="color:${C.navy};font-size:17px;">${money(amount)}</strong></div>` : ''}
    </td></tr>
  </table>`;
}

function lottoHtml(base, l, dateLong) {
  return periodHeading('LOTTO', dateLong, 'Draw') + gameCard(base, {
    logoFile: GAMES.lotto.logo, logoWidth: 138, draw: l.drawNo,
    body: statement(`The <strong>LOTTO</strong> results for ${esc(dateLong)} are as follows:`)
      + ballRow(base, 'lotto', l.numbers || [])
      + (l.letter ? freeTicketRow(base, l.letter, l.letterWord) : '')
      + winnersLine(winnersSentence([
        { label: 'Match-4', winners: l.match4Winners, payout: l.match4Payout },
        { label: 'Match-3', winners: l.match3Winners, payout: l.match3Payout },
      ]))
      + jackpotBox('LOTTO', l.jackpotWinners, l.jackpot),
  });
}

function super6Html(base, s, dateLong) {
  return periodHeading('SUPER 6', dateLong, 'Draw') + gameCard(base, {
    logoFile: GAMES.super6.logo, logoWidth: 150, draw: s.drawNo,
    body: statement(`The <strong>SUPER 6</strong> results for ${esc(dateLong)} are as follows:`)
      + ballRow(base, 'super6', s.numbers || [])
      + (s.letter ? freeTicketRow(base, s.letter, s.letterWord) : '')
      + winnersLine(winnersSentence([
        { label: 'Match-4', winners: s.match4Winners, payout: s.match4Payout },
        { label: 'Match-5', winners: s.match5Winners, payout: s.match5Payout },
      ]))
      + jackpotBox('SUPER 6', s.jackpotWinners, s.jackpot),
  });
}

// ------------------------------------------------------------------- shell

function shell(base, inner, { preheader, footer }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>National Lotteries Authority Results</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings></xml><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"
         style="width:640px;max-width:640px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
    <tr><td style="background:${C.navy};padding:20px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="56" valign="middle">${logo(base, 'nla.png', 52, 'National Lotteries Authority')}</td>
        <td valign="middle" style="padding-left:14px;">
          <div style="font-family:${FONT};font-size:17px;font-weight:bold;color:#FFFFFF;
                      letter-spacing:.4px;line-height:22px;">NATIONAL LOTTERIES AUTHORITY</div>
          <div style="font-family:${FONT};font-size:12px;color:${C.yellow};
                      letter-spacing:1.6px;line-height:18px;">OFFICIAL DRAW RESULTS</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:24px 24px 8px;">${inner}</td></tr>
    <tr><td style="padding:20px 24px 26px;border-top:1px solid ${C.rule};">
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.soft};">
        ${footer}
      </p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// -------------------------------------------------------------- plain text

function textPeriod(p, dateLong) {
  const L = [];
  L.push(`The following are the National Lotteries Authority ${p.banner} Draw results for ${dateLong}:`, '');
  if (p.playWay?.number) {
    L.push(`The Winning Number for the PLAY WAY ${p.banner} Draw: ${p.playWay.number}   Symbol: ${symbolFor(p.playWay.number)}`);
    if (p.playWay.drawNo) L.push(`(${drawNo(p.playWay.drawNo)})`);
    L.push('');
  }
  if (p.playWay?.multiplier) {
    L.push(`The Winning Ball for the PLAY WAY Multi-X ${p.banner} Draw: ${p.playWay.multiplier}`);
    if (p.playWay.payout) L.push(`Payout: ${money(p.playWay.payout)}`);
    L.push('');
  }
  if (p.pick3?.digits?.length) {
    L.push(`The Winning Numbers for DAILY PICK 3 ${p.banner} Draw: ${joinDigits(p.pick3.digits)}`);
    if (p.pick3.drawNo) L.push(`(${drawNo(p.pick3.drawNo)})`);
    L.push('');
  }
  if (p.pick3?.multiplier) {
    L.push(`The Winning Ball for the PICK 3 Multi-X ${p.banner} Draw: ${p.pick3.multiplier}`);
    if (p.pick3.payout) L.push(`Payout: ${money(p.pick3.payout)}`);
    L.push('');
  }
  if (p.cash4?.digits?.length) {
    L.push(`The Winning Numbers for DAILY CASH 4 ${p.banner} Draw: ${joinDigits(p.cash4.digits)}`);
    if (p.cash4.drawNo) L.push(`(${drawNo(p.cash4.drawNo)})`);
    L.push('');
  }
  if (p.cash4?.multiplier) {
    L.push(`The Winning Ball for the CASH 4 Multi-X ${p.banner} Draw: ${p.cash4.multiplier}`);
    if (p.cash4.payout) L.push(`Payout: ${money(p.cash4.payout)}`);
    L.push('');
  }
  return L;
}

function textJackpot(label, winners, amount) {
  const w = Number(winners) || 0;
  const L = [w > 0
    ? `There ${w === 1 ? 'was' : 'were'} ${w} ${label} JACKPOT WINNER${w === 1 ? '' : 'S'}`
    : `There was NO ${label} JACKPOT WINNER`];
  if (amount) L.push('', `Current estimated ${label} Jackpot is now ${money(amount)}`);
  return L;
}

// ------------------------------------------------------------------ public

/**
 * @param {object} doc  normalised results document (see buildDoc in src/lib/doc.js)
 * @param {object} opts { assetBase, footer }
 * @returns {{subject:string, html:string, text:string}}
 */
export function buildEmail(doc, opts = {}) {
  const base = (opts.assetBase || '').replace(/\/$/, '');
  const dateLong = longDate(doc.date);
  const greeting = doc.greeting || 'Dear All,';

  let inner = `<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;color:${C.ink};">${esc(greeting)}</p>`;
  const text = [greeting, ''];

  if (doc.notice) {
    inner += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="margin:14px 0 0;background:#FFF6D6;border-left:4px solid ${C.yellow};border-radius:6px;">
      <tr><td style="padding:12px 14px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.ink};">
      ${esc(doc.notice)}</td></tr></table>`;
    text.push(doc.notice, '');
  }

  for (const pop of doc.cashPopGroups || []) {
    inner += cashPopHtml(base, pop.pops, dateLong);
    text.push(`The following are the National Lotteries Authority CASH POP Draw results for ${dateLong}:`, '');
    for (const p of pop.pops) {
      if (!p.number) continue;
      text.push(`The Winning Number for the ${p.banner} Draw: ${p.number}`);
      if (p.drawNo) text.push(`(${drawNo(p.drawNo)})`);
      if (p.payout) text.push(`Payout: ${money(p.payout)}`);
      text.push('');
    }
  }

  for (const p of doc.dailyPeriods || []) {
    inner += dailyPeriodHtml(base, p, dateLong);
    text.push(...textPeriod(p, dateLong));
  }

  if (doc.lotto) {
    inner += lottoHtml(base, doc.lotto, dateLong);
    const l = doc.lotto;
    text.push(`The LOTTO results for ${dateLong} are as follows: ${joinPadded(l.numbers)}`);
    if (l.drawNo) text.push(`(${drawNo(l.drawNo)})`);
    text.push('');
    if (l.letter) text.push(`Free Ticket Letter: ${l.letter}${l.letterWord ? ` as in ${l.letterWord}` : ''}`, '');
    const w = winnersSentence([
      { label: 'Match-4', winners: l.match4Winners, payout: l.match4Payout },
      { label: 'Match-3', winners: l.match3Winners, payout: l.match3Payout },
    ], false);
    if (w) text.push(w, '');
    text.push(...textJackpot('LOTTO', l.jackpotWinners, l.jackpot), '');
  }

  if (doc.super6) {
    inner += super6Html(base, doc.super6, dateLong);
    const s = doc.super6;
    text.push(`The SUPER 6 results for ${dateLong} are as follows: ${joinPadded(s.numbers)}`);
    if (s.drawNo) text.push(`(${drawNo(s.drawNo)})`);
    text.push('');
    if (s.letter) text.push(`Free Ticket Letter: ${s.letter}${s.letterWord ? ` as in ${s.letterWord}` : ''}`, '');
    const w = winnersSentence([
      { label: 'Match-4', winners: s.match4Winners, payout: s.match4Payout },
      { label: 'Match-5', winners: s.match5Winners, payout: s.match5Payout },
    ], false);
    if (w) text.push(w, '');
    text.push(...textJackpot('SUPER 6', s.jackpotWinners, s.jackpot), '');
  }

  const footer = opts.footer
    || 'National Lotteries Authority. Results are provisional until certified by the Authority. '
    + 'In the event of a discrepancy, the official draw records prevail.';

  text.push('', footer.replace(/\s+/g, ' ').trim());

  return {
    subject: doc.subject || defaultSubject(doc, dateLong),
    html: shell(base, inner, { preheader: doc.preheader || preheaderFor(doc), footer: esc(footer) }),
    text: text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
  };
}

export function defaultSubject(doc, dateLong) {
  const d = dateLong || longDate(doc.date);
  if (doc.kind === 'eod') return `NLA Complete Results — ${d}`;
  const bits = [];
  for (const g of doc.cashPopGroups || []) bits.push(g.pops.length > 1 ? 'Cash Pop' : g.pops[0]?.banner);
  for (const p of doc.dailyPeriods || []) bits.push(p.banner);
  if (doc.lotto) bits.push('Lotto');
  if (doc.super6) bits.push('Super 6');
  return `NLA Results — ${bits.filter(Boolean).join(', ')} — ${d}`;
}

function preheaderFor(doc) {
  const p = (doc.dailyPeriods || [])[0];
  if (p?.playWay?.number) return `Play Way ${p.playWay.number} ${symbolFor(p.playWay.number)} · Pick 3 ${joinDigits(p.pick3?.digits)} · Cash 4 ${joinDigits(p.cash4?.digits)}`;
  const pop = (doc.cashPopGroups || [])[0]?.pops?.find((x) => x.number);
  if (pop) return `${pop.banner}: ${pop.number}`;
  if (doc.lotto) return `Lotto ${joinPadded(doc.lotto.numbers)}`;
  if (doc.super6) return `Super 6 ${joinPadded(doc.super6.numbers)}`;
  return 'Official draw results';
}
