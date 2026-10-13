import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import worker from '../src/index.ts'
import {encrypt,decrypt,randomToken} from '../src/oauth.ts'

const origin='https://example.github.io'
const notionSource='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
function database(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../migrations/0001_oauth.sql',import.meta.url),'utf8'))
  return {
    prepare(sql){
      const stmt=sqlite.prepare(sql)
      let args=[]
      return {bind(...items){args=items;return this},async first(){return stmt.get(...args)??null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)}}
    },close(){sqlite.close()}
  }
}
const mockEnv=db=>({DB:db,NOTION_CLIENT_ID:'client-1',NOTION_CLIENT_SECRET:'secret-1',NOTION_REDIRECT_URI:'https://worker.example/api/auth/notion/callback',TOKEN_ENCRYPTION_KEY:'1'.repeat(64),FRONTEND_URL:'https://example.github.io/widget-playground/'})
const req=(path,method='GET',body,token,headers={})=>new Request('https://worker.example'+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}) ,...headers},...(body?{body:JSON.stringify(body)}:{})})
function notionMock(){
  const saved=globalThis.fetch
  const calls=[]
  globalThis.fetch=async (uri,options={})=>{
    const url=String(uri);calls.push({url,options})
    assert.ok(url.startsWith('https://api.notion.com/v1/'))
    if(url.endsWith('/oauth/token')){
      const body=JSON.parse(options.body)
      const isSecond=body.code==='user-B'
      assert.equal(options.headers.Authorization,`Basic ${btoa('client-1:secret-1')}`)
      return Response.json({access_token:isSecond?'TOKEN_B':'TOKEN_A',refresh_token:'REFRESH_TOKEN',bot_id:'bot',workspace_id:'workspace-'+(isSecond?'B':'A'),workspace_name:'Personal',owner:{type:'user',user:{id:isSecond?'user-B':'user-A'}}})
    }
    assert.equal(options.headers['Notion-Version'],'2026-03-11')
    if(url.endsWith('/search'))return Response.json({results:[{object:'data_source',id:notionSource,title:[{plain_text:'Learning'}],properties:{Money:{id:'money',type:'number'},Date:{id:'date',type:'date'}}}],has_more:false})
    if(url.endsWith('/data_sources/'+notionSource))return Response.json({id:notionSource,properties:{Money:{id:'money',type:'number'},Date:{id:'date',type:'date'},Hidden:{id:'s',type:'rich_text'}}})
    if(url.endsWith('/data_sources/'+notionSource+'/query'))return Response.json({results:[{id:'NOT_RETURNED',properties:{Money:{id:'money',type:'number',number:42},Date:{id:'date',type:'date',date:{start:'2026-10-12'}},Hidden:{id:'s',type:'rich_text',rich_text:[{plain_text:'SECRET_ROW'}]}}}],has_more:false})
    throw Error('Unexpected URL '+url)
  }
  return {calls,restore(){globalThis.fetch=saved}}
}
async function login(env,code){
  // Browser visits Worker in the top-level window; cookie is round-tripped.
  const start=await worker.fetch(new Request('https://worker.example/api/auth/notion/start'),env)
  assert.equal(start.status,302)
  const state=new URL(start.headers.get('location')).searchParams.get('state')
  const cookie=start.headers.get('Set-Cookie').split(';')[0]
  assert.ok(state&&start.headers.get('location').includes('oauth/authorize'))
  const result=await worker.fetch(new Request(`https://worker.example/api/auth/notion/callback?code=${code}&state=${state}`,{headers:{Cookie:cookie}}),env)
  assert.equal(result.status,302)
  assert.ok(!result.headers.get('Location').includes('access_token'))
  const hash=new URL(result.headers.get('Location')).hash
  assert.ok(hash.startsWith('#/auth/complete?ticket='))
  const ticket=new URLSearchParams(hash.split('?')[1]).get('ticket')
  const done=await worker.fetch(req('/api/auth/ticket','POST',{ticket}),env)
  assert.equal(done.status,200)
  const session=(await done.json()).token
  assert.ok(session)
  return {session,ticket,state,cookie}
}
test('OAuth: CSRF, single-use state, isolation, aggregate-only snapshots and revocation',async()=>{
  const DB=database(),env=mockEnv(DB),mock=notionMock()
  try{
    let response=await worker.fetch(req('/api/notion/data-sources'),env)
    assert.equal(response.status,401)
    response=await worker.fetch(req('/api/auth/ticket','POST',{ticket:'a'.repeat(64)},undefined,{Origin:'https://evil.example'}),env)
    assert.equal(response.status,403)
    const pending=await worker.fetch(new Request('https://worker.example/api/auth/notion/start'),env)
    const state=new URL(pending.headers.get('Location')).searchParams.get('state')
    response=await worker.fetch(new Request(`https://worker.example/api/auth/notion/callback?code=user-A&state=${state}`,{headers:{Cookie:'wp_oauth=invalid'}}),env)
    assert.equal(response.status,403)
    const a=await login(env,'user-A')
    response=await worker.fetch(new Request(`https://worker.example/api/auth/notion/callback?code=user-A&state=${a.state}`,{headers:{Cookie:a.cookie}}),env)
    assert.equal(response.status,403,'OAuth state must not replay')
    response=await worker.fetch(req('/api/auth/ticket','POST',{ticket:a.ticket}),env)
    assert.equal(response.status,401,'one-time ticket must not replay')
    const b=await login(env,'user-B')
    const list=await worker.fetch(req('/api/notion/data-sources','GET',undefined,a.session),env)
    assert.equal(list.status,200)
    const body=await list.json()
    assert.equal(body.sources.length,1)
    const key=body.sources[0].key
    assert.ok(key.startsWith('n'))
    const cfg={sourceKey:key,dateFieldId:'date',valueFieldId:'money',categoryFieldId:'',groupBy:'month',aggregate:'sum',dateFrom:'2026-10-01',dateTo:'2026-10-31'}
    response=await worker.fetch(req('/api/widgets/charts/preview','POST',cfg,a.session),env)
    assert.equal(response.status,200)
    const chart=await response.text()
    assert.ok(!chart.includes('SECRET_ROW')&&!chart.includes('NOT_RETURNED')&&!chart.includes('TOKEN_A'))
    assert.deepEqual(JSON.parse(chart).data,[{label:'2026-10',value:42}])
    const beforeB=await worker.fetch(req('/api/widgets/charts/preview','POST',cfg,b.session),env)
    assert.equal(beforeB.status,404,'second user must not inherit first user grants')
    response=await worker.fetch(req('/api/widgets','POST',{config:cfg,chartType:'bar',title:'My chart'},a.session),env)
    assert.equal(response.status,201)
    const id=(await response.json()).id
    assert.equal((await worker.fetch(req('/api/public/widgets/'+id),env)).status,404,'must be private by default')
    assert.equal((await worker.fetch(req('/api/widgets/'+id+'/publish','POST',{confirm:'PUBLISH_AGGREGATES'},b.session),env)).status,404,'other owner cannot publish')
    assert.equal((await worker.fetch(req('/api/widgets/'+id+'/publish','POST',{confirm:'no'},a.session),env)).status,400)
    response=await worker.fetch(req('/api/widgets/'+id+'/publish','POST',{confirm:'PUBLISH_AGGREGATES'},a.session),env)
    assert.equal(response.status,200)
    response=await worker.fetch(req('/api/public/widgets/'+id),env)
    assert.equal(response.status,200)
    const publicChart=await response.text()
    assert.ok(!publicChart.includes('SECRET_ROW')&&!publicChart.includes('TOKEN_A'))
    assert.deepEqual(JSON.parse(publicChart).data,[{label:'2026-10',value:42}])
    assert.equal((await worker.fetch(req('/api/widgets/'+id+'/unpublish','POST',{},b.session),env)).status,404)
    assert.equal((await worker.fetch(req('/api/widgets/'+id+'/unpublish','POST',{},a.session),env)).status,200)
    response=await worker.fetch(req('/api/widgets/'+id+'/refresh','POST',{},a.session),env)
    assert.equal(response.status,200,'owner can explicitly refresh a private chart')
    assert.equal((await worker.fetch(req('/api/public/widgets/'+id),env)).status,404)
  }finally{mock.restore();DB.close()}
})
test('AES-GCM encrypt/decrypt rejects modifications; random tokens differ',async()=>{
  const key='ab'.repeat(32),cipher=await encrypt('private-token',key)
  assert.equal(await decrypt(cipher,key),'private-token')
  await assert.rejects(()=>decrypt(cipher.replace(/.$/,'0'),key))
  assert.notEqual(randomToken(),randomToken())
})
