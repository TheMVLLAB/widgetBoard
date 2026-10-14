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
    clock:Math.floor(Date.now()/1000),beforeBatch:null,afterStatement:null,
    prepare(sql){
      const stmt=sqlite.prepare(sql)
      let args=[]
      return {bind(...items){args=items;return this},async first(){return stmt.get(...args)??null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)},execute(){return {results:stmt.all(...args)}}}
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
async function handoff(env,widgetId){
  const verifier=randomToken()
  const response=await worker.fetch(req('/api/auth/embed','POST',{verifierHash:await sha256(verifier),...(widgetId?{widgetId}:{})}),env)
  assert.equal(response.status,200)
  const value=await response.json()
  assert.match(value.id,/^[a-f0-9]{64}$/)
  assert.equal(value.authUrl,`https://worker.example/api/auth/notion/start?handoff=${value.id}`)
  assert.ok(!value.authUrl.includes(verifier))
  return {...value,verifier}
}
async function start(env,flow){
  // OAuth cookies are first-party in the external browser, never required by the embed.
  const response=await worker.fetch(new Request(flow.authUrl),env)
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
  return attempt
}
async function login(env,code='user-A'){
  const flow=await handoff(env)
  const attempt=await complete(env,flow,code)
  const response=await claim(env,flow)
  assert.equal(response.status,200)
  const {token,expiresIn}=await response.json()
  assert.match(token,/^[a-f0-9]{64}$/)
  assert.equal(expiresIn,7200)
  return {...flow,...attempt,session:token}
}
async function save(env,session){
  assert.equal((await worker.fetch(req('/api/notion/data-sources','GET',undefined,session),env)).status,200)
  const response=await worker.fetch(req('/api/widgets','POST',{config:cfg,chartType:'bar',title:'My chart'},session),env)
  assert.equal(response.status,201)
  return (await response.json()).id
}
const sessionCount=async DB=>(await DB.prepare('SELECT count(*) AS count FROM sessions').first()).count

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
