import React, { useEffect, useState } from 'react';
import * as api from '../lib/api.js';

/**
 * Send progress, outside the dialog.
 *
 * The dialog closes as soon as a send is accepted, so this is where the
 * operator watches it happen. It sits at the bottom of the screen and stays
 * there while they move on to the next draw, then settles into a short summary.
 *
 * It shows the two stages in the order they run: the websites, then the email.
 */
export default function SendProgress({ run, onDone, onDismiss }) {
  const [live, setLive] = useState(null);
  const [finished, setFinished] = useState(false);
  const [hidden, setHidden] = useState(false);

  /* Clear itself after two minutes.
     The panel sits in the corner over the Send button, so leaving it there
     blocks the next draw. The send carries on server-side regardless — the
     panel is only a view of it — so hiding it loses nothing. Progress is still
     in History, and the draw's own status tag shows what happened. */
  useEffect(() => {
    if (!run?.id) return undefined;
    setHidden(false);
    const t = setTimeout(() => { setHidden(true); onDismiss?.(); }, 120_000);
    return () => clearTimeout(t);
    /* eslint-disable-next-line */
  }, [run?.id]);

  useEffect(() => {
    if (!run?.id) return undefined;
    setLive(null);
    setFinished(false);

    // Website-only finishes inside the request, so there is nothing to poll.
    if (run.action === 'website') {
      setFinished(true);
      onDone?.();
      return undefined;
    }

    let stop = false;
    api.watchBlastRun(run.id, (r) => { if (!stop) setLive(r); })
      .then((final) => {
        if (stop) return;
        setLive(final);
        setFinished(true);
        onDone?.();
      })
      .catch(() => { if (!stop) setFinished(true); });
    return () => { stop = true; };
    /* eslint-disable-next-line */
  }, [run?.id]);

  if (!run || hidden) return null;

  const total = live?.total_recipients ?? run.total ?? 0;
  const sent = live?.sent_count ?? 0;
  const failed = live?.failed_count ?? 0;
  const pct = total ? Math.min(100, Math.round((sent / total) * 100)) : 0;

  const web = run.website;
  const doesWeb = run.action === 'both' || run.action === 'website';
  const doesMail = run.action === 'both' || run.action === 'email';

  const webState = !doesWeb ? null
    : !web ? 'pending'
    : web.failed ? 'problem'
    : 'done';

  const mailState = !doesMail ? null
    : finished ? (failed ? 'problem' : 'done')
    : 'running';

  return (
    <div className={`sendbar${finished ? ' finished' : ''}`} role="status" aria-live="polite">
      <div className="sendbar-head">
        <b>{run.label}</b>
        <span className="sendbar-what">
          {run.action === 'website' ? 'Websites only'
            : run.action === 'email' ? 'Email only'
            : 'Websites, then email'}
        </span>
        {/* Always dismissible: it overlays the Send button, so there must be a
            way to move it out of the way at any point. */}
        <button className="sendbar-x" onClick={() => { setHidden(true); onDismiss?.(); }}
          aria-label="Dismiss">×</button>
      </div>

      <div className="sendbar-stages">
        {doesWeb && (
          <div className={`stage ${webState}`}>
            <span className="stage-dot" />
            <span>
              Websites
              {webState === 'done' && ` — ${web.sent} result${web.sent === 1 ? '' : 's'} published`}
              {webState === 'problem' && ` — ${web.sent} published, ${web.failed} failed`}
              {webState === 'pending' && ' — publishing…'}
            </span>
          </div>
        )}

        {doesMail && (
          <div className={`stage ${mailState}`}>
            <span className="stage-dot" />
            <span>
              Email — {sent} of {total}
              {failed ? `, ${failed} failed` : ''}
              {mailState === 'done' && ' sent'}
            </span>
          </div>
        )}
      </div>

      {doesMail && (
        <div className="sendbar-track">
          <div className="sendbar-fill" style={{ width: `${finished ? 100 : pct}%` }} />
        </div>
      )}

      {!finished && doesMail && (
        <p className="sendbar-note">
          Carries on if you close this or move to another draw.
        </p>
      )}
    </div>
  );
}
