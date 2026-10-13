import { useSyncExternalStore } from 'react'
import type { ConnectedChartConfig } from '../../lib/config'

const rawBase=String(import.meta.env.VITE_NOTION_API_BASE||'').trim().replace(/\/$/,'')
export const API_BASE=/^https:\/\/[^/]+$/.test(rawBase)||/^http:\/\/localhost:\d+$/.test(rawBase)?rawBase:''
let sessionToken=''
try{const saved=sessionStorage.getItem('wp_session_v03');if(saved){const entry=JSON.parse(saved);if(entry.expiresAt>Date.now()&&/^[a-f0-9]{64}$/.test(entry.token))sessionToken=entry.token;else sessionStorage.removeItem('wp_session_v03')}}catch{/* unavailable in a sandboxed embed */}
const listeners=new Set<()=>void>()
function emit(){for(const fn of listeners)fn()}
export function useSessionToken(){return useSyncExternalStore(cb=>{listeners.add(cb);return()=>listeners.delete(cb)},()=>sessionToken,()=> '')}
export function clearSession(){sessionToken='';try{sessionStorage.removeItem('wp_session_v03')}catch{}emit()}
export function beginNotionAuth(){if(!API_BASE)throw new Error('VITE_NOTION_API_BASE를 설정하세요.');window.location.assign(`${API_BASE}/api/auth/notion/start`)}
export type ConnectedSource={key:string;title:string;fieldCount:number;workspace:string}
export type NotionField={id:string;name:string;type:string}
export type ChartResponse={data:{label:string;value:number}[];recordCount:number;groupCount:number;updatedAt:string}
export type PublishedChart=ChartResponse & {title:string;chartType:string}
export type Workspace={id:string;name:string}
export async function requestApi<T>(path:string,method:'GET'|'POST'='GET',payload?:unknown):Promise<T>{
  if(!API_BASE)throw new Error('API 주소(VITE_NOTION_API_BASE)를 설정해 주세요.')
  const abort=new AbortController()
  const timeout=setTimeout(()=>abort.abort(),30000)
  try{
    const response=await fetch(`${API_BASE}${path}`,{method,headers:{'Content-Type':'application/json',...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:abort.signal,cache:'no-store'})
    const result=await response.json().catch(()=>null)
    if(!response.ok){if(response.status===401&&!path.includes('/api/auth/ticket'))clearSession();throw new Error(result?.error||`API 응답 오류 (${response.status})`)}
    return result as T
  }catch(err){if((err as Error).name==='AbortError')throw new Error('요청 시간이 초과되었습니다.');throw err}
  finally{clearTimeout(timeout)}
}
export async function redeemTicket(ticket:string){const result=await requestApi<{token:string}>('/api/auth/ticket','POST',{ticket});if(!/^[a-f0-9]{64}$/.test(result.token))throw new Error('로그인 응답 오류');sessionToken=result.token;try{sessionStorage.setItem('wp_session_v03',JSON.stringify({token:result.token,expiresAt:Date.now()+7200*1000}))}catch{}emit()}
export async function logout(){try{if(sessionToken)await requestApi('/api/auth/logout','POST',{})}finally{clearSession()}}
export async function workspaces(){return (await requestApi<{workspaces:Workspace[]}>('/api/me')).workspaces}
export async function disconnect(connectionId:string){return requestApi('/api/notion/disconnect','POST',{connectionId})}
export async function fetchSources(){return (await requestApi<{sources:ConnectedSource[]}>('/api/notion/data-sources')).sources}
export async function fetchSchema(key:string){return (await requestApi<{fields:NotionField[]}>(`/api/notion/data-sources/${encodeURIComponent(key)}/schema`)).fields}
export async function fetchChart(config:ConnectedChartConfig){return requestApi<ChartResponse>('/api/widgets/charts/preview','POST',config)}
export async function saveChart(config:ConnectedChartConfig,chartType:string,title:string){return requestApi<{id:string;visibility:string}>('/api/widgets','POST',{config,chartType,title})}
export async function publishChart(id:string){return requestApi<{id:string;visibility:string}>('/api/widgets/'+encodeURIComponent(id)+'/publish','POST',{confirm:'PUBLISH_AGGREGATES'})}
export async function unpublishChart(id:string){return requestApi<{visibility:string}>('/api/widgets/'+encodeURIComponent(id)+'/unpublish','POST',{})}
export async function fetchPublicChart(id:string){return requestApi<PublishedChart>('/api/public/widgets/'+encodeURIComponent(id))}

export type SavedChart={id:string;title:string;visibility:string;chart_type:string;updated_at:number}
export async function savedCharts(){return (await requestApi<{widgets:SavedChart[]}>('/api/widgets')).widgets}
export async function refreshChart(id:string){return requestApi('/api/widgets/'+encodeURIComponent(id)+'/refresh','POST',{})}
