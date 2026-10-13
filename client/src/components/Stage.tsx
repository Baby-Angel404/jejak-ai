import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { SceneCanvas } from '../scene/SceneCanvas';
import { useNarrow, useReducedMotion } from '../state/useMedia';
import { useSession } from '../state/session';

export function Stage() {
  const { t, theme, lang } = useI18n();
  const state = useSession();
  const narrow = useNarrow(600);
  const reduced = useReducedMotion();

  const labels = useMemo(() => ({
    you: t('scene.label.you'),
    tower: t('scene.label.tower'),
    dc: t('scene.label.dc'),
    cool: t('scene.label.cool'),
    glass: t('scene.label.glass'),
    req: t('scene.legend.request'),
    res: t('scene.legend.response'),
    caption: t('scene.caption'),
  }), [t, lang]);

  // Gelas mengikuti total sesi; selama streaming angka prompt yang sedang jalan ikut dihitung.
  const glassMl = state.sessionTotals.ml + (state.status === 'streaming' ? state.totals.ml : 0);

  const statusText =
    state.status === 'error' ? `${t('status.error')}: ${state.error ?? ''}`
      : state.status === 'streaming' ? (state.mode === 'simulasi' ? t('status.sim') : t('status.live'))
        : state.status === 'done' ? t('status.done')
          : t('status.idle');

  return (
    <figure className="stage" style={{ margin: 0 }}>
      <SceneCanvas
        instant={state.instant}
        sessionMl={glassMl}
        dark={theme === 'dark'}
        reduced={reduced}
        labels={labels}
      />
      <figcaption>
        <strong role="status" aria-live="polite">{statusText}</strong>
      </figcaption>
      <div className="legend" aria-hidden={!narrow}>
        <span className="legend-item"><span className="swatch yellow" />{t('scene.legend.power')}</span>
        <span className="legend-item"><span className="swatch blue" />{t('scene.legend.response')}</span>
        <span className="legend-item"><span className="swatch dash" />{t('scene.legend.request')}</span>
        <span className="legend-item"><span className="swatch pink" />{t('scene.legend.steam')}</span>
        <span className="legend-item"><span className="swatch" style={{ background: 'transparent' }} />{t('scene.legend.glass')}</span>
      </div>
    </figure>
  );
}