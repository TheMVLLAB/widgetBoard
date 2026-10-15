import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import worker from '../src/index.ts'
import {encrypt,decrypt,randomToken,sha256} from '../src/oauth.ts'

const origin='https://example.github.io'
const notionSource='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const cfg={sourceKey:'n'+notionSource.replaceAll('-',''),dateFieldId:'date',valueFieldId:'money',categoryFieldId:'',groupBy:'month',aggregate:'sum',dateFrom:'2026-10-01',dateTo:'2026-10-31'}
function database(){
  const sqlite=new DatabaseSync(':memory:')
  const migrations=new URL('../migrations/',import.meta.url)
  for(const file of readdirSync(migrations).filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,migrations),'utf8'))
  const db={
    clock:Math.floor(Date.now()/1000),beforeBatch:null,afterStatement:null,beforeQuery:null,
    prepare(sql){
      const stmt=sqlite.prepare(sql)
      let args=[]
      return {bind(...items){args=items;return this},async first(){await db.beforeQuery?.(sql,args);return stmt.get(...args)??null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)},execute(){return {results:stmt.all(...args)}}}
    },
    async batch(statements){
      if(db.beforeBatch)await db.beforeBatch()
      sqlite.exec('BEGIN')
      try{
        const results=statements.map((stmt,index)=>{const result=stmt.execute();db.afterStatement?.(index);return result})
        sqlite.exec('COMMIT')
        return results
      }catch(error){sqlite.exec('ROLLBACK');throw error}
    },
    close(){sqlite.close()}
  }
  sqlite.function('unixepoch',()=>db.clock)
  return db
}
const mockEnv=db=>({DB:db,NOTION_CLIENT_ID:'client-1',NOTION_CLIENT_SECRET:'secret-1',NOTION_REDIRECT_URI:'https://worker.example/api/auth/notion/callback',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),FRONTEND_URL:'https://example.github.io/widget-playground/'})
const req=(path,method='GET',body,token,headers={})=>new Request('https://worker.example'+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},...(body?{body:JSON.stringify(body)}:{})})
function notionMock(){
  const saved=globalThis.fetch
  const mock={calls:[],value:42,beforeToken:null,restore(){globalThis.fetch=saved}}
  globalThis.fetch=async (uri,options={})=>{
    const url=String(uri);mock.calls.push({url,options})
    assert.ok(url.startsWith('https://api.notion.com/v1/'))
    if(url.endsWith('/oauth/token')){
      const body=JSON.parse(options.body)
      await mock.beforeToken?.(body)
      const isSecond=body.code==='user-B'
      assert.equal(options.headers.Authorization,`Basic ${btoa('client-1:secret-1')}`)
      return Response.json({access_token:isSecond?'TOKEN_B':'TOKEN_A',refresh_token:'REFRESH_TOKEN',bot_id:'bot',workspace_id:'workspace-'+(isSecond?'B':'A'),workspace_name:'Personal',owner:{type:'user',user:{id:isSecond?'user-B':'user-A'}}})
    }
    assert.equal(options.headers['Notion-Version'],'2026-03-11')
    if(url.endsWith('/search'))return Response.json({results:[{object:'data_source',id:notionSource,title:[{plain_text:'Learning'}],properties:{Money:{id:'money',type:'number'},Date:{id:'date',type:'date'}}}],has_more:false})
    if(url.endsWith('/data_sources/'+notionSource))return Response.json({id:notionSource,properties:{Money:{id:'money',type:'number'},Date:{id:'date',type:'date'},Hidden:{id:'s',type:'rich_text'}}})
    if(url.endsWith('/data_sources/'+notionSource+'/query'))return Response.json({results:[{id:'NOT_RETURNED',properties:{Money:{id:'money',type:'number',number:mock.value},Date:{id:'date',type:'date',date:{start:'2026-10-12'}},Hidden:{id:'s',type:'rich_text',rich_text:[{plain_text:'SECRET_ROW'}]}}}],has_more:false})
    throw Error('Unexpected URL '+url)
  }
  return mock
}
async function handoff(env,widgetId,reuse=false){
  const verifier=randomToken()
  const response=await worker.fetch(req('/api/auth/embed','POST',{verifierHash:await sha256(verifier),...(widgetId?{widgetId}:{}),...(reuse?{reuse:true}:{})}),env)
  assert.equal(response.status,200)
  const value=await response.json()
  assert.match(value.id,/^[a-f0-9]{64}$/)
  assert.equal(value.authUrl,`https://worker.example/api/auth/notion/start?handoff=${value.id}${reuse?'&reuse=1':''}`)
  assert.ok(!value.authUrl.includes(verifier))
  return {...value,verifier}
}
async function start(env,flow,browserCookie=''){
  // OAuth cookies are first-party in the external browser, never required by the embed.
  const response=await worker.fetch(new Request(flow.authUrl,{headers:browserCookie?{Cookie:browserCookie}:{}}),env)
  assert.equal(response.status,302)
  return {state:new URL(response.headers.get('location')).searchParams.get('state'),cookie:response.headers.get('Set-Cookie').split(';')[0]}
}
const callback=(env,attempt,code='user-A')=>worker.fetch(new Request(`https://worker.example/api/auth/notion/callback?code=${code}&state=${attempt.state}`,{headers:{Cookie:attempt.cookie}}),env)
const claim=(env,flow,verifier=flow.verifier)=>worker.fetch(req('/api/auth/embed/claim','POST',{id:flow.id,verifier}),env)
async function complete(env,flow,code='user-A'){
  const attempt=await start(env,flow)
  const response=await callback(env,attempt,code)
  assert.equal(response.status,302)
  assert.equal(new URL(response.headers.get('Location')).hash,'#/auth/embed/complete')
  assert.ok(response.headers.get('Set-Cookie').includes('Max-Age=0'))
  const root=response.headers.getSetCookie().find(value=>value.startsWith('wp_browser='))
  assert.ok(root)
  return {...attempt,browserCookie:root.split(';')[0]}
}
async function login(env,code='user-A'){
  const flow=await handoff(env)
  const attempt=await complete(env,flow,code)
  const response=await claim(env,flow)
  assert.equal(response.status,200)
  const {token,expiresIn}=await response.json()
  assert.match(token,/^[a-f0-9]{64}$/)
  assert.ok(expiresIn>0&&expiresIn<=7200)
  return {...flow,...attempt,session:token}
}
async function save(env,session){
  assert.equal((await worker.fetch(req('/api/notion/data-sources','GET',undefined,session),env)).status,200)
  const response=await worker.fetch(req('/api/widgets','POST',{config:cfg,chartType:'bar',title:'My chart'},session),env)
  assert.equal(response.status,201)
  return (await response.json()).id
}
const sessionCount=async DB=>(await DB.prepare('SELECT count(*) AS count FROM sessions').first()).count
const rootHash=async session=>sha256(session.browserCookie.split('=')[1])
const rootCount=async DB=>(await DB.prepare('SELECT count(*) AS count FROM browser_sessions').first()).count
async function consent(env,flow,browserCookie){
  const response=await worker.fetch(new Request(flow.authUrl,{headers:{Cookie:browserCookie}}),env)
  assert.equal(response.status,200)
  const html=await response.text()
  const csrf=html.match(/name="csrf" value="([a-f0-9]{64})"/)?.[1]
  assert.ok(csrf)
  return {response,html,csrf}
}
function reuse(env,flow,browserCookie,csrf,origin='https://worker.example'){
  return worker.fetch(new Request('https://worker.example/api/auth/notion/reuse',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Cookie:browserCookie,...(origin===null?{}:{Origin:origin})},body:new URLSearchParams({handoff:flow.id,csrf})}),env)
}
async function approveReuse(env,flow,browserCookie){
  const page=await consent(env,flow,browserCookie)
  const response=await reuse(env,flow,browserCookie,page.csrf)
  assert.equal(response.status,302)
  assert.equal(new URL(response.headers.get('Location')).hash,'#/auth/embed/complete')
  return page
}

test('owner-only saved widgets query live Notion; copied URLs and removed publication APIs never expose data',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    assert.equal((await worker.fetch(req('/api/notion/data-sources'),env)).status,401)
    const a=await login(env),b=await login(env,'user-B')
    const id=await save(env,a.session)
    const calls=mock.calls.length
    assert.equal((await worker.fetch(req('/api/widgets/'+id),env)).status,401,'a copied widget URL grants nothing without credentials')
    assert.equal((await worker.fetch(req('/api/widgets/'+id,'GET',undefined,b.session),env)).status,404)
    assert.equal((await worker.fetch(req('/api/widgets/charts/preview','POST',cfg,b.session),env)).status,404,'grants are not inherited by another user')
    assert.equal(mock.calls.length,calls,'denied requests must not reach Notion')
    let response=await worker.fetch(req('/api/widgets/'+id,'GET',undefined,a.session),env)
    assert.equal(response.status,200)
    assert.equal(response.headers.get('Cache-Control'),'no-store')
    const text=await response.text(),chart=JSON.parse(text)
    assert.deepEqual(Object.keys(chart).sort(),['chartType','result','title'])
    assert.equal(chart.title,'My chart');assert.equal(chart.chartType,'bar')
    assert.deepEqual(chart.result.data,[{label:'2026-10',value:42}])
    for(const secret of ['SECRET_ROW','NOT_RETURNED','TOKEN_A','REFRESH_TOKEN',notionSource,'sourceKey','valueFieldId'])assert.ok(!text.includes(secret))
    mock.value=84
    response=await worker.fetch(req('/api/widgets/'+id,'GET',undefined,a.session),env)
    assert.deepEqual((await response.json()).result.data,[{label:'2026-10',value:84}],'each fetch queries latest database values')
    assert.equal((await worker.fetch(req('/api/public/widgets/'+id,'GET',undefined,a.session),env)).status,404)
    for(const action of ['publish','unpublish','refresh'])assert.equal((await worker.fetch(req(`/api/widgets/${id}/${action}`,'POST',{},a.session),env)).status,404)
    assert.equal((await worker.fetch(req('/api/widgets/'+'-'.repeat(36),'GET',undefined,a.session),env)).status,400)
    const mine=await worker.fetch(req('/api/widgets','GET',undefined,a.session),env)
    assert.deepEqual((await mine.json()).widgets.map(row=>row.id),[id])
    const theirs=await worker.fetch(req('/api/widgets','GET',undefined,b.session),env)
    assert.deepEqual((await theirs.json()).widgets,[])
    const connectionId=(await DB.prepare('SELECT id FROM connections WHERE user_id=?').bind('user-A').first()).id
    assert.equal((await worker.fetch(req('/api/notion/disconnect','POST',{connectionId},b.session),env)).status,404)
    assert.equal((await worker.fetch(req('/api/notion/disconnect','POST',{connectionId},a.session),env)).status,200)
    assert.equal((await worker.fetch(req('/api/widgets/'+id,'GET',undefined,a.session),env)).status,404,'disconnect revokes saved source access')
    assert.equal((await worker.fetch(req('/api/auth/logout','POST',{},a.session),env)).status,200)
    assert.equal((await worker.fetch(req('/api/widgets/'+id,'GET',undefined,a.session),env)).status,401)
  }finally{mock.restore();DB.close()}
})

test('handoff verifier, CSRF state, origin, expiry and single-use session claims',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    assert.equal((await worker.fetch(new Request('https://worker.example/api/auth/notion/start'),env)).status,401)
    assert.equal((await worker.fetch(req('/api/auth/embed','POST',{verifierHash:'A'.repeat(64)}),env)).status,400)
    assert.equal((await worker.fetch(req('/api/auth/embed','POST',{verifierHash:'a'.repeat(64),widgetId:'-'.repeat(36)}),env)).status,400)
    assert.equal((await worker.fetch(req('/api/auth/embed','POST',{verifierHash:'a'.repeat(64)},undefined,{Origin:'https://evil.example'}),env)).status,403)
    const flow=await handoff(env),idHash=await sha256(flow.id)
    const row=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(idHash).first()
    assert.equal(row.id_hash,idHash);assert.notEqual(row.id_hash,flow.id)
    assert.equal(row.verifier_hash,await sha256(flow.verifier))
    assert.ok(row.expires_at>DB.clock&&row.expires_at<=Math.floor(Date.now()/1000)+600)
    assert.equal((await claim(env,flow,randomToken())).status,401,'wrong verifier rejected even before OAuth completes')
    for(let i=0;i<2;i++){
      const pending=await claim(env,flow)
      assert.equal(pending.status,202);assert.deepEqual(await pending.json(),{pending:true})
    }
    assert.equal(await sessionCount(DB),0)
    assert.equal((await worker.fetch(req('/api/auth/embed/claim','POST',{id:flow.id,verifier:flow.verifier},undefined,{Origin:'https://evil.example'}),env)).status,403)
    const attempt=await start(env,flow)
    assert.equal((await callback(env,{...attempt,cookie:'wp_oauth=invalid'})).status,403)
    assert.equal((await callback(env,attempt)).status,302)
    assert.equal((await callback(env,attempt)).status,403,'state cannot replay')
    assert.equal((await claim(env,flow,randomToken())).status,401)
    const response=await claim(env,flow)
    assert.equal(response.status,200)
    const session=(await response.json()).token
    assert.equal((await claim(env,flow)).status,401,'handoff cannot replay')
    assert.equal(await sessionCount(DB),1)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,session),env)).status,200)
    const expired=await handoff(env)
    await DB.prepare('UPDATE oauth_embed_handoffs SET expires_at=? WHERE id_hash=?').bind(DB.clock,await sha256(expired.id)).run()
    assert.equal((await claim(env,expired)).status,401)
    assert.equal((await worker.fetch(new Request(expired.authUrl),env)).status,401)
    assert.equal(await sessionCount(DB),1)
    const late=await handoff(env),lateAttempt=await start(env,late)
    await DB.prepare('UPDATE oauth_embed_handoffs SET expires_at=? WHERE id_hash=?').bind(DB.clock,await sha256(late.id)).run()
    assert.equal((await callback(env,lateAttempt)).status,401,'expired callback never completes handoff')
    const during=await handoff(env),duringAttempt=await start(env,during)
    const sha256During=await sha256(during.id)
    mock.beforeToken=()=>DB.prepare('UPDATE oauth_embed_handoffs SET expires_at=? WHERE id_hash=?').bind(DB.clock,sha256During).run()
    assert.equal((await callback(env,duringAttempt)).status,401,'expiry during token exchange is rechecked on completion')
    assert.equal((await DB.prepare('SELECT user_id FROM oauth_embed_handoffs WHERE id_hash=?').bind(sha256During).first()).user_id,null)
    assert.equal(await sessionCount(DB),1)
  }finally{mock.restore();DB.close()}
})

test('a copied embed login URL cannot mint a session for a nonowner',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const a=await login(env),id=await save(env,a.session),before=await sessionCount(DB)
    const copied=await handoff(env,id)
    await complete(env,copied,'user-B')
    assert.equal((await claim(env,copied)).status,403)
    assert.equal(await sessionCount(DB),before,'nonowner claim creates no session')
    const own=await handoff(env,id)
    await complete(env,own)
    const response=await claim(env,own)
    assert.equal(response.status,200)
    const token=(await response.json()).token
    assert.equal((await worker.fetch(req('/api/widgets/'+id,'GET',undefined,token),env)).status,200)
  }finally{mock.restore();DB.close()}
})

test('claim transaction prevents concurrent replay, expiry races, owner deletion and partial issuance',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const flow=await handoff(env)
    await complete(env,flow)
    const concurrent=await Promise.all([claim(env,flow),claim(env,flow)])
    assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,401])
    assert.equal(await sessionCount(DB),1)
    const expired=await handoff(env)
    await complete(env,expired)
    DB.beforeBatch=()=>{DB.clock+=601}
    assert.equal((await claim(env,expired)).status,401,'expiry after preliminary read is checked inside transaction')
    assert.equal(await sessionCount(DB),1)
    DB.beforeBatch=null;DB.clock=Math.floor(Date.now()/1000)
    const crossing=await handoff(env)
    await complete(env,crossing)
    DB.afterStatement=index=>{if(index===0)DB.clock+=601}
    assert.equal((await claim(env,crossing)).status,200,'expiry between statements cannot leave an unconsumed issued session')
    assert.equal(await sessionCount(DB),2)
    assert.equal(await DB.prepare('SELECT id_hash FROM oauth_embed_handoffs WHERE id_hash=?').bind(await sha256(crossing.id)).first(),null)
    DB.afterStatement=null;DB.clock=Math.floor(Date.now()/1000)
    const rollback=await handoff(env)
    await complete(env,rollback)
    DB.afterStatement=index=>{if(index===0)throw Error('transaction failure')}
    assert.equal((await claim(env,rollback)).status,500)
    assert.equal(await sessionCount(DB),2,'failed batch rolls back session insertion')
    DB.afterStatement=null
    assert.equal((await claim(env,rollback)).status,200,'failed transaction leaves handoff usable')
    const a=await login(env),id=await save(env,a.session),deleted=await handoff(env,id)
    await complete(env,deleted)
    const before=await sessionCount(DB)
    DB.beforeBatch=()=>DB.prepare('DELETE FROM widgets WHERE id=?').bind(id).run()
    assert.equal((await claim(env,deleted)).status,401)
    assert.equal(await sessionCount(DB),before,'owner deletion between read and batch cannot issue a session')
  }finally{mock.restore();DB.close()}
})

test('first successful OAuth callback fixes handoff identity, including overlapping callbacks',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const flow=await handoff(env),first=await start(env,flow),second=await start(env,flow)
    let release,entered
    const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
    mock.beforeToken=async body=>{if(body.code==='user-A'){entered();await gate}}
    const slow=callback(env,first,'user-A')
    await started
    assert.equal((await callback(env,second,'user-B')).status,302)
    release()
    assert.equal((await slow).status,401,'late callback cannot overwrite authenticated identity')
    assert.equal(await rootCount(DB),1,'losing callback cannot leave an additional browser root')
    assert.equal(await DB.prepare('SELECT id FROM connections WHERE user_id=?').bind('user-A').first(),null)
    const response=await claim(env,flow)
    assert.equal(response.status,200)
    const me=await worker.fetch(req('/api/me','GET',undefined,(await response.json()).token),env)
    assert.equal((await me.json()).userId,'user-B')
    assert.equal((await worker.fetch(new Request(flow.authUrl),env)).status,401)
  }finally{mock.restore();DB.close()}
})

test('AES-GCM encrypt/decrypt rejects modifications; random tokens differ',async()=>{
  const key='ab'.repeat(32),cipher=await encrypt('private-token',key)
  assert.equal(await decrypt(cipher,key),'private-token')
  await assert.rejects(()=>decrypt(cipher.slice(0,-1)+(cipher.endsWith('0')?'1':'0'),key))
  assert.notEqual(randomToken(),randomToken())
})

test('OAuth creates a hashed two-hour browser root and appends its private cookie alongside state deletion',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const flow=await handoff(env),attempt=await start(env,flow)
    const response=await callback(env,attempt)
    assert.equal(response.status,302)
    const cookies=response.headers.getSetCookie()
    assert.equal(cookies.length,2)
    assert.ok(cookies.some(value=>value.startsWith('wp_oauth=;')&&value.includes('Max-Age=0')))
    const root=cookies.find(value=>value.startsWith('wp_browser='))
    const raw=root.match(/^wp_browser=([a-f0-9]{64});/)[1]
    for(const flag of ['HttpOnly','SameSite=None','Path=/api/auth','Max-Age=7200','Secure'])assert.ok(root.includes(flag))
    assert.ok(!response.headers.get('Location').includes(raw))
    assert.equal(await response.text(),'')
    const stored=await DB.prepare('SELECT * FROM browser_sessions').first()
    assert.equal(stored.token_hash,await sha256(raw))
    assert.notEqual(stored.token_hash,raw)
    assert.equal(stored.user_id,'user-A')
    assert.equal(stored.expires_at,DB.clock+7200)
    const completed=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(await sha256(flow.id)).first()
    assert.equal(completed.browser_session_hash,stored.token_hash)
    const claimed=await claim(env,flow),value=await claimed.json()
    assert.equal(claimed.status,200)
    assert.deepEqual(Object.keys(value).sort(),['expiresIn','token'])
    assert.ok(!JSON.stringify(value).includes(raw))
    const child=await DB.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(await sha256(value.token)).first()
    assert.equal(child.browser_session_hash,stored.token_hash)
    assert.equal(child.expires_at,stored.expires_at)
    const localEnv={...env,NOTION_REDIRECT_URI:'http://localhost:8787/api/auth/notion/callback'}
    const localFlow=await handoff(localEnv),localAttempt=await start(localEnv,localFlow)
    const local=await callback(localEnv,localAttempt)
    assert.equal(local.status,302)
    assert.ok(local.headers.getSetCookie().every(value=>!value.includes('; Secure')))
  }finally{mock.restore();DB.close()}
})

test('existing root requires explicit consent, then reconnects without Notion exchange or search',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),widgetId=await save(env,owner.session)
    const flow=await handoff(env,widgetId,true),before=mock.calls.length,roots=await rootCount(DB)
    const page=await consent(env,flow,owner.browserCookie)
    const repeated=await worker.fetch(new Request(flow.authUrl,{headers:{Cookie:owner.browserCookie,Origin:origin}}),env)
    assert.equal(repeated.status,200)
    assert.equal(repeated.headers.get('Access-Control-Allow-Origin'),null,'consent nonce is not CORS-readable')
    assert.equal(page.response.headers.get('Cache-Control'),'no-store')
    assert.equal(page.response.headers.get('X-Frame-Options'),'DENY')
    assert.ok(page.response.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"))
    assert.equal(page.response.headers.get('Set-Cookie'),null,'consent GET never rotates or creates cookies')
    for(const secret of [owner.browserCookie.split('=')[1],flow.verifier,'SECRET_ROW','TOKEN_A','REFRESH_TOKEN','My chart'])assert.ok(!page.html.includes(secret))
    const pending=await claim(env,flow)
    assert.equal(pending.status,202)
    assert.deepEqual(await pending.json(),{pending:true},'GET alone cannot authenticate a verifier holder')
    const record=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(await sha256(flow.id)).first()
    assert.equal(record.user_id,null);assert.equal(record.browser_session_hash,null)
    assert.equal((await worker.fetch(req('/api/widgets/'+widgetId,'GET',undefined,undefined,{Cookie:owner.browserCookie}),env)).status,401,'root cookie is never an iframe bearer')
    const approved=await reuse(env,flow,owner.browserCookie,page.csrf)
    assert.equal(approved.status,302)
    assert.equal(new URL(approved.headers.get('Location')).hash,'#/auth/embed/complete')
    assert.equal((await reuse(env,flow,owner.browserCookie,page.csrf)).status,401,'consent cannot replay')
    assert.equal((await claim(env,flow,randomToken())).status,401)
    const claimed=await claim(env,flow)
    assert.equal(claimed.status,200)
    const value=await claimed.json()
    assert.ok(value.expiresIn>0&&value.expiresIn<=7200)
    const child=await DB.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(await sha256(value.token)).first()
    assert.equal(child.browser_session_hash,await rootHash(owner))
    assert.equal(await rootCount(DB),roots,'reuse must not lengthen or replace the browser root')
    assert.equal(mock.calls.length,before,'GET, consent and claim never call any Notion endpoint')
    assert.equal((await claim(env,flow)).status,401)
    assert.equal((await worker.fetch(req('/api/widgets/'+widgetId,'GET',undefined,value.token),env)).status,200)
  }finally{mock.restore();DB.close()}
})

test('reuse POST rejects missing or foreign Origin, invalid CSRF, cross-handoff tokens and missing cookie',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),flow=await handoff(env,undefined,true),other=await handoff(env,undefined,true)
    const page=await consent(env,flow,owner.browserCookie),before=await sessionCount(DB),calls=mock.calls.length
    for(const origin of ['https://evil.example','https://example.github.io',null]){
      assert.equal((await reuse(env,flow,owner.browserCookie,page.csrf,origin)).status,403)
    }
    assert.equal((await reuse(env,flow,owner.browserCookie,randomToken())).status,403)
    assert.equal((await reuse(env,other,owner.browserCookie,page.csrf)).status,403,'nonce is bound to this handoff')
    assert.equal((await reuse(env,flow,'',page.csrf)).status,401)
    const record=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(await sha256(flow.id)).first()
    assert.equal(record.user_id,null);assert.equal(record.denied,0,'CSRF errors cannot poison a legitimate flow')
    assert.equal((await claim(env,flow)).status,202)
    assert.equal(await sessionCount(DB),before)
    assert.equal(mock.calls.length,calls)
    assert.equal((await reuse(env,flow,owner.browserCookie,page.csrf)).status,302)
    assert.equal((await worker.fetch(req('/api/auth/embed','POST',{verifierHash:'a'.repeat(64),reuse:'true'}),env)).status,400)
  }finally{mock.restore();DB.close()}
})

test('nonowner reuse denial reaches verifier-bound polling without GET completing authentication',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),widgetId=await save(env,owner.session),other=await login(env,'user-B')
    const flow=await handoff(env,widgetId,true),before=await sessionCount(DB),calls=mock.calls.length
    const response=await worker.fetch(new Request(flow.authUrl,{headers:{Cookie:other.browserCookie}}),env)
    assert.equal(response.status,403)
    assert.equal(response.headers.get('Set-Cookie'),null)
    assert.equal((await claim(env,flow)).status,403,'iframe must learn the owner denial instead of polling pending')
    assert.equal((await claim(env,flow,randomToken())).status,401,'denial is still verifier-bound')
    const record=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(await sha256(flow.id)).first()
    assert.equal(record.denied,1);assert.equal(record.user_id,null);assert.equal(record.browser_session_hash,null)
    assert.equal((await worker.fetch(new Request(flow.authUrl,{headers:{Cookie:owner.browserCookie}}),env)).status,401)
    const direct=await handoff(env,widgetId,true)
    const csrf=await sha256(other.browserCookie.split('=')[1]+':'+direct.id)
    assert.equal((await reuse(env,direct,other.browserCookie,csrf)).status,403,'POST repeats the owner check even without GET')
    assert.equal(await sessionCount(DB),before)
    assert.equal(mock.calls.length,calls)
  }finally{mock.restore();DB.close()}
})

test('missing, malformed, expired and revoked browser roots fall back to OAuth; explicit OAuth never skips approval',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),root=await rootHash(owner),calls=mock.calls.length
    const missing=await handoff(env,undefined,true)
    await start(env,missing)
    const malformed=await handoff(env,undefined,true)
    await start(env,malformed,'wp_browser=invalid')
    const explicit=await handoff(env)
    await start(env,explicit,owner.browserCookie)
    const expires=await handoff(env,undefined,true)
    const page=await consent(env,expires,owner.browserCookie)
    await DB.prepare('UPDATE browser_sessions SET expires_at=? WHERE token_hash=?').bind(DB.clock,root).run()
    assert.equal((await reuse(env,expires,owner.browserCookie,page.csrf)).status,401)
    await start(env,expires,owner.browserCookie)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,owner.session),env)).status,401,'an unexpired bearer cannot outlive its root')
    await DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()
    const revoked=await handoff(env,undefined,true)
    await start(env,revoked,owner.browserCookie)
    assert.equal(mock.calls.length,calls,'fallback GET only redirects; it does not exchange or search')
    assert.equal((await callback(env,await start(env,missing))).status,302,'fallback still completes genuine OAuth')
  }finally{mock.restore();DB.close()}
})

test('child lifetime is capped by its parent and root-null legacy sessions keep their two-hour contract',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),root=await rootHash(owner),expiry=DB.clock+90
    await DB.prepare('UPDATE browser_sessions SET expires_at=? WHERE token_hash=?').bind(expiry,root).run()
    const flow=await handoff(env,undefined,true)
    await approveReuse(env,flow,owner.browserCookie)
    const claimed=await claim(env,flow),value=await claimed.json()
    assert.equal(claimed.status,200);assert.equal(value.expiresIn,90)
    const child=await DB.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(await sha256(value.token)).first()
    assert.equal(child.expires_at,expiry)
    assert.equal((await DB.prepare('SELECT expires_at FROM browser_sessions WHERE token_hash=?').bind(root).first()).expires_at,expiry)
    const legacy=randomToken()
    await DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha256(legacy),'user-A',DB.clock+7200).run()
    const legacyFlow=await handoff(env)
    await DB.prepare('UPDATE oauth_embed_handoffs SET user_id=? WHERE id_hash=?').bind('user-A',await sha256(legacyFlow.id)).run()
    const legacyClaim=await claim(env,legacyFlow),legacyValue=await legacyClaim.json()
    assert.equal(legacyClaim.status,200);assert.equal(legacyValue.expiresIn,7200)
    assert.equal((await DB.prepare('SELECT browser_session_hash FROM sessions WHERE token_hash=?').bind(await sha256(legacyValue.token)).first()).browser_session_hash,null)
    DB.clock=expiry
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,value.token),env)).status,401)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,owner.session),env)).status,401)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,legacy),env)).status,200)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,legacyValue.token),env)).status,200)
  }finally{mock.restore();DB.close()}
})

test('bearer-only logout revokes the browser root, original session, all children and pending claims',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),independent=await login(env),root=await rootHash(owner),children=[]
    for(let i=0;i<2;i++){
      const flow=await handoff(env,undefined,true)
      await approveReuse(env,flow,owner.browserCookie)
      children.push((await (await claim(env,flow)).json()).token)
    }
    const pendingClaim=await handoff(env,undefined,true)
    await approveReuse(env,pendingClaim,owner.browserCookie)
    DB.afterStatement=index=>{if(index===1)throw Error('transaction failure')}
    assert.equal((await worker.fetch(req('/api/auth/logout','POST',{},children[0]),env)).status,500)
    DB.afterStatement=null
    assert.equal(await sessionCount(DB),4,'failed logout must roll back sibling deletion and root revocation')
    assert.ok(await DB.prepare('SELECT token_hash FROM browser_sessions WHERE token_hash=?').bind(root).first())
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,owner.session),env)).status,200)
    const logout=await worker.fetch(req('/api/auth/logout','POST',{},children[0]),env)
    assert.equal(logout.status,200)
    assert.ok(logout.headers.get('Set-Cookie').includes('wp_browser=;'))
    assert.ok(logout.headers.get('Set-Cookie').includes('Max-Age=0'))
    assert.equal(await DB.prepare('SELECT token_hash FROM browser_sessions WHERE token_hash=?').bind(root).first(),null)
    for(const token of [owner.session,...children]){
      assert.equal((await worker.fetch(req('/api/me','GET',undefined,token),env)).status,401)
      assert.equal(await DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').bind(await sha256(token)).first(),null)
    }
    assert.equal((await claim(env,pendingClaim)).status,401)
    assert.equal((await worker.fetch(req('/api/me','GET',undefined,independent.session),env)).status,200,'other browser roots of the same user remain separate')
    assert.equal(await sessionCount(DB),1)
    await start(env,await handoff(env,undefined,true),owner.browserCookie)
  }finally{mock.restore();DB.close()}
})

test('claim rejects revoked, expired or wrong-user roots before or during issuance and leaves no orphan token',async t=>{
  for(const scenario of ['revoked-before','revoked-between','revoked-after-consume','expired-between','wrong-user','owner-between','handoff-replaced']){
    await t.test(scenario,async()=>{
      const DB=database(),env=mockEnv(DB),mock=notionMock()
      try{
        const owner=await login(env),widgetId=await save(env,owner.session)
        const flow=await handoff(env,widgetId,true),root=await rootHash(owner)
        await approveReuse(env,flow,owner.browserCookie)
        const before=await sessionCount(DB),idHash=await sha256(flow.id)
        if(scenario==='revoked-before')DB.beforeBatch=()=>DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()
        if(scenario==='revoked-between')DB.afterStatement=index=>{if(index===0)DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()}
        if(scenario==='revoked-after-consume')DB.afterStatement=index=>{if(index===1)DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()}
        if(scenario==='expired-between')DB.afterStatement=index=>{if(index===0)DB.clock+=7200}
        if(scenario==='wrong-user'){
          await DB.prepare('INSERT INTO users(id,created_at) VALUES(?,?)').bind('user-B',DB.clock).run()
          await DB.prepare('UPDATE browser_sessions SET user_id=? WHERE token_hash=?').bind('user-B',root).run()
        }
        if(scenario==='owner-between')DB.afterStatement=index=>{if(index===0)DB.prepare('DELETE FROM widgets WHERE id=?').bind(widgetId).run()}
        if(scenario==='handoff-replaced')DB.beforeBatch=()=>DB.prepare('UPDATE oauth_embed_handoffs SET browser_session_hash=NULL WHERE id_hash=?').bind(idHash).run()
        assert.equal((await claim(env,flow)).status,401)
        assert.equal(await sessionCount(DB),before,'failed issuance must remove its newly inserted token')
        DB.beforeBatch=null;DB.afterStatement=null
        if(scenario!=='owner-between'&&scenario!=='handoff-replaced')assert.equal((await worker.fetch(req('/api/me','GET',undefined,owner.session),env)).status,401)
      }finally{mock.restore();DB.close()}
    })
  }
})

test('reuse consent SQL rechecks root, handoff expiry, ownership and first-winner identity',async t=>{
  for(const scenario of ['root-revoked','root-expired','handoff-expired','owner-deleted','already-completed']){
    await t.test(scenario,async()=>{
      const DB=database(),env=mockEnv(DB),mock=notionMock()
      try{
        const owner=await login(env),widgetId=await save(env,owner.session),flow=await handoff(env,widgetId,true)
        const page=await consent(env,flow,owner.browserCookie),root=await rootHash(owner),hash=await sha256(flow.id),before=await sessionCount(DB)
        DB.beforeQuery=async sql=>{
          if(!sql.startsWith('UPDATE oauth_embed_handoffs SET user_id='))return
          DB.beforeQuery=null
          if(scenario==='root-revoked')await DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()
          if(scenario==='root-expired')await DB.prepare('UPDATE browser_sessions SET expires_at=? WHERE token_hash=?').bind(DB.clock,root).run()
          if(scenario==='handoff-expired')await DB.prepare('UPDATE oauth_embed_handoffs SET expires_at=? WHERE id_hash=?').bind(DB.clock,hash).run()
          if(scenario==='owner-deleted')await DB.prepare('DELETE FROM widgets WHERE id=?').bind(widgetId).run()
          if(scenario==='already-completed')await DB.prepare('UPDATE oauth_embed_handoffs SET user_id=? WHERE id_hash=?').bind('user-A',hash).run()
        }
        assert.equal((await reuse(env,flow,owner.browserCookie,page.csrf)).status,401)
        const record=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(hash).first()
        assert.equal(record.user_id,scenario==='already-completed'?'user-A':null)
        assert.equal(record.browser_session_hash,null)
        assert.equal(await sessionCount(DB),before)
      }finally{mock.restore();DB.close()}
    })
  }
})

test('OAuth completion transaction checks expiry, removes unlinked roots and rolls back partial completion',async t=>{
  for(const scenario of ['expired-before','expired-between','batch-failure']){
    await t.test(scenario,async()=>{
      const DB=database(),env=mockEnv(DB),mock=notionMock()
      try{
        const flow=await handoff(env),attempt=await start(env,flow),hash=await sha256(flow.id)
        if(scenario==='expired-before')DB.beforeBatch=()=>{DB.clock+=601}
        if(scenario==='expired-between')DB.afterStatement=index=>{if(index===1)DB.clock+=601}
        if(scenario==='batch-failure')DB.afterStatement=index=>{if(index===2)throw Error('transaction failure')}
        const response=await callback(env,attempt)
        assert.equal(response.status,scenario==='batch-failure'?500:401)
        assert.equal(response.headers.get('Set-Cookie'),null)
        assert.equal(await rootCount(DB),0)
        assert.equal(await sessionCount(DB),0)
        assert.equal((await DB.prepare('SELECT count(*) AS count FROM connections').first()).count,0)
        const record=await DB.prepare('SELECT * FROM oauth_embed_handoffs WHERE id_hash=?').bind(hash).first()
        assert.equal(record.user_id,null);assert.equal(record.browser_session_hash,null)
        DB.beforeBatch=null;DB.afterStatement=null
        if(scenario==='batch-failure')await complete(env,flow)
      }finally{mock.restore();DB.close()}
    })
  }
})

test('overlapping OAuth and reuse consent cannot overwrite the first authenticated handoff or leak an extra root',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),flow=await handoff(env,undefined,true)
    const oauth=await start(env,flow),page=await consent(env,flow,owner.browserCookie)
    let release,entered
    const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
    mock.beforeToken=async()=>{entered();await gate}
    const slow=callback(env,oauth,'user-B')
    await started
    assert.equal((await reuse(env,flow,owner.browserCookie,page.csrf)).status,302)
    release()
    assert.equal((await slow).status,401)
    assert.equal(await rootCount(DB),1)
    assert.equal(await DB.prepare('SELECT id FROM connections WHERE user_id=?').bind('user-B').first(),null)
    const response=await claim(env,flow)
    assert.equal(response.status,200)
    const me=await worker.fetch(req('/api/me','GET',undefined,(await response.json()).token),env)
    assert.equal((await me.json()).userId,'user-A')
  }finally{mock.restore();DB.close()}
})

test('cookie restoration grants only the owner a bounded session without another Notion OAuth exchange',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),widgetId=await save(env,owner.session),other=await login(env,'user-B')
    const root=await DB.prepare('SELECT * FROM browser_sessions WHERE token_hash=?').bind(await rootHash(owner)).first()
    DB.clock+=120
    const calls=mock.calls.length
    const restored=await worker.fetch(req('/api/auth/session','POST',{widgetId},undefined,{Cookie:owner.browserCookie}),env)
    assert.equal(restored.status,200)
    assert.equal(restored.headers.get('Access-Control-Allow-Origin'),origin)
    assert.equal(restored.headers.get('Access-Control-Allow-Credentials'),'true')
    const value=await restored.json()
    assert.notEqual(value.token,owner.session)
    assert.equal(value.expiresIn,root.expires_at-DB.clock)
    assert.equal(mock.calls.length,calls,'restore must not re-run OAuth or query Notion')
    assert.deepEqual(await DB.prepare('SELECT * FROM browser_sessions WHERE token_hash=?').bind(root.token_hash).first(),root,'restoration does not renew the root')
    const chart=await worker.fetch(req('/api/widgets/'+widgetId,'GET',undefined,value.token),env)
    assert.equal(chart.status,200)
    assert.equal((await chart.json()).result.data[0].value,42)
    assert.equal((await worker.fetch(req('/api/auth/session','POST',{widgetId},undefined,{Cookie:other.browserCookie}),env)).status,403)
    assert.equal((await worker.fetch(req('/api/auth/session','POST',{widgetId}),env)).status,401)
    const otherRestore=await worker.fetch(req('/api/auth/session','POST',{},undefined,{Cookie:other.browserCookie}),env)
    assert.equal(otherRestore.status,200)
    assert.equal((await worker.fetch(req('/api/widgets/'+widgetId,'GET',undefined,(await otherRestore.json()).token),env)).status,404)
    assert.equal((await worker.fetch(req('/api/auth/logout','POST',{},value.token),env)).status,200)
    assert.equal((await worker.fetch(req('/api/widgets/'+widgetId,'GET',undefined,value.token),env)).status,401)
    assert.equal((await worker.fetch(req('/api/auth/session','POST',{widgetId},undefined,{Cookie:owner.browserCookie}),env)).status,401)
  }finally{mock.restore();DB.close()}
})

test('automatic restoration rejects missing/cross-site origins and simple form posts before issuing credentials',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),before=await sessionCount(DB)
    for(const caller of [null,'null','https://evil.example','https://worker.example']){
      const headers={'Content-Type':'application/json',Cookie:owner.browserCookie,...(caller===null?{}:{Origin:caller})}
      const response=await worker.fetch(new Request('https://worker.example/api/auth/session',{method:'POST',headers,body:'{}'}),env)
      assert.equal(response.status,403)
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)
      const preflight=await worker.fetch(new Request('https://worker.example/api/auth/session',{method:'OPTIONS',headers}),env)
      assert.equal(preflight.status,403)
    }
    for(const contentType of ['text/plain','application/x-www-form-urlencoded']){
      const response=await worker.fetch(new Request('https://worker.example/api/auth/session',{method:'POST',headers:{Origin:origin,Cookie:owner.browserCookie,'Content-Type':contentType},body:'{}'}),env)
      assert.equal(response.status,400)
    }
    assert.equal((await worker.fetch(req('/api/auth/session','POST',{widgetId:'invalid'},undefined,{Cookie:owner.browserCookie}),env)).status,400)
    assert.equal(await sessionCount(DB),before)
    const allowed=await worker.fetch(req('/api/auth/session','OPTIONS'),env)
    assert.equal(allowed.status,204)
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),origin)
    assert.equal(allowed.headers.get('Access-Control-Allow-Credentials'),'true')
    assert.equal((await worker.fetch(req('/api/health'),env)).headers.get('Access-Control-Allow-Credentials'),null,'normal APIs do not opt into cookies')
  }finally{mock.restore();DB.close()}
})

test('cookie restoration atomically rechecks revocation, expiry and ownership at issuance',async t=>{
  for(const scenario of ['revoked','expired','widget-owner','root-owner']){
    await t.test(scenario,async()=>{
      const DB=database(),env=mockEnv(DB),mock=notionMock()
      try{
        const owner=await login(env),widgetId=await save(env,owner.session)
        await login(env,'user-B')
        const root=await rootHash(owner),before=await sessionCount(DB)
        DB.beforeQuery=async sql=>{
          if(!sql.startsWith('INSERT INTO sessions('))return
          DB.beforeQuery=null
          if(scenario==='revoked')await DB.prepare('DELETE FROM browser_sessions WHERE token_hash=?').bind(root).run()
          if(scenario==='expired')DB.clock+=7200
          if(scenario==='widget-owner')await DB.prepare('UPDATE widgets SET user_id=? WHERE id=?').bind('user-B',widgetId).run()
          if(scenario==='root-owner')await DB.prepare('UPDATE browser_sessions SET user_id=? WHERE token_hash=?').bind('user-B',root).run()
        }
        assert.equal((await worker.fetch(req('/api/auth/session','POST',{widgetId},undefined,{Cookie:owner.browserCookie}),env)).status,401)
        assert.equal(await sessionCount(DB),before,'failed restoration cannot leave an issued bearer')
      }finally{mock.restore();DB.close()}
    })
  }
})

test('explicit reuse upgrades an old root cookie for cross-site restore without extending its lifetime',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    const owner=await login(env),root=await rootHash(owner),expires=DB.clock+60
    await DB.prepare('UPDATE browser_sessions SET expires_at=? WHERE token_hash=?').bind(expires,root).run()
    const flow=await handoff(env,undefined,true),page=await consent(env,flow,owner.browserCookie)
    const response=await reuse(env,flow,owner.browserCookie,page.csrf),cookie=response.headers.get('Set-Cookie')
    assert.equal(response.status,302)
    assert.ok(cookie.startsWith(owner.browserCookie+';'))
    assert.ok(cookie.includes('SameSite=None')&&cookie.includes('Secure')&&cookie.includes('HttpOnly'))
    assert.ok(Number(cookie.match(/Max-Age=(\d+)/)[1])<=60)
    assert.equal((await DB.prepare('SELECT expires_at FROM browser_sessions WHERE token_hash=?').bind(root).first()).expires_at,expires)
  }finally{mock.restore();DB.close()}
})
