import { aggregatePages, fieldsFromSchema, parseChartRequest, validateFields } from './aggregate.ts'
import type { ChartRequest } from './aggregate.ts'

export interface Env {
  NOTION_TOKEN:string;
  NOTION_SOURCES_JSON:string;
  ADMIN_ACCESS_KEY:string;
  SESSION_SECRET:string;
  SITE_ORIGIN:string;
}
const NOTION_VERSION='2026-03-11'
const API='https://api.notion.com/v1'
const encoder=new TextEncoder()
const forbidCache={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
function json(data:unknown,status=200,extra?:HeadersInit){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...forbidCache,...extra}})}
function origins(env:Env){return env.SITE_ORIGIN.split(',').map(s=>s.trim()).filter(s=>/^https?:\/\/[^/]+$/.test(s))}
function allowedOrigin(request:Request,env:Env){const origin=request.headers.get('Origin');return !origin||origins(env).includes(origin)}
function cors(response:Response,request:Request,env:Env){const origin=request.headers.get('Origin');if(origin && origins(env).includes(origin)){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin')}return response}
function jsonError(message:string,status:number,extra?:HeadersInit){return json({error:message},status,extra)}
function b64(input:Uint8Array){let s='';for(const n of input)s+=String.fromCharCode(n);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromB64(input:string){const s=atob(input.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-input.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0))}
async function key(secret:string){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function sameSecret(a:string,b:string){
  const [ah,bh]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);
  return new Uint8Array(ah).every((n,i)=>n===new Uint8Array(bh)[i])
}
async function mintSession(env:Env){
  const payload=b64(encoder.encode(JSON.stringify({v:1,exp:Math.floor(Date.now()/1000)+1800,nonce:crypto.randomUUID()})))
  const mac=b64(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env.SESSION_SECRET),encoder.encode(payload))))
  return `${payload}.${mac}`
}
async function authenticated(req:Request,env:Env){
  const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||''
  if(!/^[\w-]{10,600}\.[\w-]{20,200}$/.test(token))return false
  const [payload,mac]=token.split('.')
  try{
    const valid=await crypto.subtle.verify('HMAC',await key(env.SESSION_SECRET),fromB64(mac),encoder.encode(payload))
    if(!valid)return false
    const data=JSON.parse(new TextDecoder().decode(fromB64(payload))) as {v:number;exp:number}
    return data.v===1 && Number.isInteger(data.exp)&&data.exp>Math.floor(Date.now()/1000) && data.exp<Math.floor(Date.now()/1000)+1900
  }catch{return false}
}
function sources(env:Env){
  const raw=JSON.parse(env.NOTION_SOURCES_JSON||'{}') as unknown
  if(!raw || Array.isArray(raw)||typeof raw!=='object')throw new Error('SOURCE_CONFIGURATION')
  const entries=Object.entries(raw as Record<string,unknown>)
  if(entries.length===0||entries.length>20)throw new Error('SOURCE_CONFIGURATION')
  const map=new Map<string,string>()
  for(const [alias,id] of entries){
    if(!/^[a-zA-Z][\w-]{0,39}$/.test(alias)||typeof id!=='string'||!/^[a-fA-F0-9-]{32,36}$/.test(id))throw new Error('SOURCE_CONFIGURATION')
    map.set(alias,id)
  }
  return map
}
async function notion(env:Env,path:string,body?:unknown):Promise<any>{
  const result=await fetch(`${API}${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${env.NOTION_TOKEN}`,'Notion-Version':NOTION_VERSION,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  if(!result.ok){if(result.status===429)throw new HttpError('Notion 요청이 많습니다. 잠시 후 다시 시도해 주세요.',503)
    if(result.status===404 || result.status===403)throw new HttpError('노션 데이터 소스에 대한 접근 권한을 확인해 주세요.',403)
    if(result.status===401)throw new HttpError('Notion 토큰을 확인해 주세요.',502)
    throw new HttpError(`Notion 데이터 조회에 실패했습니다 (${result.status}).`,502)}
  return result.json()
}
class HttpError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status}}
async function readJson(request:Request):Promise<any>{
  const length=Number(request.headers.get('Content-Length')||0)
  if(length>8192)throw new HttpError('요청 데이터가 너무 큽니다.',413)
  const raw=await request.text()
  if(raw.length>8192)throw new HttpError('요청 데이터가 너무 큽니다.',413)
  try{return JSON.parse(raw)}catch{throw new HttpError('JSON 형식이 잘못되었습니다.',400)}
}
function routeSources(pathname:string){const p=pathname.match(/^\/api\/notion\/data-sources\/([a-zA-Z][\w-]{0,39})\/schema$/);return p?.[1]||null}
async function main(req:Request,env:Env):Promise<Response>{
  const {pathname}=new URL(req.url)
  if(pathname==='/api/health'&&req.method==='GET')return json({ok:true,service:'widget-playground-notion',notionVersion:NOTION_VERSION})
  if(!env.NOTION_TOKEN||!env.NOTION_SOURCES_JSON||!env.ADMIN_ACCESS_KEY||env.ADMIN_ACCESS_KEY.length<32||!env.SESSION_SECRET||env.SESSION_SECRET.length<32||!origins(env).length)return jsonError('Worker 환경변수를 설정해 주세요.',503)
  if(pathname==='/api/auth/login'&&req.method==='POST'){
    const body=await readJson(req)
    const supplied=typeof body.key==='string'&&body.key.length<=1024?body.key:''
    if(!supplied || !await sameSecret(supplied,env.ADMIN_ACCESS_KEY))return jsonError('개인 접근 키가 올바르지 않습니다.',401)
    return json({token:await mintSession(env),expiresIn:1800})
  }
  if(!await authenticated(req,env))return jsonError('인증이 필요하거나 세션이 만료되었습니다.',401)
  const map=sources(env)
  if(pathname==='/api/notion/data-sources'&&req.method==='GET'){
    // No search over all shared databases: only explicitly allowlisted sources.
    const entries=await Promise.all([...map.entries()].map(async ([key,id])=>{
      const schema=await notion(env,`/data_sources/${id}`)
      const title=Array.isArray(schema.title)?schema.title.map((t:any)=>t.plain_text||'').join(''):''
      return {key,title:title||key,fieldCount:Object.keys(schema.properties||{}).length}
    }))
    return json({sources:entries})
  }
  const keyName=routeSources(pathname)
  if(keyName && req.method==='GET'){
    const id=map.get(keyName)
    if(!id)return jsonError('등록되지 않은 데이터 소스입니다.',404)
    const schema=await notion(env,`/data_sources/${id}`)
    return json({key:keyName,fields:fieldsFromSchema(schema)})
  }
  if(pathname==='/api/widgets/charts/preview'&&req.method==='POST'){
    let cfg:ChartRequest
    try{cfg=parseChartRequest(await readJson(req))}catch(e){return jsonError((e as Error).message,400)}
    const id=map.get(cfg.sourceKey)
    if(!id)return jsonError('등록되지 않은 데이터 소스입니다.',404)
    const schema=await notion(env,`/data_sources/${id}`)
    try{validateFields(cfg,fieldsFromSchema(schema))}catch(e){return jsonError((e as Error).message,400)}
    // Cap complete pages at 1000. Never show partial aggregates silently.
    const pages:any[]=[]
    let cursor:string|undefined
    const schemaFields=fieldsFromSchema(schema)
    const selectedDate=schemaFields.find(f=>f.id===cfg.dateFieldId)
    const conditions:any[]=[]
    if(selectedDate&&(cfg.dateFrom||cfg.dateTo)){
      for(const [op,value] of [['on_or_after',cfg.dateFrom],['on_or_before',cfg.dateTo]] as const){
        if(!value)continue
        const key=selectedDate.type==='created_time'?'created_time':selectedDate.type==='last_edited_time'?'last_edited_time':'date'
        conditions.push(key==='date'?{property:selectedDate.name,date:{[op]:value}}:{timestamp:key,[key]:{[op]:value}})
      }
    }
    const filter=conditions.length===2?{and:conditions}:conditions[0]
    for(let page=0;page<11;page++){
      const response=await notion(env,`/data_sources/${id}/query`,{page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})})
      if(!Array.isArray(response.results))throw new HttpError('데이터 응답을 해석할 수 없습니다.',502)
      if(response.request_status?.type==='incomplete')throw new HttpError('Notion API의 조회 결과가 잘렸습니다.',422)
      pages.push(...response.results)
      if(pages.length>1000)throw new HttpError('현재 1000개 항목까지만 집계할 수 있습니다. 조회 범위를 줄여 주세요.',422)
      if(!response.has_more)return json({...aggregatePages(pages,cfg),updatedAt:new Date().toISOString()})
      if(!response.next_cursor)throw new HttpError('조회 커서가 누락되었습니다.',502)
      cursor=response.next_cursor
    }
    return jsonError('1000개 항목을 초과하여 집계하지 않았습니다.',422)
  }
  return jsonError('요청 경로가 올바르지 않습니다.',404)
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    if(request.method==='OPTIONS'){
      if(!allowedOrigin(request,env))return jsonError('허용되지 않은 출처입니다.',403)
      return cors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600',...forbidCache}}),request,env)
    }
    if(!allowedOrigin(request,env))return jsonError('허용되지 않은 출처입니다.',403)
    try{return cors(await main(request,env),request,env)}
    catch(error){const status=error instanceof HttpError?error.status:500
      if(!(error instanceof HttpError))console.error('Worker request failed (details omitted)')
      return cors(jsonError(error instanceof HttpError?error.message:'서버 오류가 발생했습니다.',status),request,env)
    }
  }
}
