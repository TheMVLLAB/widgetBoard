const encoder = new TextEncoder()
export function randomToken(bytes=32):string{
  const buf=crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buf,b=>b.toString(16).padStart(2,'0')).join('')
}
export function epoch(){return Math.floor(Date.now()/1000)}
export async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}
export function keyBytes(hex:string){if(!/^[a-f0-9]{64}$/i.test(hex))throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters');return new Uint8Array(hex.match(/../g)!.map(x=>parseInt(x,16)))}
export async function encrypt(plaintext:string, hexKey:string){
  const key=await crypto.subtle.importKey('raw',keyBytes(hexKey),'AES-GCM',false,['encrypt'])
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const result=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(plaintext)))
  return `v1:${Array.from(iv,b=>b.toString(16).padStart(2,'0')).join('')}:${Array.from(result,b=>b.toString(16).padStart(2,'0')).join('')}`
}
export async function decrypt(cipher:string,hexKey:string){
  const [version,ivhex,datahex]=cipher.split(':')
  if(version!=='v1'||!/^[a-f0-9]{24}$/i.test(ivhex)||!datahex||!/^(?:[a-f0-9]{2})+$/i.test(datahex))throw new Error('Invalid encrypted token')
  const key=await crypto.subtle.importKey('raw',keyBytes(hexKey),'AES-GCM',false,['decrypt'])
  const iv=new Uint8Array(ivhex.match(/../g)!.map(x=>parseInt(x,16)))
  const data=new Uint8Array(datahex.match(/../g)!.map(x=>parseInt(x,16)))
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,data))
}
export type OAuthToken = {access_token:string;refresh_token:string;bot_id:string;workspace_id:string;workspace_name?:string;owner?:{type:string;user?:{id:string}}}
export async function exchangeNotionToken(clientId:string,clientSecret:string,body:Record<string,string>):Promise<OAuthToken>{
  const response=await fetch('https://api.notion.com/v1/oauth/token',{method:'POST',headers:{Authorization:`Basic ${btoa(`${clientId}:${clientSecret}`)}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)})
  if(!response.ok)throw new Error(`Notion OAuth failed (${response.status})`)
  const info=await response.json() as OAuthToken
  if(!info.access_token||!info.refresh_token||!info.bot_id||!info.workspace_id)throw new Error('Notion OAuth token response is incomplete')
  return info
}
