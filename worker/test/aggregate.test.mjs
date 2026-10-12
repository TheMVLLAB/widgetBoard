import test from 'node:test';import assert from 'node:assert/strict'
import {aggregatePages,parseChartRequest,validateFields,fieldsFromSchema} from '../src/aggregate.ts'
const config={sourceKey:'study',dateFieldId:'d',valueFieldId:'n',categoryFieldId:'c',groupBy:'month',aggregate:'sum',dateFrom:'2026-01-01',dateTo:'2026-12-31'}
const row=(date,value,category)=>({properties:{Date:{id:'d',type:'date',date:{start:date}},Cost:{id:'n',type:'number',number:value},Category:{id:'c',type:'select',select:{name:category}}}})
test('sum, count, average and filtering',()=>{
 const pages=[row('2026-10-01',120,'A'),row('2026-10-09',-20,'A'),row('2026-09-15',5,'B')]
 assert.deepEqual(aggregatePages(pages,config).data,[{label:'2026-09',value:5},{label:'2026-10',value:100}])
 assert.deepEqual(aggregatePages(pages,{...config,groupBy:'category',aggregate:'count'}).data,[{label:'A',value:2},{label:'B',value:1}])
 assert.deepEqual(aggregatePages(pages,{...config,aggregate:'avg',dateFrom:'2026-10-01'}).data,[{label:'2026-10',value:50}])
})
test('invalid dates and types rejected',()=>{
 assert.throws(()=>parseChartRequest({...config,dateFrom:'2026-02-30'}))
 assert.throws(()=>parseChartRequest({...config,sourceKey:'../../secrets'}))
 assert.throws(()=>validateFields(config,[{id:'d',name:'Date',type:'date'}]))
 assert.equal(fieldsFromSchema({properties:{Date:{id:'d',type:'date'}}})[0].id,'d')
})
test('missing values omitted and multiple tags double count per group',()=>{
 const p=row('2026-10-01',10,'A');p.properties.Category={id:'c',type:'multi_select',multi_select:[{name:'A'},{name:'B'}]}
 assert.deepEqual(aggregatePages([p],{...config,groupBy:'category',aggregate:'sum'}).data,[{label:'A',value:10},{label:'B',value:10}])
})
