import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Signs the desk out after a spell of inactivity.
 *
 * The results desk sits on an office machine that can send results to sixty
 * media houses and publish to two public websites. Leaving it signed in
 * unattended is the realistic security risk here, more than anything remote.
 *
 * It warns before acting. Losing a half-entered draw to a silent logout would
 * be its own kind of damage, so the last minute is spent asking.
 *
 *   IDLE_MINUTES     quiet time before the warning appears
 *   WARN_SECONDS     how long the warning waits before signing out
 *
 * Typing, clicking, scrolling or touching the screen resets the clock. A send
 * running in the background does not — that continues server-side regardless
 * of who is signed in.
 */
const IDLE_MINUTES = Number(import.meta.env.VITE_IDLE_MINUTES || 30);
const WARN_SECONDS = 60;

export default function IdleLogout({ enabled = true }) {
  const [warning, setWarning] = useState(false);
  const [left, setLeft] = useState(WARN_SECONDS);
  const idleTimer = useRef(null);
  const countdown = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const signOut = async () => {
      clearInterval(countdown.current);
      try { await supabase.auth.signOut(); } catch { /* going anyway */ }
      // A reload returns to the sign-in screen, and the next sign-in opens on
      // the current draw because nothing about the draw is held in the URL.
      window.location.replace(window.location.pathname);
    };

    const startCountdown = () => {
      setWarning(true);
      setLeft(WARN_SECONDS);
      countdown.current = setInterval(() => {
        setLeft((n) => {
          if (n <= 1) { signOut(); return 0; }
          return n - 1;
        });
      }, 1000);
    };

    const reset = () => {
      clearTimeout(idleTimer.current);
      clearInterval(countdown.current);
      setWarning(false);
      idleTimer.current = setTimeout(startCountdown, IDLE_MINUTES * 60 * 1000);
    };

    const events = ['mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    reset();

    return () => {
      for (const e of events) window.removeEventListener(e, reset);
      clearTimeout(idleTimer.current);
      clearInterval(countdown.current);
    };
  }, [enabled]);

  if (!warning) return null;

  return (
    <div className="idlewarn" role="alertdialog" aria-live="assertive">
      <div className="idlewarn-box">
        <h3>Still there?</h3>
        <p>
          You have been inactive for {IDLE_MINUTES} minutes. For security the desk
          will sign out in <b>{left}</b> second{left === 1 ? '' : 's'}.
        </p>
        <p className="idlewarn-note">
          Anything already saved stays saved, and a send in progress carries on.
        </p>
        <button
          className="btn primary"
          autoFocus
          onClick={() => { clearInterval(countdown.current); setWarning(false); }}
        >
          Keep me signed in
        </button>
      </div>
    </div>
  );
}
