import type { WidgetId } from './config'
export type WidgetInfo = {id:WidgetId;name:string;subtitle:string;description:string;category:string;emoji:string;accent:string;tag:string;features:string[]}
export const registry:WidgetInfo[] = [
  {id:'daily-word',name:'Daily Word',subtitle:'오늘의 작은 발견',description:'하루 한 단어, 오래 남는 배움. 뜻을 가리고 맞혀보세요.',category:'Study',emoji:'📖',accent:'peach',tag:'Daily pick',features:['날짜별 단어','뜻 가리기','학습 완료 기록']},
  {id:'flashcard',name:'Flashcard Deck',subtitle:'뒤집어 보고, 기억하기',description:'영단어 카드를 넘기며 가볍게 반복 학습해요.',category:'Study',emoji:'🗂️',accent:'lilac',tag:'Interactive',features:['카드 뒤집기','다음 카드','복습 표시']},
  {id:'focus-garden',name:'Focus Garden',subtitle:'집중이 자라는 정원',description:'시간을 차곡차곡 쌓아 나만의 식물을 키워보세요.',category:'Focus',emoji:'🪴',accent:'green',tag:'Popular',features:['집중 타이머','성장 보상','누적 세션']},
  {id:'habit-stamps',name:'Habit Stamps',subtitle:'작은 체크, 큰 변화',description:'귀여운 스탬프로 오늘의 습관을 기록해요.',category:'Focus',emoji:'✅',accent:'yellow',tag:'Daily',features:['습관 체크','7일 기록','완료 개수']},
  {id:'roulette',name:'Decision Roulette',subtitle:'고민은 룰렛에게',description:'선택지가 너무 많을 때, 재밌게 하나 뽑아보세요.',category:'Play',emoji:'🎯',accent:'pink',tag:'Just for fun',features:['선택지 편집','룰렛 회전','랜덤 결과']},
  {id:'mini-charts',name:'Mini Charts',subtitle:'숫자도 귀엽게',description:'간단한 데이터를 막대, 선, 도넛 그래프로 바꿔요.',category:'Data',emoji:'📊',accent:'blue',tag:'Utility',features:['3종 차트','데이터 편집','항목 탐색']},
  {id:'smart-clock',name:'Smart Clock',subtitle:'지금, 이 순간',description:'내 페이지에 어울리는 깔끔한 시계를 놓아보세요.',category:'Utility',emoji:'⏰',accent:'gray',tag:'Essential',features:['디지털·아날로그','시간대 변경','12/24시간']}
]
export function widgetById(id: WidgetId) {return registry.find(x=>x.id===id)!}
