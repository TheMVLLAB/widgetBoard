import { useSyncExternalStore } from 'react'
import { defaultConfig, defaultConnectedChart, embedUrl } from '../../lib/config'
import type { ChartType, ConnectedChartConfig, WidgetConfig } from '../../lib/config'

const rawBase=String(import.meta.env.VITE_NOTION_API_BASE||'').trim().replace(/\/$/,'')
export const API_BASE=/^https:\/\/[^/]+$/.test(rawBase)||/^http:\/\/localhost:\d+$/.test(rawBase)?rawBase:''
const hexToken=/^[a-f0-9]{64}$/
let sessionToken='',expiresAt=0
let authAttempt=0
let sessionRevision=0
const restoreRequests=new Map<string,{promise:Promise<boolean>;controller:AbortController}>()
let expiryTimer:number|undefined
const listeners=new Set<()=>void>()
function emit(){for(const fn of listeners)fn()}
function armExpiry(){clearTimeout(expiryTimer);if(sessionToken)expiryTimer=window.setTimeout(clearSession,Math.max(0,expiresAt-Date.now()))}
function readStoredSession(){
  clearTimeout(expiryTimer);sessionToken='';expiresAt=0
  try{
    const saved=localStorage.getItem('wp_session_v03')
    if(saved){const entry=JSON.parse(saved);if(Number.isFinite(entry.expiresAt)&&entry.expiresAt>Date.now()&&entry.expiresAt<=Date.now()+7200000&&hexToken.test(entry.token)){sessionToken=entry.token;expiresAt=entry.expiresAt}else localStorage.removeItem('wp_session_v03')}
  }catch{/* Keep sessions in memory when storage is unavailable. */}
  armExpiry()
}
readStoredSession()
function currentToken(){return expiresAt>Date.now()?sessionToken:''}
export function useSessionToken(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb)},currentToken,()=> '')}
export function clearSession(){++sessionRevision;for(const request of restoreRequests.values())request.controller.abort();restoreRequests.clear();clearTimeout(expiryTimer);sessionToken='';expiresAt=0;try{localStorage.removeItem('wp_session_v03')}catch{}emit()}
function installSession(result:{token:string;expiresIn:number}){
  if(!hexToken.test(result.token)||!Number.isFinite(result.expiresIn)||result.expiresIn<=0||result.expiresIn>7200)throw new Error('로그인 응답 오류')
  ++sessionRevision;sessionToken=result.token;expiresAt=Date.now()+result.expiresIn*1000
  try{localStorage.setItem('wp_session_v03',JSON.stringify({token:sessionToken,expiresAt}))}catch{}
  armExpiry();emit()
}
if(typeof window!=='undefined'){
  const expire=()=>{if(sessionToken&&!currentToken())clearSession()}
  window.addEventListener('focus',expire)
  document.addEventListener('visibilitychange',expire)
  window.addEventListener('storage',(event:StorageEvent)=>{if(event.key==='wp_session_v03'||event.key===null){++authAttempt;++sessionRevision;for(const request of restoreRequests.values())request.controller.abort();restoreRequests.clear();readStoredSession();emit()}})
}
export function restoreSession(widgetId?:string):Promise<boolean>{
  if(currentToken())return Promise.resolve(true)
  if(!API_BASE||(widgetId!==undefined&&!isSavedWidgetId(widgetId)))return Promise.resolve(false)
  const key=widgetId??'',existing=restoreRequests.get(key)
  if(existing)return existing.promise
  const revision=sessionRevision,controller=new AbortController()
  const promise=(async()=>{
    const timer=setTimeout(()=>controller.abort(),10000)
    try{
      const response=await fetch(`${API_BASE}/api/auth/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(widgetId===undefined?{}:{widgetId}),credentials:'include',cache:'no-store',signal:controller.signal})
      if(!response.ok)return false
      const result=await response.json()
      if(controller.signal.aborted||revision!==sessionRevision)return !!currentToken()
      installSession(result);return true
    }catch{return false}
    finally{clearTimeout(timer)}
  })().finally(()=>{if(restoreRequests.get(key)?.promise===promise)restoreRequests.delete(key)})
  restoreRequests.set(key,{promise,controller})
  return promise
}
export const isSavedWidgetId=(id:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
export function privateEmbedUrl(id:string,config:WidgetConfig,origin:string,pathname:string){
  if(!isSavedWidgetId(id))throw new Error('저장한 차트 주소가 올바르지 않습니다.')
  const display:WidgetConfig={...defaultConfig,theme:config.theme,embedLayout:config.embedLayout,showTitle:config.showTitle,showBorder:config.showBorder,transparentBackground:config.transparentBackground,motion:config.motion,chartSource:'notion',connected:defaultConnectedChart,chartData:defaultConfig.chartData}
  return embedUrl('mini-charts',display,origin,pathname)+'&widget='+encodeURIComponent(id)
}
export type ConnectedSource={key:string;title:string;fieldCount:number;workspace:string}
export type NotionField={id:string;name:string;type:string}
export type ChartResponse={data:{label:string;value:number}[];recordCount:number;groupCount:number;updatedAt:string}
export type SavedChartResponse={title:string;chartType:ChartType;result:ChartResponse}
export type Workspace={id:string;name:string}
export async function requestApi<T>(path:string,method:'GET'|'POST'='GET',payload?:unknown,signal?:AbortSignal):Promise<T>{
  if(!API_BASE)throw new Error('API 주소(VITE_NOTION_API_BASE)를 설정해 주세요.')
  const token=currentToken(),authPath=path.startsWith('/api/auth/')
  const abort=new AbortController()
  const cancel=()=>abort.abort()
  signal?.addEventListener('abort',cancel,{once:true})
  if(signal?.aborted)abort.abort()
  const timeout=setTimeout(cancel,30000)
  try{
    const response=await fetch(`${API_BASE}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:abort.signal,cache:'no-store',credentials:'omit'})
    const result=await response.json().catch(()=>null)
    if(abort.signal.aborted)throw new DOMException('Aborted','AbortError')
    if(!response.ok){
      if(response.status===401&&!authPath&&token&&token===currentToken())clearSession()
      throw new Error(response.status===403?'내 Notion 계정에 저장된 차트만 볼 수 있습니다.':typeof result?.error==='string'?result.error:`API 응답 오류 (${response.status})`)
    }
    if(!authPath&&(!token||token!==currentToken()))throw new Error('인증이 변경되었습니다. 내 Notion 계정을 다시 인증해 주세요.')
    return result as T
  }catch(err){if((err as Error).name==='AbortError'&&!signal?.aborted)throw new Error('요청 시간이 초과되었습니다.');throw err}
  finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel)}
}
function delay(ms:number,signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(new DOMException('Aborted','AbortError'))}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve()},ms)
    signal.addEventListener('abort',cancel,{once:true})
    if(signal.aborted)cancel()
  })
}
type AuthOptions={widgetId?:string;reuse?:boolean;signal:AbortSignal;onReady:(url:string)=>void;onWindowUnavailable:()=>void}
export async function beginNotionAuth({widgetId,reuse=false,signal,onReady,onWindowUnavailable}:AuthOptions){
  if(!API_BASE)throw new Error('VITE_NOTION_API_BASE를 설정하세요.')
  if(!globalThis.crypto?.subtle||!globalThis.crypto?.getRandomValues)throw new Error('이 환경에서는 안전한 인증을 지원하지 않습니다. 최신 브라우저의 HTTPS 화면에서 열어 주세요.')
  if(widgetId!==undefined&&!isSavedWidgetId(widgetId))throw new Error('저장한 차트 주소가 올바르지 않습니다.')
  let popup:Window|null=null
  try{popup=window.open('about:blank','_blank','popup,width=600,height=760');if(popup)popup.opener=null}catch{}
  const attempt=++authAttempt,abort=new AbortController()
  ++sessionRevision
  const cancel=()=>abort.abort()
  signal.addEventListener('abort',cancel,{once:true})
  if(signal.aborted)abort.abort()
  let timedOut=false,ready=false
  for(const request of restoreRequests.values())request.controller.abort()
  restoreRequests.clear()
  const timeout=setTimeout(()=>{timedOut=true;abort.abort()},600000)
  try{
    const verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('')
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))
    const verifierHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')
    const handoff=await requestApi<{id:string;authUrl:string}>('/api/auth/embed','POST',{verifierHash,...(widgetId===undefined?{}:{widgetId}),...(reuse?{reuse:true}:{})},abort.signal)
    if(!handoff||typeof handoff.authUrl!=='string')throw new Error('인증 주소 응답 오류')
    const url=new URL(handoff.authUrl)
    if(!hexToken.test(handoff.id)||url.origin!==new URL(API_BASE).origin||url.username||url.password||url.pathname!=='/api/auth/notion/start'||url.searchParams.get('handoff')!==handoff.id||url.searchParams.size!==(reuse?2:1)||(reuse&&url.searchParams.get('reuse')!=='1')||url.hash)throw new Error('인증 주소 응답 오류')
    ready=true;onReady(handoff.authUrl)
    try{if(popup)popup.location.replace(handoff.authUrl);else onWindowUnavailable()}catch{popup=null;onWindowUnavailable()}
    while(!abort.signal.aborted){
      if(attempt!==authAttempt)throw new Error('다른 인증 요청이 시작되었습니다. 다시 인증해 주세요.')
      try{if(popup?.closed){popup=null;onWindowUnavailable()}}catch{popup=null;onWindowUnavailable()}
      const claim=await requestApi<{pending:true}|{token:string;expiresIn:number}>('/api/auth/embed/claim','POST',{id:handoff.id,verifier},abort.signal)
      if(!claim||typeof claim!=='object')throw new Error('로그인 응답 오류')
      if('token' in claim){if(attempt!==authAttempt)throw new Error('인증 요청이 변경되었습니다.');installSession(claim);return}
      if(claim.pending!==true)throw new Error('로그인 응답 오류')
      await delay(2000,abort.signal)
    }
  }catch(err){if(timedOut)throw new Error('인증 대기 시간이 만료되었습니다. 기존 링크는 유지되지만 새 인증을 시작해야 합니다.');throw err}
  finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);if(!ready)try{popup?.close()}catch{}}
}
export async function logout(){++authAttempt;const pending=currentToken()?requestApi('/api/auth/logout','POST',{}):Promise.resolve();clearSession();await pending}
export async function workspaces(signal?:AbortSignal){return (await requestApi<{workspaces:Workspace[]}>('/api/me','GET',undefined,signal)).workspaces}
export async function disconnect(connectionId:string){return requestApi('/api/notion/disconnect','POST',{connectionId})}
export async function fetchSources(signal?:AbortSignal){return (await requestApi<{sources:ConnectedSource[]}>('/api/notion/data-sources','GET',undefined,signal)).sources}
export async function fetchSchema(key:string,signal?:AbortSignal){return (await requestApi<{fields:NotionField[]}>(`/api/notion/data-sources/${encodeURIComponent(key)}/schema`,'GET',undefined,signal)).fields}
export async function fetchChart(config:ConnectedChartConfig,signal?:AbortSignal){return requestApi<ChartResponse>('/api/widgets/charts/preview','POST',config,signal)}
export async function saveChart(config:ConnectedChartConfig,chartType:string,title:string,signal?:AbortSignal){return requestApi<{id:string}>('/api/widgets','POST',{config,chartType,title},signal)}
export async function fetchSavedChart(id:string,signal?:AbortSignal){
  if(!isSavedWidgetId(id))throw new Error('저장한 차트 주소가 올바르지 않습니다.')
  const result=await requestApi<SavedChartResponse>('/api/widgets/'+encodeURIComponent(id),'GET',undefined,signal)
  if(!['bar','line','donut'].includes(result.chartType))throw new Error('차트 응답 오류')
  return result
}
export type SavedChart={id:string;title:string;chart_type:ChartType;updated_at:number}
export async function savedCharts(signal?:AbortSignal){return (await requestApi<{widgets:SavedChart[]}>('/api/widgets','GET',undefined,signal)).widgets}
