import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/index.ts'
const env={NOTION_TOKEN:'secret_test',NOTION_SOURCES_JSON:JSON.stringify({study:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}),ADMIN_ACCESS_KEY:'a'.repeat(64),SESSION_SECRET:'b'.repeat(64),SITE_ORIGIN:'https://test.github.io'}
const origin='https://test.github.io'
const request=(path,method='GET',body,token)=>new Request(`https://worker.example${path}`,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})})
function mockNotion(){const old=globalThis.fetch;const queries=[];globalThis.fetch=async (input,opts={})=>{
 const url=String(input)
 assert.ok(url.startsWith('https://api.notion.com/v1/'))
 assert.equal(opts.headers['Notion-Version'],'2026-03-11')
 if(url.includes('/query')){queries.push(JSON.parse(opts.body));return new Response(JSON.stringify({results:[{id:'ROW_ID_SENSITIVE',properties:{Date:{id:'d',type:'date',date:{start:'2026-10-11'}},Money:{id:'n',type:'number',number:120},Tag:{id:'c',type:'select',select:{name:'Study'}},Secret:{id:'secret',type:'rich_text',rich_text:[{plain_text:'NEVER_RETURN_THIS'}]}}}],has_more:false}),{status:200})}
 return new Response(JSON.stringify({id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',title:[{plain_text:'Study logs'}],properties:{Date:{id:'d',type:'date'},Money:{id:'n',type:'number'},Tag:{id:'c',type:'select'},Secret:{id:'secret',type:'rich_text'}}}),{status:200})
};return {queries,restore:()=>{globalThis.fetch=old}}}
test('unauthenticated request rejected, origin denied, auth keys not exposed, read-only aggregation',async ()=>{
 const mocked=mockNotion()
 try{
   let resp=await worker.fetch(request('/api/notion/data-sources'),env)
   assert.equal(resp.status,401)
   resp=await worker.fetch(new Request('https://worker.example/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({key:env.ADMIN_ACCESS_KEY})}),env)
   assert.equal(resp.status,403)
   resp=await worker.fetch(request('/api/auth/login','POST',{key:env.ADMIN_ACCESS_KEY}),env)
   assert.equal(resp.status,200)
   assert.equal(resp.headers.get('Access-Control-Allow-Origin'),origin)
   const {token}=await resp.json()
   assert.ok(token && !token.includes(env.ADMIN_ACCESS_KEY))
   resp=await worker.fetch(request('/api/notion/data-sources','GET',undefined,token),env)
   assert.equal(resp.status,200)
   const {sources}=await resp.json()
   assert.deepEqual(sources,[{key:'study',title:'Study logs',fieldCount:4}])
   resp=await worker.fetch(request('/api/notion/data-sources/nope/schema','GET',undefined,token),env)
   assert.equal(resp.status,404)
   resp=await worker.fetch(request('/api/widgets/charts/preview','POST',{sourceKey:'study',dateFieldId:'d',valueFieldId:'n',categoryFieldId:'c',groupBy:'month',aggregate:'sum',dateFrom:'2026-10-01',dateTo:'2026-10-31'},token),env)
   assert.equal(resp.status,200)
   const text=await resp.text()
   assert.ok(!text.includes('NEVER_RETURN_THIS')&&!text.includes('ROW_ID_SENSITIVE'))
   assert.deepEqual(JSON.parse(text).data,[{label:'2026-10',value:120}])
   assert.equal(mocked.queries.length,1)
   assert.deepEqual(mocked.queries[0].filter,{and:[{property:'Date',date:{on_or_after:'2026-10-01'}},{property:'Date',date:{on_or_before:'2026-10-31'}}]})
 }finally{mocked.restore()}
})

test('session stays valid for 30 days, then expires; altered and revoked tokens fail',async ()=>{
 const mocked=mockNotion()
 const realNow=Date.now
 const issuedAt=Date.UTC(2026,9,12)
 let now=issuedAt
 Date.now=()=>now
 try{
   const login=await worker.fetch(request('/api/auth/login','POST',{key:env.ADMIN_ACCESS_KEY}),env)
   assert.equal(login.status,200)
   const {token}=await login.json()
   now=issuedAt+29*24*60*60*1000
   assert.equal((await worker.fetch(request('/api/notion/data-sources','GET',undefined,token),env)).status,200)
   const [payload,mac]=token.split('.')
   const altered=Buffer.from(JSON.stringify({v:1,exp:Math.floor(now/1000)+60})).toString('base64url')+'.'+mac
   assert.notEqual(altered.split('.')[0],payload)
   assert.equal((await worker.fetch(request('/api/notion/data-sources','GET',undefined,altered),env)).status,401)
   assert.equal((await worker.fetch(request('/api/notion/data-sources','GET',undefined,token),{...env,SESSION_SECRET:'c'.repeat(64)})).status,401)
   now=issuedAt+30*24*60*60*1000-1000
   assert.equal((await worker.fetch(request('/api/notion/data-sources','GET',undefined,token),env)).status,200)
   now+=1000
   assert.equal((await worker.fetch(request('/api/notion/data-sources','GET',undefined,token),env)).status,401)
 }finally{Date.now=realNow;mocked.restore()}
})
