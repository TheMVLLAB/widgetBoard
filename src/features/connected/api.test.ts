import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { decodeConfig, defaultConfig, defaultConnectedChart } from '../../lib/config'

const widgetId='11111111-2222-4333-8444-555555555555'
const handoffId='a'.repeat(64),token='b'.repeat(64)
const authUrl=`https://api.example.test/api/auth/notion/start?handoff=${handoffId}`
const chart={title:'Private chart',chartType:'line',result:{data:[{label:'Private amount',value:42}],recordCount:1,groupCount:1,updatedAt:'2026-10-13T00:00:00Z'}}
let approved=false,claims=0,claimStatus=200
let requests:{url:string;body:Record<string,unknown>;headers:Headers}[]=[]

beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();vi.stubEnv('VITE_NOTION_API_BASE','https://api.example.test')
  approved=false;claims=0;claimStatus=200;requests=[]
  vi.stubGlobal('crypto',webcrypto)
  vi.stubGlobal('sessionStorage',{getItem(){throw new Error('Blocked storage')},setItem(){throw new Error('Blocked storage')},removeItem(){throw new Error('Blocked storage')}})
  vi.stubGlobal('window',{open:vi.fn(()=>null),close:vi.fn(),addEventListener:vi.fn(),setTimeout})
  vi.stubGlobal('document',{addEventListener:vi.fn(),removeEventListener:vi.fn(),visibilityState:'visible'})
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),path=new URL(url).pathname,body=JSON.parse(String(init?.body||'{}')),headers=new Headers(init?.headers)
    requests.push({url,body,headers})
    if(path==='/api/auth/embed')return Response.json({id:handoffId,authUrl})
    if(path==='/api/auth/embed/claim'){
      claims++
      if(claimStatus===403)return Response.json({error:'Forbidden'},{status:403})
      return approved?Response.json({token,expiresIn:30}):Response.json({pending:true},{status:202})
    }
    if(path==='/api/auth/logout')return Response.json({ok:true})
    if(path===`/api/widgets/${widgetId}`)return headers.get('Authorization')===`Bearer ${token}`?Response.json(chart):Response.json({error:'Authentication required'},{status:401})
    throw new Error(`Unexpected API request: ${path}`)
  }))
})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks()})

describe('owner-only OAuth handoff',()=>{
  it('opens synchronously, retains a blocked-popup link, and authenticates only after a verifier-bound claim',async()=>{
    const api=await import('./api'),onReady=vi.fn(),onWindowUnavailable=vi.fn(),abort=new AbortController()
    const auth=api.beginNotionAuth({widgetId,signal:abort.signal,onReady,onWindowUnavailable})
    expect(window.open).toHaveBeenCalledOnce()
    expect(fetch).not.toHaveBeenCalled()
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    expect(onReady).toHaveBeenCalledWith(authUrl)
    expect(onWindowUnavailable).toHaveBeenCalledOnce()
    await expect(api.fetchSavedChart(widgetId)).rejects.toBeInstanceOf(Error)
    expect(requests.find(r=>r.url.endsWith(`/api/widgets/${widgetId}`))?.headers.has('Authorization')).toBe(false)
    const created=requests.find(r=>r.url.endsWith('/api/auth/embed'))!,claimed=requests.find(r=>r.url.endsWith('/api/auth/embed/claim'))!
    expect(claimed.body.verifier).toMatch(/^[a-f0-9]{64}$/)
    expect(created.body).toEqual({widgetId,verifierHash:createHash('sha256').update(String(claimed.body.verifier)).digest('hex')})
    expect(new URL(authUrl).searchParams.size).toBe(1)
    expect(requests.every(r=>!r.url.includes(String(claimed.body.verifier)))).toBe(true)
    approved=true;await vi.advanceTimersByTimeAsync(2000);await auth
    expect(await api.fetchSavedChart(widgetId)).toEqual(chart)
    expect(requests.at(-1)?.headers.get('Authorization')).toBe(`Bearer ${token}`)
    await vi.advanceTimersByTimeAsync(30000)
    await expect(api.fetchSavedChart(widgetId)).rejects.toBeInstanceOf(Error)
    expect(requests.at(-1)?.headers.has('Authorization')).toBe(false)
  })
  it('keeps polling when COOP makes the OAuth window appear closed',async()=>{
    const replace=vi.fn(),onWindowUnavailable=vi.fn()
    vi.stubGlobal('window',{open:vi.fn(()=>({closed:true,opener:null,location:{replace},close:vi.fn()})),addEventListener:vi.fn(),setTimeout})
    const api=await import('./api'),onReady=vi.fn(),abort=new AbortController()
    const auth=api.beginNotionAuth({widgetId,signal:abort.signal,onReady,onWindowUnavailable})
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    expect(replace).toHaveBeenCalledWith(authUrl)
    expect(onWindowUnavailable).toHaveBeenCalledOnce()
    approved=true;await vi.advanceTimersByTimeAsync(2000);await auth
    expect(await api.fetchSavedChart(widgetId)).toEqual(chart)
  })
  it('never installs a session for a non-owner claim',async()=>{
    claimStatus=403
    const api=await import('./api'),abort=new AbortController()
    await expect(api.beginNotionAuth({widgetId,signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()})).rejects.toBeInstanceOf(Error)
    await expect(api.fetchSavedChart(widgetId)).rejects.toBeInstanceOf(Error)
    expect(requests.at(-1)?.headers.has('Authorization')).toBe(false)
  })
  it('stops polls and timers when the initiating screen unmounts',async()=>{
    const api=await import('./api'),abort=new AbortController()
    const outcome=api.beginNotionAuth({signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()}).catch(error=>error)
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    const count=claims;abort.abort()
    expect((await outcome).name).toBe('AbortError')
    await vi.advanceTimersByTimeAsync(600000)
    expect(claims).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps the same fallback URL when the ten-minute request expires',async()=>{
    const api=await import('./api'),onReady=vi.fn(),abort=new AbortController()
    const outcome=api.beginNotionAuth({widgetId,signal:abort.signal,onReady,onWindowUnavailable:vi.fn()}).catch(error=>error)
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    await vi.advanceTimersByTimeAsync(600000)
    expect(await outcome).toBeInstanceOf(Error)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(authUrl)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects an in-flight data response after logout rather than returning stale private data',async()=>{
    approved=true
    const api=await import('./api'),abort=new AbortController()
    await api.beginNotionAuth({widgetId,signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()})
    let resolve:((response:Response)=>void)|undefined
    vi.mocked(fetch).mockImplementationOnce(()=>new Promise<Response>(done=>{resolve=done}))
    const outcome=api.fetchSavedChart(widgetId).catch(error=>error)
    await api.logout();resolve!(Response.json(chart))
    expect(await outcome).toBeInstanceOf(Error)
  })
})

describe('private chart links and embedded rendering',()=>{
  it('encodes only a saved ID and sanitized display defaults, not creator configuration or data',async()=>{
    const {privateEmbedUrl}=await import('./api')
    const config={...defaultConfig,instanceId:'creator-secret',theme:'mint' as const,chartType:'donut' as const,chartSource:'notion' as const,chartData:[{label:'Private salary',value:98765}],habits:['Private habit'],connected:{...defaultConnectedChart,sourceKey:'privateDB',dateFieldId:'privateDate',valueFieldId:'privateSalary',categoryFieldId:'privateCategory'}}
    const url=new URL(privateEmbedUrl(widgetId,config,'https://example.github.io','/widgetBoard/')),display=decodeConfig(url.searchParams.get('config'))
    expect([...url.searchParams.keys()].sort()).toEqual(['config','embed','widget'])
    expect(url.searchParams.get('widget')).toBe(widgetId)
    expect(display.connected).toEqual(defaultConnectedChart)
    expect(display.chartData).toEqual(defaultConfig.chartData)
    expect(display.habits).toEqual(defaultConfig.habits)
    expect(display.instanceId).toBe(defaultConfig.instanceId)
    expect(display.theme).toBe('mint')
    expect(display.chartType).toBe(defaultConfig.chartType)
    expect(JSON.stringify(display)).not.toMatch(/privateDB|privateDate|privateSalary|privateCategory|Private salary|Private habit|creator-secret/)
    expect(()=>privateEmbedUrl('not-a-widget',config,'https://example.test','/')).toThrow(Error)
  })
})
