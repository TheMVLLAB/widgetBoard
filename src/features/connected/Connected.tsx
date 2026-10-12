import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, LockKeyhole, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react'
import { API_BASE,clearSession,fetchChart,fetchSchema,fetchSources,login,useSessionToken } from './api'
import type { ConnectedSource, NotionField, ChartResponse } from './api'
import type { ConnectedChartConfig, WidgetConfig } from '../../lib/config'
import { storageAvailable } from '../../lib/storage'

export function LoginBox({compact=false}:{compact?:boolean}){
  const [accessKey,setAccessKey]=useState('')
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const token=useSessionToken()
  const [canStoreSession]=useState(storageAvailable)
  if(!API_BASE)return <div className="connected-alert"><LockKeyhole size={18}/> <span>연동 API 주소가 아직 설정되지 않았습니다. README의 배포 안내를 따라 설정하세요.</span></div>
  if(token)return <div className="connected-user"><ShieldCheck size={16}/> 개인 세션 연결됨 <button type="button" onClick={clearSession}><LogOut size={14}/> 종료</button></div>
  return <form className={`connected-login ${compact?'connected-login-compact':''}`} onSubmit={async e=>{e.preventDefault();setLoading(true);setError('');try{await login(accessKey);setAccessKey('')}catch(err){setError((err as Error).message)}finally{setLoading(false)}}}>
    <LockKeyhole size={22}/><strong>개인 데이터 보호</strong><span>Worker에 등록한 개인 접근 키를 입력해 주세요. 키 자체는 저장하지 않으며, 인증 토큰을 이 브라우저에 저장해 30일 동안 연결을 유지합니다. 공용 기기에서는 사용 후 종료해 주세요.</span>
    <input aria-label="개인 접근 키" autoComplete="off" type="password" minLength={32} maxLength={1024} placeholder="개인 접근 키 (32자 이상)" value={accessKey} onChange={e=>setAccessKey(e.target.value)} required/>
    <button disabled={loading||accessKey.length<32} type="submit">{loading?'인증 중...':'연결하기'}</button>
    {!canStoreSession&&<div role="alert" className="connected-error">브라우저 저장소가 차단되어 새로고침하면 접근 키를 다시 입력해야 합니다.</div>}
    {error&&<div role="alert" className="connected-error">{error}</div>}
  </form>
}
const dateTypes=['date','created_time','last_edited_time']
const numericTypes=['number','formula','rollup']
const categoryTypes=['select','status','multi_select','checkbox']
function pickSelect(label:string,value:string,fields:NotionField[],allowed:string[],update:(s:string)=>void){return <label className="connected-field"><span>{label}</span><select value={value} onChange={e=>update(e.target.value)}><option value="">속성 선택</option>{fields.filter(f=>allowed.includes(f.type)).map(f=><option value={f.id} key={f.id}>{f.name} · {f.type}</option>)}</select></label>}
export function ConnectedSettings({config,update}:{config:WidgetConfig;update:(v:ConnectedChartConfig)=>void}){
  const token=useSessionToken()
  const [sources,setSources]=useState<ConnectedSource[]>([])
  const [fields,setFields]=useState<NotionField[]>([])
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const c=config.connected
  useEffect(()=>{if(!token)return;let live=true;setLoading(true);setError('');fetchSources().then(s=>{if(live)setSources(s)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[token])
  useEffect(()=>{if(!token||!c.sourceKey){setFields([]);return}let live=true;fetchSchema(c.sourceKey).then(f=>{if(live)setFields(f)}).catch(e=>{if(live){setFields([]);setError(e.message)}});return()=>{live=false}},[token,c.sourceKey])
  if(!token)return <LoginBox/>
  const set=(values:Partial<ConnectedChartConfig>)=>update({...c,...values})
  return <div className="connected-form">
    <LoginBox compact/>
    {loading&&<span className="connected-help">연결된 데이터 소스를 불러오는 중...</span>}
    {error&&<p className="connected-error" role="alert">{error}</p>}
    <label className="connected-field"><span>Notion 데이터 소스</span><select value={c.sourceKey} onChange={e=>set({sourceKey:e.target.value,dateFieldId:'',valueFieldId:'',categoryFieldId:''})}><option value="">데이터 소스 선택</option>{sources.map(s=><option value={s.key} key={s.key}>{s.title} ({s.key})</option>)}</select></label>
    {c.sourceKey&&<>
      <label className="connected-field"><span>그룹화</span><select value={c.groupBy} onChange={e=>set({groupBy:e.target.value as ConnectedChartConfig['groupBy']})}><option value="month">월별</option><option value="day">일별</option><option value="category">카테고리별</option></select></label>
      <label className="connected-field"><span>집계 방식</span><select value={c.aggregate} onChange={e=>set({aggregate:e.target.value as ConnectedChartConfig['aggregate']})}><option value="sum">합계</option><option value="count">건수</option><option value="avg">평균</option></select></label>
      {pickSelect('날짜 속성',c.dateFieldId,fields,dateTypes,v=>set({dateFieldId:v}))}
      {c.groupBy==='category'&&pickSelect('분류 속성',c.categoryFieldId,fields,categoryTypes,v=>set({categoryFieldId:v}))}
      {c.aggregate!=='count'&&pickSelect('숫자 속성',c.valueFieldId,fields,numericTypes,v=>set({valueFieldId:v}))}
      <div className="connected-dates"><label className="connected-field"><span>시작일 (선택)</span><input type="date" value={c.dateFrom} onChange={e=>set({dateFrom:e.target.value})}/></label><label className="connected-field"><span>종료일 (선택)</span><input type="date" value={c.dateTo} onChange={e=>set({dateTo:e.target.value})}/></label></div>
      <p className="connected-help"><Check size={13}/> API는 읽기 전용이며 차트 집계 결과만 반환합니다. 다중 선택 태그는 여러 그룹에 각각 집계됩니다.</p>
    </>}
  </div>
}
export function useConnectedData(config: ConnectedChartConfig){
  const token=useSessionToken()
  const [result,setResult]=useState<ChartResponse|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [seq,setSeq]=useState(0)
  const reload=useCallback(()=>setSeq(v=>v+1),[])
  const settings=JSON.stringify(config)
  useEffect(()=>{
    if(!token||!config.sourceKey){setResult(null);setError('');return}
    if((config.groupBy!=='category'&&!config.dateFieldId)|| (config.groupBy==='category'&&!config.categoryFieldId) || (config.aggregate!=='count'&&!config.valueFieldId)){setResult(null);setError('날짜·분류·숫자 속성을 설정해 주세요.');return}
    let live=true
    setLoading(true);setError('');setResult(null)
    fetchChart(config).then(data=>{if(live)setResult(data)}).catch(e=>{if(live){setError(e.message);setResult(null)}}).finally(()=>{if(live)setLoading(false)})
    return()=>{live=false}
  // Serialize validated input changes to avoid effect loops from object identity.
  },[token,settings,seq])
  useEffect(()=>{if(!token)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')reload()},5*60*1000);return()=>clearInterval(timer)},[token,reload])
  return {result,error,loading,reload}
}
export function ConnectedChartFrame({config,render}:{config:WidgetConfig;render:(result:ChartResponse)=>ReactNode}){
  const token=useSessionToken()
  const {result,error,loading,reload}=useConnectedData(config.connected)
  if(!API_BASE)return <div className="widget-body"><div className="connected-alert">연동 API가 설정되지 않았습니다. GitHub Pages의 VITE_NOTION_API_BASE 변수를 확인하세요.</div></div>
  if(!token)return <div className="widget-body"><LoginBox/></div>
  return <div className="connected-runtime">
    <div className="connected-runtime-status"><span><ShieldCheck size={13}/> Notion DB · Private</span><button onClick={reload} type="button" aria-label="차트 새로고침" disabled={loading}><RefreshCcw size={14}/> {loading?'로딩 중':'새로고침'}</button></div>
    {error&&<p className="connected-error" role="alert">{error}</p>}
    {result?render(result):<div className="connected-empty" aria-live="polite">{loading?'Notion DB에서 데이터를 불러오는 중...':'위젯 설정을 확인해 주세요.'}</div>}
    {result&&<div className="connected-foot">집계 항목 {result.recordCount}건 · 마지막 조회 {new Date(result.updatedAt).toLocaleTimeString('ko-KR')}</div>}
  </div>
}
