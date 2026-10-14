import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProviderEntry } from '../../../shared/types';
import { useI18n } from '../i18n';
import { fetchProviders } from '../state/coefficients';
import { num, tooltipFormatter, type Loc } from '../state/format';
import { waterPer1kOut } from '../state/aggregate';

const INKS = ['var(--blue)', 'var(--pink)', 'var(--yellow)'];

interface Draft {
  e_in: string; e_out: string; pue: string; wue: string;
  tahun: string; sumber: string;
}

/** Nilai formulir default berasal dari satu sumber: entri koefisien server. */
function draftFor(p: Partial<ProviderEntry>): Draft {
  return {
    e_in: String(p.e_in ?? ''), e_out: String(p.e_out ?? ''),
    pue: String(p.pue ?? ''), wue: String(p.wue ?? ''),
    tahun: p.tahun === undefined ? '' : String(p.tahun),
    sumber: p.sumber ?? '',
  };
}

export function CoefficientsPanel() {
  const { t, lang } = useI18n();
  const loc: Loc = lang === 'id' ? 'id' : 'en';
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      setProviders(await fetchProviders());
      setErr('');
    } catch {
      setErr(t('dash.offline'));
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rows = useMemo(() => Object.entries(providers).map(([id, p], i) => ({
    id, p, ink: INKS[i % INKS.length],
    draft: drafts[id] ?? draftFor(p),
  })), [providers, drafts]);

  const setField = (id: string, key: keyof Draft, value: string) => {
    const base = drafts[id] ?? draftFor(providers[id] ?? {});
    setDrafts(d => ({ ...d, [id]: { ...base, [key]: value } }));
  };

  const save = async (id: string, draft: Draft) => {
    const nums = { e_in: Number(draft.e_in), e_out: Number(draft.e_out), pue: Number(draft.pue), wue: Number(draft.wue) };
    if (Object.values(nums).some(v => !Number.isFinite(v) || v < 0)) { setErr(t('coef.invalid')); return; }
    setBusy(id); setMsg(''); setErr('');
    try {
      const res = await fetch(`/api/coefficients/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...nums,
          sumber: draft.sumber,
          ...(draft.tahun.trim() ? { tahun: Number(draft.tahun) } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      setMsg(t('coef.saved'));
      setDrafts(d => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch (e) {
      setErr(t('coef.save.failed', { msg: (e as Error).message }));
    } finally {
      setBusy('');
    }
  };

  const reset = async () => {
    setBusy('__reset'); setMsg(''); setErr('');
    try {
      const res = await fetch('/api/coefficients/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? String(res.status));
      setMsg(t('coef.reset.done'));
      await load();
    } catch (e) {
      setErr(t('coef.reset.failed', { msg: (e as Error).message }));
    } finally {
      setBusy('');
    }
  };

  const chart = rows.map(r => ({ name: r.p.name, ml: Number(waterPer1kOut(r.p).toFixed(4)) }));

  return (
    <div className="doc" style={{ maxWidth: 'none' }}>
      <section className="hero">
        <span className="stamp">{t('hero.stamp')}</span>
        <h1>{t('coef.title')}</h1>
        <p className="lede">{t('coef.lede')}</p>
      </section>

      <div className="form-row">
        <button type="button" className="btn ghost" onClick={() => void reset()} disabled={busy === '__reset'}>
          {t('coef.reset')}
        </button>
        {msg && <span className="hint">{msg}</span>}
      </div>
      {err && <p className="error-box">{err}</p>}

      <div className="chart-grid">
        <div className="chart-box" role="img" aria-label={t('coef.chart')}>
          <h2>{t('coef.chart')}</h2>
          {chart.length === 0 ? <p className="hint">—</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart accessibilityLayer data={chart} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <YAxis width={46} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--rule)' }} formatter={tooltipFormatter(t('coef.chart'), (n) => `${num(loc, n, 3)} mL`)} />
                <Bar dataKey="ml" radius={[2, 2, 0, 0]}>
                  {chart.map((_, i) => <Cell key={i} fill={INKS[i % INKS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="hint">{t('coef.table.note')}</p>
        </div>
      </div>

      <div className="scroll-x" tabIndex={0} role="region" aria-label={t('coef.title')}>
        <table className="data coef-table">
          <caption className="visually-hidden">{t('coef.title')}</caption>
          <thead>
            <tr>
              <th scope="col">provider</th>
              <th scope="col">{t('coef.col.model')}</th>
              <th scope="col">{t('coef.col.ein')}</th>
              <th scope="col">{t('coef.col.eout')}</th>
              <th scope="col">{t('coef.col.pue')}</th>
              <th scope="col">{t('coef.col.wue')}</th>
              <th scope="col">{t('coef.col.year')}</th>
              <th scope="col">{t('coef.col.source')}</th>
              <th scope="col">{t('coef.col.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, p, draft }) => (
              <tr key={id}>
                <td>
                  {p.name}
                  <span className="hint" style={{ display: 'block' }}>{p.hasKey ? t('coef.hasKey') : t('coef.noKey')}</span>
                </td>
                <td>{p.model}</td>
                {(['e_in', 'e_out', 'pue', 'wue', 'tahun'] as (keyof Draft)[]).map(k => (
                  <td key={k}>
                    <input
                      className="field cell"
                      type="number"
                      step="0.01"
                      min="0"
                      aria-label={`${p.name} ${k}`}
                      value={draft[k]}
                      onChange={e => setField(id, k, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <input
                    className="field cell wide-cell"
                    aria-label={`${p.name} sumber`}
                    value={draft.sumber}
                    onChange={e => setField(id, 'sumber', e.target.value)}
                  />
                </td>
                <td>
                  <button type="button" className="btn ghost" onClick={() => void save(id, draft)} disabled={busy === id}>
                    {t('coef.save')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}