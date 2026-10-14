import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { decodeConfig, defaultConfig, defaultConnectedChart } from '../../lib/config'
// Reload the client after stubbing browser globals and env to isolate its module-scoped session.

const widgetId='11111111-2222-4333-8444-555555555555'
const handoffId='a'.repeat(64),token='b'.repeat(64)
const authUrl=`https://api.example.test/api/auth/notion/start?handoff=${handoffId}`
const reuseAuthUrl=`${authUrl}&reuse=1`
const chart={title:'Private chart',chartType:'line',result:{data:[{label:'Private amount',value:42}],recordCount:1,groupCount:1,updatedAt:'2026-10-13T00:00:00Z'}}
let approved=false,claims=0,claimStatus=200,responseAuthUrl=authUrl
let requests:{url:string;body:Record<string,unknown>;headers:Headers;credentials:RequestCredentials|undefined}[]=[]

beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();vi.stubEnv('VITE_NOTION_API_BASE','https://api.example.test')
  approved=false;claims=0;claimStatus=200;responseAuthUrl=authUrl;requests=[]
  vi.stubGlobal('crypto',webcrypto)
  vi.stubGlobal('sessionStorage',{getItem(){throw new Error('Blocked storage')},setItem(){throw new Error('Blocked storage')},removeItem(){throw new Error('Blocked storage')}})
  vi.stubGlobal('window',{open:vi.fn(()=>null),close:vi.fn(),addEventListener:vi.fn(),setTimeout})
  vi.stubGlobal('document',{addEventListener:vi.fn(),removeEventListener:vi.fn(),visibilityState:'visible'})
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),path=new URL(url).pathname,body=JSON.parse(String(init?.body||'{}')),headers=new Headers(init?.headers)
    requests.push({url,body,headers,credentials:init?.credentials})
    if(path==='/api/auth/embed')return Response.json({id:handoffId,authUrl:responseAuthUrl})
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
  it.each([undefined,false,true])('sends only explicit reuse and accepts its matching URL (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl;approved=true
    const api=await import('./api'),onReady=vi.fn()
    await api.beginNotionAuth({widgetId,reuse,signal:new AbortController().signal,onReady,onWindowUnavailable:vi.fn()})
    const created=requests.find(r=>r.url.endsWith('/api/auth/embed'))!,claimed=requests.find(r=>r.url.endsWith('/api/auth/embed/claim'))!
    expect(created.body).toEqual({widgetId,verifierHash:createHash('sha256').update(String(claimed.body.verifier)).digest('hex'),...(reuse?{reuse:true}:{})})
    expect(onReady).toHaveBeenCalledWith(responseAuthUrl)
    expect(new URL(responseAuthUrl).searchParams.get('verifier')).toBeNull()
    expect(requests.every(r=>r.credentials==='omit'&&!r.url.includes(String(claimed.body.verifier)))).toBe(true)
    expect(await api.fetchSavedChart(widgetId)).toEqual(chart)
  })
  it.each([
    [true,authUrl],
    [false,reuseAuthUrl],
    [undefined,reuseAuthUrl],
    [true,`${authUrl}&reuse=0`],
    [true,`${authUrl}&reuse=true`],
    [true,`${authUrl}&reuse=`],
    [true,`${reuseAuthUrl}&reuse=1`],
    [true,`${reuseAuthUrl}&extra=1`],
    [false,`${authUrl}&extra=1`],
    [true,`${reuseAuthUrl}&handoff=${handoffId}`],
    [false,`${authUrl}&handoff=${handoffId}`],
    [true,`${authUrl}&mode=reuse`],
    [true,reuseAuthUrl.replace('api.example.test','untrusted.example.test')],
    [true,reuseAuthUrl.replace('https://','https://user:password@')],
    [true,`${reuseAuthUrl}#token`],
    [true,reuseAuthUrl.replace('/notion/start','/notion/callback')],
    [true,reuseAuthUrl.replace(handoffId,'c'.repeat(64))],
  ] as const)('rejects an unexpected authorization URL (reuse=%s, url=%s)',async(reuse,url)=>{
    responseAuthUrl=url;approved=true
    const close=vi.fn(),replace=vi.fn(),onReady=vi.fn()
    vi.mocked(window.open).mockReturnValue({opener:null,location:{replace},close} as unknown as Window)
    const api=await import('./api')
    await expect(api.beginNotionAuth({widgetId,reuse,signal:new AbortController().signal,onReady,onWindowUnavailable:vi.fn()})).rejects.toBeInstanceOf(Error)
    expect(onReady).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(claims).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await expect(api.fetchSavedChart(widgetId)).rejects.toBeInstanceOf(Error)
    expect(requests.at(-1)?.headers.has('Authorization')).toBe(false)
  })
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
  it.each([false,true])('keeps polling when COOP makes the OAuth window appear closed (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl
    const replace=vi.fn(),onWindowUnavailable=vi.fn()
    vi.stubGlobal('window',{open:vi.fn(()=>({closed:true,opener:null,location:{replace},close:vi.fn()})),addEventListener:vi.fn(),setTimeout})
    const api=await import('./api'),onReady=vi.fn(),abort=new AbortController()
    const auth=api.beginNotionAuth({widgetId,reuse,signal:abort.signal,onReady,onWindowUnavailable})
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    expect(replace).toHaveBeenCalledWith(responseAuthUrl)
    expect(onWindowUnavailable).toHaveBeenCalledOnce()
    approved=true;await vi.advanceTimersByTimeAsync(2000);await auth
    expect(await api.fetchSavedChart(widgetId)).toEqual(chart)
  })
  it.each([false,true])('never installs a session for a non-owner claim (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl;claimStatus=403
    const api=await import('./api'),abort=new AbortController()
    await expect(api.beginNotionAuth({widgetId,reuse,signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()})).rejects.toBeInstanceOf(Error)
    await expect(api.fetchSavedChart(widgetId)).rejects.toBeInstanceOf(Error)
    expect(requests.at(-1)?.headers.has('Authorization')).toBe(false)
  })
  it.each([false,true])('stops polls and timers when the initiating screen unmounts (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl
    const api=await import('./api'),abort=new AbortController()
    const outcome=api.beginNotionAuth({reuse,signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()}).catch(error=>error)
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    const count=claims;abort.abort()
    expect((await outcome).name).toBe('AbortError')
    await vi.advanceTimersByTimeAsync(600000)
    expect(claims).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([false,true])('keeps the same fallback URL when the ten-minute request expires (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl
    const api=await import('./api'),onReady=vi.fn(),abort=new AbortController()
    const outcome=api.beginNotionAuth({widgetId,reuse,signal:abort.signal,onReady,onWindowUnavailable:vi.fn()}).catch(error=>error)
    await vi.waitFor(()=>expect(claims).toBeGreaterThan(0))
    await vi.advanceTimersByTimeAsync(600000)
    expect(await outcome).toBeInstanceOf(Error)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onReady).toHaveBeenCalledWith(responseAuthUrl)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([false,true])('rejects an in-flight data response after logout rather than returning stale private data (reuse=%s)',async(reuse)=>{
    responseAuthUrl=reuse?reuseAuthUrl:authUrl;approved=true
    const api=await import('./api'),abort=new AbortController()
    await api.beginNotionAuth({widgetId,reuse,signal:abort.signal,onReady:vi.fn(),onWindowUnavailable:vi.fn()})
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
