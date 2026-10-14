import { useId } from 'react'
import { Leaf, TrendingUp } from 'lucide-react'
import type { ChartDatum } from '../lib/config'

export function lineGeometry(data:ChartDatum[]){
  const low=Math.min(0,...data.map(d=>d.value)),high=Math.max(0,...data.map(d=>d.value))
  const unit=10**Math.floor(Math.log10((high-low||1)/4))
  const step=Math.ceil((high-low||1)/4/unit)*unit
  const first=Math.floor(low/step),last=Math.max(first+1,Math.ceil(high/step))
  const min=first*step,max=last*step
  const y=(value:number)=>236-(value-min)/(max-min)*212
  const points=data.map((d,i)=>({x:data.length===1?314:48+i*532/(data.length-1),y:y(d.value)}))
  const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x))
  // Harmonic tangents keep each segment inside its two data values, without false peaks.
  const tangents=points.map((_,i)=>i===0?slopes[0]||0:i===points.length-1?slopes[i-1]||0:slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]))
  let path=points.length?`M ${points[0].x} ${points[0].y}`:''
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=(b.x-a.x)/3
    path+=` C ${a.x+dx} ${a.y+dx*tangents[i-1]} ${b.x-dx} ${b.y-dx*tangents[i]} ${b.x} ${b.y}`
  }
  return {points,path,zero:y(0),ticks:Array.from({length:last-first+1},(_,i)=>({value:(first+i)*step,y:y((first+i)*step)}))}
}

export function LineChart({data,active,onSelect,connected}:{data:ChartDatum[];active:number;onSelect:(index:number)=>void;connected:boolean}){
  const id=useId().replace(/:/g,'')
  const {points,path,zero,ticks}=lineGeometry(data)
  const selected=data[active],point=points[active],start=data[0],end=data[data.length-1]
  const change=end.value-start.value,positive=data.filter(d=>d.value>0).length
  const signed=(value:number)=>`${value>0?'+':''}${value.toLocaleString()}`
  const area=`${path} L ${points[points.length-1].x} ${zero} L ${points[0].x} ${zero} Z`
  const labelEvery=Math.max(1,Math.ceil((data.length-1)/5))
  return <section className="momentum-chart" aria-label="변화 기록 차트">
    <header className="momentum-heading"><span className="momentum-icon"><Leaf size={24}/></span><div><h3>My Momentum</h3><p>{connected?'Notion 데이터의 흐름과 변화를 살펴보세요.':'작은 변화도 기록하면 흐름이 보여요.'}</p></div><span className="momentum-motto">SMALL STEPS<br/>STILL COUNT.</span></header>
    <div className="momentum-plot"><svg viewBox="0 0 600 270" role="group" aria-label="양수와 음수 영역이 구분된 선 그래프">
      <defs>
        <linearGradient id={`${id}-positive`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-positive)" stopOpacity=".3"/><stop offset="100%" stopColor="var(--chart-positive)" stopOpacity=".04"/></linearGradient>
        <linearGradient id={`${id}-negative`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-negative)" stopOpacity=".05"/><stop offset="100%" stopColor="var(--chart-negative)" stopOpacity=".24"/></linearGradient>
        <clipPath id={`${id}-above`}><rect x="48" y="0" width="532" height={zero}/></clipPath>
        <clipPath id={`${id}-below`}><rect x="48" y={zero} width="532" height={270-zero}/></clipPath>
      </defs>
      {ticks.map(t=><g key={t.value} className="momentum-grid"><line x1="48" x2="580" y1={t.y} y2={t.y}/><text x="37" y={t.y} dy=".35em" textAnchor="end">{t.value.toLocaleString(undefined,{maximumSignificantDigits:3})}</text></g>)}
      {points.map((p,i)=>(i%labelEvery===0||i===data.length-1)&&<line key={i} className="momentum-guide" x1={p.x} x2={p.x} y1="24" y2="236"/>)}
      <path d={area} fill={`url(#${id}-positive)`} clipPath={`url(#${id}-above)`}/>
      <path d={area} fill={`url(#${id}-negative)`} clipPath={`url(#${id}-below)`}/>
      <line className="momentum-zero" x1="48" x2="580" y1={zero} y2={zero}/>
      <path className="momentum-curve" d={path} stroke="var(--chart-positive)" clipPath={`url(#${id}-above)`}/>
      <path className="momentum-curve" d={path} stroke="var(--chart-negative)" clipPath={`url(#${id}-below)`}/>
      <line className="momentum-selected-guide" x1={point.x} x2={point.x} y1="24" y2="236"/>
      {points.map((p,i)=><g key={i} className="momentum-point" role="button" tabIndex={0} aria-label={`${data[i].label}: ${data[i].value}`} aria-pressed={active===i} onClick={()=>onSelect(i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(i)}}} style={{color:data[i].value<0?'var(--chart-negative)':'var(--chart-positive)'}}>
        <title>{data[i].label}: {signed(data[i].value)}</title><circle className="momentum-point-hit" cx={p.x} cy={p.y} r="13"/><circle className="momentum-dot" cx={p.x} cy={p.y} r={active===i?6:3.5}/>
      </g>)}
    </svg><div className="momentum-labels">{data.map((d,i)=>(i%labelEvery===0||i===data.length-1)&&<span key={i} title={d.label} style={{left:`${points[i].x/600*100}%`}}>{d.label}</span>)}</div></div>
    <div className="momentum-selection" aria-live="polite"><span className={`momentum-status-dot ${selected.value<0?'is-negative':''}`}/><span>{selected.label}</span><strong>{signed(selected.value)}</strong></div>
    <div className="momentum-stats">
      <div className="momentum-stat"><span className="momentum-stat-icon"><TrendingUp size={22}/></span><div><span>Net Change · 순변화</span><strong>{signed(change)}</strong></div><p>{start.label} {signed(start.value)} → {end.label} {signed(end.value)}</p></div>
      <div className="momentum-stat"><span className="momentum-stat-icon is-coral"><Leaf size={22}/></span><div><span>Positive Points · 양수 항목</span><strong>{positive}<small> / {data.length}</small></strong></div><p>0보다 큰 값의 항목 수예요.</p></div>
    </div>
    <p className="momentum-caption">점을 클릭하거나 키보드로 선택하면 값을 확인할 수 있어요.</p>
  </section>
}
