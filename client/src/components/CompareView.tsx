import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProviderEntry } from '../../../shared/types';
import { useI18n } from '../i18n';
import { SceneCanvas } from '../scene/SceneCanvas';
import { useNarrow, useReducedMotion } from '../state/useMedia';
import { fetchProviders } from '../state/coefficients';
import { compareStore, runCompare, useCompare, type CompareLane } from '../state/compare';
import { fmtBytes, fmtMl, fmtWh, num, tooltipFormatter, type Loc } from '../state/format';
import { withRange } from '../../../shared/calc';

const INKS = ['var(--blue)', 'var(--pink)', 'var(--yellow)'];

function LaneRow({ label, tag, value, range }: {
  label: string;
  tag?: { text: string; measured?: boolean };
  value: string;
  range?: string;
}) {
  return (
    <div className="row">
      <span className="label">
        {label}
        {tag && <span className={`tag${tag.measured ? ' measured' : ''}`}> {tag.text}</span>}
      </span>
      <span className="leader" aria-hidden="true" />
      <span className="value">{value}</span>
      {range && <span className="range">{range}</span>}
    </div>
  );
}

function LaneCard({ lane, focused, loc, onFocus, estTag, measTag }: {
  lane: CompareLane;
  focused: boolean;
  loc: Loc;
  onFocus: () => void;
  estTag: string;
  measTag: string;
}) {
  const ml = withRange(lane.totals.ml);
  const wh = withRange(lane.totals.wh);
  const range = (a: string, b: string) => `${a} – ${b}`;

  return (
    <div className={`lane-card${focused ? ' focused' : ''}`}>
      <div className="lane-head">
        <strong>{lane.name}</strong>
        <span className="lane-model">{lane.model || lane.tag}</span>
      </div>

      <LaneRow label="Air" tag={{ text: estTag }} value={fmtMl(loc, lane.totals.ml)}
        range={range(fmtMl(loc, ml.low), fmtMl(loc, ml.high))} />
      <LaneRow label="Listrik" tag={{ text: estTag }} value={fmtWh(loc, lane.totals.wh)}
        range={range(fmtWh(loc, wh.low), fmtWh(loc, wh.high))} />
      <LaneRow label="Data" tag={{ text: measTag, measured: true }} value={fmtBytes(loc, lane.totals.bytes)} />

      <div className="lane-foot">
        <span>
          {num(loc, lane.totals.tokensIn, 0)} in · {num(loc, lane.totals.tokensOut, 0)} out
          {lane.estimated && ' · ≈'}
        </span>
        <button type="button" className="btn ghost" onClick={onFocus} disabled={focused}>
          {focused ? '●' : '○'}
        </button>
      </div>

      <p className="lane-status">
        {lane.status === 'error' ? lane.error
          : lane.status === 'streaming' ? '…'
            : lane.status === 'done' ? `${lane.text.slice(0, 90)}${lane.text.length > 90 ? '…' : ''}`
              : '—'}
      </p>
    </div>
  );
}

function MiniBar({ title, unit, data, dataKey, format }: {
  title: string;
  unit: string;
  data: Record<string, string | number>[];
  dataKey: string;
  format: (v: number) => string;
}) {
  return (
    <div className="chart-box" role="img" aria-label={`${title}: ${data.map(d => `${d.name} ${format(Number(d[dataKey]))} ${unit}`).join(', ')}`}>
      <h3>{title}</h3>
      {data.length === 0 ? (
        <p className="hint">—</p>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart accessibilityLayer data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
            <YAxis width={46} tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'var(--rule)' }}
              formatter={tooltipFormatter(title, (n) => `${format(n)} ${unit}`)}
            />
            <Bar dataKey={dataKey} radius={[2, 2, 0, 0]}>
              {data.map((_, i) => <Cell key={i} fill={INKS[i % INKS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function CompareView() {
  const { t, theme, lang } = useI18n();
  const state = useCompare();
  const loc: Loc = lang === 'id' ? 'id' : 'en';
  const narrow = useNarrow(600);
  const reduced = useReducedMotion();

  const [prompt, setPrompt] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({});
  const [err, setErr] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchProviders(ac.signal).then(p => {
      const ready = Object.fromEntries(Object.entries(p).filter(([, v]) => v.hasKey));
      setProviders(ready);
      setIds(cur => (cur.length ? cur : Object.keys(ready).slice(0, 2)));
    });
    return () => ac.abort();
  }, []);

  const toggle = (id: string) => {
    setErr('');
    setIds(cur => {
      if (cur.includes(id)) return cur.filter(x => x !== id);
      if (cur.length >= 3) return cur;            // maksimal 3 jalur
      return [...cur, id];
    });
  };

  const run = async () => {
    if (!prompt.trim()) { setErr(t('form.err.empty')); return; }
    if (ids.length < 2) { setErr(t('compare.needsTwo')); return; }
    setErr('');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await runCompare({ prompt: prompt.trim(), providers, ids, maxTokens: 1024, signal: ac.signal });
    } catch (e) {
      for (const id of ids) compareStore.failLane(id, (e as Error).message);
      compareStore.finish();
    }
    abortRef.current = null;
  };

  const stop = () => { abortRef.current?.abort(); compareStore.stopAll(); };

  const focusLane = state.lanes.find(l => l.tag === state.focus) ?? state.lanes[0];
  const labels = useMemo(() => ({
    you: t('scene.label.you'), tower: t('scene.label.tower'), dc: t('scene.label.dc'),
    cool: t('scene.label.cool'), glass: t('scene.label.glass'),
    req: t('scene.legend.request'), res: t('scene.legend.response'), caption: t('scene.caption'),
  }), [t, lang]);

  const charts = [
    { title: t('compare.chart.water'), unit: 'mL', key: 'ml', format: (v: number) => num(loc, v, 3) },
    { title: t('compare.chart.electric'), unit: 'Wh', key: 'wh', format: (v: number) => num(loc, v, 4) },
    { title: t('compare.chart.data'), unit: 'kB', key: 'kb', format: (v: number) => num(loc, v, 1) },
  ];

  const lowest = state.lanes.filter(l => l.status === 'done')
    .reduce<CompareLane | null>((a, b) => (!a || b.totals.ml < a.totals.ml ? b : a), null);

  return (
    <div>
      <section className="hero">
        <span className="stamp">{t('hero.stamp')}</span>
        <h1>{t('compare.title')}</h1>
        <p className="lede">{t('compare.lede')}</p>
      </section>

      <div className="form-row" role="group" aria-label={t('compare.pick')}>
        {Object.entries(providers).map(([id, p]) => (
          <button
            key={id}
            type="button"
            className="btn ghost"
            aria-pressed={ids.includes(id)}
            onClick={() => toggle(id)}
          >
            {p.name}
          </button>
        ))}
        {Object.keys(providers).length === 0 && (
          <span className="hint">{t('form.err.provider')}</span>
        )}
      </div>

      <label className="field-label" htmlFor="cmp-prompt">{t('compare.prompt')}</label>
      <textarea
        id="cmp-prompt"
        className="prompt"
        rows={3}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={t('compare.prompt.ph')}
      />

      <div className="form-row">
        {state.running
          ? <button type="button" className="btn" onClick={stop}>{t('compare.stop')}</button>
          : <button type="button" className="btn" onClick={() => void run()} disabled={ids.length < 2}>{t('compare.run')}</button>}
        <span className="hint">{ids.length}/3 {t('compare.pick').toLowerCase()}</span>
      </div>

      {err && <p className="error-box">{err}</p>}

      {state.lanes.length === 0 ? (
        <p className="hint" style={{ marginTop: 18 }}>{t('compare.empty')}</p>
      ) : (
        <>
          <div className="lane-grid">
            {state.lanes.map(l => (
              <LaneCard
                key={l.tag}
                lane={l}
                loc={loc}
                focused={l.tag === focusLane?.tag}
                estTag={t('receipt.tag.est')}
                measTag={t('receipt.tag.measured')}
                onFocus={() => compareStore.focusLane(l.tag)}
              />
            ))}
          </div>

          {lowest && state.lanes.length > 1 && (
            <p className="hint" style={{ marginTop: 10 }}>{t('compare.winner', { name: lowest.name })}</p>
          )}

          <div className="chart-grid">
            {charts.map(c => (
              <MiniBar
                key={c.key}
                title={c.title}
                unit={c.unit}
                format={c.format}
                dataKey={c.key}
                data={state.lanes.map(l => ({
                  name: l.name,
                  ml: l.totals.ml,
                  wh: l.totals.wh,
                  kb: l.totals.bytes / 1000,
                }))}
              />
            ))}
          </div>

          <figure className="stage" style={{ marginTop: 22 }}>
            <SceneCanvas
              instant={focusLane?.instant ?? { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 }}
              sessionMl={focusLane?.totals.ml ?? 0}
              dark={theme === 'dark'}
              reduced={reduced}
              labels={labels}
            />
            <figcaption>
              <strong>{focusLane ? focusLane.name : ''}</strong>
              {narrow && <span className="hint"> · {t('compare.focused')}</span>}
            </figcaption>
          </figure>
        </>
      )}
    </div>
  );
}