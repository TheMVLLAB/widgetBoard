export const ids = ['daily-word','flashcard','focus-garden','habit-stamps','roulette','mini-charts','smart-clock'] as const
export type WidgetId = typeof ids[number]
export type Theme = 'cream' | 'mint' | 'dark'
export type Density = 'compact' | 'comfort'
export type ChartType = 'bar'|'line'|'donut'
export type ClockStyle = 'digital'|'analog'
export type Level = 'easy' | 'medium' | 'advanced'
export type ChartDatum = { label: string; value: number }
export type WidgetConfig = {
  theme: Theme
  density: Density
  radius: number
  instanceId: string
  level: Level
  timezone: string
  examples: boolean
  timerMinutes: number
  chartType: ChartType
  chartData: ChartDatum[]
  clockStyle: ClockStyle
  clock24h: boolean
  rouletteOptions: string[]
  habits: string[]
}
export const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'Europe/Prague', 'Europe/London', 'America/New_York', 'UTC']
export const defaultConfig: WidgetConfig = {
  theme: 'cream', density: 'comfort', radius: 22, instanceId: 'default', level: 'medium', timezone: 'Asia/Seoul', examples: true,
  timerMinutes: 25, chartType: 'bar', chartData: [{label:'월',value:42},{label:'화',value:68},{label:'수',value:52},{label:'목',value:89},{label:'금',value:76}],
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
  const chart = Array.isArray(x.chartData) ? x.chartData.filter(isObject).slice(0,8).map((item,i)=>({
    label: text(item.label,20)||`항목 ${i+1}`,
    value: typeof item.value==='number'&&Number.isFinite(item.value) ? Math.min(1e6, Math.max(0,item.value)) : 0
  })) : d.chartData
  const strings = (val:unknown, fallback:string[], max:number) => Array.isArray(val)
    ? val.slice(0,max).map(v=>text(v,35).trim()).filter(Boolean) : fallback
  return {
    theme: oneOf(x.theme,['cream','mint','dark'],d.theme),
    density: oneOf(x.density,['compact','comfort'],d.density),
    radius: typeof x.radius==='number'&&Number.isFinite(x.radius) ? Math.min(32,Math.max(0,Math.round(x.radius))) : d.radius,
    instanceId: text(x.instanceId,50).replace(/[^\w-]/g,'') || d.instanceId,
    level: oneOf(x.level,['easy','medium','advanced'],d.level),
    timezone: oneOf(x.timezone,TIMEZONES,d.timezone),
    examples: typeof x.examples === 'boolean' ? x.examples : d.examples,
    timerMinutes: typeof x.timerMinutes === 'number' && [5,15,25,50].includes(x.timerMinutes) ? x.timerMinutes : d.timerMinutes,
    chartType: oneOf(x.chartType,['bar','line','donut'],d.chartType), chartData: chart.length>0 ? chart : d.chartData,
    clockStyle: oneOf(x.clockStyle,['digital','analog'],d.clockStyle),
    clock24h: typeof x.clock24h === 'boolean' ? x.clock24h : d.clock24h,
    rouletteOptions: strings(x.rouletteOptions,d.rouletteOptions,10).length>=2 ? strings(x.rouletteOptions,d.rouletteOptions,10) : d.rouletteOptions,
    habits: strings(x.habits,d.habits,7).length ? strings(x.habits,d.habits,7) : d.habits
  }
}
// URL-safe UTF-8 base64, with an upper bound to avoid excessive untrusted input.
export function encodeConfig(config: WidgetConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sanitizeConfig(config)))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
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
