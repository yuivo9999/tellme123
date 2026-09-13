/* TellMe123 Story Contract Core */
(function(root){
  'use strict';
  const CN_DAY={零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12,十三:13,十四:14,十五:15,十六:16,十七:17,十八:18,十九:19,二十:20};
  const WORDS=[['凌晨',3],['清晨',6],['早晨',7],['早上',8],['上午',9],['中午',12],['正午',12],['午后',14],['下午',15],['黄昏',18],['傍晚',18],['晚上',19],['夜晚',20],['夜里',20],['入夜',19],['深夜',23],['半夜',0],['子时',23],['卯时',5],['辰时',7],['巳时',9],['午时',12],['未时',13],['申时',15],['酉时',17],['戌时',19],['亥时',21]];
  function ordinal(v){
    const s=String(v||'').trim(); if(!s) return null; let day=null,m=s.match(/第\s*(\d+)\s*(?:天|日)/);
    if(m) day=+m[1]; else {m=s.match(/第\s*([一二三四五六七八九十]+)\s*(?:天|日)/); if(m) day=CN_DAY[m[1]]??null;}
    if(day==null&&/次[日天]|翌[日天]/.test(s)) day=2; if(day==null&&/当[日天]|本[日天]/.test(s)) day=1;
    let h=-1; for(const [w,n] of WORDS){if(s.includes(w)){h=n;break;}}
    if(h<0){m=s.match(/第\s*(\d+)\s*个?小时|(\d+)\s*(?:点|时)/);if(m)h=+(m[1]||m[2]);}
    if(day==null&&h<0)return null; return ((day==null?1:day)-1)*24+(h<0?0:h);
  }
  function spanDays(a,b){const x=ordinal(a),y=ordinal(b);if(x==null||y==null||y<x)return null;return Math.floor(y/24)-Math.floor(x/24)+1;}
  function rangeFromText(raw){const t=String(raw||'').trim();if(!t)return{raw:'',from:'',to:''};let m=t.match(/起点\s*[=：:]\s*([^；;\n]+?)(?=\s*(?:[；;]|终点\s*[=：:]))/),e=t.match(/终点\s*[=：:]\s*([^；;\n]+?)(?:\s*[；;].*)?$/);if(m||e)return{raw:t,from:(m?m[1]:'').trim(),to:(e?e[1]:'').trim()};m=t.match(/(?:从\s*)?(.+?)\s*(?:到|至|—|–|→|->)\s*(.+)$/);return m?{raw:t,from:m[1].trim(),to:m[2].trim()}:{raw:t,from:t,to:t};}
  function dayMarkers(text){return Array.from(new Set((String(text||'').match(/第\s*(?:\d+|[一二三四五六七八九十]+)\s*(?:日|天)/g)||[]).map(x=>x.replace(/\s+/g,''))));}
  function validateChapterContract(x){x=x||{};const p=x.planned||{},o=x.observed||{},c=x.card||{},issues=[],from=String(p.from||'').trim(),to=String(p.to||'').trim(),pf=ordinal(from),pt=ordinal(to),ot=ordinal(o.time||''),days=spanDays(from,to);if(pf!=null&&pt!=null&&pt<pf)issues.push({code:'TIME_PLAN_REVERSED',severity:'fail',message:'计划时间终点早于起点'});if(pt!=null&&ot!=null&&ot<pt)issues.push({code:'TIME_COVERAGE_INSUFFICIENT',severity:'fail',message:`正文观测收尾「${o.time}」仍早于计划终点「${to}」`});else if(pt!=null&&ot==null&&days>=2)issues.push({code:'TIME_END_UNCONFIRMED',severity:'warn',message:`多日跨度（${days}日）但正文状态无法确认章末是否抵达「${to}」`});const beats=String(c.beats||p.beats||p.beatsText||'');if(days>=2&&dayMarkers(beats).length<2)issues.push({code:'TIME_SKELETON_INSUFFICIENT',severity:'fail',message:`计划跨度 ${days} 日，但本章推进骨架未明确展开至少两个日期节点`});const status=issues.some(i=>i.severity==='fail')?'FAIL':issues.length?'WARN':'PASS';return{status,issues,planned:{from,to,days},observedTime:String(o.time||'').trim(),dayMarkers:dayMarkers(beats)};}
  root.TellMeStoryContract={version:1,ordinal,spanDays,rangeFromText,dayMarkers,validateChapterContract};
})(window);
