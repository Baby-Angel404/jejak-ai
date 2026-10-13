import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { SessionState } from '../state/session';
import { withRange } from '../../../shared/calc';
import { useReducedMotion } from '../state/useMedia';
import { fmtBytes, fmtMl, fmtSeconds, fmtWh, num } from '../state/format';

/**
 * Angka naik halus menuju nilai baru selama streaming.
 * Kalau pengguna meminta reduced motion, angka langsung ikut nilai tanpa tween.
 */
function useCountUp(target: number, active: boolean): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const raf = useRef(0);
  const from = useRef(target);
  const t0 = useRef(0);

  useEffect(() => {
    if (!active || reduced) { from.current = target; setValue(target); return; }
    from.current = value;
    t0.current = performance.now();
    const dur = 260;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0.current) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const next = from.current + (target - from.current) * e;
      setValue(next);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, reduced]);

  return value;
}

function Row({ label, tag, children }: {
  label: string;
  tag?: { text: string; measured?: boolean };
  children: React.ReactNode;
}) {
  return (
    <div className="row">
      <span className="label">
        {label}
        {tag && <span className={`tag${tag.measured ? ' measured' : ''}`}> {tag.text}</span>}
      </span>
      <span className="leader" aria-hidden="true" />
      <span className="value">{children}</span>
    </div>
  );
}

export function Receipt({ state }: { state: SessionState }) {
  const { t, lang } = useI18n();
  const loc = lang === 'id' ? 'id' : 'en';
  const streaming = state.status === 'streaming';
  const hasRun = state.prompts > 0 || state.totals.ml > 0;

  const ml = useCountUp(state.totals.ml, streaming);
  const wh = useCountUp(state.totals.wh, streaming);
  const bytes = useCountUp(state.totals.bytes, streaming);
  const W = useCountUp(state.instant.W, streaming);
  // Sesi yang sedang berjalan ikut dihitung supaya total tidak terlihat nol saat streaming.
  const inflight = streaming ? state.totals : { ml: 0, wh: 0, bytes: 0 };
  const sMl = useCountUp(state.sessionTotals.ml + inflight.ml, streaming);
  const sWh = useCountUp(state.sessionTotals.wh + inflight.wh, streaming);
  const sBytes = useCountUp(state.sessionTotals.bytes + inflight.bytes, streaming);

  // Selama streaming angka tengah masih naik, jadi rentangnya ikut dihitung dari nilai berjalan.
  const mlR = withRange(state.totals.ml);
  const whR = withRange(state.totals.wh);

  const drops = Math.round(state.totals.ml / 0.05);
  const ledSeconds = state.totals.wh * 360; // 10 W = 10/3600 Wh per detik
  const streamSeconds = state.totals.bytes / (5_000_000 / 8);

  return (
    <div className="receipt-col">
      <div className="struk">
        <div className="struk-head">
          <h2>{t('receipt.title')}</h2>
          <span className="who">
            {hasRun ? state.model || state.provider : t('receipt.who.idle')}
          </span>
        </div>

        <Row label={t('receipt.water')} tag={{ text: t('receipt.tag.est') }}>
          {fmtMl(loc, ml)}
        </Row>
        <div className="row">
          <span className="leader" aria-hidden="true" />
          <span className="range">
            {t('receipt.range', { min: fmtMl(loc, mlR.low), max: fmtMl(loc, mlR.high) })}
          </span>
        </div>

        <Row label={t('receipt.power')} tag={{ text: t('receipt.tag.est') }}>
          {fmtWh(loc, wh)}
        </Row>
        <div className="row">
          <span className="leader" aria-hidden="true" />
          <span className="range">
            {t('receipt.range', { min: fmtWh(loc, whR.low), max: fmtWh(loc, whR.high) })}
          </span>
        </div>

        <Row label={t('receipt.data')} tag={{ text: t('receipt.tag.measured'), measured: true }}>
          {fmtBytes(loc, bytes)}
        </Row>

        <p className="struk-section-title">{t('receipt.tokens')}</p>
        <div className="row">
          <span className="label">
            {t('receipt.tokens.line', { in: num(loc, state.totals.tokensIn, 0), out: num(loc, state.totals.tokensOut, 0) })}
            {state.tokensEstimated && <span className="tag"> {t('receipt.estimatedTokens')}</span>}
          </span>
        </div>
        <Row label={t('receipt.instant')}>{`${num(loc, W, 3)} W`}</Row>

        <p className="struk-section-title">{t('receipt.equiv')}</p>
        {!hasRun ? (
          <div className="equiv">{t('receipt.equiv.empty')}</div>
        ) : (
          <ul className="equiv" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t('receipt.equiv.drops', { n: num(loc, drops, 0) })}</li>
            <li>{t('receipt.equiv.led', { n: fmtSeconds(loc, ledSeconds) })}</li>
            <li>{t('receipt.equiv.stream', { n: fmtSeconds(loc, streamSeconds) })}</li>
          </ul>
        )}

        <p className="struk-section-title">{t('receipt.session')}</p>
        <Row label={t('receipt.water')}>{fmtMl(loc, sMl)}</Row>
        <Row label={t('receipt.power')}>{fmtWh(loc, sWh)}</Row>
        <Row label={t('receipt.data')} tag={{ text: t('receipt.tag.measured'), measured: true }}>{fmtBytes(loc, sBytes)}</Row>
        <div className="equiv" style={{ marginTop: 8 }}>{t('receipt.session.note')}</div>
        {lang === 'id' && <div className="equiv">Estimasi memakai rentang 0,4&times; sampai 3&times;; angka tunggal tanpa rentang tidak ditampilkan.</div>}
        {lang === 'en' && <div className="equiv">Estimates carry a 0.4&times; to 3&times; range; a single number without a range is never shown.</div>}
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {`${t('receipt.water')} ${fmtMl(loc, state.totals.ml)}. ${t('receipt.power')} ${fmtWh(loc, state.totals.wh)}. ${t('receipt.data')} ${fmtBytes(loc, state.totals.bytes)}.`}
      </p>
    </div>
  );
}