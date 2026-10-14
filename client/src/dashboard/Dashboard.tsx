import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { HistoryRow } from '../../../shared/types';
import { useI18n } from '../i18n';
import { fetchProviders } from '../state/coefficients';
import { fmtBytes, fmtMl, fmtWh, num, tooltipFormatter, type Loc } from '../state/format';
import { aggregate, type Period } from '../state/aggregate';

export function Dashboard() {
  const { t, lang } = useI18n();
  const loc: Loc = lang === 'id' ? 'id' : 'en';

  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [period, setPeriod] = useState<Period>('day');
  const [state, setState] = useState<'idle' | 'loading' | 'offline'>('loading');

  const load = async () => {
    setState('loading');
    try {
      const qs = filter ? `&provider=${encodeURIComponent(filter)}` : '';
      const res = await fetch(`/api/history?limit=2000${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      setRows(json.rows);
      setState('idle');
    } catch {
      setRows([]);
      setState('offline');
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);
  useEffect(() => {
    const ac = new AbortController();
    fetchProviders(ac.signal).then(p => setProviders(Object.keys(p)));
    return () => ac.abort();
  }, []);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    prompts: acc.prompts + 1,
    tokens: acc.tokens + r.tokens_in + r.tokens_out,
    ml: acc.ml + r.ml,
    wh: acc.wh + r.wh,
    bytes: acc.bytes + r.bytes,
  }), { prompts: 0, tokens: 0, ml: 0, wh: 0, bytes: 0 }), [rows]);

  const buckets = useMemo(() => aggregate(rows, period), [rows, period]);
  const periodLabel = period === 'day' ? t('dash.day') : period === 'week' ? t('dash.week') : t('dash.month');

  const exportQuery = filter ? `?provider=${encodeURIComponent(filter)}` : '';

  return (
    <div className="doc" style={{ maxWidth: 'none' }}>
      <section className="hero">
        <span className="stamp">{t('hero.stamp')}</span>
        <h1>{t('dash.title')}</h1>
        <p className="lede">{t('dash.estimateNote')}</p>
      </section>

      <div className="form-row">
        <div>
          <label className="field-label" htmlFor="dash-provider">{t('dash.filter.provider')}</label>
          <select id="dash-provider" className="field" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">{t('dash.filter.all')}</option>
            {providers.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div role="group" aria-label={t('dash.period')}>
          <span className="field-label">{t('dash.period')}</span>
          <div className="form-row" style={{ margin: 0 }}>
            {(['day', 'week', 'month'] as Period[]).map(p => (
              <button
                key={p}
                type="button"
                className="btn ghost"
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {p === 'day' ? t('dash.day') : p === 'week' ? t('dash.week') : t('dash.month')}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn ghost" onClick={() => void load()}>{t('dash.refresh')}</button>
        <div className="toggle-row">
          <a className="btn ghost" href={`/api/export.csv${exportQuery}`} download>{t('dash.export')} CSV</a>
          <a className="btn ghost" href={`/api/export.json${exportQuery}`} download>{t('dash.export')} JSON</a>
        </div>
      </div>

      {state === 'offline' && <p className="error-box">{t('dash.offline')}</p>}

      <div className="stat-strip">
        <div><span>{t('dash.total.prompts')}</span><strong className="num">{num(loc, totals.prompts, 0)}</strong></div>
        <div><span>{t('dash.total.tokens')}</span><strong className="num">{num(loc, totals.tokens, 0)}</strong></div>
        <div><span>{t('dash.total.water')} <i className="tag">{t('receipt.tag.est')}</i></span><strong className="num">{fmtMl(loc, totals.ml)}</strong></div>
        <div><span>{t('dash.total.electric')} <i className="tag">{t('receipt.tag.est')}</i></span><strong className="num">{fmtWh(loc, totals.wh)}</strong></div>
        <div><span>{t('dash.total.data')} <i className="tag measured">{t('receipt.tag.measured')}</i></span><strong className="num">{fmtBytes(loc, totals.bytes)}</strong></div>
      </div>

      <h2 style={{ marginTop: 26 }}>{t('dash.trend')} · {periodLabel}</h2>
      {buckets.length === 0 ? (
        <p className="hint">{state === 'loading' ? '…' : t('dash.empty')}</p>
      ) : (
        <div className="chart-grid">
          <div className="chart-box" role="img" aria-label={`${t('dash.col.water')} dan ${t('dash.col.electric')} per ${periodLabel}`}>
            <h3>{t('dash.col.water')} · {t('dash.col.electric')}</h3>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart accessibilityLayer data={buckets} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <YAxis width={46} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <Tooltip cursor={{ stroke: 'var(--rule-strong)' }} />
                <Line type="monotone" dataKey="ml" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} name={t('dash.col.water')} />
                <Line type="monotone" dataKey="wh" stroke="var(--pink)" strokeWidth={2} dot={{ r: 3 }} name={t('dash.col.electric')} />
              </LineChart>
            </ResponsiveContainer>
            <p className="hint">{t('dash.axisNote')}</p>
          </div>
          <div className="chart-box" role="img" aria-label={`${t('dash.col.data')} per ${periodLabel}`}>
            <h3>{t('dash.col.data')}</h3>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart accessibilityLayer data={buckets} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--rule)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <YAxis width={46} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--rule)' }} formatter={tooltipFormatter(t('dash.col.data'), (n) => fmtBytes(loc, n))} />
                <Bar dataKey="bytes" fill="var(--yellow)" stroke="var(--ink)" strokeWidth={1} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 26 }}>{t('dash.table')}</h2>
      {rows.length === 0 ? (
        <p className="hint">{state === 'loading' ? '…' : t('dash.empty')}</p>
      ) : (
        <div className="scroll-x" tabIndex={0} role="region" aria-label={t('dash.table')}>
          <table className="data">
            <caption className="visually-hidden">{t('dash.table')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('dash.table.time')}</th>
                <th scope="col">provider</th>
                <th scope="col">model</th>
                <th scope="col">{t('dash.table.in')}</th>
                <th scope="col">{t('dash.table.out')}</th>
                <th scope="col">{t('dash.col.water')}</th>
                <th scope="col">{t('dash.col.electric')}</th>
                <th scope="col">{t('dash.col.data')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.ts).toLocaleString(loc === 'id' ? 'id-ID' : 'en-GB')}</td>
                  <td>{r.provider}</td>
                  <td>{r.model}{r.tokens_estimated === 1 && <span className="tag"> ≈</span>}</td>
                  <td>{num(loc, r.tokens_in, 0)}</td>
                  <td>{num(loc, r.tokens_out, 0)}</td>
                  <td>{fmtMl(loc, r.ml)}</td>
                  <td>{fmtWh(loc, r.wh)}</td>
                  <td>{fmtBytes(loc, r.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}