// ============================================================================
// REPLACE the existing confirmSend function in src/views/ResultsView.jsx
// with this one.
//
// Two fixes:
//   1. It now sends the EXACT email shown in the preview (built from `scope`,
//      so a single draw sends that draw). Previously only the date was sent and
//      the server rebuilt it as the whole day.
//   2. The RESENT subject and banner work again — that was lost in the
//      throttled-send rewrite.
//
// `markResent` already exists near the top of this file. If it is missing, add:
//
//   function markResent(html) {
//     const banner = `<div style="background:#b3261e;color:#fff;font-family:Arial,sans-serif;`
//       + `font-weight:700;font-size:14px;text-align:center;padding:10px 14px;letter-spacing:.02em">`
//       + `RESENT — this corrects results sent earlier. Please disregard the previous email.</div>`;
//     if (html.includes('<body')) return html.replace(/(<body[^>]*>)/i, `$1${banner}`);
//     return banner + html;
//   }
// ============================================================================

  async function confirmSend({ groupIds, emails, isResend, dbOnly }) {
    setBusy(true);
    setProgress(null);
    try {
      if (dbOnly) {
        const r = await api.pushToWebsite(date);
        const failed = r?.website?.failed?.length || 0;
        const sent = r?.website?.sent ?? 0;
        toast(failed
          ? `Website updated with ${sent} result(s); ${failed} failed.`
          : `Website updated with ${sent} result(s). No email sent.`,
          failed ? 'info' : 'good');
        setDialog(false);
        return;
      }

      // The email built for THIS selection — `email` comes from the same useMemo
      // that renders the preview, so what is sent is what was previewed.
      const subject = isResend ? `[RESENT] ${email.subject}` : email.subject;
      const html    = isResend ? markResent(email.html) : email.html;
      const text    = isResend
        ? `*** RESENT — corrects earlier results ***\n\n${email.text}`
        : email.text;

      const started = await api.sendBlast({
        drawDate: date,
        subject, html, text,
        scopeLabel: scope.label,
        scopeKind: scope.kind,
        isResend: !!isResend,
        groupIds: groupIds?.length ? groupIds : null,
        emails: emails?.length ? emails : null,
      });

      toast(
        `Sending "${scope.label}" to ${started.totalRecipients} recipient`
        + `${started.totalRecipients === 1 ? '' : 's'}. `
        + `About ${started.estimatedMinutes} min — it continues even if you close this.`,
        'good',
      );
      setProgress({ sent: 0, total: started.totalRecipients });

      const final = await api.watchBlastRun(started.runId, (run) => {
        setProgress({ sent: run.sent_count, total: run.total_recipients, status: run.status });
      });

      const bits = [`Sent to ${final.sent_count} of ${final.total_recipients}`];
      if (final.failed_count) bits.push(`${final.failed_count} failed`);
      toast(bits.join(' · ') + '.', final.failed_count ? 'info' : 'good');
      setDialog(false);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally { setBusy(false); setProgress(null); }
  }
