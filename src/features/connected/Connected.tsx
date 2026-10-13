import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ExternalLink, LockKeyhole, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react'
import { API_BASE, beginNotionAuth, disconnect, fetchChart, fetchPublicChart, fetchSchema, fetchSources, logout, publishChart, saveChart, unpublishChart, useSessionToken, workspaces, savedCharts } from './api'
import type { ChartResponse, ConnectedSource, NotionField, PublishedChart, Workspace, SavedChart } from './api'
import type { ConnectedChartConfig, WidgetConfig } from '../../lib/config'
import { defaultConfig, defaultConnectedChart, embedUrl } from '../../lib/config'

export function OAuthFinish({ticket}:{ticket:string}){
  const [message,setMessage]=useState('Notion 연결을 완료하는 중...')
  const started=useRef(false)
  useEffect(()=>{if(started.current)return;started.current=true;import('./api').then(({redeemTicket})=>redeemTicket(ticket)).then(()=>{setMessage('연결 성공! 차트 Builder로 이동합니다.');window.location.replace(`${location.pathname}#/build/mini-charts`)}).catch(err=>setMessage(`연결 실패: ${err.message}`))},[ticket])
  return <section className="connected-oauth-finish" role="status"><h2>Notion OAuth</h2><p>{message}</p><a href="#/build/mini-charts">Mini Charts로 돌아가기</a></section>
}
export function LoginBox({compact=false}:{compact?:boolean}){
  const token=useSessionToken()
  const [error,setError]=useState('')
  const [spaces,setSpaces]=useState<Workspace[]>([])
  useEffect(()=>{if(token)workspaces().then(setSpaces).catch(()=>setSpaces([]));else setSpaces([])},[token])
  if(!API_BASE)return <div className="connected-alert"><LockKeyhole size={18}/> 연동 API 주소를 아직 설정하지 않았습니다.</div>
  if(!token)return <div className={`connected-login ${compact?'connected-login-compact':''}`}>
    <ShieldCheck size={21}/><strong>Notion 계정 연결</strong>
    <span>개인 API 키를 입력할 필요가 없어요. Notion에서 공유할 DB를 선택해 승인하면 됩니다.</span>
    <button type="button" onClick={()=>{try{beginNotionAuth()}catch(e){setError((e as Error).message)}}}>Notion 계정 연결 <ExternalLink size={14}/></button>
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </div>
  return <div className="connected-user"><ShieldCheck size={16}/> 연결됨 {spaces.length?`· ${spaces.map(w=>w.name).join(', ')}`:''}
    <button type="button" onClick={beginNotionAuth}>워크스페이스 추가</button><button type="button" onClick={()=>{void logout()}}><LogOut size={14}/> 로그아웃</button>
  </div>
}
const dateTypes=['date','created_time','last_edited_time']
const numericTypes=['number','formula','rollup']
const categoryTypes=['select','status','multi_select','checkbox']
function fieldSelect(label:string,value:string,fields:NotionField[],allowed:string[],update:(s:string)=>void){return <label className="connected-field"><span>{label}</span><select value={value} onChange={e=>update(e.target.value)}><option value="">속성 선택</option>{fields.filter(f=>allowed.includes(f.type)).map(f=><option key={f.id} value={f.id}>{f.name} · {f.type}</option>)}</select></label>}
export function ConnectedSettings({config,update}:{config:WidgetConfig;update:(v:ConnectedChartConfig)=>void}){
  const token=useSessionToken()
  const [sources,setSources]=useState<ConnectedSource[]>([]),[fields,setFields]=useState<NotionField[]>([])
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[spaces,setSpaces]=useState<Workspace[]>([])
  const c=config.connected
  const refresh=useCallback(()=>{if(!token)return;setLoading(true);setError('');Promise.all([fetchSources(),workspaces()]).then(([s,w])=>{setSources(s);setSpaces(w)}).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[token])
  useEffect(()=>{refresh()},[refresh])
  useEffect(()=>{if(!token||!c.sourceKey){setFields([]);return}let active=true;fetchSchema(c.sourceKey).then(f=>{if(active)setFields(f)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[token,c.sourceKey])
  if(!token)return <LoginBox/>
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
export function useConnectedData(config:ConnectedChartConfig){
  const token=useSessionToken()
  const [result,setResult]=useState<ChartResponse|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[seq,setSeq]=useState(0)
  const reload=useCallback(()=>setSeq(x=>x+1),[])
  const settings=JSON.stringify(config)
  useEffect(()=>{
    if(!token||!config.sourceKey){setResult(null);setError('');return}
    if((config.groupBy!=='category'&&!config.dateFieldId)||(config.groupBy==='category'&&!config.categoryFieldId)||(config.aggregate!=='count'&&!config.valueFieldId)){setResult(null);setError('속성을 모두 선택하세요.');return}
    let active=true;setLoading(true);setResult(null);setError('')
    fetchChart(config).then(r=>{if(active)setResult(r)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[token,settings,seq])
  useEffect(()=>{if(!token)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')reload()},300000);return()=>clearInterval(timer)},[token,reload])
  return {result,error,loading,reload}
}
export function ConnectedChartFrame({config,render}:{config:WidgetConfig;render:(result:ChartResponse)=>ReactNode}){
  const id=new URLSearchParams(location.search).get('shared')
  const token=useSessionToken()
  const {result,error,loading,reload}=useConnectedData(config.connected)
  const [publicResult,setPublicResult]=useState<PublishedChart|null>(null),[publicError,setPublicError]=useState('')
  useEffect(()=>{
    if(!id)return
    let active=true,timer:number|undefined
    setPublicResult(null);setPublicError('')
    const refresh=async()=>{
      try{const next=await fetchPublicChart(id);if(active){setPublicResult(next);setPublicError('')}}
      catch(e){if(active){setPublicResult(null);setPublicError((e as Error).message)}}
      finally{if(active)timer=window.setTimeout(()=>void refresh(),60000)}
    }
    void refresh()
    return()=>{active=false;clearTimeout(timer)}
  },[id])
  if(id)return <div className="connected-runtime">{publicError&&<p role="alert" className="connected-error">{publicError}</p>}{publicResult?render(publicResult):<div className="connected-empty">{publicError?'차트를 표시할 수 없습니다.':'Notion 최신 집계값을 불러오는 중...'}</div>}{publicResult&&<div className="connected-foot">Notion 실시간 연동 · {new Date(publicResult.updatedAt).toLocaleString('ko-KR')} 조회 · 60초마다 자동 갱신</div>}</div>
  if(!API_BASE)return <div className="connected-alert">Notion API 연결 주소가 설정되지 않았습니다.</div>
  if(!token)return <div className="connected-runtime"><div className="connected-alert"><LockKeyhole size={18}/> 비공개 차트입니다. 임베드에서는 자동 로그인을 지원하지 않습니다.</div><p>Builder의 공유 관리에서 실시간 공유를 허용하고 공개 링크를 복사해 Notion 임베드 주소를 교체하세요. 계정 연결만으로는 비공개 주소가 공개되지 않습니다.</p><a href={`${location.origin}${location.pathname}#/build/mini-charts`} target="_blank" rel="noreferrer">Builder에서 열기 <ExternalLink size={14}/></a></div>
  return <div className="connected-runtime"><div className="connected-runtime-status"><span><ShieldCheck size={13}/> Notion DB · Private</span><button type="button" onClick={reload} disabled={loading}><RefreshCcw size={14}/> {loading?'불러오는 중':'새로고침'}</button></div>{error&&<p className="connected-error" role="alert">{error}</p>}{result?render(result):<div className="connected-empty">{loading?'Notion 데이터를 집계하는 중...':'차트 설정을 확인해 주세요.'}</div>}{result&&<div className="connected-foot">{result.recordCount}건 집계 · {new Date(result.updatedAt).toLocaleString('ko-KR')}</div>}</div>
}
export function PublishBox({config}:{config:WidgetConfig}){
  const token=useSessionToken()
  const [id,setId]=useState(''),[status,setStatus]=useState<'private'|'public'>('private'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmPublic,setConfirmPublic]=useState(false)
  useEffect(()=>{setId('');setStatus('private');setConfirmPublic(false)},[config.connected.sourceKey,config.connected.dateFieldId,config.connected.valueFieldId,config.connected.categoryFieldId,config.connected.groupBy,config.connected.aggregate,config.connected.dateFrom,config.connected.dateTo,config.chartType])
  if(!token)return <div className="connected-alert">Notion 계정을 먼저 연결하세요.</div>
  const publishedUrl=id&&status==='public'?`${embedUrl('mini-charts',{...config,connected:defaultConnectedChart},location.origin,location.pathname)}&shared=${encodeURIComponent(id)}`:''
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <div className="connected-publish">
    <h3>Connected Chart · 공유 관리</h3>
    <p>차트는 기본 비공개입니다. Notion에 임베드하려면 <strong>최신 집계값의 실시간 공유</strong>를 허용하세요. 원본 행과 OAuth 토큰은 공개하지 않습니다.</p>
    {!id&&<button disabled={busy||!config.connected.sourceKey} type="button" onClick={()=>void run(async()=>{const w=await saveChart(config.connected,config.chartType,'Connected Mini Chart');setId(w.id)})}>① 차트 비공개 저장</button>}
    {id&&status==='private'&&<><label className="connected-public-confirm"><input type="checkbox" checked={confirmPublic} onChange={e=>setConfirmPublic(e.target.checked)}/> 앞으로 변경되는 그룹명과 최신 집계값도 링크를 가진 누구에게나 계속 공개됨에 동의합니다.</label><button type="button" disabled={busy||!confirmPublic} onClick={()=>void run(async()=>{await publishChart(id);setStatus('public')})}>② 실시간 공유 허용</button></>}
    {id&&status==='public'&&<><p className="connected-help">임베드는 Notion DB를 조회해 최신 값을 표시하고 60초마다 자동 갱신합니다. 아래 공개 링크를 Notion에 붙여넣으세요.</p><label className="connected-field"><span>실시간 공개 임베드 URL</span><input readOnly value={publishedUrl} onFocus={e=>e.target.select()}/></label><button type="button" onClick={()=>navigator.clipboard.writeText(publishedUrl).catch(()=>setError('주소를 직접 복사해 주세요.'))}>공개 링크 복사</button><button type="button" disabled={busy} onClick={()=>void run(async()=>{await unpublishChart(id);setStatus('private');setConfirmPublic(false)})}>공유 해제</button></>}
    {id&&status==='private'&&<p className="connected-help">비공개 저장됨 · 아직 공개 링크가 없습니다.</p>}
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </div>
}

export function SavedChartsManager(){
  const token=useSessionToken(),[items,setItems]=useState<SavedChart[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[consentId,setConsentId]=useState('')
  const load=useCallback(()=>{if(!token)return;savedCharts().then(setItems).catch(e=>setError(e.message))},[token])
  useEffect(()=>{load()},[load])
  if(!token)return null
  const act=async(id:string,op:'publish'|'revoke')=>{setBusy(id);setError('');try{if(op==='publish')await publishChart(id);else await unpublishChart(id);setConsentId('');load()}catch(e){setError((e as Error).message)}finally{setBusy('')}}
  return <section className="connected-publish" aria-label="저장한 차트 관리"><h3>내가 저장한 차트</h3><button type="button" onClick={load}>목록 새로고침</button>
    {items.length===0&&<p className="connected-help">저장한 차트가 없습니다.</p>}
    {items.map(item=><div key={item.id} className="connected-saved-item"><strong>{item.title}</strong><span>{item.visibility==='public'?'실시간 공유 중':'비공개'}</span>
      {item.visibility==='private'&&<label className="connected-public-confirm"><input type="checkbox" checked={consentId===item.id} onChange={e=>setConsentId(e.target.checked?item.id:'')}/> 앞으로 변경되는 그룹명과 최신 집계값도 링크를 가진 누구에게나 계속 공개됨에 동의합니다.</label>}
      <div className="connected-saved-actions">{item.visibility==='public'?<><button type="button" onClick={()=>{const url=embedUrl('mini-charts',{...defaultConfig,chartSource:'notion',chartType:item.chart_type as WidgetConfig['chartType'],connected:defaultConnectedChart},location.origin,location.pathname)+'&shared='+encodeURIComponent(item.id);navigator.clipboard.writeText(url).catch(()=>setError('링크를 복사하지 못했습니다.'))}}>공개 링크 복사</button><button type="button" disabled={busy===item.id} onClick={()=>void act(item.id,'revoke')}>공유 해제</button></>:<button type="button" disabled={!!busy||consentId!==item.id} onClick={()=>void act(item.id,'publish')}>실시간 공유 허용</button>}</div></div>)}
    {error&&<p className="connected-error" role="alert">{error}</p>}
  </section>
}
