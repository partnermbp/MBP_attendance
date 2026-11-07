import type { ReactNode } from 'react';

export default function KnowMore({ children, label = 'Know more' }: { children: ReactNode; label?: string }) {
  return <details className="crm-know-more">
    <summary>{label}</summary>
    <div className="crm-know-more-content">{children}</div>
  </details>;
}
