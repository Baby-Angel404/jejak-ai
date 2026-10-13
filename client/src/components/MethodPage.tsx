import { useEffect, useState } from 'react';
import type { ProviderEntry } from '../../../shared/types';
import { useI18n } from '../i18n';
import { fetchProviders, LOCAL_SIMULATION } from '../state/coefficients';

export function MethodPage() {
  const { t } = useI18n();
  const [providers, setProviders] = useState<Record<string, ProviderEntry>>({});

  useEffect(() => {
    const ac = new AbortController();
    fetchProviders(ac.signal).then(p => setProviders(p));
    return () => ac.abort();
  }, []);

  const rows = Object.entries(providers);
  const showLocal = rows.length === 0;

  return (
    <div className="doc">
      <h1>{t('method.title')}</h1>
      <p>{t('method.p1')}</p>

      <h2>{t('method.h2.measured')}</h2>
      <p>{t('method.measured.body')}</p>

      <h2>{t('method.h2.estimated')}</h2>
      <p><code>{t('method.estimated.formula1')}</code></p>
      <p><code>{t('method.estimated.formula2')}</code></p>
      <p>{t('method.estimated.units')}</p>
      <p>{t('method.estimated.body')}</p>

      <h2>{t('method.h2.range')}</h2>
      <p>{t('method.range.body')}</p>

      <h2>{t('method.h2.limits')}</h2>
      <ul>
        <li>{t('method.limits.l1')}</li>
        <li>{t('method.limits.l2')}</li>
        <li>{t('method.limits.l3')}</li>
        <li>{t('method.limits.l4')}</li>
        <li>{t('method.limits.l5')}</li>
      </ul>

      <h2>{t('method.h2.coef')}</h2>
      <p className="hint">{t('method.coef.note')}</p>
      <div className="scroll-x" tabIndex={0} role="region" aria-label={t('method.h2.coef')}>
        <table className="data">
          <caption className="visually-hidden">{t('method.h2.coef')}</caption>
          <thead>
            <tr>
              <th scope="col">provider</th>
              <th scope="col">model</th>
              <th scope="col">e_in</th>
              <th scope="col">e_out</th>
              <th scope="col">PUE</th>
              <th scope="col">WUE</th>
              <th scope="col">air / 1.000 token keluar</th>
              <th scope="col">sumber</th>
            </tr>
          </thead>
          <tbody>
            {(showLocal ? [['simulasi-lokal', LOCAL_SIMULATION] as const] : rows).map(([id, p]) => (
              <tr key={id}>
                <td>{p.name}</td>
                <td>{p.model}</td>
                <td>{p.e_in}</td>
                <td>{p.e_out}</td>
                <td>{p.pue}</td>
                <td>{p.wue}</td>
                <td>{((p.e_out / 1000) * p.pue * p.wue * 1000).toFixed(3)} mL</td>
                <td>{p.sumber ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showLocal && <p className="hint">Server belum jalan, jadi tabel memakai koefisien simulasi lokal. Jalankan <code>npm run dev</code> untuk melihat daftar provider dari <code>config/coefficients.json</code>.</p>}
    </div>
  );
}