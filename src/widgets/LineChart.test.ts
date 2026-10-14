import { describe, expect, it } from 'vitest'
import { lineGeometry } from './LineChart'

const data=(values:number[])=>values.map((value,i)=>({label:String(i),value}))

describe('momentum curve',()=>{
  it('keeps the smooth curve within adjacent values, including sign crossings and plateaus',()=>{
    const {points,path}=lineGeometry(data([-20,-2,30,5,-30,-10,10,40,20,0,23,48,48,48,-20]))
    const segments=[...path.matchAll(/C ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g)]
    expect(segments.length).toBe(points.length-1)
    for(let i=0;i<segments.length;i++){
      const a=points[i],b=points[i+1],c1=Number(segments[i][2]),c2=Number(segments[i][4])
      for(let j=0;j<=20;j++){
        const t=j/20,y=(1-t)**3*a.y+3*(1-t)**2*t*c1+3*(1-t)*t*t*c2+t**3*b.y
        expect(y).toBeGreaterThanOrEqual(Math.min(a.y,b.y)-1e-9)
        expect(y).toBeLessThanOrEqual(Math.max(a.y,b.y)+1e-9)
      }
    }
  })
  it.each([[0],[-5],[5],[0,0,0],[-5,-5],[5,5],[-1e6,1e6],[-0.001,0.001]])('places finite points and the zero baseline inside the plot for %j',(...values:number[])=>{
    const {points,zero}=lineGeometry(data(values))
    expect(zero).toBeGreaterThanOrEqual(24)
    expect(zero).toBeLessThanOrEqual(236)
    for(const point of points){
      expect(Number.isFinite(point.x)&&Number.isFinite(point.y)).toBe(true)
      expect(point.y).toBeGreaterThanOrEqual(24)
      expect(point.y).toBeLessThanOrEqual(236)
    }
  })
  it('places negative and positive values on opposite sides of zero',()=>{
    const {points,zero}=lineGeometry(data([-20,0,48]))
    expect(points[0].y).toBeGreaterThan(zero)
    expect(points[1].y).toBe(zero)
    expect(points[2].y).toBeLessThan(zero)
  })
})
