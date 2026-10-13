/** Public embed contract. Never put private Notion connections, sessions or user rows into URLs. */
import { decodeConfig, defaultConfig, embedUrl, encodeConfig, newInstanceId, sanitizeConfig } from './config'
import type { WidgetConfig, WidgetId } from './config'

export type EmbedMode = 'personal' | 'template'
export const EMBED_FORMAT_VERSION = 1
export const isPersistentWidget = (id: WidgetId) => ['daily-word','flashcard','focus-garden','habit-stamps'].includes(id)

/** Safe, portable defaults for Notion templates; no creator connection or user identity. */
export function makeTemplateConfig(input: WidgetConfig): WidgetConfig {
  const result=sanitizeConfig(input)
  // A template URL must not carry a creator's installation/state identifier.
  result.instanceId='template'
  if(result.chartSource==='notion'){
    result.connected={...defaultConfig.connected}
    result.chartData=defaultConfig.chartData.map(p=>({...p}))
  }
  return result
}

/** Embed URL for a duplicable Notion template. Personal progress is intentionally not persisted. */
export function templateEmbedUrl(id: WidgetId, config: WidgetConfig, origin: string, pathname: string): string {
  return embedUrl(id,makeTemplateConfig(config),origin,pathname)+'&mode=template&v='+EMBED_FORMAT_VERSION
}

/** The editor URL can safely be shared and always creates a fresh local-state ID. */
export function templateEditorUrl(id: WidgetId, config:WidgetConfig, origin:string, pathname:string):string {
  return `${origin}${pathname}#/build/${id}?config=${encodeConfig(makeTemplateConfig(config))}`
}

/** A copied preset gets a new local identity and never inherits a Notion source. */
export function configFromPreset(encoded: string|null):WidgetConfig {
  return {...decodeConfig(encoded),instanceId:newInstanceId()}
}

export function decodeEmbedMode(q:URLSearchParams):EmbedMode {
  return q.get('mode')==='template'?'template':'personal'
}

export function safePreviewConfig(config:WidgetConfig):WidgetConfig {
  const c=sanitizeConfig(config)
  if(c.chartSource==='notion'){
    c.connected={...defaultConfig.connected}
    c.chartData=defaultConfig.chartData.map(p=>({...p}))
  }
  return c
}
