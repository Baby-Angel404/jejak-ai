import { useEffect, useRef, useState } from 'react';
import type { ProviderEntry } from '../../../shared/types';
import { useI18n } from '../i18n';
import { streamChat, type StreamHandlers } from '../state/api';
import { simulateChat } from '../state/simulate';
import { fetchProviders, LOCAL_SIMULATION } from '../state/coefficients';
import { sessionStore, useSession, type Mode } from '../state/session';

export function PromptForm() {
  const { t } = useI18n();
  const state = useSession();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<Mode>('simulasi');
  const [maxTokens, setMaxTokens] = useState(1024);
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({});
  const [providerId, setProviderId] = useState('');
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [formError, setFormError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  useEffect(() => {
    const ac = new AbortController();
    fetchProviders(ac.signal).then(p => {
      const ready = Object.fromEntries(Object.entries(p).filter(([, v]) => v.hasKey));
      setProviders(ready);
      setServerUp(Object.keys(p).length > 0);
      const first = Object.keys(ready)[0];
      if (first) setProviderId(cur => cur || first);
    });
    return () => ac.abort();
  }, []);

  const handlers = useRef<StreamHandlers>({
    onToken: (e) => sessionStore.appendToken(e.delta),
    onMetrics: (m, dt) => sessionStore.applyMetrics(m, dt),
    onDone: (d) => sessionStore.finish(d),
    onError: e => sessionStore.fail(e.message),
  }).current;

  const running = state.status === 'streaming';

  const submit = async () => {
    const text = prompt.trim();
    if (!text) { setFormError(t('form.err.empty')); return; }
    if (mode === 'live' && !providerId) { setFormError(t('form.err.provider')); return; }
    setFormError('');

    const ac = new AbortController();
    abortRef.current = ac;

    if (mode === 'simulasi') {
      sessionStore.begin(LOCAL_SIMULATION.name, 'simulasi lokal', 'simulasi');
      try {
        await simulateChat({ prompt: text, signal: ac.signal }, handlers, LOCAL_SIMULATION);
      } catch (e) {
        sessionStore.fail((e as Error).message);
      }
      if (statusRef.current === 'streaming') sessionStore.stop();
    } else {
      const model = providers[providerId]?.model ?? '';
      sessionStore.begin(providerId, model, 'live');
      try {
        await streamChat({ provider: providerId, prompt: text, maxTokens, signal: ac.signal }, handlers);
        if (statusRef.current === 'streaming') sessionStore.fail('Stream berakhir tanpa event done.');
      } catch (e) {
        if (!ac.signal.aborted) sessionStore.fail((e as Error).message);
      }
      if (statusRef.current === 'streaming') sessionStore.stop();
    }
    abortRef.current = null;
  };

  const stop = () => {
    abortRef.current?.abort();
    sessionStore.stop();
  };

  const ready = Object.entries(providers);

  return (
    <div>
      <div className="form-row" role="group" aria-label={t('form.send')}>
        <button type="button" className="btn ghost" aria-pressed={mode === 'simulasi'} onClick={() => setMode('simulasi')}>
          {t('form.simulate')}
        </button>
        <button type="button" className="btn ghost" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
          {t('form.send')}
        </button>
      </div>

      <label className="field-label" htmlFor="prompt">{t('form.prompt')}</label>
      <textarea
        id="prompt"
        className="prompt"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder={t('form.prompt.ph')}
        rows={4}
      />

      <div className="form-row">
        {mode === 'live' && (
          <>
            <div>
              <label className="field-label" htmlFor="provider">{t('form.provider')}</label>
              <select
                id="provider"
                className="field"
                value={providerId}
                onChange={e => setProviderId(e.target.value)}
              >
                {ready.length === 0 && <option value="">{t('form.err.provider')}</option>}
                {ready.map(([id, p]) => <option key={id} value={id}>{p.name} · {p.model}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="maxtok">{t('form.maxTokens')}</label>
              <input
                id="maxtok"
                className="field"
                type="number"
                min={64}
                max={8192}
                step={64}
                value={maxTokens}
                onChange={e => setMaxTokens(Number(e.target.value) || 1024)}
              />
            </div>
          </>
        )}

        {running
          ? <button type="button" className="btn" onClick={stop}>{t('form.stop')}</button>
          : <button type="button" className="btn" onClick={() => void submit()}>{t('form.send')}</button>}
      </div>

      <p className="hint">
        {mode === 'simulasi' ? t('form.sim.note') : t('form.live.note')}
        {serverUp === false && ' · server belum jalan (npm run dev:server), mode nyata belum tersedia.'}
      </p>

      {formError && <p className="error-box">{formError}</p>}
    </div>
  );
}