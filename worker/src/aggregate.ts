/* Server-side, read-only aggregation. Nothing from a Notion page is sent to the browser. */
export type GroupBy = 'month' | 'day' | 'category'
export type Aggregate = 'sum' | 'count' | 'avg'
export type ChartRequest = {
  sourceKey: string; dateFieldId: string; valueFieldId: string; categoryFieldId: string;
  groupBy: GroupBy; aggregate: Aggregate; dateFrom: string; dateTo: string
}
export type Field = { id: string; name: string; type: string }
export type DataPoint = { label: string; value: number }
export const DATE_TYPES = new Set(['date','created_time','last_edited_time'])
export const NUMBER_TYPES = new Set(['number','formula','rollup'])
export const CATEGORY_TYPES = new Set(['select','status','multi_select','checkbox'])
const DAY = /^\d{4}-\d{2}-\d{2}$/
export function validDate(s:string){return !s || (DAY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s)}
export function parseChartRequest(x:unknown): ChartRequest {
  if(!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('설정이 올바르지 않습니다.')
  const input=x as Record<string,unknown>
  const get=(key:string,max=128)=>typeof input[key]==='string' ? (input[key] as string).trim().slice(0,max) : ''
  const sourceKey=get('sourceKey',40),dateFieldId=get('dateFieldId'),valueFieldId=get('valueFieldId'),categoryFieldId=get('categoryFieldId')
  const groupBy=get('groupBy') as GroupBy, aggregate=get('aggregate') as Aggregate
  const dateFrom=get('dateFrom',10),dateTo=get('dateTo',10)
  if(!/^[a-zA-Z][\w-]{0,39}$/.test(sourceKey) || !['month','day','category'].includes(groupBy) || !['sum','count','avg'].includes(aggregate)) throw new Error('지원하지 않는 차트 설정입니다.')
  if(!validDate(dateFrom)||!validDate(dateTo)||(dateFrom&&dateTo&&dateFrom>dateTo)) throw new Error('날짜 범위가 잘못되었습니다.')
  if(dateFrom&&dateTo && (Date.parse(dateTo)-Date.parse(dateFrom))/86400000>366) throw new Error('최대 366일 범위만 조회할 수 있습니다.')
  return {sourceKey,dateFieldId,valueFieldId,categoryFieldId,groupBy,aggregate,dateFrom,dateTo}
}
export function validateFields(cfg:ChartRequest, fields:Field[]){
  const byId=(id:string)=>fields.find(p=>p.id===id)
  if(cfg.groupBy!=='category' || cfg.dateFrom || cfg.dateTo){
    const date=byId(cfg.dateFieldId)
    if(!date||!DATE_TYPES.has(date.type)) throw new Error('날짜 속성을 선택해 주세요.')
  }
  if(cfg.groupBy==='category') {
    const category=byId(cfg.categoryFieldId)
    if(!category||!CATEGORY_TYPES.has(category.type))throw new Error('카테고리 속성을 선택해 주세요.')
  }
  if(cfg.aggregate!=='count'){
    const value=byId(cfg.valueFieldId)
    if(!value||!NUMBER_TYPES.has(value.type))throw new Error('숫자 속성을 선택해 주세요.')
  }
}
type NotionProperty = Record<string, any>
type NotionPage = {properties: Record<string, NotionProperty>;created_time?:string;last_edited_time?:string}
function property(page:NotionPage,id:string){return Object.values(page.properties||{}).find(p=>p?.id===id)}
function getDate(page:NotionPage,id:string):string|null{
  if(id==='__created_time')return page.created_time?.slice(0,10)||null
  if(id==='__last_edited_time')return page.last_edited_time?.slice(0,10)||null
  const p=property(page,id)
  if(!p)return null
  if(p.type==='date')return p.date?.start?.slice(0,10)||null
  return null
}
function getNumber(page:NotionPage,id:string):number|null{
  const p=property(page,id)
  if(!p)return null
  const v=p.type==='number'?p.number:p.type==='formula'?p.formula?.number:p.type==='rollup'?p.rollup?.number:null
  return typeof v==='number' && Number.isFinite(v)?v:null
}
function getCategories(page:NotionPage,id:string):string[]{
  const p=property(page,id)
  if(!p)return ['미분류']
  if(p.type==='select')return [p.select?.name||'미분류']
  if(p.type==='status')return [p.status?.name||'미분류']
  if(p.type==='checkbox')return [p.checkbox?'완료':'미완료']
  if(p.type==='multi_select')return p.multi_select?.length?p.multi_select.map((t:{name:string})=>t.name):['미분류']
  return ['미분류']
}
export function aggregatePages(pages:NotionPage[],cfg:ChartRequest): {data:DataPoint[];recordCount:number;groupCount:number}{
  const groups=new Map<string,{total:number;count:number}>()
  let recordCount=0
  for(const page of pages){
    const date=cfg.dateFieldId?getDate(page,cfg.dateFieldId):null
    if((cfg.groupBy!=='category'||cfg.dateFrom||cfg.dateTo)&&!date)continue
    if((cfg.dateFrom && date! < cfg.dateFrom) || (cfg.dateTo && date! > cfg.dateTo))continue
    const n=cfg.aggregate==='count'?1:getNumber(page,cfg.valueFieldId)
    if(n===null)continue
    const labels=cfg.groupBy==='category'?[...new Set(getCategories(page,cfg.categoryFieldId))]:[cfg.groupBy==='month'?date!.slice(0,7):date!]
    recordCount++
    for(const label of labels){
      const old=groups.get(label)||{total:0,count:0}
      groups.set(label,{total:old.total+n,count:old.count+1})
    }
  }
  if(groups.size>36)throw new Error('그룹이 36개를 초과합니다. 기간이나 분류를 줄여 주세요.')
  const data=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([label,s])=>({label,value:cfg.aggregate==='avg'?Number((s.total/s.count).toFixed(2)):s.total}))
  return {data,recordCount,groupCount:data.length}
}
export function fieldsFromSchema(dataSource:any):Field[]{
  const props=Object.entries(dataSource.properties||{}).map(([name,p])=>({id:String((p as any).id||name),name,type:String((p as any).type||'unknown')}))
  return [...props,{id:'__created_time',name:'생성일',type:'created_time'},{id:'__last_edited_time',name:'수정일',type:'last_edited_time'}]
}
