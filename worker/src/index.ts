import { aggregatePages, fieldsFromSchema, parseChartRequest, validateFields } from './aggregate.ts'
import type { ChartRequest } from './aggregate.ts'
import { decrypt, encrypt, epoch, exchangeNotionToken, randomToken, sha256 } from './oauth.ts'

export interface Env {
  DB: D1Database
  NOTION_CLIENT_ID: string
  NOTION_CLIENT_SECRET: string
  NOTION_REDIRECT_URI: string
  TOKEN_ENCRYPTION_KEY: string
  FRONTEND_URL: string
}
type Connection={id:string;user_id:string;workspace_id:string;workspace_name:string;bot_id:string;access_cipher:string;refresh_cipher:string}
type Source={id:string;user_id:string;connection_id:string;source_id:string;title:string}
type WidgetRow={id:string;user_id:string;source_grant_id:string;title:string;chart_type:string;config_json:string}
type Handoff={id_hash:string;verifier_hash:string;widget_id:string|null;user_id:string|null;expires_at:number;browser_session_hash:string|null;denied:number}
const API='https://api.notion.com/v1'
const NOTION_VERSION='2026-03-11'
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}
class ApiError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status}}
const send=(value:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...noStore,...headers}})
function front(env:Env){const url=new URL(env.FRONTEND_URL);if((url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost'))||url.username||url.password||url.search||url.hash||url.pathname.includes('..'))throw new Error('Invalid FRONTEND_URL');return url}
function checkEnv(env:Env){if(!env.DB||!env.NOTION_CLIENT_ID||!env.NOTION_CLIENT_SECRET||!env.NOTION_REDIRECT_URI||!env.TOKEN_ENCRYPTION_KEY||!env.FRONTEND_URL)return false;return /^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)}
function allowCors(resp:Response,req:Request,env:Env){if(resp.headers.get('Content-Type')?.startsWith('text/html'))return resp;const origin=req.headers.get('Origin');try{if(origin&&origin===front(env).origin){resp.headers.set('Access-Control-Allow-Origin',origin);resp.headers.set('Vary','Origin')}}catch{/* environment not configured yet */}return resp}
function guardOrigin(req:Request,env:Env){const origin=req.headers.get('Origin');if(origin&&origin!==front(env).origin)throw new ApiError('허용되지 않은 출처입니다.',403)}
async function bodyJson(req:Request){if(Number(req.headers.get('Content-Length')||0)>8192)throw new ApiError('요청 크기 초과',413);const str=await req.text();if(str.length>8192)throw new ApiError('요청 크기 초과',413);try{const value=JSON.parse(str);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>}catch{throw new ApiError('JSON 형식 오류')}}
function pathPart(str:string){return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str)}
function sourceKey(id:string){return 'n'+id.replace(/-/g,'').toLowerCase()}
function sourceId(key:string){if(!/^n[a-f0-9]{32}$/.test(key))throw new ApiError('잘못된 데이터 소스 ID');return key.slice(1).replace(/^(.{8})(.{4})(.{4})(.{4})(.*)$/,'$1-$2-$3-$4-$5')}
function redirectAuth(env:Env){const url=front(env);url.hash='/auth/embed/complete';return new Response(null,{status:302,headers:{Location:url.href,...noStore}})}
function cookie(req:Request,name:string){const match=req.headers.get('Cookie')?.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]*)'));return match?.[1]||''}
function oauthCookie(value:string,env:Env){return `wp_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/notion; Max-Age=${value?600:0}${new URL(env.NOTION_REDIRECT_URI).protocol==='https:'?'; Secure':''}`}
function browserCookie(value:string,maxAge:number,env:Env){return `wp_browser=${value}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=${Math.max(0,Math.min(7200,maxAge))}${new URL(env.NOTION_REDIRECT_URI).protocol==='https:'?'; Secure':''}`}
async function browserSession(req:Request,env:Env){
  const raw=cookie(req,'wp_browser')
  if(!/^[a-f0-9]{64}$/.test(raw))return null
  const hash=await sha256(raw)
  const row=await env.DB.prepare('SELECT user_id,expires_at FROM browser_sessions WHERE token_hash=? AND expires_at>unixepoch()').bind(hash).first<{user_id:string;expires_at:number}>()
  return row?{...row,hash,raw}:null
}
const htmlEscapes:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}
function htmlEscape(value:string){return value.replace(/[&<>"']/g,char=>htmlEscapes[char]!)}
async function rateLimit(req:Request,env:Env,scope:string,max:number){
  // Cloudflare sets CF-Connecting-IP; only hashes are stored. Add Cloudflare WAF before public launch.
  const ip=req.headers.get('CF-Connecting-IP')||'local-test'
  const hash=await sha256(`${scope}:${ip}`)
  const now=epoch(),start=now-now%300
  const row=await env.DB.prepare('INSERT INTO rate_windows(key,window_start,request_count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET request_count=CASE WHEN window_start<? THEN 1 ELSE request_count+1 END,window_start=excluded.window_start RETURNING request_count').bind(hash,start,start).first<{request_count:number}>()
  if((row?.request_count||0)>max)throw new ApiError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',429)
}
async function sessionUser(req:Request,env:Env){const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)throw new ApiError('로그인이 필요합니다.',401);const hash=await sha256(token);const row=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>unixepoch() AND (browser_session_hash IS NULL OR EXISTS (SELECT 1 FROM browser_sessions WHERE browser_sessions.token_hash=sessions.browser_session_hash AND browser_sessions.user_id=sessions.user_id AND browser_sessions.expires_at>unixepoch()))').bind(hash).first<{user_id:string}>();if(!row)throw new ApiError('로그인이 만료되었습니다. Notion을 다시 연결해 주세요.',401);return row.user_id}
async function myConnections(env:Env,userId:string){return (await env.DB.prepare('SELECT * FROM connections WHERE user_id=? LIMIT 20').bind(userId).all<Connection>()).results}
async function connection(env:Env,userId:string,id:string){const conn=await env.DB.prepare('SELECT * FROM connections WHERE id=? AND user_id=?').bind(id,userId).first<Connection>();if(!conn)throw new ApiError('연결된 워크스페이스를 찾을 수 없습니다.',404);return conn}
async function notionRaw(token:string,path:string,payload?:unknown){return fetch(`${API}${path}`,{method:payload===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Notion-Version':NOTION_VERSION,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)})})}
async function notion(env:Env,conn:Connection,path:string,payload?:unknown):Promise<any>{
  let response=await notionRaw(await decrypt(conn.access_cipher,env.TOKEN_ENCRYPTION_KEY),path,payload)
  if(response.status===401){
    // Token refresh is authenticated with the server-side OAuth client secret; ciphertext is CAS-updated.
    let updated=conn
    try{
      const fresh=await exchangeNotionToken(env.NOTION_CLIENT_ID,env.NOTION_CLIENT_SECRET,{grant_type:'refresh_token',refresh_token:await decrypt(conn.refresh_cipher,env.TOKEN_ENCRYPTION_KEY)})
      const encAccess=await encrypt(fresh.access_token,env.TOKEN_ENCRYPTION_KEY)
      const encRefresh=await encrypt(fresh.refresh_token,env.TOKEN_ENCRYPTION_KEY)
      await env.DB.prepare('UPDATE connections SET access_cipher=?,refresh_cipher=?,updated_at=? WHERE id=? AND refresh_cipher=?').bind(encAccess,encRefresh,epoch(),conn.id,conn.refresh_cipher).run()
    }catch{/* concurrent refresh may already have rotated the token */}
    updated=await connection(env,conn.user_id,conn.id)
    response=await notionRaw(await decrypt(updated.access_cipher,env.TOKEN_ENCRYPTION_KEY),path,payload)
  }
  if(!response.ok){if(response.status===401)throw new ApiError('Notion 연결이 만료되었습니다. 다시 연결해 주세요.',401);if(response.status===403||response.status===404)throw new ApiError('Notion 페이지의 접근 권한을 확인해 주세요.',403);if(response.status===429)throw new ApiError('Notion 요청 한도에 도달했습니다.',503);throw new ApiError(`Notion API 오류 (${response.status})`,502)}
  return response.json()
}
async function findSource(env:Env,userId:string,key:string){const ds=sourceId(key);const row=await env.DB.prepare('SELECT * FROM source_grants WHERE user_id=? AND source_id=? ORDER BY last_seen DESC LIMIT 1').bind(userId,ds).first<Source>();if(!row)throw new ApiError('본인이 연결한 DB가 아닙니다. 데이터 소스를 다시 불러오세요.',404);return {row,conn:await connection(env,userId,row.connection_id)}}
async function listSources(env:Env,userId:string){
  const found=new Map<string,{key:string;title:string;fieldCount:number;workspace:string}>()
  for(const conn of await myConnections(env,userId)){
    let cursor:string|undefined
    for(let page=0;page<5;page++){
      const info=await notion(env,conn,'/search',{page_size:100,filter:{property:'object',value:'data_source'},...(cursor?{start_cursor:cursor}:{})})
      if(!Array.isArray(info.results))throw new ApiError('Notion 검색 결과 오류',502)
      for(const item of info.results){
        if(item.object!=='data_source'||!pathPart(String(item.id)))continue
        const title=Array.isArray(item.title)?item.title.map((t:any)=>t.plain_text||'').join(''):''
        const key=sourceKey(item.id)
        await env.DB.prepare('INSERT INTO source_grants (id,user_id,connection_id,source_id,title,last_seen) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,connection_id,source_id) DO UPDATE SET title=excluded.title,last_seen=excluded.last_seen').bind(crypto.randomUUID(),userId,conn.id,item.id,title||'Untitled',epoch()).run()
        if(!found.has(key))found.set(key,{key,title:title||'Untitled',fieldCount:Object.keys(item.properties||{}).length,workspace:conn.workspace_name})
      }
      if(!info.has_more)break
      if(!info.next_cursor)throw new ApiError('Notion 검색 커서 오류',502)
      if(page===4)throw new ApiError('DB가 너무 많습니다. 검색 한도를 조정해 주세요.',422)
      cursor=info.next_cursor
    }
  }
  return [...found.values()]
}
async function chartAggregate(env:Env,userId:string,requested:unknown){
  let cfg:ChartRequest
  try{cfg=parseChartRequest(requested)}catch(err){throw new ApiError((err as Error).message)}
  const {row,conn}=await findSource(env,userId,cfg.sourceKey)
  const schema=await notion(env,conn,`/data_sources/${row.source_id}`)
  const fields=fieldsFromSchema(schema)
  try{validateFields(cfg,fields)}catch(err){throw new ApiError((err as Error).message)}
  const date=fields.find(f=>f.id===cfg.dateFieldId)
  const conditions:any[]=[]
  if(date&&(cfg.dateFrom||cfg.dateTo)){
    const fieldType=date.type==='created_time'?'created_time':date.type==='last_edited_time'?'last_edited_time':'date'
    for(const [op,v] of [['on_or_after',cfg.dateFrom],['on_or_before',cfg.dateTo]] as const){if(!v)continue;conditions.push(fieldType==='date'?{property:date.name,date:{[op]:v}}:{timestamp:fieldType,[fieldType]:{[op]:v}})}
  }
  const filter=conditions.length===2?{and:conditions}:conditions[0]
  const pages:any[]=[]
  let cursor:string|undefined
  for(let iteration=0;iteration<11;iteration++){
    const data=await notion(env,conn,`/data_sources/${row.source_id}/query`,{page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})})
    if(!Array.isArray(data.results))throw new ApiError('Notion 조회 결과 오류',502)
    pages.push(...data.results)
    if(pages.length>1000)throw new ApiError('집계 항목 1,000개 초과: 기간을 줄여 주세요.',422)
    if(!data.has_more){
      try{return {source:row,config:cfg,result:{...aggregatePages(pages,cfg),updatedAt:new Date().toISOString()}}}
      catch(err){throw new ApiError((err as Error).message,422)}
    }
    if(!data.next_cursor)throw new ApiError('Notion 조회 커서 오류',502)
    cursor=data.next_cursor
  }
  throw new ApiError('집계 항목이 너무 많습니다.',422)
}
async function widgetOwner(env:Env,userId:string,id:string){if(!pathPart(id))throw new ApiError('위젯 ID 오류');const row=await env.DB.prepare('SELECT * FROM widgets WHERE id=? AND user_id=?').bind(id,userId).first<WidgetRow>();if(!row)throw new ApiError('소유한 위젯이 아닙니다.',404);return row}
async function main(req:Request,env:Env){
  const url=new URL(req.url),path=url.pathname
  if(path==='/api/health'&&req.method==='GET')return send({ok:true,version:'0.3',notionVersion:NOTION_VERSION})
  if(!checkEnv(env))throw new ApiError('OAuth/D1 환경변수가 설정되지 않았습니다.',503)
  if(path==='/api/auth/notion/start'&&req.method==='GET'){
    await rateLimit(req,env,'oauth-start',12)
    const handoff=url.searchParams.get('handoff')
    if(!handoff||!/^[a-f0-9]{64}$/.test(handoff))throw new ApiError('로그인 요청이 잘못되었습니다.',401)
    const handoffId=await sha256(handoff)
    const record=await env.DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0').bind(handoffId).first<Handoff>()
    if(!record)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    if(url.searchParams.get('reuse')==='1'){
      const browser=await browserSession(req,env)
      if(browser){
        if(record.widget_id&&!await env.DB.prepare('SELECT id FROM widgets WHERE id=? AND user_id=?').bind(record.widget_id,browser.user_id).first()){
          await env.DB.prepare('UPDATE oauth_embed_handoffs SET denied=1 WHERE id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0 AND widget_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM widgets WHERE widgets.id=oauth_embed_handoffs.widget_id AND widgets.user_id=?) AND EXISTS (SELECT 1 FROM browser_sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch())').bind(handoffId,browser.user_id,browser.hash,browser.user_id).run()
          throw new ApiError('이 위젯의 소유자로 로그인해 주세요.',403)
        }
        const csrf=await sha256(browser.raw+':'+handoff)
        // no-referrer makes browser form POST Origin null; same-origin preserves the consent check without external URL leakage.
        return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>기존 인증 연결</title><body><h1>기존 인증 연결</h1><p>이 브라우저의 기존 Notion 인증으로 연결합니다. Notion 승인은 다시 필요하지 않습니다.</p><form method="post" action="/api/auth/notion/reuse"><input type="hidden" name="handoff" value="${htmlEscape(handoff)}"><input type="hidden" name="csrf" value="${htmlEscape(csrf)}"><button type="submit">기존 인증 연결</button></form></body></html>`,{headers:{...noStore,'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}})
      }
    }
    const state=randomToken()
    await env.DB.prepare('INSERT INTO oauth_states(state_hash,expires_at,handoff_id) VALUES (?,?,?)').bind(await sha256(state),epoch()+600,handoffId).run()
    const auth=new URL('https://api.notion.com/v1/oauth/authorize')
    auth.searchParams.set('client_id',env.NOTION_CLIENT_ID)
    auth.searchParams.set('response_type','code')
    auth.searchParams.set('owner','user')
    auth.searchParams.set('redirect_uri',env.NOTION_REDIRECT_URI)
    auth.searchParams.set('state',state)
    return new Response(null,{status:302,headers:{Location:auth.href,'Set-Cookie':oauthCookie(state,env),...noStore}})
  }
  if(path==='/api/auth/notion/reuse'&&req.method==='POST'){
    if(req.headers.get('Origin')!==url.origin)throw new ApiError('허용되지 않은 출처입니다.',403)
    await rateLimit(req,env,'oauth-reuse',12)
    if(req.headers.get('Content-Type')?.split(';')[0].trim()!=='application/x-www-form-urlencoded')throw new ApiError('로그인 요청이 잘못되었습니다.')
    if(Number(req.headers.get('Content-Length')||0)>8192)throw new ApiError('요청 크기 초과',413)
    const text=await req.text()
    if(text.length>8192)throw new ApiError('요청 크기 초과',413)
    const form=new URLSearchParams(text),handoff=form.get('handoff'),csrf=form.get('csrf')
    if(!handoff||!/^[a-f0-9]{64}$/.test(handoff))throw new ApiError('로그인 요청이 잘못되었습니다.',401)
    const browser=await browserSession(req,env)
    if(!browser)throw new ApiError('로그인이 만료되었습니다. Notion을 다시 연결해 주세요.',401)
    if(csrf!==await sha256(browser.raw+':'+handoff))throw new ApiError('로그인 요청 검증 실패',403)
    const idHash=await sha256(handoff)
    const record=await env.DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0').bind(idHash).first<Handoff>()
    if(!record)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    if(record.widget_id&&!await env.DB.prepare('SELECT id FROM widgets WHERE id=? AND user_id=?').bind(record.widget_id,browser.user_id).first())throw new ApiError('이 위젯의 소유자로 로그인해 주세요.',403)
    const completed=await env.DB.prepare('UPDATE oauth_embed_handoffs SET user_id=?,browser_session_hash=? WHERE id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0 AND (widget_id IS NULL OR EXISTS (SELECT 1 FROM widgets WHERE widgets.id=oauth_embed_handoffs.widget_id AND widgets.user_id=?)) AND EXISTS (SELECT 1 FROM browser_sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch()) RETURNING id_hash').bind(browser.user_id,browser.hash,idHash,browser.user_id,browser.hash,browser.user_id).first()
    if(!completed)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    return redirectAuth(env)
  }
  if(path==='/api/auth/notion/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state')||''
    const stateCookie=cookie(req,'wp_oauth')
    if(!/^[a-f0-9]{64}$/.test(state)||state!==stateCookie)throw new ApiError('OAuth state 검증 실패',403)
    const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>unixepoch() RETURNING handoff_id').bind(await sha256(state)).first<{handoff_id:string|null}>()
    if(!row)throw new ApiError('이미 사용했거나 만료된 로그인 시도입니다.',403)
    const handoff=row.handoff_id?await env.DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0').bind(row.handoff_id).first<Handoff>():null
    if(!handoff)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    if(url.searchParams.get('error'))throw new ApiError('Notion 연결이 취소되었습니다.',400)
    const code=url.searchParams.get('code')||''
    if(!code||code.length>512)throw new ApiError('Notion 인증 코드가 없습니다.')
    const token=await exchangeNotionToken(env.NOTION_CLIENT_ID,env.NOTION_CLIENT_SECRET,{grant_type:'authorization_code',code,redirect_uri:env.NOTION_REDIRECT_URI})
    const userId=token.owner?.type==='user'?token.owner.user?.id:''
    if(!userId)throw new ApiError('Notion 사용자를 확인할 수 없습니다.',400)
    const browserToken=randomToken(),browserHash=await sha256(browserToken)
    const access=await encrypt(token.access_token,env.TOKEN_ENCRYPTION_KEY),refresh=await encrypt(token.refresh_token,env.TOKEN_ENCRYPTION_KEY)
    const pending='id_hash=? AND expires_at>unixepoch() AND user_id IS NULL AND denied=0'
    const linked='id_hash=? AND user_id=? AND browser_session_hash=? AND denied=0'
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(id,created_at) SELECT ?,unixepoch() WHERE EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE ${pending}) ON CONFLICT(id) DO NOTHING`).bind(userId,handoff.id_hash),
      env.DB.prepare(`INSERT INTO browser_sessions(token_hash,user_id,expires_at) SELECT ?,?,unixepoch()+7200 WHERE EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE ${pending})`).bind(browserHash,userId,handoff.id_hash),
      env.DB.prepare(`UPDATE oauth_embed_handoffs SET user_id=?,browser_session_hash=? WHERE ${pending} AND EXISTS (SELECT 1 FROM browser_sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch()) RETURNING id_hash`).bind(userId,browserHash,handoff.id_hash,browserHash,userId),
      env.DB.prepare(`DELETE FROM browser_sessions WHERE token_hash=? AND (expires_at<=unixepoch() OR NOT EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE ${linked}))`).bind(browserHash,handoff.id_hash,userId,browserHash),
      env.DB.prepare(`INSERT INTO connections(id,user_id,workspace_id,workspace_name,bot_id,access_cipher,refresh_cipher,updated_at) SELECT ?,?,?,?,?,?,?,unixepoch() FROM browser_sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch() AND EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE ${linked}) ON CONFLICT(user_id,workspace_id) DO UPDATE SET workspace_name=excluded.workspace_name,bot_id=excluded.bot_id,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,updated_at=excluded.updated_at`).bind(crypto.randomUUID(),userId,token.workspace_id,token.workspace_name||'Notion Workspace',token.bot_id,access,refresh,browserHash,userId,handoff.id_hash,userId,browserHash),
      env.DB.prepare(`SELECT expires_at-unixepoch() AS remaining FROM browser_sessions WHERE token_hash=? AND user_id=? AND expires_at>unixepoch() AND EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE ${linked})`).bind(browserHash,userId,handoff.id_hash,userId,browserHash),
    ])
    const browser=results[5].results[0] as {remaining:number}|undefined
    if(!results[2].results.length||!browser)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    const response=redirectAuth(env)
    response.headers.append('Set-Cookie',oauthCookie('',env))
    response.headers.append('Set-Cookie',browserCookie(browserToken,browser.remaining,env))
    return response
  }
  guardOrigin(req,env)
  if(path==='/api/auth/embed'&&req.method==='POST'){
    await rateLimit(req,env,'embed-start',12)
    const {verifierHash,widgetId,reuse}=await bodyJson(req)
    if(typeof verifierHash!=='string'||!/^[a-f0-9]{64}$/.test(verifierHash))throw new ApiError('로그인 검증 값이 잘못되었습니다.')
    if(widgetId!==undefined&&(typeof widgetId!=='string'||!pathPart(widgetId)))throw new ApiError('위젯 ID 오류')
    if(reuse!==undefined&&typeof reuse!=='boolean')throw new ApiError('로그인 요청이 잘못되었습니다.')
    const id=randomToken()
    await env.DB.prepare('INSERT INTO oauth_embed_handoffs(id_hash,verifier_hash,widget_id,expires_at) VALUES (?,?,?,?)').bind(await sha256(id),verifierHash,typeof widgetId==='string'?widgetId:null,epoch()+600).run()
    const authUrl=new URL('/api/auth/notion/start',url.origin)
    authUrl.searchParams.set('handoff',id)
    if(reuse===true)authUrl.searchParams.set('reuse','1')
    return send({id,authUrl:authUrl.href})
  }
  if(path==='/api/auth/embed/claim'&&req.method==='POST'){
    await rateLimit(req,env,'embed-claim',180)
    const {id,verifier}=await bodyJson(req)
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)||typeof verifier!=='string'||!/^[a-f0-9]{64}$/.test(verifier))throw new ApiError('로그인 요청이 잘못되었습니다.',401)
    const idHash=await sha256(id),verifierHash=await sha256(verifier)
    const record=await env.DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=? AND verifier_hash=? AND expires_at>unixepoch()').bind(idHash,verifierHash).first<Handoff>()
    if(!record)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    if(record.denied)throw new ApiError('이 위젯의 소유자로 로그인해 주세요.',403)
    if(!record.user_id)return send({pending:true},202)
    if(record.widget_id&&!await env.DB.prepare('SELECT id FROM widgets WHERE id=? AND user_id=?').bind(record.widget_id,record.user_id).first())throw new ApiError('이 위젯의 소유자로 로그인해 주세요.',403)
    const token=randomToken(),tokenHash=await sha256(token)
    const eligible='id_hash=? AND verifier_hash=? AND user_id=? AND browser_session_hash IS ? AND denied=0 AND (widget_id IS NULL OR EXISTS (SELECT 1 FROM widgets WHERE widgets.id=oauth_embed_handoffs.widget_id AND widgets.user_id=oauth_embed_handoffs.user_id))'
    const handoffParent='(oauth_embed_handoffs.browser_session_hash IS NULL OR EXISTS (SELECT 1 FROM browser_sessions WHERE browser_sessions.token_hash=oauth_embed_handoffs.browser_session_hash AND browser_sessions.user_id=oauth_embed_handoffs.user_id AND browser_sessions.expires_at>unixepoch()))'
    const sessionParent='(sessions.browser_session_hash IS NULL OR EXISTS (SELECT 1 FROM browser_sessions WHERE browser_sessions.token_hash=sessions.browser_session_hash AND browser_sessions.user_id=sessions.user_id AND browser_sessions.expires_at>unixepoch()))'
    // Consume only this transaction's new session; a parent expiry/revocation must also cancel issuance.
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,browser_session_hash) SELECT ?,user_id,CASE WHEN browser_session_hash IS NULL THEN unixepoch()+7200 ELSE MIN(unixepoch()+7200,(SELECT expires_at FROM browser_sessions WHERE token_hash=oauth_embed_handoffs.browser_session_hash)) END,browser_session_hash FROM oauth_embed_handoffs WHERE ${eligible} AND expires_at>unixepoch() AND ${handoffParent}`).bind(tokenHash,idHash,verifierHash,record.user_id,record.browser_session_hash),
      env.DB.prepare(`DELETE FROM oauth_embed_handoffs WHERE ${eligible} AND ${handoffParent} AND EXISTS (SELECT 1 FROM sessions WHERE token_hash=? AND user_id=oauth_embed_handoffs.user_id AND browser_session_hash IS oauth_embed_handoffs.browser_session_hash) RETURNING user_id`).bind(idHash,verifierHash,record.user_id,record.browser_session_hash,tokenHash),
      env.DB.prepare(`DELETE FROM sessions WHERE token_hash=? AND (EXISTS (SELECT 1 FROM oauth_embed_handoffs WHERE id_hash=?) OR expires_at<=unixepoch() OR NOT ${sessionParent} OR (? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM widgets WHERE id=? AND user_id=sessions.user_id)))`).bind(tokenHash,idHash,record.widget_id,record.widget_id),
      env.DB.prepare(`SELECT expires_at-unixepoch() AS remaining FROM sessions WHERE token_hash=? AND expires_at>unixepoch() AND ${sessionParent} AND (? IS NULL OR EXISTS (SELECT 1 FROM widgets WHERE id=? AND user_id=sessions.user_id))`).bind(tokenHash,record.widget_id,record.widget_id),
    ])
    const issued=results[3].results[0] as {remaining:number}|undefined
    if(!results[1].results.length||!issued)throw new ApiError('로그인 요청이 만료되었거나 사용되었습니다.',401)
    return send({token,expiresIn:Math.min(7200,issued.remaining)})
  }
  const userId=await sessionUser(req,env)
  if(path==='/api/auth/logout'&&req.method==='POST'){
    const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||''
    const hash=await sha256(token)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>? AND browser_session_hash=(SELECT browser_session_hash FROM sessions WHERE token_hash=? AND user_id=?)').bind(userId,hash,hash,userId),
      env.DB.prepare('DELETE FROM browser_sessions WHERE token_hash=(SELECT browser_session_hash FROM sessions WHERE token_hash=? AND user_id=?) AND user_id=?').bind(hash,userId,userId),
      env.DB.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').bind(hash,userId),
    ])
    return send({ok:true},200,{'Set-Cookie':browserCookie('',0,env)})
  }
  if(path==='/api/me'&&req.method==='GET'){
    const entries=await myConnections(env,userId)
    return send({userId,workspaces:entries.map(c=>({id:c.id,name:c.workspace_name}))})
  }
  if(path==='/api/notion/connections'&&req.method==='GET')return send({connections:(await myConnections(env,userId)).map(c=>({id:c.id,name:c.workspace_name}))})
  if(path==='/api/notion/disconnect'&&req.method==='POST'){
    const id=(await bodyJson(req)).connectionId
    if(typeof id!=='string')throw new ApiError('연결 ID 오류')
    await connection(env,userId,id)
    await env.DB.prepare('DELETE FROM connections WHERE id=? AND user_id=?').bind(id,userId).run()
    return send({ok:true,notice:'서버에 저장된 연결 정보를 제거했습니다. Notion에서도 연결을 해제할 수 있습니다.'})
  }
  if(path==='/api/notion/data-sources'&&req.method==='GET')return send({sources:await listSources(env,userId)})
  const schema=path.match(/^\/api\/notion\/data-sources\/(n[a-f0-9]{32})\/schema$/)
  if(schema&&req.method==='GET'){
    const {row,conn}=await findSource(env,userId,schema[1])
    return send({key:schema[1],fields:fieldsFromSchema(await notion(env,conn,`/data_sources/${row.source_id}`))})
  }
  if(path==='/api/widgets/charts/preview'&&req.method==='POST')return send((await chartAggregate(env,userId,await bodyJson(req))).result)
  if(path==='/api/widgets'&&req.method==='GET'){
    const rows=(await env.DB.prepare('SELECT id,title,visibility,chart_type,updated_at FROM widgets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100').bind(userId).all()).results
    return send({widgets:rows})
  }
  if(path==='/api/widgets'&&req.method==='POST'){
    const raw=await bodyJson(req),type=raw.chartType,title=raw.title
    if(!['bar','line','donut'].includes(String(type)))throw new ApiError('차트 유형이 올바르지 않습니다.')
    const {source,config}=await chartAggregate(env,userId,raw.config)
    const id=crypto.randomUUID()
    await env.DB.prepare('INSERT INTO widgets(id,user_id,source_grant_id,title,chart_type,config_json,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,userId,source.id,typeof title==='string'?title.slice(0,80):'My Notion chart',type,JSON.stringify(config),'private',epoch(),epoch()).run()
    return send({id,visibility:'private'},201)
  }
  const saved=path.match(/^\/api\/widgets\/([^/]+)$/)
  if(saved&&req.method==='GET'){
    const row=await widgetOwner(env,userId,saved[1])
    const {result}=await chartAggregate(env,userId,JSON.parse(row.config_json))
    return send({title:row.title,chartType:row.chart_type,result})
  }
  return send({error:'찾을 수 없는 API입니다.'},404)
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
  if(req.method==='OPTIONS'){
    try{guardOrigin(req,env);return allowCors(new Response(null,{status:204,headers:{...noStore,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Max-Age':'600'}}),req,env)}catch{return send({error:'허용되지 않은 출처입니다.'},403)}
  }
  try{return allowCors(await main(req,env),req,env)}
  catch(err){const known=err instanceof ApiError;if(!known)console.error('Unexpected Worker error (message/redacted)');return allowCors(send({error:known?err.message:'서버 오류가 발생했습니다.'},known?err.status:500),req,env)}
}}
