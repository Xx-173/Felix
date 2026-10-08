import React from 'react';

/** Keep the translated text intact while giving its English gloss less weight. */
export function BilingualLabel({ children, stacked = false }: { children: string; stacked?: boolean }) {
  const match = children.match(/^(.*?)\s*[（(]([^（）()]*)[）)]$/);
  if (!match) return <>{children}</>;
  return <span className={`felix-bilingual${stacked ? ' felix-bilingual--stacked' : ''}`}>
    <span>{match[1]}</span>{' '}<span className="felix-bilingual-gloss">（{match[2]}）</span>
  </span>;
}
