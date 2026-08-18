import React, { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

export default function RecipientsView({ groups, onGroupsChanged }) {
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [filter, setFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [bulk, setBulk] = useState('');
  const [bulkGroups, setBulkGroups] = useState([]);
  const [one, setOne] = useState({ email: '', full_name: '' });
  const [importing, setImporting] = useState(false);

  const reload = () => api.listRecipients().then(setPeople).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const shown = useMemo(() => {
    if (!people) return [];
    const q = filter.trim().toLowerCase();
    return people.filter((p) => {
      if (q && !p.email.toLowerCase().includes(q) && !(p.full_name || '').toLowerCase().includes(q)) return false;
      if (groupFilter && !(p.recipient_group_members || []).some((m) => m.group_id === groupFilter)) return false;
      return true;
    });
  }, [people, filter, groupFilter]);

  async function addOne(e) {
    e.preventDefault();
    if (!one.email.trim()) return;
    try {
      await api.addRecipient({ email: one.email.trim().toLowerCase(), full_name: one.full_name.trim() || null });
      setOne({ email: '', full_name: '' });
      toast('Recipient added.', 'good');
      reload();
    } catch (err) {
      toast(/duplicate|unique/i.test(err.message) ? 'That address is already on the list.' : err.message, 'bad');
    }
  }

  async function runImport() {
    if (!bulk.trim()) return;
    setImporting(true);
    try {
      const r = await api.importRecipients(bulk, bulkGroups);
      const bits = [`${r.added.length} added`];
      if (r.duplicates.length) bits.push(`${r.duplicates.length} already on the list`);
      if (r.invalid.length) bits.push(`${r.invalid.length} skipped as unreadable`);
      toast(bits.join(', ') + '.', r.added.length ? 'good' : 'info');
      setBulk('');
      reload();
    } catch (e) { toast(e.message, 'bad'); } finally { setImporting(false); }
  }

  async function removePicked() {
    const ids = [...picked];
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} recipient${ids.length === 1 ? '' : 's'}? They will stop receiving every blast.`)) return;
    try {
      await api.removeRecipients(ids);
      setPicked(new Set());
      toast(`Removed ${ids.length}.`, 'good');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function toggleActive(p) {
    try {
      await api.updateRecipient(p.id, { active: !p.active });
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function exportCsv() {
    const rows = [['email', 'name', 'active'], ...shown.map((p) => [p.email, p.full_name || '', p.active])];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nla-recipients-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const allPicked = shown.length > 0 && shown.every((p) => picked.has(p.id));

  return (
    <div className="main" style={{ maxWidth: 1080 }}>
      <div className="pagehead">
        <h1>Recipients</h1>
        <span className="sub">{people ? `${people.length} on the list` : 'loading…'}</span>
      </div>

      <section className="card">
        <header><h3>Add one</h3></header>
        <div className="body">
          <form className="row" onSubmit={addOne}>
            <div className="field">
              <label>Email address</label>
              <input type="email" required value={one.email} placeholder="name@example.com"
                onChange={(e) => setOne({ ...one, email: e.target.value })} />
            </div>
            <div className="field">
              <label>Name (optional)</label>
              <input type="text" value={one.full_name} placeholder="Newsroom desk"
                onChange={(e) => setOne({ ...one, full_name: e.target.value })} />
            </div>
            <button className="btn primary" type="submit">Add recipient</button>
          </form>
        </div>
      </section>

      <section className="card">
        <header>
          <h3>Add a batch</h3>
          <span className="hint">Paste a list or a CSV — one address per line</span>
        </header>
        <div className="body">
          <textarea
            className="plain" value={bulk} onChange={(e) => setBulk(e.target.value)}
            style={{ width: '100%', minHeight: 130, fontFamily: 'var(--mono)', fontSize: 12.5 }}
            placeholder={'newsroom@gbn.gd\nDesmond Charles, desmond@example.com\n"Agent 14" <agent14@example.com>'}
          />
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field">
              <label>Put them in</label>
              <div className="multix-picker">
                {groups.map((g) => (
                  <button key={g.id} type="button" aria-pressed={bulkGroups.includes(g.id)}
                    onClick={() => setBulkGroups((x) => x.includes(g.id) ? x.filter((y) => y !== g.id) : [...x, g.id])}>
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn primary" onClick={runImport} disabled={importing || !bulk.trim()}>
              {importing ? 'Importing…' : 'Import addresses'}
            </button>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
            Names are picked up when they sit beside the address. Duplicates are skipped, not overwritten.
          </p>
        </div>
      </section>

      <section className="card">
        <header>
          <h3>The list</h3>
          <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="search" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7 }} />
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 7 }} aria-label="Filter by group">
              <option value="">All groups</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button className="btn sm" onClick={exportCsv}>Export CSV</button>
            <button className="btn sm danger" onClick={removePicked} disabled={!picked.size}>
              Remove {picked.size || ''}
            </button>
          </div>
        </header>
        <div className="body" style={{ padding: '14px 6px' }}>
          {!people && <p style={{ padding: 14, color: 'var(--ink-3)' }}>Loading…</p>}
          {people && shown.length === 0 && (
            <div className="empty">
              <b>Nobody here yet</b>
              Add an address above, or paste in a batch, and it will appear in this list.
            </div>
          )}
          {shown.length > 0 && (
            <table className="list">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={allPicked} aria-label="Select all shown"
                      onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())} />
                  </th>
                  <th>Email</th><th>Name</th><th>Groups</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" checked={picked.has(p.id)} aria-label={`Select ${p.email}`}
                        onChange={(e) => setPicked((s) => {
                          const n = new Set(s);
                          e.target.checked ? n.add(p.id) : n.delete(p.id);
                          return n;
                        })} />
                    </td>
                    <td className="num">{p.email}</td>
                    <td>{p.full_name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {(p.recipient_group_members || [])
                        .map((m) => groups.find((g) => g.id === m.group_id)?.name)
                        .filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>
                      {p.bounced_at ? <span className="pill failed">Bounced</span>
                        : p.unsubscribed ? <span className="pill">Unsubscribed</span>
                        : p.active ? <span className="pill sent">Active</span>
                        : <span className="pill draft">Paused</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn sm ghost" onClick={() => toggleActive(p)}>
                        {p.active ? 'Pause' : 'Resume'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
