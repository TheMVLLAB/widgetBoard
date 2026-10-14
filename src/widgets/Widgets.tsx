import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Eye, EyeOff, Leaf, Play, Pause, RotateCcw, Shuffle, Sparkles, Volume2 } from 'lucide-react'
import type { WidgetConfig, WidgetId, ChartDatum, ChartType } from '../lib/config'
import { localDay, storageAvailable, useStoragePersistence, useStoredState } from '../lib/storage'
import { dailyWordIndex, wordsForLevel } from '../data/words'
import { ConnectedChartFrame } from '../features/connected/Connected'
import type { ChartResponse } from '../features/connected/api'

type Props = {id: WidgetId; config:WidgetConfig; embedded?:boolean; templateMode?:boolean; savedWidgetId?:string}
export function WidgetRenderer({id,config,embedded=false,templateMode=false,savedWidgetId}:Props){
  return <div className={`widget-frame widget-theme-${config.theme} widget-density-${config.density} ${embedded?'widget-embedded':''} ${config.showTitle?'':'widget-hide-kicker'} ${config.showBorder?'':'widget-no-border'} ${config.transparentBackground?'widget-transparent':''} ${config.motion==='reduce'?'widget-motion-reduce':''}`} style={{borderRadius:config.radius}}>
    {id==='daily-word'&&<DailyWord config={config}/>}
    {id==='flashcard'&&<Flashcards config={config}/>}
    {id==='focus-garden'&&<FocusGarden config={config}/>}
    {id==='habit-stamps'&&<HabitStamps config={config}/>}
    {id==='roulette'&&<Roulette config={config}/>}
    {id==='mini-charts'&&((config.chartSource==='notion'||(embedded&&savedWidgetId!==undefined))&&!templateMode?<ConnectedChartFrame config={config} embedded={embedded} widgetId={savedWidgetId} render={(result:ChartResponse,chartType:ChartType)=><MiniCharts config={{...config,chartType}} connectedData={result.data}/>}/>:<MiniCharts config={config}/>)}
    {id==='smart-clock'&&<SmartClock config={config}/>}
  </div>
}
function WidgetKicker({name,tag}: {name:string;tag?:string}) {
  return <div className="widget-kicker"><span><Sparkles size={14}/> {name}</span>{tag&&<span className="tiny-label">{tag}</span>}</div>
}
function StorageNote(){const persist=useStoragePersistence();const ok=useMemo(()=>persist?storageAvailable():false,[persist]);return !persist?<div className="storage-note">템플릿용 체험 링크에서는 개인 기록이 저장되지 않아요. 내 위젯 만들기에서 고유 링크를 생성할 수 있어요.</div>:ok?null:<div className="storage-note">이 환경에서는 로컬 기록 저장이 제한되어 있어요. 현재 열린 화면에서만 사용해 주세요.</div>}
function DailyWord({config}: {config:WidgetConfig}) {
  const options=wordsForLevel(config.level)
  const day=localDay(config.timezone)
  const base=dailyWordIndex(day,config.level,options.length)
  const [step,setStep]=useState(0)
  const [revealed,setRevealed]=useState(false)
  const [saved,setSaved]=useStoredState<string[]>(`${config.instanceId}:daily-word:learned`,[])
  const word=options[(base+step)%options.length]
  const wordKey=`${day}:${word.word}`
  const isSaved=saved.includes(wordKey)
  const speak=()=>{if(!('speechSynthesis' in window))return; speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(word.word);u.lang='en-US';speechSynthesis.speak(u)}
  return <div className="widget-body word-widget">
    <WidgetKicker name="DAILY VOCABULARY" tag="ONE DAY · ONE WORD"/>
    <div className="word-content"><div className="word-type">{word.type} <span className="word-dot">·</span> {config.level}</div>
      <h2>{word.word}</h2>
      <button className="word-sound" type="button" onClick={speak} aria-label="영어 발음 듣기"><Volume2 size={16}/> Listen to pronunciation</button>
      <div className="word-answer" aria-live="polite">{revealed?<><strong>{word.meaning}</strong>{config.examples&&<em>“{word.example}”</em>}</>:<><EyeOff size={21}/><span>뜻을 떠올려보세요</span></>}</div>
    </div>
    <div className="widget-divider"/>
    <div className="widget-actions wrap-actions">
      <button type="button" className="soft-btn" onClick={()=>setRevealed(v=>!v)}>{revealed?<EyeOff size={15}/>:<Eye size={15}/>} {revealed?'뜻 가리기':'뜻 보기'}</button>
      <button type="button" className={`soft-btn ${isSaved?'active-btn':''}`} onClick={()=>setSaved(prev=>isSaved?prev.filter(x=>x!==wordKey):[...prev,wordKey])}><Check size={15}/> {isSaved?'학습 완료':'외웠어요'}</button>
      <button type="button" className="dark-btn" onClick={()=>{setStep(v=>v+1);setRevealed(false)}}>다음 <ArrowRight size={15}/></button>
    </div>
    <StorageNote/>
  </div>
}
function Flashcards({config}:{config:WidgetConfig}){
  const options=wordsForLevel(config.level)
  const [index,setIndex]=useState(0)
  const [flipped,setFlipped]=useState(false)
  const [known,setKnown]=useStoredState<string[]>(`${config.instanceId}:flashcards:known`,[])
  const [offset,setOffset]=useState(0)
  const item=options[(index+offset)%options.length]
  const memorized=known.includes(item.word)
  const next=(shift:number)=>{setIndex(v=>(v+shift+options.length)%options.length);setFlipped(false)}
  return <div className="widget-body flashcard-widget">
    <WidgetKicker name="FLASHCARD DECK" tag={`${(index%options.length)+1} / ${options.length}`}/>
    <button className={`flip-card ${flipped?'is-flipped':''}`} onClick={()=>setFlipped(v=>!v)} aria-label={flipped?'카드 앞면 보기':'카드를 뒤집어 뜻 보기'}>
      <span className="flip-card-helper">{flipped?'MEANING':'VOCABULARY'} <Shuffle size={15}/></span>
      <strong>{flipped?item.meaning:item.word}</strong>
      <span className="flip-card-footer">{flipped?item.example:'클릭해서 카드를 뒤집어보세요 ↗'}</span>
    </button>
    <div className="widget-actions between-actions">
      <button className="icon-btn" onClick={()=>next(-1)} aria-label="이전 카드"><ChevronLeft size={20}/></button>
      <button className={`soft-btn ${memorized?'active-btn':''}`} onClick={()=>setKnown(v=>memorized?v.filter(w=>w!==item.word):[...v,item.word])}><CheckCircle2 size={16}/> {memorized?'외웠어요':'암기 완료'}</button>
      <button className="icon-btn" onClick={()=>{setOffset(Math.floor(Math.random()*options.length));setIndex(0);setFlipped(false)}} aria-label="카드 섞기"><Shuffle size={17}/></button>
      <button className="icon-btn" onClick={()=>next(1)} aria-label="다음 카드"><ChevronRight size={20}/></button>
    </div>
    <div className="subtle-caption">암기한 단어 {known.filter(w=>options.some(o=>o.word===w)).length}개 · 클릭해서 뒤집기</div>
    <StorageNote/>
  </div>
}
type TimerState={elapsed:number; startedAt:number|null; sessions:number; minutes:number}
function FocusGarden({config}:{config:WidgetConfig}){
  const duration=config.timerMinutes*60000
  const [timer,setTimer]=useStoredState<TimerState>(`${config.instanceId}:focus-garden`,{elapsed:0,startedAt:null,sessions:0,minutes:0})
  const [now,setNow]=useState(Date.now())
  useEffect(()=>{const i=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(i)},[])
  const elapsed=Math.max(0,timer.elapsed+(timer.startedAt!==null?Math.max(0,now-timer.startedAt):0))
  const remaining=Math.max(0,duration-elapsed)
  const done=remaining===0
  const display=`${Math.floor(remaining/60000).toString().padStart(2,'0')}:${Math.floor((remaining%60000)/1000).toString().padStart(2,'0')}`
  const progress=Math.min(100,100*(elapsed/duration))
  const icon=['🌰','🌱','🌿','🪴','🌷','🌻'][Math.min(5,Math.floor(timer.sessions/2))]
  const stop=()=>setTimer(t=>({...t,elapsed:Math.max(0,t.elapsed+(t.startedAt!==null?Date.now()-t.startedAt:0)),startedAt:null}))
  const reset=()=>setTimer(t=>({...t,elapsed:0,startedAt:null}))
  const finish=()=>setTimer(t=>({...t,elapsed:0,startedAt:null,sessions:t.sessions+1,minutes:t.minutes+config.timerMinutes}))
  return <div className="widget-body garden-widget">
    <WidgetKicker name="FOCUS GARDEN" tag="GROW WITH TIME"/>
    <div className="garden-scene"><div className="garden-sun">✳</div><div className="garden-spark spark-one">✦</div><div className="garden-spark spark-two">✧</div><div className="plant-emoji" aria-label="성장 중인 식물">{icon}</div><div className="garden-ground"/></div>
    <div className="timer-head"><div><div className="timer-digits" aria-live="off">{display}</div><span className="tiny-muted">{done?'완료할 준비가 됐어요!':timer.startedAt!==null?'집중하는 중...':'작은 시작이 큰 정원을 만들어요'}</span></div><div className="garden-badge"><Leaf size={14}/> {timer.sessions} sessions</div></div>
    <div className="progress-track"><div style={{width:`${progress}%`}}/></div>
    <div className="widget-actions">
      {done?<button className="dark-btn stretch" onClick={finish}><Check size={16}/> 완료 기록하고 식물 키우기</button>:timer.startedAt!==null?<button className="dark-btn stretch" onClick={stop}><Pause size={16}/> 일시정지</button>:<button className="dark-btn stretch" onClick={()=>setTimer(t=>({...t,startedAt:Date.now()}))}><Play size={15}/> {timer.elapsed?'계속 집중하기':'집중 시작'}</button>}
      <button className="icon-btn" onClick={reset} aria-label="타이머 초기화"><RotateCcw size={18}/></button>
    </div>
    <div className="subtle-caption">누적 {timer.minutes}분 · 세션 종료 후 완료를 눌러야 기록돼요.</div>
    <StorageNote/>
  </div>
}
function HabitStamps({config}:{config:WidgetConfig}){
  const today=localDay(config.timezone)
  const [history,setHistory]=useStoredState<Record<string,string[]>>(`${config.instanceId}:habits:history`,{})
  const checked=history[today]||[]
  const toggle=(name:string)=>setHistory(h=>({...h,[today]:(h[today]||[]).includes(name)?(h[today]||[]).filter(n=>n!==name):[...(h[today]||[]),name]}))
  const days=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-(6-i));return localDay(config.timezone,date)})
  return <div className="widget-body habits-widget">
    <WidgetKicker name="HABIT STAMPS" tag="SMALL WINS"/>
    <div className="habits-heading"><div><h3>하루 한 걸음 🌟</h3><span>오늘도 반짝이는 기록을 남겨요.</span></div><span className="habit-score">{checked.filter(n=>config.habits.includes(n)).length}<small>/{config.habits.length}</small></span></div>
    <div className="habit-list">{config.habits.map(name=><button className={`habit-row ${checked.includes(name)?'habit-done':''}`} key={name} onClick={()=>toggle(name)} aria-pressed={checked.includes(name)}><span className="habit-check">{checked.includes(name)?<Check size={15}/>:null}</span><span>{name}</span>{checked.includes(name)&&<span className="habit-star">✦</span>}</button>)}</div>
    <div className="widget-divider"/>
    <div className="week-label">지난 7일의 기록</div>
    <div className="week-stamps">{days.map(day=><div key={day} className="stamp-day"><span>{day.slice(5).replace('-','/')}</span><div className={history[day]?.length?'stamp done':'stamp'}>{history[day]?.length?'✿':'·'}</div></div>)}</div>
    <StorageNote/>
  </div>
}
const COLORS=['#f7ad9c','#a5b5f4','#e7be70','#9bcbb4','#c7b1df','#f4cbac','#98c6d9','#d9bcae','#a5cf7f','#dfb3cf']
function Roulette({config}:{config:WidgetConfig}){
  const choices=config.rouletteOptions
  const [rotation,setRotation]=useState(0)
  const [spinning,setSpinning]=useState(false)
  const [result,setResult]=useState<string|null>(null)
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
  const bg=`conic-gradient(${choices.map((_,i)=>`${COLORS[i%COLORS.length]} ${i*100/choices.length}% ${(i+1)*100/choices.length}%`).join(',')})`
  const spin=()=>{if(spinning)return;const pick=Math.floor(Math.random()*choices.length);const angle=360/choices.length; const target=360-(pick+.5)*angle;const delta=360*5+(target-(rotation%360)+360)%360;setRotation(v=>v+delta);setSpinning(true);setResult(null);const reduce=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; timer.current=setTimeout(()=>{setResult(choices[pick]);setSpinning(false)},reduce?50:3200)}
  return <div className="widget-body roulette-widget">
    <WidgetKicker name="DECISION ROULETTE" tag="LET CHANCE DECIDE"/>
    <h3>오늘은 뭘 해볼까?</h3>
    <div className="wheel-wrap"><div className="wheel-pointer"/><div className="roulette-wheel" style={{background:bg,transform:`rotate(${rotation}deg)`}}>{choices.map((label,i)=><span key={`${label}-${i}`} className="wheel-label" style={{transform:`rotate(${(i+.5)*360/choices.length}deg) translateY(-105px) rotate(-${(i+.5)*360/choices.length}deg)`}}>{label.length>8?label.slice(0,7)+'…':label}</span>)}</div><div className="wheel-center">✦</div></div>
    <div className="roulette-result" aria-live="polite">{result?<><span>오늘의 선택은</span><strong>{result}!</strong></>:<span>{spinning?'두근두근...':'망설이지 말고 한 번 돌려봐!'}</span>}</div>
    <button className="dark-btn stretch" onClick={spin} disabled={spinning}><Shuffle size={16}/> {spinning?'돌아가는 중':'룰렛 돌리기'}</button>
    <span className="subtle-caption">선택지는 위젯 설정에서 변경할 수 있어요.</span>
  </div>
}
function ChartDrawing({data,type,active,onSelect}:{data:ChartDatum[];type:WidgetConfig['chartType'];active:number;onSelect:(n:number)=>void}){
  const max=Math.max(...data.map(d=>d.value),1)
  const min=Math.min(...data.map(d=>d.value),0)
  const absMax=Math.max(Math.abs(min),Math.abs(max),1)
  if(type==='donut' && data.some(d=>d.value<0))return <div className="connected-empty">음수 데이터는 도넛 차트에 표시할 수 없습니다. 막대 또는 꺾은선 차트를 선택해 주세요.</div>
  if(type==='donut'){
    const sum=data.reduce((a,v)=>a+v.value,0)
    let acc=0
    const gradient=data.map((d,i)=>{const a=acc;acc+=sum?d.value/sum*100:100/data.length;return `${COLORS[i%COLORS.length]} ${a}% ${acc}%`}).join(',')
    return <div className="donut-zone"><div className="donut-chart" style={{background:`conic-gradient(${gradient})`}}><div className="donut-hole"><strong>{data[active]?.value.toLocaleString()}</strong><span>{data[active]?.label}</span></div></div></div>
  }
  if(type==='bar' && min<0){
    return <div className="signed-chart" role="group" aria-label="음수 및 양수 막대 그래프">
      {data.map((d,i)=><button key={i} className={`signed-column ${active===i?'bar-active':''}`} onClick={()=>onSelect(i)} aria-label={`${d.label}: ${d.value}`}>
        <span className="signed-value">{active===i?d.value.toLocaleString():''}</span>
        <span className="signed-track">
          <span className="signed-positive" style={{height:d.value>0?`${d.value/absMax*48}%`:'0%',background:COLORS[i%COLORS.length]}}/>
          <span className="signed-negative" style={{height:d.value<0?`${Math.abs(d.value)/absMax*48}%`:'0%',background:COLORS[i%COLORS.length]}}/>
        </span>
        <span className="bar-name">{d.label}</span>
      </button>)}
    </div>
  }
  if(type==='line'){
    const pts=data.map((d,i)=>({x:40+(i*(280/Math.max(1,data.length-1))),y:162-((d.value-min)/Math.max(1,max-min))*125}))
    return <div className="line-chart"><svg viewBox="0 0 360 200" role="img" aria-label="선 그래프"><line x1="26" y1="163" x2="337" y2="163" stroke="currentColor" opacity=".2"/><line x1="26" y1="100" x2="337" y2="100" stroke="currentColor" opacity=".1"/>
      <polyline points={pts.map(p=>`${p.x},${p.y}`).join(' ')} stroke="var(--w-accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {pts.map((p,i)=><g key={i} role="button" tabIndex={0} onClick={()=>onSelect(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(i)}}} aria-label={`${data[i].label}: ${data[i].value}`}><circle cx={p.x} cy={p.y} r={active===i?8:5} fill={active===i?'#2b2b2b':'var(--w-accent)'} stroke="var(--w-bg)" strokeWidth="3"/><text x={p.x} y="187" textAnchor="middle" fontSize="12" fill="currentColor">{data[i].label.slice(0,5)}</text></g>)}
    </svg></div>
  }
  return <div className="bar-chart" role="img" aria-label="막대 그래프">{data.map((d,i)=><button key={i} onClick={()=>onSelect(i)} className={`bar-item ${active===i?'bar-active':''}`} aria-label={`${d.label}: ${d.value}`}><span className="bar-value">{active===i?d.value.toLocaleString():''}</span><span className="bar-track"><span style={{height:`${Math.max(4,Math.abs(d.value)/absMax*100)}%`,background:COLORS[i%COLORS.length],opacity:d.value<0?.65:1,border:d.value<0?'2px dashed #6e6777':'none'}}/></span><span className="bar-name">{d.label}</span></button>)}</div>
}
function MiniCharts({config,connectedData}:{config:WidgetConfig;connectedData?:ChartDatum[]}){
  const [active,setActive]=useState(0)
  const data=connectedData||config.chartData
  const total=data.reduce((sum,d)=>sum+d.value,0)
  return <div className="widget-body chart-widget">
    <WidgetKicker name="MINI CHARTS" tag={config.chartType.toUpperCase()}/>
    <div className="chart-title"><div><h3>{connectedData?'Notion 데이터 요약':'이번 주의 기록'}</h3><span>{connectedData?'읽기 전용 집계 결과':'나의 데이터를 한눈에'}</span></div><div className="chart-total"><strong>{total.toLocaleString()}</strong><span>TOTAL</span></div></div>
    {data.length>0?<ChartDrawing data={data} type={config.chartType} active={Math.min(active,data.length-1)} onSelect={setActive}/>:<div className="connected-empty">조건에 맞는 데이터가 없습니다.</div>}
    {data.length>0&&<div className="chart-details"><span className="chart-swatch" style={{background:COLORS[Math.min(active,data.length-1)%COLORS.length]}}/>{data[Math.min(active,data.length-1)].label}<strong>{data[Math.min(active,data.length-1)].value.toLocaleString()}</strong></div>}
    <span className="subtle-caption">각 항목을 클릭하면 해당 값을 확인할 수 있어요.</span>
  </div>
}
function dateParts(timezone:string,now:Date){const vals = new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now); const get=(part:string)=>Number(vals.find(v=>v.type===part)?.value||0);return {h:get('hour'),m:get('minute'),s:get('second')}}
function SmartClock({config}:{config:WidgetConfig}){
  const [now,setNow]=useState(()=>new Date())
  useEffect(()=>{const n=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(n)},[])
  const {h,m,s}=dateParts(config.timezone,now)
  const time=new Intl.DateTimeFormat('ko-KR',{timeZone:config.timezone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:!config.clock24h}).format(now)
  const date=new Intl.DateTimeFormat('ko-KR',{timeZone:config.timezone,weekday:'long',month:'long',day:'numeric'}).format(now)
  return <div className="widget-body clock-widget">
    <WidgetKicker name="SMART CLOCK" tag="RIGHT NOW"/>
    {config.clockStyle==='digital'?<div className="digital-clock"><span className="clock-star">✳</span><div className="digital-time">{time}</div><div className="digital-date">{date}</div></div>:<div className="analog-area"><div className="analog-clock"><span className="mark mark-12">12</span><span className="mark mark-3">3</span><span className="mark mark-6">6</span><span className="mark mark-9">9</span><span className="clock-hand hour" style={{transform:`translateX(-50%) rotate(${h%12*30+m*.5}deg)`}}/><span className="clock-hand minute" style={{transform:`translateX(-50%) rotate(${m*6+s*.1}deg)`}}/><span className="clock-hand second" style={{transform:`translateX(-50%) rotate(${s*6}deg)`}}/><span className="clock-pin"/></div><span>{date}</span></div>}
    <div className="clock-footer"><span className="tz-dot"/>{config.timezone.replace('_',' ')}<span>✦ make today count</span></div>
  </div>
}
export function WidgetThumbnail({id}:{id:WidgetId}){
  if(id==='daily-word')return <div className="thumb-content thumb-word"><small>WORD OF THE DAY</small><strong>serendipity</strong><span>뜻밖의 행운 ✨</span></div>
  if(id==='flashcard')return <div className="thumb-content thumb-flash"><div className="thumb-flash-front"><small>VOCABULARY</small><strong>flourish</strong><span>↗ flip to reveal</span></div><div className="thumb-flash-back"/></div>
  if(id==='focus-garden')return <div className="thumb-content thumb-focus"><div>✧ &nbsp;&nbsp; ✳</div><strong>🪴</strong><span>24:59 <small>FOCUS TIME</small></span></div>
  if(id==='habit-stamps')return <div className="thumb-content thumb-habits"><span>✦ Daily habits</span><div><b>✓</b> Read 10 pages</div><div><b>✓</b> Morning stretch</div><div><b>·</b> Drink water</div></div>
  if(id==='roulette')return <div className="thumb-content thumb-roulette"><span className="mini-wheel"/><span className="mini-pointer">▼</span></div>
  if(id==='mini-charts')return <div className="thumb-content thumb-charts"><div><b style={{height:'40%'}}/><b style={{height:'75%'}}/><b style={{height:'58%'}}/><b style={{height:'91%'}}/><b style={{height:'68%'}}/></div><span>WEEKLY PROGRESS</span></div>
  return <div className="thumb-content thumb-clock"><span>MONDAY, OCTOBER 12</span><strong>10:24<span>:36</span></strong><span>SEOUL, SOUTH KOREA</span></div>
}
