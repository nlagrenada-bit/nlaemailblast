// ============================================================================
// REPLACE the existing sendBlast function in src/lib/api.js with this one.
// (Leave watchBlastRun and everything else as it is.)
//
// The change: the previewed email (subject/html/text) is now sent to the server
// and stored on the run. Previously only drawDate was sent, so the server
// rebuilt the email as the whole day — which is why selecting a single draw
// sent the complete results.
// ============================================================================

export async function sendBlast({
  drawDate, subject, html, text,
  scopeLabel = null, scopeKind = null, isResend = false,
  groupIds = null, emails = null,
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/send-blast', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({
      drawDate, subject, html, text,
      scopeLabel, scopeKind, isResend,
      groupIds, emails,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The blast could not be started.');
  return body;   // 202 + { runId, totalRecipients, estimatedMinutes }
}
