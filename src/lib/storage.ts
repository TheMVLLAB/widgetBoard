import { useState } from 'react'
const prefix = 'widget-playground:v1:'
export function storageAvailable(): boolean {
  try { const key=`${prefix}probe`; localStorage.setItem(key,'1'); localStorage.removeItem(key); return true } catch { return false }
}
export function useStoredState<T>(key: string, initial: T): [T,(next:T|((prev:T)=>T))=>void] {
  const [state,setState] = useState<T>(()=>{
    try {const saved=localStorage.getItem(prefix+key); return saved ? JSON.parse(saved) as T : initial} catch {return initial}
  })
  function change(next:T|((prev:T)=>T)) {
    setState(prev=>{
      const value = typeof next === 'function' ? (next as (p:T)=>T)(prev) : next
      try {localStorage.setItem(prefix+key,JSON.stringify(value))} catch { /* iframe storage may be blocked */ }
      return value
    })
  }
  return [state,change]
}
export function localDay(timezone: string, at=new Date()):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at)
}
