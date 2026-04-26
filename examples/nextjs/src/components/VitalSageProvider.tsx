'use client';

import { useEffect } from 'react';
import { bootVitalSage } from '../lib/vitalsage-init';

/**
 * Thin client-side wrapper that boots the VitalSage SDK once the browser mounts.
 * Place this inside the root layout so it covers every page.
 */
export default function VitalSageProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    bootVitalSage().catch(console.error);
  }, []);

  return <>{children}</>;
}
