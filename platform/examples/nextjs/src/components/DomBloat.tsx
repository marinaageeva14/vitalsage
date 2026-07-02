'use client';

import { useEffect, useRef } from 'react';

/**
 * FIX: renders only the visible slice of a large list (virtualisation pattern).
 * Instead of 3 000 real DOM nodes we keep ≤ 10 in the DOM at any time,
 * repositioned via a transform as the user scrolls.
 *
 * In production you would use react-window or @tanstack/virtual; this is a
 * minimal inline version so the example has zero extra dependencies.
 */
export default function DomBloat() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const TOTAL   = 300;   // logical rows
    const VISIBLE = 10;    // rows kept in DOM
    const ROW_H   = 24;    // px per row

    const container = ref.current;
    if (!container) return;

    // Build only VISIBLE rows, recycle them on scroll.
    const rows: HTMLDivElement[] = [];
    for (let i = 0; i < VISIBLE; i++) {
      const row = document.createElement('div');
      row.style.cssText = `position:absolute;height:${ROW_H}px;width:100%;top:${i * ROW_H}px`;
      for (let j = 0; j < 10; j++) row.appendChild(document.createElement('span'));
      container.appendChild(row);
      rows.push(row);
    }

    container.style.cssText = `position:relative;height:${TOTAL * ROW_H}px;overflow:hidden;display:none`;

    let lastStart = 0;
    function recycle(scrollTop: number) {
      const start = Math.floor(scrollTop / ROW_H);
      if (start === lastStart) return;
      lastStart = start;
      rows.forEach((row, i) => {
        const idx = start + i;
        if (idx >= TOTAL) { row.style.display = 'none'; return; }
        row.style.display = '';
        row.style.top = `${idx * ROW_H}px`;
      });
    }

    const parent = container.parentElement;
    parent?.addEventListener('scroll', () => recycle(parent.scrollTop), { passive: true });
  }, []);

  return <div ref={ref} aria-hidden="true" />;
}
