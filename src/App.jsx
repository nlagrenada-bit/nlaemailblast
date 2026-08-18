import React, { useEffect, useState } from 'react';
import { supabase, ASSET_BASE } from './lib/supabase.js';
import { todayLocal, shiftDate } from './lib/dates.js';
import * as api from './lib/api.js';
import { ToastHost } from './components/Toast.jsx';
import ResultsView from './views/ResultsView.jsx';
import RecipientsView from './views/RecipientsView.jsx';
import HistoryView from './views/HistoryView.jsx';
import SettingsView from './views/SettingsView.jsx';
import SignIn from './views/SignIn.jsx';

const TABS = [
  ['results', 'Results'],
  ['recipients', 'Recipients'],
  ['history', 'History'],
  ['settings', 'Settings'],
];

export default function App() {
  const [session, setSession] = useState(undefined);   // undefined = still checking
  const [staff, setStaff] = useState(null);
  const [tab, setTab] = useState('results');
  const [date, setDate] = useState(todayLocal());
  const [settings, setSettings] = useState({});
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setStaff(null); return; }
    supabase.from('staff').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setStaff(data));
    api.loadSettings().then(setSettings).catch(() => {});
    api.listGroups().then(setGroups).catch(() => {});
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <ToastHost><SignIn /></ToastHost>;

  const canSend = ['approver', 'admin'].includes(staff?.role);
  const refreshSettings = () => api.loadSettings().then(setSettings).catch(() => {});

  return (
    <ToastHost>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img src={`${ASSET_BASE}/nla.png`} alt="" />
            <div>
              <b>NLA</b>
              <span>RESULTS DESK</span>
            </div>
          </div>

          <nav className="tabs">
            {TABS.map(([id, label]) => (
              <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="spacer" />

          {tab === 'results' && (
            <div className="datepick">
              <button onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day">‹</button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Draw date" />
              <button onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Next day">›</button>
              {date !== todayLocal() && (
                <button onClick={() => setDate(todayLocal())} style={{ fontSize: 11 }}>Today</button>
              )}
            </div>
          )}

          <div className="who">
            <b>{staff?.full_name || session.user.email}</b>
            {staff?.role ? `${staff.role}${canSend ? '' : ' · entry only'}` : 'no desk role'}
          </div>
          <button className="btn ghost" style={{ color: '#b9cbe8' }}
            onClick={() => supabase.auth.signOut()}>Sign out</button>
        </header>

        {!staff && (
          <div className="notice error" style={{ margin: 20 }}>
            This account is signed in but not on the results desk. An admin needs to add a
            row to the <code>staff</code> table for {session.user.email}.
          </div>
        )}

        {staff && (
          <div className="shell">
            {tab === 'results' && (
              <ResultsView date={date} settings={settings} groups={groups} canSend={canSend} />
            )}
            {tab === 'recipients' && (
              <RecipientsView groups={groups} onGroupsChanged={() => api.listGroups().then(setGroups)} />
            )}
            {tab === 'history' && <HistoryView groups={groups} canSend={canSend} />}
            {tab === 'settings' && <SettingsView settings={settings} onChanged={refreshSettings} />}
          </div>
        )}
      </div>
    </ToastHost>
  );
}
