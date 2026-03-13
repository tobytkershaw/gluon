export interface QaAudioTraceEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

interface QaAudioTraceStore {
  enabled: boolean;
  events: QaAudioTraceEvent[];
}

const TRACE_KEY = '__GLUON_QA_AUDIO_TRACE__';
const TRACE_STORAGE_KEY = 'gluon-qa-audio-trace';
const MAX_EVENTS = 2000;

function getStore(): QaAudioTraceStore {
  const globalObj = globalThis as typeof globalThis & { [TRACE_KEY]?: QaAudioTraceStore };
  if (!globalObj[TRACE_KEY]) {
    globalObj[TRACE_KEY] = { enabled: false, events: [] };
  }
  return globalObj[TRACE_KEY]!;
}

function storageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URL(window.location.href).searchParams.get('qaAudioTrace') === '1') return true;
    return window.localStorage.getItem(TRACE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isQaAudioTraceEnabled(): boolean {
  const store = getStore();
  if (store.enabled) return true;
  if (storageEnabled()) {
    store.enabled = true;
    return true;
  }
  return false;
}

export function setQaAudioTraceEnabled(enabled: boolean): void {
  const store = getStore();
  store.enabled = enabled;
  if (typeof window !== 'undefined') {
    try {
      if (enabled) window.localStorage.setItem(TRACE_STORAGE_KEY, '1');
      else window.localStorage.removeItem(TRACE_STORAGE_KEY);
    } catch {
      // Ignore storage failures in QA-only instrumentation
    }
  }
}

export function clearQaAudioTrace(): void {
  getStore().events = [];
}

export function getQaAudioTrace(): QaAudioTraceEvent[] {
  return [...getStore().events];
}

export function recordQaAudioTrace(event: { type: string; [key: string]: unknown }): void {
  if (!isQaAudioTraceEnabled()) return;

  const store = getStore();
  const fullEvent: QaAudioTraceEvent = { ts: Date.now(), ...event };
  store.events.push(fullEvent);
  if (store.events.length > MAX_EVENTS) {
    store.events.splice(0, store.events.length - MAX_EVENTS);
  }

  if (typeof console !== 'undefined') {
    console.info('[qa-audio]', JSON.stringify(fullEvent));
  }
}

declare global {
  interface Window {
    __gluonQaAudioTrace?: {
      enable: () => void;
      disable: () => void;
      clear: () => void;
      get: () => QaAudioTraceEvent[];
    };
  }
}

if (typeof window !== 'undefined') {
  window.__gluonQaAudioTrace = {
    enable: () => setQaAudioTraceEnabled(true),
    disable: () => setQaAudioTraceEnabled(false),
    clear: clearQaAudioTrace,
    get: getQaAudioTrace,
  };
}
