import { describe, expect, it } from 'vitest'
import { decodeConfig, defaultConfig, embedUrl, encodeConfig, sanitizeConfig } from './config'
import { dailyWordIndex, wordsForLevel } from '../data/words'
describe('embed config',()=>{
 it('round-trips UTF-8 Korean labels',()=>{const config={...defaultConfig,habits:['공부하기','산책하기'],instanceId:'test-1'};expect(decodeConfig(encodeConfig(config))).toEqual(config)})
 it('rejects unexpected types and absurd lengths',()=>{const c=sanitizeConfig({radius:999,theme:'evil',rouletteOptions:['ok'],chartData:[{label:'a',value:-5}]});expect(c.radius).toBe(32);expect(c.theme).toBe('cream');expect(c.rouletteOptions).toHaveLength(4);expect(c.chartData[0].value).toBe(0)})
 it('returns defaults for corrupt config',()=>expect(decodeConfig('not-encoded')).toEqual(defaultConfig))
 it('creates GitHub Pages compatible direct embed URL',()=>expect(embedUrl('daily-word',defaultConfig,'https://example.github.io','/widget-playground/')).toContain('/widget-playground/?embed=daily-word&config='))
})
describe('word rotation',()=>{
 it('is deterministic for each date',()=>{const len=wordsForLevel('medium').length;expect(dailyWordIndex('2026-10-12','medium',len)).toBe(dailyWordIndex('2026-10-12','medium',len))})
 it('always selects an existing word',()=>{const len=wordsForLevel('easy').length;expect(dailyWordIndex('2026-10-15','easy',len)).toBeLessThan(len)})
})

import { configFromPreset, makeTemplateConfig, templateEmbedUrl, templateEditorUrl } from './embed'
describe('v0.4 template-safe embeds',()=>{
 it('does not reuse creator installation IDs or Notion property identifiers',()=>{
  const privateConfig=sanitizeConfig({...defaultConfig,instanceId:'creator-id',chartSource:'notion',connected:{...defaultConfig.connected,sourceKey:'creatorFinance',dateFieldId:'privateDate',valueFieldId:'salary',categoryFieldId:'privateCategory'}})
  const safe=makeTemplateConfig(privateConfig)
  expect(safe.instanceId).toBe('template')
  expect(safe.connected).toEqual(defaultConfig.connected)
  expect(safe.chartSource).toBe('notion')
  const uri=templateEmbedUrl('mini-charts',privateConfig,'https://example.github.io','/widget-playground/')
  expect(uri).toContain('mode=template')
  expect(decodeConfig(new URL(uri).searchParams.get('config')).connected).toEqual(defaultConfig.connected)
  expect(uri).not.toContain('creatorFinance')
 })
 it('can duplicate a safe template preset into unique new instances',()=>{
  const presetUrl=templateEditorUrl('daily-word',defaultConfig,'https://example.github.io','/widget-playground/')
  const encoded=new URL(presetUrl.replace('#/build/daily-word?','?')).searchParams.get('config')
  expect(encoded).not.toBeNull()
  const a=configFromPreset(encoded), b=configFromPreset(encoded)
  expect(a.instanceId).not.toBe('template')
  expect(a.instanceId).not.toBe(b.instanceId)
 })
 it('preserves the original embed URL contract for existing v0.1-v0.3 links',()=>{
  const original=embedUrl('smart-clock',defaultConfig,'https://example.github.io','/widget-playground/')
  expect(new URL(original).searchParams.has('mode')).toBe(false)
  expect(decodeConfig(new URL(original).searchParams.get('config'))).toEqual(defaultConfig)
 })
})
