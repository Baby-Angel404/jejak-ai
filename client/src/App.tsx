import { Suspense, lazy, useState } from 'react';
import { useI18n } from './i18n';
import { useSession } from './state/session';
import { PromptForm } from './components/PromptForm';
import { Stage } from './components/Stage';
import { MethodPage } from './components/MethodPage';
import { Receipt } from './receipt/Receipt';

// Halaman yang memakai Recharts dimuat terpisah supaya adegan utama tetap ringan.
const CompareView = lazy(() => import('./components/CompareView').then(m => ({ default: m.CompareView })));
const Dashboard = lazy(() => import('./dashboard/Dashboard').then(m => ({ default: m.Dashboard })));
const CoefficientsPanel = lazy(() => import('./dashboard/CoefficientsPanel').then(m => ({ default: m.CoefficientsPanel })));

type View = 'scene' | 'compare' | 'dashboard' | 'coefficients' | 'method';

export default function App() {
  const { t, theme, toggleTheme, lang, setLang } = useI18n();
  const state = useSession();
  const [view, setView] = useState<View>('scene');

  return (
    <>
      <div className="wrap">
        <a className="skip-link" href="#main">{t('skip')}</a>
        <header className="topbar">
          <span className="brand"><span className="dot" />Jejak AI</span>
          <nav className="nav" aria-label={t('nav.scene')}>
            <button type="button" aria-current={view === 'scene' ? 'page' : undefined} onClick={() => setView('scene')}>
              {t('nav.scene')}
            </button>
            <button type="button" aria-current={view === 'compare' ? 'page' : undefined} onClick={() => setView('compare')}>
              {t('nav.compare')}
            </button>
            <button type="button" aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => setView('dashboard')}>
              {t('nav.dashboard')}
            </button>
            <button type="button" aria-current={view === 'coefficients' ? 'page' : undefined} onClick={() => setView('coefficients')}>
              {t('nav.coefficients')}
            </button>
            <button type="button" aria-current={view === 'method' ? 'page' : undefined} onClick={() => setView('method')}>
              {t('nav.method')}
            </button>
          </nav>
          <div className="toggle-row">
            <button type="button" className="btn ghost" onClick={toggleTheme}>
              {t('theme.toggle')}: {theme === 'dark' ? t('theme.dark') : t('theme.light')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setLang(lang === 'id' ? 'en' : 'id')}>
              {t('lang.toggle')}
            </button>
          </div>
        </header>

        <main id="main">
        <Suspense fallback={<p className="hint" style={{ padding: '24px 0' }}>…</p>}>
        {view === 'dashboard' ? (
          <Dashboard />
        ) : view === 'coefficients' ? (
          <CoefficientsPanel />
        ) : view === 'compare' ? (
          <CompareView />
        ) : view === 'scene' ? (
          <>
            <section className="hero">
              <span className="stamp">{t('hero.stamp')}</span>
              <h1>{t('hero.title')}</h1>
              <p className="lede">{t('hero.lede')}</p>
            </section>

            <PromptForm />

            <div className="layout" style={{ marginTop: 26 }}>
              <div>
                <Stage />
                {state.status !== 'idle' && (
                  <div className="stream" aria-live="polite">
                    {state.text || (state.status === 'error' ? state.error : '…')}
                  </div>
                )}
                {state.status === 'error' && state.error && <p className="error-box">{state.error}</p>}
              </div>
              <Receipt state={state} />
            </div>
          </>
        ) : (
          <MethodPage />
        )}
        </Suspense>
        </main>

        <footer className="site">
          <p>
            Water &amp; electricity are estimates from published-style coefficients, shown with a 0.4&times;–3&times; range.
            Tokens and bytes are measured. Providers do not publish real consumption per prompt.
          </p>
        </footer>
      </div>
    </>
  );
}