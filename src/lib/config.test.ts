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
