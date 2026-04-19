import type { ConnectionType, DeviceContext } from '@vitalsage/types';

export function collectDeviceContext(): DeviceContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  const conn = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;

  return {
    userAgent:           navigator.userAgent,
    viewport:            { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio:    window.devicePixelRatio ?? 1,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 1,
    ...(nav.deviceMemory !== undefined ? { deviceMemory: nav.deviceMemory as number } : {}),
    deviceCategory: inferDeviceCategory(),
    connection: {
      type: inferConnectionType(conn),
      ...(conn?.effectiveType !== undefined ? { effectiveType: conn.effectiveType as string }  : {}),
      ...(conn?.downlink      !== undefined ? { downlink:      conn.downlink as number }       : {}),
      ...(conn?.rtt           !== undefined ? { rtt:           conn.rtt as number }            : {}),
      ...(conn?.saveData      !== undefined ? { saveData:      conn.saveData as boolean }      : {}),
    },
  };
}

function inferDeviceCategory(): 'mobile' | 'desktop' | 'tablet' {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

function inferConnectionType(conn: unknown): ConnectionType {
  if (!conn || typeof conn !== 'object') return 'unknown';
  const c = conn as Record<string, unknown>;
  if (c['type'] === 'wifi')     return 'wifi';
  if (c['type'] === 'ethernet') return 'ethernet';
  const effective = c['effectiveType'];
  if (effective === '4g')      return '4g';
  if (effective === '3g')      return '3g';
  if (effective === '2g')      return '2g';
  if (effective === 'slow-2g') return 'slow-2g';
  return 'unknown';
}
