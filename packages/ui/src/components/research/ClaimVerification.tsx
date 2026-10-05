import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ResearchReport } from '@finagent/core';

export const ClaimVerification: React.FC<{ report: ResearchReport }> = ({ report }) => {
  const { t } = useTranslation();
  const claims = report.claimVerification ?? [];
  const supported = claims.filter((claim) => claim.status === 'supported').length;
  return (
    <section className="mt-3 rounded-lg border border-border p-3 text-xs" data-testid="claim-verification">
      <h4 className="font-semibold">{t('research.verification.title')}</h4>
      <p className="mt-1 text-text-muted">{t('research.confidenceNote')}</p>
      <p className="mt-1">{claims.length ? t('research.verification.coverage', { supported, total: claims.length }) : t('research.verification.legacy')}</p>
      {claims.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">{t('research.verification.details')}</summary>
          <ul className="mt-2 space-y-2">
            {claims.map((claim) => (
              <li key={claim.claimId} data-verification-status={claim.status}>
                <span className={claim.status === 'supported' ? 'text-positive' : 'text-warning'}>
                  {t(`research.verification.${claim.status}`)}
                </span>{' · '}{claim.claimText}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
