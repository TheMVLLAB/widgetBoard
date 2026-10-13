import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp, Clock3, Copy, ExternalLink, Gamepad2, Grid2X2, Heart, Leaf, Menu, MoveUpRight, Palette, Search, Settings2, SlidersHorizontal, WandSparkles, X } from 'lucide-react'
import { defaultConfig, decodeConfig, embedUrl, isWidgetId, validEmbedConfig, newInstanceId, sanitizeConfig, type ChartDatum, type WidgetConfig, type WidgetId } from './lib/config'
import { configFromPreset, decodeEmbedMode, makeTemplateConfig, templateEditorUrl, templateEmbedUrl } from './lib/embed'
import { StoragePersistenceProvider } from './lib/storage'
import { registry, widgetById } from './lib/registry'
import { WidgetRenderer, WidgetThumbnail } from './widgets/Widgets'
import { ConnectedSettings, OAuthFinish, PublishBox, SavedChartsManager } from './features/connected/Connected'
import type { ConnectedChartConfig } from './lib/config'

type Route={page:'home';category:string}|{page:'oauth';ticket:string}|{page:'detail'|'builder'|'embed';id:WidgetId;query:string}|{page:'missing'}
function routeFromHash():Route {
  // The standalone Notion URL uses a real query string because embedders may discard #fragments.
  const embedQuery = new URLSearchParams(location.search)
  const embeddedId = embedQuery.get('embed')
  if (embeddedId) return isWidgetId(embeddedId) ? {page:'embed', id:embeddedId,query:location.search.slice(1)} : {page:'missing'}
  const raw=location.hash.slice(1)||'/'
  const [path,query='']=raw.split('?')
  const parts=path.split('/').filter(Boolean)
  if(!parts.length)return {page:'home',category:new URLSearchParams(query).get('category')||'All widgets'}
  if(parts[0]==='auth'&&parts[1]==='complete')return {page:'oauth',ticket:new URLSearchParams(query).get('ticket')||''}
  if(['widget','build','embed'].includes(parts[0])&&isWidgetId(parts[1]||''))return {page:parts[0]==='widget'?'detail':parts[0]==='build'?'builder':'embed',id:parts[1] as WidgetId,query}
  return {page:'missing'}
}
function useRoute(){const [route,setRoute]=useState<Route>(routeFromHash);useEffect(()=>{const refresh=()=>{setRoute(routeFromHash());window.scrollTo(0,0)};window.addEventListener('hashchange',refresh);return()=>window.removeEventListener('hashchange',refresh)},[]);return route}
const navs=[{label:'All widgets',icon:Grid2X2},{label:'Study',icon:BookOpen},{label:'Focus',icon:Leaf},{label:'Play',icon:Gamepad2},{label:'Data',icon:SlidersHorizontal},{label:'Utility',icon:Clock3}]
function navHref(category:string){return category==='All widgets'?'#/':`#/?category=${encodeURIComponent(category)}`}
function Sidebar({active,close}:{active:string;close:()=>void}){
  return <aside className="sidebar"><a href="#/" onClick={close} className="brand"><span className="brand-glyph"><span>✳</span></span><span className="brand-words">widget<span>playground</span></span></a>
    <div className="sidebar-section">DISCOVER</div><nav aria-label="위젯 카테고리">{navs.map(({label,icon:Icon})=><a key={label} onClick={close} className={`nav-item ${active===label?'nav-active':''}`} href={navHref(label)}><Icon size={17}/><span>{label}</span>{label==='All widgets'&&<span className="nav-count">07</span>}</a>)}</nav>
    <div className="sidebar-section sidebar-second">YOUR SPACE</div><a className="nav-item" href="#/widget/daily-word" onClick={close}><Heart size={17}/> Today's pick</a><a className="nav-item" href="#/build/daily-word" onClick={close}><Palette size={17}/> Customize</a>
    <div className="sidebar-spacer"/><div className="sidebar-tip"><div>✦ LITTLE THINGS MATTER</div><strong>Make room for a little joy.</strong><p>당신의 공간을 조금 더 특별하게 만드는 작은 위젯들.</p><span className="tip-stars">✳ ✧ ✿</span></div>
    <div className="sidebar-bottom">MADE WITH <span>♥</span> FOR YOUR NOTION</div>
  </aside>
}
function Header({title,onMenu}:{title:string;onMenu:()=>void}){const [help,setHelp]=useState(false);return <><header className="topbar"><div className="topbar-left"><button className="mobile-menu" onClick={onMenu} aria-label="메뉴 열기"><Menu size={20}/></button><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{title}</strong></div><div className="topbar-right"><span className="version-pill"><span/> v0.4 EMBED BETA</span><button aria-label="노션에 설치하는 방법" className="help-btn" onClick={()=>setHelp(true)}><CircleHelp size={19}/></button></div></header>
    {help&&<div role="presentation" className="modal-backdrop" onClick={()=>setHelp(false)}><section role="dialog" aria-modal="true" aria-label="노션 설치 안내" className="help-dialog" onClick={e=>e.stopPropagation()}><button className="dialog-close" onClick={()=>setHelp(false)} aria-label="닫기"><X size={20}/></button><div className="modal-icon">✳</div><h2>노션에 위젯 넣기</h2><ol><li>마음에 드는 위젯을 고르고 <b>Customize</b>를 눌러요.</li><li>색상과 내용을 설정한 뒤 <b>Copy embed link</b>를 눌러요.</li><li>노션에서 <b>/임베드</b> 블록을 추가하고 링크를 붙여넣어요.</li><li>블록 크기를 조절하면 끝!</li></ol><p>사용 기록은 브라우저별로 저장되며 일부 노션 환경에서는 저장이 제한될 수 있어요.</p><button className="primary-button" onClick={()=>setHelp(false)}>알겠어요 <Check size={16}/></button></section></div>}
  </>}
function Gallery({category}:{category:string}){
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState(category)
  useEffect(()=>setFilter(category),[category])
  const widgets=useMemo(()=>registry.filter(w=>(filter==='All widgets'||w.category===filter)&&(`${w.name} ${w.subtitle} ${w.description} ${w.category}`.toLowerCase().includes(search.toLowerCase()))),[search,filter])
  return <>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-star">✦</span> A LITTLE MAGIC FOR YOUR WORKSPACE</div><h1>Make your space<br/><em>come alive<span>✳</span></em></h1><p>작고 재미있는 위젯들로 나만의 공간을 만들어보세요.<br/>고르고, 꾸미고, 노션에 쏙!</p><button type="button" onClick={()=>document.getElementById('explore')?.scrollIntoView({behavior:'smooth'})} className="hero-button">Explore widgets <ArrowRight size={17}/></button><div className="hero-foot"><span className="avatar-group"><i>✿</i><i>★</i><i>✳</i></span><span>7 little tools, endless possibilities</span></div></div>
    <div className="hero-art" aria-hidden="true"><div className="hero-art-halo"/><div className="hero-sticky sticky-top">✧ make today lovely</div><div className="hero-card hero-card-back"><span>FOCUS GARDEN</span><strong>🪴</strong><small>growing everyday...</small></div><div className="hero-card hero-card-front"><span>DAILY WORD <b>✳</b></span><strong>serendipity</strong><small>뜻밖의 행운을 발견하는 순간</small><div>↗ keep learning</div></div><div className="hero-mini-star star-a">✷</div><div className="hero-mini-star star-b">✿</div></div></section>
    <section className="content-section" id="explore"><div className="section-head"><div><div className="overline">THE COLLECTION</div><h2>Find your little favorite <span>✦</span></h2><p>오늘의 기분과 목적에 딱 맞는 위젯을 찾아보세요.</p></div><div className="widget-total">7 WIDGETS & COUNTING <MoveUpRight size={15}/></div></div>
      <div className="filters"><div className="filter-pills">{['All widgets','Study','Focus','Play','Data','Utility'].map(cat=><button key={cat} className={`filter-pill ${filter===cat?'selected':''}`} onClick={()=>setFilter(cat)}>{cat}</button>)}</div><label className="search-box"><Search size={18}/><input aria-label="위젯 검색" placeholder="Search widgets..." value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="검색 지우기" onClick={()=>setSearch('')}><X size={15}/></button>}</label></div>
      <div className="widget-grid">{widgets.map(w=><a className="widget-tile" key={w.id} href={`#/widget/${w.id}`}><div className={`thumb thumb-${w.accent}`}><span className="thumb-corner">↗</span><WidgetThumbnail id={w.id}/></div><div className="tile-info"><div><div className="tile-name">{w.name} <ArrowRight size={16}/></div><div className="tile-description">{w.subtitle}</div></div><span className="tile-category">{w.category}</span></div></a>)}
      {!widgets.length&&<div className="empty-state">🧩<strong>아직 찾는 위젯이 없어요.</strong><span>다른 검색어나 카테고리를 선택해 보세요.</span></div>}</div>
    </section><section className="bottom-banner"><div className="banner-orbit">✳</div><div><span>MADE FOR CURIOUS MINDS</span><h2>Small widgets,<br/>big personality.</h2><p>당신의 노션에 작은 재미를 더해보세요.</p></div><a href="#/widget/daily-word">Start with today's word <ArrowRight size={16}/></a></section><Footer/>
  </>
}
function Footer(){return <footer className="footer"><span>© 2026 WIDGET PLAYGROUND</span><span>MADE TO MAKE EVERYDAY A LITTLE BRIGHTER ✳</span></footer>}
function Detail({id}:{id:WidgetId}){
  const info=widgetById(id);const config={...defaultConfig,instanceId:`demo-${id}`}
  return <div className="inner-page"><a href="#/" className="back-link"><ArrowLeft size={17}/> Back to explore</a><div className="detail-heading"><div><span className="overline">{info.category.toUpperCase()} / WIDGET Nº {String(registry.indexOf(info)+1).padStart(2,'0')}</span><h1>{info.name}<span className="detail-sparkle">✳</span></h1><p>{info.description}</p></div><a className="primary-button" href={`#/build/${id}`}>Customize widget <ArrowRight size={17}/></a></div>
    <div className="detail-layout"><section className="demo-panel"><div className="panel-heading"><span className="live-dot"/> LIVE PREVIEW <span>직접 클릭해 보세요</span></div><div className="demo-widget"><WidgetRenderer key={id} id={id} config={config}/></div><div className="demo-hint">✦ 위젯은 미리보기 안에서도 작동해요.</div></section>
      <aside className="info-panel"><div className={`detail-icon thumb-${info.accent}`}>{info.emoji}</div><div className="overline">ABOUT THIS WIDGET</div><h2>{info.subtitle}</h2><p>{info.description}</p><div className="info-divider"/><strong className="panel-subtitle">WHAT YOU CAN DO</strong>{info.features.map(f=><div className="feature-row" key={f}><span><Check size={13}/></span>{f}</div>)}<div className="info-divider"/><div className="info-note">✨ 원하는 모습으로 꾸미고 URL 하나로 노션에 임베드할 수 있어요.</div><a className="outline-wide" href={`#/build/${id}`}>Open Widget Builder <SlidersHorizontal size={16}/></a></aside></div><Footer/></div>
}
function labeledChoice(label:string,value:string,opts:{value:string;label:string}[],fn:(v:string)=>void){return <label className="setting-field"><span>{label}</span><select value={value} onChange={e=>fn(e.target.value)}>{opts.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><ChevronDown size={16}/></label>}
function Builder({id,query}:{id:WidgetId;query:string}){
  const info=widgetById(id)
  const [config,setConfig]=useState<WidgetConfig>(()=>{const preset=new URLSearchParams(query).get('config');return preset?configFromPreset(preset):{...defaultConfig,instanceId:newInstanceId()}})
  const [copied,setCopied]=useState(false)
  const [expanded,setExpanded]=useState(true)
  const [copyError,setCopyError]=useState('')
  const [previewMode,setPreviewMode]=useState<'personal'|'template'>('personal')
  const update=<K extends keyof WidgetConfig>(key:K,value:WidgetConfig[K])=>setConfig(c=>sanitizeConfig({...c,[key]:value}))
  const url=embedUrl(id,config,location.origin,location.pathname)
  const templateUrl=templateEmbedUrl(id,config,location.origin,location.pathname)
  const templateConfig=makeTemplateConfig(config)
  async function copy(target:string){try{await navigator.clipboard.writeText(target);setCopied(true);setCopyError('');setTimeout(()=>setCopied(false),2400)}catch{setCopyError('자동 복사가 제한되었습니다. 아래 URL을 직접 복사해 주세요.')}}
  function dataFromLines(s:string):ChartDatum[]{return s.split('\n').slice(0,8).map(line=>{const [label,v]=line.split(',');return {label:(label||'').trim().slice(0,20),value:Number(v)}}).filter(o=>o.label&&Number.isFinite(o.value)&&o.value>=0)}
  return <div className="inner-page builder-page"><a className="back-link" href={`#/widget/${id}`}><ArrowLeft size={17}/> Back to {info.name}</a><div className="builder-header"><div><span className="overline">WIDGET STUDIO / PERSONALIZE</span><h1>Make it yours <span>✳</span></h1><p>원하는 색과 내용으로 꾸미고, 노션에 넣을 링크를 복사하세요.</p></div><a href="#/" className="back-to-gallery">Explore more <ArrowRight size={16}/></a></div>
    <div className="builder-layout"><section className="builder-controls"><div className="control-title"><span className="builder-icon"><Settings2 size={19}/></span><div><strong>{info.name}</strong><small>Widget settings</small></div><button aria-label="설정 접기 또는 펼치기" onClick={()=>setExpanded(v=>!v)}><ChevronDown size={19} style={{transform:expanded?'':'rotate(-90deg)'}}/></button></div>{expanded&&<div className="controls-body">
      <div className="field-group"><strong>LOOK & FEEL <span>01</span></strong><label className="field-label">Color theme</label><div className="theme-picks">{[{id:'cream',name:'Cream',color:'#f5e8d6'},{id:'mint',name:'Mint',color:'#cde9d6'},{id:'dark',name:'Midnight',color:'#34373d'}].map(t=><button aria-pressed={config.theme===t.id} key={t.id} className={`theme-choice ${config.theme===t.id?'theme-on':''}`} onClick={()=>update('theme',t.id as WidgetConfig['theme'])}><span style={{background:t.color}}>{config.theme===t.id&&<Check size={16}/>}</span><small>{t.name}</small></button>)}</div>
      {labeledChoice('Widget spacing',config.density,[{value:'compact',label:'Compact'},{value:'comfort',label:'Comfort'}],v=>update('density',v as WidgetConfig['density']))}<label className="radius-control"><div><span>Round corners</span><small>{config.radius}px</small></div><input type="range" min="0" max="32" step="2" value={config.radius} onChange={e=>update('radius',Number(e.target.value))}/></label></div>
      <div className="field-group"><strong>WIDGET CONTENT <span>02</span></strong>
      {(id==='daily-word'||id==='flashcard')&&labeledChoice('Vocabulary difficulty',config.level,[{value:'easy',label:'Easy · 쉬움'},{value:'medium',label:'Medium · 보통'},{value:'advanced',label:'Advanced · 어려움'}],v=>update('level',v as WidgetConfig['level']))}
      {id==='daily-word'&&<label className="toggle-field"><span>Show example sentence</span><input type="checkbox" checked={config.examples} onChange={e=>update('examples',e.target.checked)}/></label>}
      {id==='focus-garden'&&labeledChoice('Focus session',String(config.timerMinutes),[5,15,25,50].map(n=>({value:String(n),label:`${n} minutes`})),v=>update('timerMinutes',Number(v)))}
      {id==='smart-clock'&&<>{labeledChoice('Display style',config.clockStyle,[{value:'digital',label:'Digital'},{value:'analog',label:'Analog'}],v=>update('clockStyle',v as WidgetConfig['clockStyle']))}<label className="toggle-field"><span>24-hour format</span><input type="checkbox" checked={config.clock24h} onChange={e=>update('clock24h',e.target.checked)}/></label></>}
      {(id==='daily-word'||id==='habit-stamps'||id==='smart-clock')&&labeledChoice('Timezone',config.timezone,['Asia/Seoul','Asia/Tokyo','Europe/Prague','Europe/London','America/New_York','UTC'].map(s=>({value:s,label:s})),v=>update('timezone',v))}
      {id==='mini-charts'&&<><div className="connected-feature">✳ Notion 계정에서 승인한 DB만 읽을 수 있어요. 개인 API 토큰은 필요하지 않습니다.</div>{labeledChoice('Data source',config.chartSource,[{value:'manual',label:'Manual · 수동 입력'},{value:'notion',label:'Notion DB · 개인 연결'}],v=>update('chartSource',v as WidgetConfig['chartSource']))}{labeledChoice('Chart type',config.chartType,[{value:'bar',label:'Bar chart'},{value:'line',label:'Line chart'},{value:'donut',label:'Donut chart'}],v=>update('chartType',v as WidgetConfig['chartType']))}{config.chartSource==='manual'?<label className="multiline-field">Chart data <span>한 줄에 항목,값 형식</span><textarea key={id} rows={6} defaultValue={config.chartData.map(x=>`${x.label},${x.value}`).join('\n')} onChange={e=>{const values=dataFromLines(e.target.value);if(values.length)update('chartData',values)}}/></label>:<ConnectedSettings config={config} update={(v:ConnectedChartConfig)=>update('connected',v)}/>}</>}
      {id==='roulette'&&<label className="multiline-field">Roulette choices <span>줄바꿈으로 구분, 최대 10개</span><textarea key={id} rows={6} defaultValue={config.rouletteOptions.join('\n')} onChange={e=>{const options=e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);if(options.length>=2)update('rouletteOptions',options)}}/></label>}
      {id==='habit-stamps'&&<label className="multiline-field">My daily habits <span>줄바꿈으로 구분, 최대 7개</span><textarea key={id} rows={5} defaultValue={config.habits.join('\n')} onChange={e=>{const items=e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);if(items.length)update('habits',items)}}/></label>}
      </div>
      <div className="field-group embed-settings"><strong>NOTION EMBED <span>03</span></strong>
        {labeledChoice('Embed layout',config.embedLayout,[{value:'compact',label:'Compact · 작은 열'},{value:'standard',label:'Standard · 일반 너비'},{value:'wide',label:'Wide · 넓은 대시보드'}],v=>update('embedLayout',v as WidgetConfig['embedLayout']))}
        <label className="toggle-field"><span>Show widget heading</span><input type="checkbox" checked={config.showTitle} onChange={e=>update('showTitle',e.target.checked)}/></label>
        <label className="toggle-field"><span>Show widget border</span><input type="checkbox" checked={config.showBorder} onChange={e=>update('showBorder',e.target.checked)}/></label>
        <label className="toggle-field"><span>Transparent background</span><input type="checkbox" checked={config.transparentBackground} onChange={e=>update('transparentBackground',e.target.checked)}/></label>
        <label className="toggle-field"><span>Reduce animations</span><input type="checkbox" checked={config.motion==='reduce'} onChange={e=>update('motion',e.target.checked?'reduce':'system')}/></label>
      </div>
      <button className="reset-button" onClick={()=>setConfig(c=>({...defaultConfig,instanceId:c.instanceId}))}>↺ Reset to defaults</button>
    </div>}</section>
    <section className="preview-column"><div className="preview-top"><div><span className="live-dot"/> LIVE NOTION PREVIEW</div><span>YOUR WIDGET</span></div>
    <div className="embed-preview-switch" role="group" aria-label="미리보기 모드"><button type="button" aria-pressed={previewMode==='personal'} className={previewMode==='personal'?'is-active':''} onClick={()=>setPreviewMode('personal')}>내 위젯</button><button type="button" aria-pressed={previewMode==='template'} className={previewMode==='template'?'is-active':''} onClick={()=>setPreviewMode('template')}>템플릿 복제 화면</button></div>
    <div className={`builder-preview-area preview-layout-${config.embedLayout}`}><div className="embed-preview-device"><StoragePersistenceProvider enabled={previewMode!=='template'}><WidgetRenderer key={`${id}:${config.instanceId}:${previewMode}`} id={id} config={previewMode==='template'?templateConfig:config} templateMode={previewMode==='template'}/></StoragePersistenceProvider>{previewMode==='template'&&<div className="preview-template-caption">{config.chartSource==='notion'&&id==='mini-charts'?'DEMO · 구매자의 데이터는 아직 연결되지 않았습니다.':'TEMPLATE MODE · 방문자의 학습 기록은 저장되지 않습니다.'}</div>}</div></div>
    <p className="preview-footnote">실제 노션 임베드의 크기는 노션 블록에서 조절해요. 이 미리보기는 콘텐츠 너비와 동작을 확인하는 용도예요.</p>{id==='mini-charts'&&config.chartSource==='notion'&&<><PublishBox config={config}/><SavedChartsManager/></>}<div className="embed-link-box"><div className="embed-link-head"><div><strong>Ready to embed?</strong><span>일반 사용과 템플릿 복제용 주소를 구분해 주세요.</span></div><div className="link-illustration">↗</div></div>
      {!(id==='mini-charts'&&config.chartSource==='notion')&&<div className="embed-link-type"><strong>내 위젯 링크</strong><p>개인 설정을 담은 일반 링크예요. 브라우저의 기록 저장 정책이 적용됩니다.</p><div className="link-input"><input type="text" value={url} readOnly aria-label="개인 위젯 URL" onFocus={e=>e.target.select()}/><button type="button" onClick={()=>void copy(url)}><Copy size={15}/> Copy</button></div></div>}
      <div className="embed-link-type"><strong>템플릿 복제용 링크 · Recommended</strong><p>제작자 데이터 연결을 제거하고 개인 진행 기록을 저장하지 않아요. 복제한 사람은 언제든 자기 위젯으로 재설정할 수 있어요.</p><div className="link-input"><input type="text" value={templateUrl} readOnly aria-label="템플릿 복제용 임베드 URL" onFocus={e=>e.target.select()}/><button type="button" onClick={()=>void copy(templateUrl)}><Copy size={15}/> {copied?'Copied!':'Copy'}</button></div><a href={templateUrl} target="_blank" rel="noreferrer">템플릿 임베드 화면 보기 <ExternalLink size={14}/></a></div>
      {id==='mini-charts'&&config.chartSource==='notion'&&<p className="embed-private-warning"><strong>Notion DB 연결 안내:</strong> 템플릿 링크에는 샘플 데이터만 포함돼요. 실제 데이터 공개는 아래 '공개 스냅샷' 관리에서 사용자가 직접 승인해야 해요. 비공개 DB 링크는 복제용으로 발급하지 않습니다.</p>}
      {copyError&&<p className="copy-warning" role="alert">{copyError}</p>}
      <div className="embed-install-guide"><strong>노션에 붙여넣기</strong><ol><li>템플릿 복제용 링크 복사</li><li>Notion 페이지에서 <kbd>/임베드</kbd> 입력</li><li>링크 붙여넣기 후 블록 크기 조절</li></ol></div>
    </div></section></div><Footer/></div>
}
function Embed({id,query}:{id:WidgetId;query:string}){
  const params=new URLSearchParams(query)
  const mode=decodeEmbedMode(params)
  const valid=validEmbedConfig(params.get('config'))
  const original=decodeConfig(params.get('config'))
  const config=mode==='template'?makeTemplateConfig(original):original
  const isDemo=mode==='template'&&id==='mini-charts'&&original.chartSource==='notion'
  const customizeUrl=templateEditorUrl(id,config,location.origin,location.pathname)
  useEffect(()=>{document.body.classList.add('embed-body');return()=>document.body.classList.remove('embed-body')},[])
  return <main className={`embed-root embed-layout-${config.embedLayout}`}>
    <StoragePersistenceProvider enabled={mode!=='template'}>
      <div className="embed-surface">{!valid&&<div className="embed-invalid" role="status">설정 링크가 손상되어 기본 위젯을 표시하고 있어요. 새로운 링크를 만들려면 아래 설정 버튼을 눌러 주세요.</div>}<WidgetRenderer id={id} config={config} embedded templateMode={mode==='template'}/>
        {mode==='template'&&<div className="embed-template-toolbar"><span>{isDemo?'예시 데이터 · 내 Notion DB 연결 필요':'무료 위젯 · 복제용 미리보기'}</span><a href={customizeUrl} target="_blank" rel="noopener noreferrer">내 위젯으로 설정 <ExternalLink size={13}/></a></div>}
      </div>
    </StoragePersistenceProvider>
  </main>
}
export default function App(){const route=useRoute();const [menu,setMenu]=useState(false)
  if(route.page==='embed')return <Embed id={route.id} query={route.query}/>
  const title=route.page==='home'?'Explore':route.page==='missing'?'Page not found':route.page==='oauth'?'Notion OAuth':widgetById(route.id).name
  const active=route.page==='home'?route.category:'All widgets'
  return <div className="app-layout"><div className={`sidebar-overlay ${menu?'overlay-on':''}`} onClick={()=>setMenu(false)}/><div className={`sidebar-wrap ${menu?'sidebar-open':''}`}><Sidebar active={active} close={()=>setMenu(false)}/></div><main className="main-area"><Header title={title} onMenu={()=>setMenu(true)}/><div className="page-content">
    {route.page==='home'&&<Gallery category={route.category}/ >}
    {route.page==='oauth'&&<OAuthFinish ticket={route.ticket}/>}
    {route.page==='detail'&&<Detail id={route.id}/>}
    {route.page==='builder'&&<Builder key={`${route.id}:${route.query}`} id={route.id} query={route.query}/>}
    {route.page==='missing'&&<div className="not-found"><WandSparkles size={40}/><h1>이 위젯은 아직 없어요.</h1><a href="#/" className="primary-button">갤러리로 돌아가기 <ArrowRight size={16}/></a></div>}
  </div></main></div>
}
