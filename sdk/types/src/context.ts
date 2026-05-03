export type ConnectionType =
  | '4g' | '3g' | '2g' | 'slow-2g' | 'wifi' | 'ethernet' | 'unknown';

export interface DeviceContext {
  userAgent:            string;
  viewport:             { width: number; height: number };
  devicePixelRatio:     number;
  hardwareConcurrency:  number;
  deviceMemory?:        number;
  deviceCategory:       'mobile' | 'desktop' | 'tablet';
  connection: {
    type:           ConnectionType;
    effectiveType?: string;
    downlink?:      number;
    rtt?:           number;
    saveData?:      boolean;
  };
  simulated?: {
    networkProfile:  string;
    viewportProfile: string;
  };
}

export interface PageContext {
  url:              string;
  referrer:         string;
  title:            string;
  domNodeCount:     number;
  resources:        ResourceEntry[];
  lcpElement?:      LCPElementDescriptor;
  fonts:            FontEntry[];
  images:           ImageEntry[];
  scripts:          ScriptEntry[];
  stylesheets:      StylesheetEntry[];
  navigationTiming: NavigationTimingSnapshot;
  traceMetrics?:    import('./trace.js').TraceMetrics;
  screenshot?:      string;  // base64 JPEG, only present on captureTrace runs
}

export interface NavigationTimingSnapshot {
  redirectTime:    number;
  dnsTime:         number;
  tlsTime:         number;
  serverTime:      number;
  downloadTime:    number;
  domParseTime:    number;
  totalLoadTime:   number;
  workerTime:      number;
  isServiceWorker: boolean;
  redirectCount:   number;
}

export interface ResourceEntry {
  name:                 string;
  initiatorType:        string;
  duration:             number;
  transferSize:         number;
  encodedBodySize:      number;
  decodedBodySize:      number;
  renderBlockingStatus: 'blocking' | 'non-blocking' | 'unknown';
  fetchStart:           number;
  responseEnd:          number;
  fromCache:            boolean;
}

export interface LCPElementDescriptor {
  tagName:               string;
  src?:                  string;
  isThirdParty:          boolean;
  fetchPriority?:        string;
  loading?:              string;
  hasExplicitDimensions: boolean;
  naturalWidth?:         number;
  naturalHeight?:        number;
  displayWidth?:         number;
  displayHeight?:        number;
  isPreloaded:           boolean;
  elementType:           'img' | 'text' | 'background-image' | 'video' | 'svg';
}

export interface ImageEntry {
  src:                   string;
  isLCP:                 boolean;
  isAboveFold:           boolean;
  hasExplicitDimensions: boolean;
  loading?:              string;
  fetchPriority?:        string;
  naturalWidth?:         number;
  naturalHeight?:        number;
  displayWidth?:         number;
  displayHeight?:        number;
  transferSize?:         number;
  format?:               string;
  isResponsive:          boolean;
  isFromCache:           boolean;
}

export interface FontEntry {
  family:         string;
  display:        string;
  url?:           string;
  isPreloaded:    boolean;
  hasCrossOrigin: boolean;
  format?:        string;
  isSystemFont:   boolean;
  isIconFont:     boolean;
}

export interface ScriptEntry {
  src?:               string;
  isInline:           boolean;
  isDeferred:         boolean;
  isAsync:            boolean;
  isModule:           boolean;
  isRenderBlocking:   boolean;
  size?:              number;
  position:           'head' | 'body';
  isThirdParty:       boolean;
  executionDuration?: number;
}

export interface StylesheetEntry {
  href?:            string;
  isInline:         boolean;
  isRenderBlocking: boolean;
  media?:           string;
  transferSize?:    number;
  isThirdParty:     boolean;
}
