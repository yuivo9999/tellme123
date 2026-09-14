/* TellMe123 runtime contract audit.
 * This is intentionally additive: it observes the existing app state and never
 * replaces the existing AI generation path. It turns timing mistakes into a
 * machine-readable audit result and a visible chapter badge.
 */
(function(root){
  'use strict';
  const CORE=root.TellMeStoryContract;
  if(!CORE) return;
  const SCHEMA_VERSION=3;
  let lastStateSignature='';
  const notified=new Set();

  function ensureSchema(){
    try{
      if(!root.state || !root.state.outline) return;
      const o=root.state.outline;
      if(Number(o._schemaVersion||0)<SCHEMA_VERSION) o._schemaVersion=SCHEMA_VERSION;
      o._contractAudit=o._contractAudit||{};
      const ss=o._storyState;
      if(ss){
        ss.contractSchema=SCHEMA_VERSION;
        ss.chapters=ss.chapters||{};
      }
    }catch(e){}
  }

  function auditChapter(i, persistIt){
    try{
      const o=root.state&&root.state.outline, ss=o&&o._storyState;
      if(!ss || !ss.chapters || !ss.chapters[i]) return null;
      const row=ss.chapters[i], planned=row.planned||{}, observed=row.observed||{};
      const card=row.card||{};
      const result=CORE.validateChapterContract({planned,observed,card});
      const prev=o._contractAudit[i];
      const comparable=JSON.stringify(result);
      if(!prev || JSON.stringify(prev.result)!==comparable){
        o._contractAudit[i]={version:SCHEMA_VERSION,result,checkedAt:Date.now()};
        row.contractAudit=o._contractAudit[i];
        if(persistIt && typeof root.persist==='function') root.persist();
      }
      if(result.status==='FAIL' && !notified.has(i+':'+comparable)){
        notified.add(i+':'+comparable);
        if(typeof root.toast==='function') root.toast(`第${i+1}章时间合同校验失败：${result.issues[0]?.message||'请检查剧情时间落点与推进骨架'}`);
      }
      return result;
    }catch(e){ return null; }
  }

  function auditAll(){
    ensureSchema();
    const ss=root.state&&root.state.outline&&root.state.outline._storyState;
    if(!ss||!ss.chapters) return [];
    const out=[];
    Object.keys(ss.chapters).forEach(k=>{ const r=auditChapter(Number(k),false); if(r) out.push({chapter:Number(k)+1,result:r}); });
    return out;
  }

  function paintBadges(){
    const rootView=document.getElementById('view'); if(!rootView) return;
    const o=root.state&&root.state.outline, audits=o&&o._contractAudit||{};
    rootView.querySelectorAll('[data-ch-card]').forEach(card=>{
      const i=Number(card.getAttribute('data-ch-card')); if(!Number.isInteger(i)) return;
      const result=audits[i]&&audits[i].result; if(!result) return;
      let el=card.querySelector('[data-contract-audit]');
      if(!el){ el=document.createElement('span'); el.setAttribute('data-contract-audit','1'); el.style.cssText='font-size:11px;padding:2px 6px;border-radius:999px;border:1px solid var(--line);white-space:nowrap;'; const host=card.querySelector('.pill'); if(host&&host.parentNode) host.parentNode.insertBefore(el,host); }
      const label=result.status==='FAIL'?'⚠ 时间合同失败':result.status==='WARN'?'△ 时间待核验':'✓ 时间合同';
      el.textContent=label;
      el.title=(result.issues||[]).map(x=>x.message).join('；')||'时间合同通过';
    });
  }

  function tick(){
    ensureSchema();
    const ss=root.state&&root.state.outline&&root.state.outline._storyState;
    const sig=ss ? JSON.stringify(Object.keys(ss.chapters||{}).map(k=>{const r=ss.chapters[k]||{};return [k,r.observed?.time,r.planned?.to,r.planned?.coverage,r.card?.beats];})) : '';
    if(sig!==lastStateSignature){ lastStateSignature=sig; auditAll(); paintBadges(); }
    else paintBadges();
  }

  root.tellmeAuditChapter=auditChapter;
  root.tellmeAuditAllChapters=auditAll;
  root.tellmeStoryContractVersion=SCHEMA_VERSION;
  ensureSchema();
  if(root.document){
    root.addEventListener('DOMContentLoaded',tick,{once:false});
    const view=root.document.getElementById('view');
    if(view && root.MutationObserver) new MutationObserver(function(){ paintBadges(); }).observe(view,{childList:true,subtree:true});
  }
  root.setTimeout(function(){ tick(); root.setInterval(tick,1500); },300);
})(window);
