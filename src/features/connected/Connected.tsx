import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ExternalLink, LockKeyhole, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react'
import { API_BASE, beginNotionAuth, disconnect, fetchChart, fetchSavedChart, fetchSchema, fetchSources, isSavedWidgetId, logout, privateEmbedUrl, saveChart, useSessionToken, workspaces, savedCharts } from './api'
import type { ChartResponse, ConnectedSource, NotionField, Workspace, SavedChart } from './api'
import type { ChartType, ConnectedChartConfig, WidgetConfig } from '../../lib/config'
import { defaultConfig } from '../../lib/config'

export function OAuthEmbedComplete(){
  return <section className="connected-oauth-finish" role="status"><h2>내 Notion 계정 인증 완료</h2><p>인증을 시작한 위젯이나 Builder로 돌아가 주세요. 해당 화면에서 계정과 차트 소유권을 확인합니다.</p><p>이 창에는 차트 데이터가 표시되지 않습니다. 창을 닫아도 됩니다.</p><button type="button" className="connected-subtle-button" onClick={()=>window.close()}>인증 창 닫기</button><p className="connected-help">자동으로 닫히지 않으면 직접 닫고 원래 화면으로 돌아가 주세요.</p></section>
}
export function LoginBox({compact=false,widgetId}:{compact?:boolean;widgetId?:string}){
  const token=useSessionToken()
  const [error,setError]=useState(''),[authUrl,setAuthUrl]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false)
  const auth=useRef<AbortController|null>(null)
  useEffect(()=>{setError('');setAuthUrl('');setNotice('');setPending(false);return()=>auth.current?.abort()},[token,widgetId])
  const start=(reuse:boolean)=>{
    auth.current?.abort()
    const controller=new AbortController();auth.current=controller
    setError('');setAuthUrl('');setNotice('');setPending(true)
    void beginNotionAuth({widgetId,reuse,signal:controller.signal,onReady:url=>{if(!controller.signal.aborted)setAuthUrl(url)},onWindowUnavailable:()=>{if(!controller.signal.aborted)setNotice('인증 창이 차단되었거나 닫혔을 수 있습니다. 인증을 마쳤다면 기다려 주세요. 필요하면 아래의 같은 링크를 새 창에서 여세요.')}})
      .catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)})
      .finally(()=>{if(!controller.signal.aborted)setPending(false)})
  }
  if(!API_BASE)return <div className="connected-alert"><LockKeyhole size={18}/> 연동 API 주소를 아직 설정하지 않았습니다.</div>
  return <div className={`connected-login ${compact?'connected-login-compact':''}`}>
    {!token&&<><div className="connected-login-heading"><ShieldCheck size={18}/><strong>내 Notion 계정 인증</strong></div><span>{widgetId?'차트를 저장한 본인의 계정만 볼 수 있어요. 복사한 링크만으로는 접근할 수 없습니다.':'별도 가입·API 키 없이, Notion에서 사용할 DB를 선택해 승인하세요.'}</span></>}
    {token&&<ConnectedAccount key={token}/>}
    <button type="button" className="connected-primary-action" disabled={pending} onClick={()=>start(!token||!!widgetId)}>{pending?'인증 기다리는 중...':token&&!widgetId?'Notion 워크스페이스 추가':'기존 인증 연결'} <ExternalLink size={14}/></button>
    {(!token||widgetId)&&<><p className="connected-help">기존 인증이 있으면 연결 확인만, 없거나 만료되면 Notion 승인을 진행해요.</p><button type="button" className="connected-reauth-action" disabled={pending} onClick={()=>start(false)}>Notion 계정 다시 인증 <ExternalLink size={12}/></button></>}
    {authUrl&&<a href={authUrl} target="_blank" rel="noopener noreferrer">같은 인증 요청을 새 창에서 열기 <ExternalLink size={14}/></a>}
    {pending&&<p className="connected-help" role="status">원래 화면을 유지한 채 인증 결과를 확인합니다. 최대 10분 동안 기다려요.</p>}
    {notice&&<p className="connected-help" role="status">{notice}</p>}
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </div>
}
function ConnectedAccount(){
  const [spaces,setSpaces]=useState<Workspace[]>([]),[error,setError]=useState('')
  useEffect(()=>{const abort=new AbortController();workspaces(abort.signal).then(setSpaces).catch(()=>{if(!abort.signal.aborted)setSpaces([])});return()=>abort.abort()},[])
  return <div className="connected-user"><ShieldCheck size={16}/> 인증됨 {spaces.length?`· ${spaces.map(w=>w.name).join(', ')}`:''}<button type="button" onClick={()=>{void logout().catch(()=>setError('로그아웃 요청을 완료하지 못했지만 이 화면의 인증은 해제되었습니다.'))}}><LogOut size={14}/> 로그아웃 · 계정 변경</button>{error&&<p className="connected-error" role="alert">{error}</p>}</div>
}
const dateTypes=['date','created_time','last_edited_time']
const numericTypes=['number','formula','rollup']
const categoryTypes=['select','status','multi_select','checkbox']
function fieldSelect(label:string,value:string,fields:NotionField[],allowed:string[],update:(s:string)=>void){return <label className="connected-field"><span>{label}</span><select value={value} onChange={e=>update(e.target.value)}><option value="">속성 선택</option>{fields.filter(f=>allowed.includes(f.type)).map(f=><option key={f.id} value={f.id}>{f.name} · {f.type}</option>)}</select></label>}
export function ConnectedSettings({config,update}:{config:WidgetConfig;update:(v:ConnectedChartConfig)=>void}){
  const token=useSessionToken()
  return token?<ConnectedSettingsForSession key={token} config={config} update={update}/>:<LoginBox/>
}
function ConnectedSettingsForSession({config,update}:{config:WidgetConfig;update:(v:ConnectedChartConfig)=>void}){
  const [sources,setSources]=useState<ConnectedSource[]>([]),[schema,setSchema]=useState<{key:string;fields:NotionField[]}>({key:'',fields:[]})
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[spaces,setSpaces]=useState<Workspace[]>([]),[seq,setSeq]=useState(0)
  const c=config.connected,fields=schema.key===c.sourceKey?schema.fields:[]
  const refresh=()=>setSeq(x=>x+1)
  useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');setSources([]);setSpaces([]);Promise.all([fetchSources(abort.signal),workspaces(abort.signal)]).then(([s,w])=>{if(!abort.signal.aborted){setSources(s);setSpaces(w)}}).catch(e=>{if(!abort.signal.aborted)setError(e.message)}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[seq])
  useEffect(()=>{setSchema({key:c.sourceKey,fields:[]});if(!c.sourceKey)return;const abort=new AbortController();fetchSchema(c.sourceKey,abort.signal).then(f=>{if(!abort.signal.aborted)setSchema({key:c.sourceKey,fields:f})}).catch(e=>{if(!abort.signal.aborted)setError(e.message)});return()=>abort.abort()},[c.sourceKey])
  const set=(patch:Partial<ConnectedChartConfig>)=>update({...c,...patch})
  return <div className="connected-form">
    <LoginBox compact/>
    <button type="button" className="connected-subtle-button" onClick={refresh} disabled={loading}><RefreshCcw size={14}/> DB 목록 새로고침</button>
    {spaces.map(space=><div className="connected-connection" key={space.id}><span>{space.name}</span><button type="button" onClick={async()=>{if(!confirm(`${space.name} 연결을 해제할까요? 이 워크스페이스에 연결된 위젯도 사용할 수 없게 됩니다.`))return;try{await disconnect(space.id);set({sourceKey:'',dateFieldId:'',valueFieldId:'',categoryFieldId:''});refresh()}catch(e){setError((e as Error).message)}}}>해제</button></div>)}
    {loading&&<span className="connected-help">연결된 DB를 검색하는 중...</span>}
    {error&&<p role="alert" className="connected-error">{error}</p>}
    <label className="connected-field"><span>Notion 데이터 소스</span><select value={c.sourceKey} onChange={e=>set({sourceKey:e.target.value,dateFieldId:'',valueFieldId:'',categoryFieldId:''})}><option value="">데이터 소스 선택</option>{sources.map(s=><option key={s.key} value={s.key}>{s.title} · {s.workspace}</option>)}</select></label>
    {c.sourceKey&&<>
      <label className="connected-field"><span>그룹화</span><select value={c.groupBy} onChange={e=>set({groupBy:e.target.value as ConnectedChartConfig['groupBy']})}><option value="month">월별</option><option value="day">일별</option><option value="category">카테고리별</option></select></label>
      <label className="connected-field"><span>집계</span><select value={c.aggregate} onChange={e=>set({aggregate:e.target.value as ConnectedChartConfig['aggregate']})}><option value="sum">합계</option><option value="count">건수</option><option value="avg">평균</option></select></label>
      {fieldSelect('날짜 속성',c.dateFieldId,fields,dateTypes,v=>set({dateFieldId:v}))}
      {c.groupBy==='category'&&fieldSelect('카테고리 속성',c.categoryFieldId,fields,categoryTypes,v=>set({categoryFieldId:v}))}
      {c.aggregate!=='count'&&fieldSelect('숫자 속성',c.valueFieldId,fields,numericTypes,v=>set({valueFieldId:v}))}
      <div className="connected-dates"><label className="connected-field"><span>시작일</span><input type="date" value={c.dateFrom} onChange={e=>set({dateFrom:e.target.value})}/></label><label className="connected-field"><span>종료일</span><input type="date" value={c.dateTo} onChange={e=>set({dateTo:e.target.value})}/></label></div>
      <p className="connected-help"><Check size={13}/> 서버가 집계한 값만 브라우저에 전달합니다. 읽기 전용입니다.</p>
    </>}
  </div>
}
function useConnectedData(config:ConnectedChartConfig,widgetId:string|undefined,enabled:boolean){
  const token=useSessionToken(),settings=JSON.stringify(config)
  const key=JSON.stringify([token,widgetId??settings,enabled])
  const [state,setState]=useState<{key:string;result:ChartResponse|null;chartType:ChartType|null;error:string;loading:boolean}>({key:'',result:null,chartType:null,error:'',loading:false})
  const [seq,setSeq]=useState(0)
  const reload=useCallback(()=>setSeq(x=>x+1),[])
  useEffect(()=>{
    if(!token||!enabled)return
    if(widgetId===undefined&&(!config.sourceKey||(config.groupBy!=='category'&&!config.dateFieldId)||(config.groupBy==='category'&&!config.categoryFieldId)||(config.aggregate!=='count'&&!config.valueFieldId))){setState({key,result:null,chartType:null,error:'데이터 소스와 속성을 모두 선택하세요.',loading:false});return}
    const abort=new AbortController()
    setState({key,result:null,chartType:null,error:'',loading:true})
    const load=async()=>widgetId===undefined?{result:await fetchChart(config,abort.signal),chartType:null}:await fetchSavedChart(widgetId,abort.signal)
    load().then(r=>{if(!abort.signal.aborted)setState({key,result:r.result,chartType:r.chartType,error:'',loading:false})}).catch(e=>{if(!abort.signal.aborted)setState({key,result:null,chartType:null,error:e.message,loading:false})})
    return()=>abort.abort()
  },[token,settings,widgetId,enabled,key,seq])
  useEffect(()=>{
    if(!token||!enabled)return
    const visible=()=>{if(document.visibilityState==='visible')reload()}
    const timer=setInterval(visible,180000)
    document.addEventListener('visibilitychange',visible)
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)}
  },[token,enabled,reload])
  return state.key===key&&token&&enabled?{...state,reload}:{result:null,chartType:null,error:'',loading:false,reload}
}
export function ConnectedChartFrame({config,embedded=false,widgetId,settings,render}:{config:WidgetConfig;embedded?:boolean;widgetId?:string;settings?:(chartType:ChartType)=>ReactNode;render:(result:ChartResponse,chartType:ChartType)=>ReactNode}){
  const token=useSessionToken()
  const invalid=widgetId!==undefined&&!isSavedWidgetId(widgetId),missing=embedded&&widgetId===undefined
  const {result,chartType,error,loading,reload}=useConnectedData(config.connected,widgetId,!invalid&&!missing)
  if(invalid||missing)return <div className="connected-alert"><LockKeyhole size={18}/> 저장한 비공개 차트 링크가 필요합니다. Builder에서 차트를 저장하고 새 임베드 링크를 만들어 주세요.</div>
  if(!API_BASE)return <div className="connected-alert">Notion API 연결 주소가 설정되지 않았습니다.</div>
  if(!token)return <div className="connected-runtime"><LoginBox widgetId={widgetId}/></div>
  return <div className="connected-runtime">
    {embedded?settings?.(chartType??config.chartType):<LoginBox compact widgetId={widgetId}/>}
    <div className="connected-runtime-status"><span><ShieldCheck size={13}/> Notion DB · 본인 전용</span><button type="button" onClick={reload} disabled={loading}><RefreshCcw size={14}/> {loading?'불러오는 중':'새로고침'}</button></div>
    {error&&<p className="connected-error" role="alert">{error}</p>}
    {result?render(result,chartType??config.chartType):<div className="connected-empty">{error|| (loading?'Notion 데이터를 집계하는 중...':'차트 설정을 확인해 주세요.')}</div>}
    {result&&<div className="connected-foot">{result.recordCount}건 집계 · {new Date(result.updatedAt).toLocaleString('ko-KR')} · 약 3분마다 갱신</div>}
  </div>
}
export function PrivateEmbedBox({config}:{config:WidgetConfig}){
  const token=useSessionToken()
  const key=JSON.stringify([token,config.connected,config.chartType])
  return token?<PrivateEmbedForConfig key={key} config={config}/>:<div className="connected-alert">내 Notion 계정을 먼저 인증하세요.</div>
}
function PrivateEmbedForConfig({config}:{config:WidgetConfig}){
  const [id,setId]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const abort=useRef<AbortController|null>(null)
  useEffect(()=>()=>abort.current?.abort(),[])
  const save=async()=>{
    const controller=new AbortController();abort.current=controller;setBusy(true);setError('')
    try{const chart=await saveChart(config.connected,config.chartType,'Connected Mini Chart',controller.signal);if(!controller.signal.aborted){if(!isSavedWidgetId(chart.id))throw new Error('저장한 차트 응답 오류');setId(chart.id)}}catch(e){if(!controller.signal.aborted)setError((e as Error).message)}finally{if(!controller.signal.aborted)setBusy(false)}
  }
  const url=id?privateEmbedUrl(id,config,location.origin,location.pathname):''
  return <div className="connected-publish">
    <h3>Connected Chart · 본인 전용 임베드</h3>
    <p>차트를 저장한 본인의 Notion 계정을 인증해야 최신 데이터를 볼 수 있어요. 링크를 복사하거나 페이지를 복제해도 다른 계정에는 데이터가 표시되지 않습니다.</p>
    {!id&&<button disabled={busy||!config.connected.sourceKey} type="button" onClick={()=>void save()}>{busy?'차트 저장 중...':'차트 저장 · 비공개 링크 만들기'}</button>}
    {url&&<><label className="connected-field"><span>본인 전용 임베드 URL</span><input readOnly value={url} onFocus={e=>e.target.select()}/></label><button type="button" onClick={()=>{void navigator.clipboard.writeText(url).catch(()=>setError('주소를 직접 복사해 주세요.'))}}>비공개 링크 복사</button><p className="connected-help">URL에는 저장한 차트 ID와 표시 설정만 포함됩니다. DB와 속성 정보는 서버에 비공개로 저장돼요.</p></>}
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </div>
}
export function SavedChartsManager(){
  const token=useSessionToken()
  return token?<SavedChartsForSession key={token}/>:null
}
function SavedChartsForSession(){
  const [items,setItems]=useState<SavedChart[]>([]),[error,setError]=useState(''),[seq,setSeq]=useState(0),[loading,setLoading]=useState(false)
  useEffect(()=>{const abort=new AbortController();setItems([]);setError('');setLoading(true);savedCharts(abort.signal).then(charts=>{if(!abort.signal.aborted)setItems(charts)}).catch(e=>{if(!abort.signal.aborted){setItems([]);setError(e.message)}}).finally(()=>{if(!abort.signal.aborted)setLoading(false)});return()=>abort.abort()},[seq])
  return <section className="connected-publish" aria-label="저장한 차트 관리"><h3>내가 저장한 차트</h3><button type="button" disabled={loading} onClick={()=>setSeq(x=>x+1)}>목록 새로고침</button>
    {items.length===0&&<p className="connected-help">{loading?'저장한 차트를 불러오는 중...':'저장한 차트가 없습니다.'}</p>}
    {items.map(item=>{
      if(!isSavedWidgetId(item.id))return null
      const url=privateEmbedUrl(item.id,defaultConfig,location.origin,location.pathname)
      return <div key={item.id} className="connected-saved-item"><strong>{item.title}</strong><span>본인 전용 · 최신 Notion 데이터</span><label className="connected-field"><span>비공개 임베드 URL</span><input readOnly value={url} onFocus={e=>e.target.select()}/></label><div className="connected-saved-actions"><button type="button" onClick={()=>{void navigator.clipboard.writeText(url).catch(()=>setError('주소를 직접 복사해 주세요.'))}}>비공개 링크 복사</button><a href={url} target="_blank" rel="noopener noreferrer">내 차트 열기 <ExternalLink size={14}/></a></div></div>
    })}
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </section>
}
