// Medidor local de lecturas de Firestore. No hace lecturas ni escrituras: registra en memoria
// y guarda el resumen y la bitácora del día en localStorage de este dispositivo.
type Bucket = { calls: number; docs: number; cacheDocs: number; opens: number };
type Listener = {
  id: number; src: string; filters: string; tab: string; trigger: string; site: string;
  openedAt: string; closedAt?: string; lifeSec?: number; snaps: number; docs: number; cacheDocs: number;
};
type LogEntry = {
  t: string; tab: string; op: string; src: string; filters?: string; docs?: number; cache?: boolean;
  ms?: number; lid?: number; trigger: string; site?: string;
};
type Stats = {
  date: string; startedAt: string; role: string;
  byKey: Record<string, Bucket>; byTab: Record<string, Bucket>; byHour: Record<string, number>;
  listeners: Record<string, Listener>;
};

const STATS_KEY = 'readMeter:';
const LOG_KEY = 'readMeterLog:';
const MAX_LOG = 1500;
const MAX_LISTENERS = 600;

let context = { tab: 'init', role: '' };
let stats: Stats | null = null;
let log: LogEntry[] = [];
let logDate = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastAction = { label: 'inicio', at: Date.now() };
let nextListenerId = 1;

const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const empty = (): Bucket => ({ calls: 0, docs: 0, cacheDocs: 0, opens: 0 });

const load = (): Stats => {
  const date = today();
  if (stats && stats.date === date) return stats;
  try {
    const raw = localStorage.getItem(STATS_KEY + date);
    if (raw) {
      stats = JSON.parse(raw) as Stats;
      stats.listeners ??= {};
      const rawLog = localStorage.getItem(LOG_KEY + date);
      log = rawLog ? JSON.parse(rawLog) : [];
      logDate = date;
      return stats;
    }
  } catch {
    // Almacenamiento no disponible.
  }
  stats = { date, startedAt: new Date().toISOString(), role: context.role, byKey: {}, byTab: {}, byHour: {}, listeners: {} };
  log = [];
  logDate = date;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(STATS_KEY) || k.startsWith(LOG_KEY)) && !k.endsWith(date)) localStorage.removeItem(k);
    }
  } catch {
    // Ignorar.
  }
  return stats;
};

const flush = () => {
  saveTimer = null;
  try {
    if (stats) {
      localStorage.setItem(STATS_KEY + stats.date, JSON.stringify(stats));
      localStorage.setItem(LOG_KEY + logDate, JSON.stringify(log));
    }
  } catch {
    // Cuota llena: se descarta la bitácora y se conserva el resumen.
    try { localStorage.removeItem(LOG_KEY + logDate); } catch { /* ignorar */ }
  }
};

const scheduleSave = () => {
  changeCounter++;
  if (!saveTimer) saveTimer = setTimeout(flush, 5000);
};

const trigger = () => `${lastAction.label} (hace ${Math.round((Date.now() - lastAction.at) / 1000)}s)`;

// Primeras funciones de la pila fuera del medidor y del envoltorio: quién pidió la lectura.
export const readCallSite = () => {
  try {
    const lines = (new Error().stack ?? '').split('\n').slice(1);
    return lines
      .filter(l => !l.includes('readMeter') && !l.includes('firebase.ts') && !/firebase[\\/]firestore/.test(l))
      .slice(0, 4)
      .map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, ''))
      .join(' < ');
  } catch {
    return '';
  }
};

const push = (entry: LogEntry) => {
  load();
  log.push(entry);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
};

export const setReadMeterContext = (tab: string, role?: string) => {
  context = { tab, role: role ?? context.role };
};

export const describeTarget = (target: any): string => {
  try {
    const q = target?._query;
    if (!q) return '';
    const parts: string[] = [];
    for (const f of q.filters ?? []) {
      const v = f.value;
      const val = JSON.stringify(v?.stringValue ?? v?.integerValue ?? v?.timestampValue ?? v?.arrayValue ?? v ?? '');
      parts.push(`${f.field?.canonicalString?.() ?? '?'} ${f.op} ${String(val).slice(0, 60)}`);
    }
    for (const o of q.explicitOrderBy ?? []) parts.push(`orden ${o.field?.canonicalString?.()} ${o.dir}`);
    if (q.limit != null) parts.push(`limite ${q.limit}`);
    return parts.join(' | ');
  } catch {
    return '';
  }
};

const addToBuckets = (s: Stats, key: string, docs: number, fromCache: boolean, opened: boolean) => {
  const tabKey = `${context.tab}|${key}`;
  for (const [map, k] of [[s.byKey, key], [s.byTab, tabKey]] as const) {
    const b = (map[k] ??= empty());
    if (opened) b.opens += 1;
    else b.calls += 1;
    if (fromCache) b.cacheDocs += docs;
    else b.docs += docs;
  }
  if (!fromCache && docs > 0) {
    const hour = String(new Date().getHours()).padStart(2, '0');
    s.byHour[hour] = (s.byHour[hour] ?? 0) + docs;
  }
};

export const recordOneShot = (kind: 'getDocs' | 'getDoc', src: string, filters: string, docs: number, fromCache: boolean, ms: number, site: string) => {
  const s = load();
  if (!s.role && context.role) s.role = context.role;
  addToBuckets(s, `${kind}:${src}`, docs, fromCache, false);
  push({ t: new Date().toISOString(), tab: context.tab, op: kind, src, filters, docs, cache: fromCache, ms, trigger: trigger(), site });
  scheduleSave();
};

export const recordListenerOpen = (src: string, filters: string, site: string): number => {
  const s = load();
  if (!s.role && context.role) s.role = context.role;
  const id = nextListenerId++;
  addToBuckets(s, `snapshot:${src}`, 0, false, true);
  if (Object.keys(s.listeners).length < MAX_LISTENERS) {
    s.listeners[id] = {
      id, src, filters, tab: context.tab, trigger: trigger(), site,
      openedAt: new Date().toISOString(), snaps: 0, docs: 0, cacheDocs: 0,
    };
  }
  push({ t: new Date().toISOString(), tab: context.tab, op: 'abrir-listener', src, filters, lid: id, trigger: trigger(), site });
  scheduleSave();
  return id;
};

export const recordListenerSnap = (id: number, src: string, docs: number, fromCache: boolean) => {
  const s = load();
  addToBuckets(s, `snapshot:${src}`, docs, fromCache, false);
  const l = s.listeners[id];
  if (l) {
    l.snaps += 1;
    if (fromCache) l.cacheDocs += docs;
    else l.docs += docs;
  }
  push({ t: new Date().toISOString(), tab: context.tab, op: 'snapshot', src, docs, cache: fromCache, lid: id, trigger: trigger() });
  scheduleSave();
};

export const recordListenerClose = (id: number, src: string) => {
  const s = load();
  const l = s.listeners[id];
  if (l && !l.closedAt) {
    l.closedAt = new Date().toISOString();
    l.lifeSec = Math.round((Date.parse(l.closedAt) - Date.parse(l.openedAt)) / 1000);
  }
  push({ t: new Date().toISOString(), tab: context.tab, op: 'cerrar-listener', src, lid: id, trigger: trigger() });
  scheduleSave();
};

let changeCounter = 0;
let lastSentCounter = 0;
export const hasUnsentReadMeterChanges = () => changeCounter !== lastSentCounter;
export const markReadMeterSent = () => { lastSentCounter = changeCounter; };

export const getDeviceId = () => {
  try {
    let id = localStorage.getItem('readMeterDevice');
    if (!id) {
      id = Math.random().toString(36).slice(2, 8);
      localStorage.setItem('readMeterDevice', id);
    }
    return id;
  } catch {
    return 'nodev';
  }
};

// Carga útil compacta para enviar a Firestore (la bitácora se limita para no pasar de ~200 KB).
export const getReadMeterPayload = () => {
  const s = load();
  const totalDocsFromServer = Object.values(s.byKey).reduce((sum, b) => sum + b.docs, 0);
  const listeners = Object.values(s.listeners).slice(-150);
  return {
    date: s.date, role: s.role, startedAt: s.startedAt, updatedAt: new Date().toISOString(),
    device: getDeviceId(), ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : '',
    totalDocsFromServer, byKey: s.byKey, byTab: s.byTab, byHour: s.byHour,
    listenersJson: JSON.stringify(listeners),
    logJson: JSON.stringify(log.slice(-200)),
  };
};
// Acción del usuario que precede a cada lectura (último clic o cambio de visibilidad).
if (typeof window !== 'undefined') {
  window.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('button,a,[role="button"],input,select') as HTMLElement | null;
    const text = (el?.innerText || el?.getAttribute('aria-label') || el?.getAttribute('title') || el?.tagName || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    lastAction = { label: `clic: ${text || 'zona'}`, at: Date.now() };
  }, true);
  document.addEventListener('visibilitychange', () => {
    lastAction = { label: `app ${document.visibilityState === 'visible' ? 'visible' : 'oculta'}`, at: Date.now() };
  });
}
