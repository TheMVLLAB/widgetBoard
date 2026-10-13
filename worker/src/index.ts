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
type WidgetRow={id:string;user_id:string;source_grant_id:string;title:string;chart_type:string;config_json:string;visibility:string}
const API='https://api.notion.com/v1'
const NOTION_VERSION='2026-03-11'
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}
class ApiError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status}}
const send=(value:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...noStore,...headers}})
function front(env:Env){const url=new URL(env.FRONTEND_URL);if((url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='localhost'))||url.username||url.password||url.search||url.hash||url.pathname.includes('..'))throw new Error('Invalid FRONTEND_URL');return url}
function checkEnv(env:Env){if(!env.DB||!env.NOTION_CLIENT_ID||!env.NOTION_CLIENT_SECRET||!env.NOTION_REDIRECT_URI||!env.TOKEN_ENCRYPTION_KEY||!env.FRONTEND_URL)return false;return /^[a-f0-9]{64}$/i.test(env.TOKEN_ENCRYPTION_KEY)}
function allowCors(resp:Response,req:Request,env:Env){const origin=req.headers.get('Origin');try{if(origin&&origin===front(env).origin){resp.headers.set('Access-Control-Allow-Origin',origin);resp.headers.set('Vary','Origin')}}catch{/* environment not configured yet */}return resp}
function guardOrigin(req:Request,env:Env){const origin=req.headers.get('Origin');if(origin&&origin!==front(env).origin)throw new ApiError('허용되지 않은 출처입니다.',403)}
async function bodyJson(req:Request){if(Number(req.headers.get('Content-Length')||0)>8192)throw new ApiError('요청 크기 초과',413);const str=await req.text();if(str.length>8192)throw new ApiError('요청 크기 초과',413);try{return JSON.parse(str) as Record<string,unknown>}catch{throw new ApiError('JSON 형식 오류')}}
function pathPart(str:string){return /^[a-f0-9-]{36}$/i.test(str)}
function sourceKey(id:string){return 'n'+id.replace(/-/g,'').toLowerCase()}
function sourceId(key:string){if(!/^n[a-f0-9]{32}$/.test(key))throw new ApiError('잘못된 데이터 소스 ID');return key.slice(1).replace(/^(.{8})(.{4})(.{4})(.{4})(.*)$/,'$1-$2-$3-$4-$5')}
function redirectAuth(env:Env,ticket:string){const url=front(env);url.hash=`/auth/complete?ticket=${encodeURIComponent(ticket)}`;return new Response(null,{status:302,headers:{Location:url.href,...noStore}})}
function cookie(req:Request,name:string){const match=req.headers.get('Cookie')?.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]*)'));return match?.[1]||''}
function oauthCookie(value:string,env:Env){return `wp_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/notion; Max-Age=${value?600:0}${new URL(env.NOTION_REDIRECT_URI).protocol==='https:'?'; Secure':''}`}
async function rateLimit(req:Request,env:Env,scope:string,max:number){
  // Cloudflare sets CF-Connecting-IP; only hashes are stored. Add Cloudflare WAF before public launch.
  const ip=req.headers.get('CF-Connecting-IP')||'local-test'
  const hash=await sha256(`${scope}:${ip}`)
  const now=epoch(),start=now-now%300
  const row=await env.DB.prepare('INSERT INTO rate_windows(key,window_start,request_count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET request_count=CASE WHEN window_start<? THEN 1 ELSE request_count+1 END,window_start=excluded.window_start RETURNING request_count').bind(hash,start,start).first<{request_count:number}>()
  if((row?.request_count||0)>max)throw new ApiError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',429)
}
async function sessionUser(req:Request,env:Env){const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)throw new ApiError('로그인이 필요합니다.',401);const hash=await sha256(token);const row=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash,epoch()).first<{user_id:string}>();if(!row)throw new ApiError('로그인이 만료되었습니다. Notion을 다시 연결해 주세요.',401);return row.user_id}
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
    const state=randomToken()
    await env.DB.prepare('INSERT INTO oauth_states(state_hash,expires_at) VALUES (?,?)').bind(await sha256(state),epoch()+600).run()
    const auth=new URL('https://api.notion.com/v1/oauth/authorize')
    auth.searchParams.set('client_id',env.NOTION_CLIENT_ID)
    auth.searchParams.set('response_type','code')
    auth.searchParams.set('owner','user')
    auth.searchParams.set('redirect_uri',env.NOTION_REDIRECT_URI)
    auth.searchParams.set('state',state)
    return new Response(null,{status:302,headers:{Location:auth.href,'Set-Cookie':oauthCookie(state,env),...noStore}})
  }
  if(path==='/api/auth/notion/callback'&&req.method==='GET'){
    const state=url.searchParams.get('state')||''
    const stateCookie=cookie(req,'wp_oauth')
    if(!/^[a-f0-9]{64}$/.test(state)||state!==stateCookie)throw new ApiError('OAuth state 검증 실패',403)
    const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash').bind(await sha256(state),epoch()).first()
    if(!row)throw new ApiError('이미 사용했거나 만료된 로그인 시도입니다.',403)
    if(url.searchParams.get('error'))throw new ApiError('Notion 연결이 취소되었습니다.',400)
    const code=url.searchParams.get('code')||''
    if(!code||code.length>512)throw new ApiError('Notion 인증 코드가 없습니다.')
    const token=await exchangeNotionToken(env.NOTION_CLIENT_ID,env.NOTION_CLIENT_SECRET,{grant_type:'authorization_code',code,redirect_uri:env.NOTION_REDIRECT_URI})
    const userId=token.owner?.type==='user'?token.owner.user?.id:''
    if(!userId)throw new ApiError('Notion 사용자를 확인할 수 없습니다.',400)
    const old=await env.DB.prepare('SELECT id FROM connections WHERE user_id=? AND workspace_id=?').bind(userId,token.workspace_id).first<{id:string}>()
    await env.DB.prepare('INSERT INTO users (id,created_at) VALUES (?,?) ON CONFLICT(id) DO NOTHING').bind(userId,epoch()).run()
    await env.DB.prepare('INSERT INTO connections (id,user_id,workspace_id,workspace_name,bot_id,access_cipher,refresh_cipher,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,workspace_id) DO UPDATE SET workspace_name=excluded.workspace_name,bot_id=excluded.bot_id,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,updated_at=excluded.updated_at').bind(old?.id||crypto.randomUUID(),userId,token.workspace_id,token.workspace_name||'Notion Workspace',token.bot_id,await encrypt(token.access_token,env.TOKEN_ENCRYPTION_KEY),await encrypt(token.refresh_token,env.TOKEN_ENCRYPTION_KEY),epoch()).run()
    const ticket=randomToken()
    await env.DB.prepare('INSERT INTO auth_tickets (ticket_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(ticket),userId,epoch()+90).run()
    const response=redirectAuth(env,ticket)
    response.headers.set('Set-Cookie',oauthCookie('',env))
    return response
  }
  guardOrigin(req,env)
  if(path==='/api/auth/ticket'&&req.method==='POST'){
    await rateLimit(req,env,'ticket',30)
    const value=(await bodyJson(req)).ticket
    if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new ApiError('인증 코드가 잘못되었습니다.',401)
    const record=await env.DB.prepare('DELETE FROM auth_tickets WHERE ticket_hash=? AND expires_at>? RETURNING user_id').bind(await sha256(value),epoch()).first<{user_id:string}>()
    if(!record)throw new ApiError('인증 코드가 만료되었거나 사용되었습니다.',401)
    const token=randomToken()
    await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha256(token),record.user_id,epoch()+7200).run()
    return send({token,expiresIn:7200})
  }
  if(path.startsWith('/api/public/widgets/')&&req.method==='GET'){
    const id=path.split('/').pop()||''
    if(!pathPart(id))throw new ApiError('위젯을 찾을 수 없습니다.',404)
    const row=await env.DB.prepare("SELECT * FROM widgets WHERE id=? AND visibility='public'").bind(id).first<WidgetRow>()
    if(!row)throw new ApiError('비공개이거나 해제된 위젯입니다.',404)
    await rateLimit(req,env,'public-chart',60)
    const {result}=await chartAggregate(env,row.user_id,JSON.parse(row.config_json))
    const stillPublic=await env.DB.prepare("SELECT id FROM widgets WHERE id=? AND visibility='public'").bind(id).first()
    if(!stillPublic)throw new ApiError('공유가 해제된 위젯입니다.',404)
    return send({title:row.title,chartType:row.chart_type,...result})
  }
  const userId=await sessionUser(req,env)
  if(path==='/api/auth/logout'&&req.method==='POST'){
    const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||''
    if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=? AND user_id=?').bind(await sha256(token),userId).run()
    return send({ok:true})
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
  const pub=path.match(/^\/api\/widgets\/([a-f0-9-]{36})\/publish$/i)
  if(pub&&req.method==='POST'){
    const row=await widgetOwner(env,userId,pub[1]);const payload=await bodyJson(req)
    if(payload.confirm!=='PUBLISH_LIVE_AGGREGATES')throw new ApiError('최신 집계값의 지속적인 공개에 명시적으로 동의해야 합니다.')
    const {result}=await chartAggregate(env,userId,JSON.parse(row.config_json))
    await env.DB.prepare("UPDATE widgets SET visibility='public',updated_at=? WHERE id=? AND user_id=?").bind(epoch(),row.id,userId).run()
    return send({id:row.id,visibility:'public',recordCount:result.recordCount,notice:'Notion DB 변경 이후의 최신 수치와 그룹 이름도 링크를 가진 누구에게나 표시됩니다.'})
  }
  const unpub=path.match(/^\/api\/widgets\/([a-f0-9-]{36})\/unpublish$/i)
  if(unpub&&req.method==='POST'){
    const row=await widgetOwner(env,userId,unpub[1])
    await env.DB.prepare("UPDATE widgets SET visibility='private',updated_at=? WHERE id=? AND user_id=?").bind(epoch(),row.id,userId).run()
    return send({ok:true,visibility:'private'})
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
