import { useSyncExternalStore } from 'react'
import type { ConnectedChartConfig } from '../../lib/config'

const rawBase=String(import.meta.env.VITE_NOTION_API_BASE||'').trim().replace(/\/$/,'')
export const API_BASE=/^https:\/\/[^/]+$/.test(rawBase)||/^http:\/\/localhost:\d+$/.test(rawBase)?rawBase:''
let sessionToken=''
const listeners=new Set<()=>void>()
const emit=()=>listeners.forEach(fn=>fn())
export function useSessionToken(){return useSyncExternalStore(sub=>{listeners.add(sub);return()=>listeners.delete(sub)},()=>sessionToken,()=> '')}
export function clearSession(){sessionToken='';emit()}
export type ConnectedSource={key:string;title:string;fieldCount:number}
export type NotionField={id:string;name:string;type:string}
export type ChartResponse={data:{label:string;value:number}[];recordCount:number;groupCount:number;updatedAt:string}
export async function requestApi<T>(path:string,method:'GET'|'POST'='GET',payload?:unknown):Promise<T>{
  if(!API_BASE)throw new Error('VITE_NOTION_API_BASE 설정이 필요합니다.')
  const abort=new AbortController()
  const timeout=setTimeout(()=>abort.abort(),25000)
  try{
    const response=await fetch(`${API_BASE}${path}`,{
      method,headers:{'Content-Type':'application/json',...(sessionToken?{Authorization:`Bearer ${sessionToken}`}:{})},
      ...(payload!==undefined?{body:JSON.stringify(payload)}:{}),signal:abort.signal,cache:'no-store'
    })
    let result:any
    try{result=await response.json()}catch{throw new Error('API 응답을 해석할 수 없습니다.')}
    if(!response.ok){if(response.status===401 && path!=='/api/auth/login')clearSession();throw new Error(result?.error||`요청 오류 (${response.status})`)}
    return result as T
  }catch(error){if((error as Error).name==='AbortError')throw new Error('응답 시간이 초과되었습니다.');throw error}
  finally{clearTimeout(timeout)}
}
export async function login(accessKey:string){
  const {token}=await requestApi<{token:string}>('/api/auth/login','POST',{key:accessKey})
  if(!token)throw new Error('인증 응답이 올바르지 않습니다.')
  sessionToken=token;emit()
}
export async function fetchSources(){return (await requestApi<{sources:ConnectedSource[]}>('/api/notion/data-sources')).sources}
export async function fetchSchema(key:string){return (await requestApi<{key:string;fields:NotionField[]}>(`/api/notion/data-sources/${encodeURIComponent(key)}/schema`)).fields}
export async function fetchChart(config:ConnectedChartConfig){return requestApi<ChartResponse>('/api/widgets/charts/preview','POST',config)}
