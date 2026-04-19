import type { SessionReport, PageContext, LCPElementDescriptor } from '@vitalsage/types';

export function synthesizeContext(sessions: SessionReport[]): PageContext {
  if (sessions.length === 0) throw new Error('Cannot synthesize context: no sessions');

  // Most recent session as base (likely most representative DOM)
  const sorted = [...sessions].sort((a, b) => b.timestamp - a.timestamp);
  const base = sorted[0]!;

  return {
    ...base.page,
    ...(base.page.lcpElement
      ? { lcpElement: annotateLcpElement(base.page.lcpElement, sessions) }
      : {}),
  };
}

function annotateLcpElement(
  el: LCPElementDescriptor,
  sessions: SessionReport[],
): LCPElementDescriptor {
  const fetchPriorities = sessions
    .map(s => s.page.lcpElement?.fetchPriority)
    .filter((v): v is string => v !== undefined && v !== null);

  // If fetchPriority is absent in > 90% of sessions, treat it as consistently missing
  const presentRatio = fetchPriorities.length / sessions.length;
  return {
    ...el,
    ...(presentRatio < 0.1 ? {} : { fetchPriority: el.fetchPriority }),
  };
}
