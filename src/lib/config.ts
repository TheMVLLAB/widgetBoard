export const ids = ['daily-word','flashcard','focus-garden','habit-stamps','roulette','mini-charts','smart-clock'] as const
export type WidgetId = typeof ids[number]
export type Theme = 'cream' | 'mint' | 'dark'
export type EmbedLayout = 'compact' | 'standard' | 'wide'
export type MotionPreference = 'system' | 'reduce'
export type ChartType = 'bar'|'line'|'donut'
export type ClockStyle = 'digital'|'analog'
export type Level = 'easy' | 'medium' | 'advanced'
export type ChartDatum = { label: string; value: number }
export type ConnectedChartConfig = {
  sourceKey: string; dateFieldId: string; valueFieldId: string; categoryFieldId: string;
  groupBy: 'month' | 'day' | 'category'; aggregate: 'sum' | 'count' | 'avg';
  dateFrom: string; dateTo: string
}
export const defaultConnectedChart: ConnectedChartConfig = {
  sourceKey:'',dateFieldId:'',valueFieldId:'',categoryFieldId:'',groupBy:'month',aggregate:'sum',dateFrom:'',dateTo:''
}
const fieldId = (x:unknown) => typeof x === 'string' ? x.replace(/[\u0000-\u001F\u007F]/g,'').slice(0,128) : ''
export function sanitizeConnected(raw:unknown):ConnectedChartConfig {
  const x=isObject(raw)?raw:{}
  const safeDate=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)?x:''
  return {
    sourceKey:typeof x.sourceKey==='string' && /^[a-zA-Z][\w-]{0,39}$/.test(x.sourceKey)?x.sourceKey:'',
    dateFieldId:fieldId(x.dateFieldId),valueFieldId:fieldId(x.valueFieldId),categoryFieldId:fieldId(x.categoryFieldId),
    groupBy:oneOf(x.groupBy,['month','day','category'],'month'),aggregate:oneOf(x.aggregate,['sum','count','avg'],'sum'),
    dateFrom:safeDate(x.dateFrom),dateTo:safeDate(x.dateTo)
  }
}
export type WidgetConfig = {
  theme: Theme
  instanceId: string
  embedLayout: EmbedLayout
  showTitle: boolean
  showBorder: boolean
  transparentBackground: boolean
  motion: MotionPreference
  level: Level
  timezone: string
  examples: boolean
  timerMinutes: number
  chartType: ChartType
  chartData: ChartDatum[]
  chartSource: 'manual' | 'notion'
  connected: ConnectedChartConfig
  clockStyle: ClockStyle
  clock24h: boolean
  rouletteOptions: string[]
  habits: string[]
}
export const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'Europe/Prague', 'Europe/London', 'America/New_York', 'UTC']
export const defaultConfig: WidgetConfig = {
  theme: 'cream', instanceId: 'default',
  embedLayout: 'standard', showTitle: true, showBorder: true, transparentBackground: false, motion: 'system', level: 'medium', timezone: 'Asia/Seoul', examples: true,
  timerMinutes: 25, chartType: 'bar', chartData: [{label:'월',value:42},{label:'화',value:68},{label:'수',value:52},{label:'목',value:89},{label:'금',value:76}],
  chartSource:'manual',connected:defaultConnectedChart,
  clockStyle: 'digital', clock24h: true,
  rouletteOptions: ['공부하기','산책하기','책 읽기','휴식하기'],
  habits: ['20분 공부하기','물 한 잔 마시기','책 10쪽 읽기']
}
const isObject = (x: unknown): x is Record<string,unknown> => Boolean(x && typeof x === 'object' && !Array.isArray(x))
const oneOf = <T extends string>(x: unknown, allowed: readonly T[], fallback: T): T =>
  typeof x === 'string' && allowed.includes(x as T) ? x as T : fallback
const text = (x: unknown, max: number) => typeof x === 'string' ? x.replace(/[\u0000-\u001F\u007F]/g,'').slice(0,max) : ''
export function sanitizeConfig(raw: unknown): WidgetConfig {
  const x = isObject(raw) ? raw : {}
  const d = defaultConfig
  const chart = Array.isArray(x.chartData) ? x.chartData.filter(isObject).slice(0,12).map((item,i)=>({
    label: text(item.label,20)||`항목 ${i+1}`,
    value: typeof item.value==='number'&&Number.isFinite(item.value) ? Math.min(1e6, Math.max(-1e6,item.value)) : 0
  })) : d.chartData
  const strings = (val:unknown, fallback:string[], max:number) => Array.isArray(val)
    ? val.slice(0,max).map(v=>text(v,35).trim()).filter(Boolean) : fallback
  return {
    theme: oneOf(x.theme,['cream','mint','dark'],d.theme),
    instanceId: text(x.instanceId,50).replace(/[^\w-]/g,'') || d.instanceId,
    embedLayout: oneOf(x.embedLayout,['compact','standard','wide'],d.embedLayout),
    showTitle: typeof x.showTitle==='boolean'?x.showTitle:d.showTitle,
    showBorder: typeof x.showBorder==='boolean'?x.showBorder:d.showBorder,
    transparentBackground: typeof x.transparentBackground==='boolean'?x.transparentBackground:d.transparentBackground,
    motion: oneOf(x.motion,['system','reduce'],d.motion),
    level: oneOf(x.level,['easy','medium','advanced'],d.level),
    timezone: oneOf(x.timezone,TIMEZONES,d.timezone),
    examples: typeof x.examples === 'boolean' ? x.examples : d.examples,
    timerMinutes: typeof x.timerMinutes === 'number' && [5,15,25,50].includes(x.timerMinutes) ? x.timerMinutes : d.timerMinutes,
    chartType: oneOf(x.chartType,['bar','line','donut'],d.chartType), chartData: chart.length>0 ? chart : d.chartData,
    chartSource:oneOf(x.chartSource,['manual','notion'],d.chartSource),connected:sanitizeConnected(x.connected),
    clockStyle: oneOf(x.clockStyle,['digital','analog'],d.clockStyle),
    clock24h: typeof x.clock24h === 'boolean' ? x.clock24h : d.clock24h,
    rouletteOptions: strings(x.rouletteOptions,d.rouletteOptions,10).length>=2 ? strings(x.rouletteOptions,d.rouletteOptions,10) : d.rouletteOptions,
    habits: strings(x.habits,d.habits,7).length ? strings(x.habits,d.habits,7) : d.habits
  }
}
// URL-safe UTF-8 base64, with an upper bound to avoid excessive untrusted input.
export function encodeConfig(config: WidgetConfig): string {
  const safe=sanitizeConfig(config)
  // Never publish stale manual values when sharing a connected widget URL.
  if(safe.chartSource==='notion')safe.chartData=defaultConfig.chartData
  else safe.connected=defaultConnectedChart
  const bytes = new TextEncoder().encode(JSON.stringify(safe))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
export function validEmbedConfig(encoded: string | null): boolean {
  if(!encoded)return true // unconfigured widgets are intentionally allowed
  if(encoded.length>7000 || !/^[a-zA-Z0-9_-]+$/.test(encoded))return false
  try{
    const padded=encoded.replace(/-/g,'+').replace(/_/g,'/')
    const raw=atob(padded+'='.repeat((4-padded.length%4)%4))
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))))
    return Boolean(decoded && typeof decoded==='object' && !Array.isArray(decoded))
  }catch{return false}
}
export function decodeConfig(encoded: string | null): WidgetConfig {
  if (!encoded || encoded.length>7000 || !/^[a-zA-Z0-9_-]+$/.test(encoded)) return sanitizeConfig(null)
  try {
    const padded = encoded.replace(/-/g,'+').replace(/_/g,'/')
    const raw = atob(padded + '='.repeat((4-padded.length%4)%4))
    const bytes = Uint8Array.from(raw,c=>c.charCodeAt(0))
    return sanitizeConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))
  } catch { return sanitizeConfig(null) }
}
export function embedPath(id: WidgetId, cfg: WidgetConfig): string { return `?embed=${id}&config=${encodeConfig(cfg)}` }
export function embedUrl(id: WidgetId, cfg:WidgetConfig, origin: string, pathname: string):string {return `${origin}${pathname}${embedPath(id,cfg)}`}
export function isWidgetId(id:string): id is WidgetId {return ids.some(x=>x===id)}
export function newInstanceId():string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0,18): Math.random().toString(36).slice(2,14)
}
