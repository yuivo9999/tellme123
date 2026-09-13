'use strict';

const APP_VERSION = '1.0.336';
const KEY_CFG = nsKey('cfg');

let _bgTaskCount = 0;
let _bgTaskLabel = '';
function startBgTask(label){ _bgTaskCount++; if(label) _bgTaskLabel = String(label); updateBgTaskIndicator(); }
function endBgTask(){ _bgTaskCount = Math.max(0, _bgTaskCount - 1); updateBgTaskIndicator(); }
function updateBgTaskIndicator(){
  const el = $('#bgTaskIndicator');
  if(!el) return;
  if(_bgTaskCount > 0){
    el.textContent = '⏳ 后台任务 ' + _bgTaskCount + ' 项进行中' + (_bgTaskLabel ? '：' + _bgTaskLabel : '') + '…';
    el.style.display = '';
  } else {
    if(!_bgTaskCount) _bgTaskLabel = '';
    el.style.display = 'none';
  }
}
window.addEventListener('beforeunload', e => {
  if(_bgTaskCount > 0 || state.generating){
    e.preventDefault();
    e.returnValue = '后台任务尚未完成，确定要离开吗？';
  }
});
const KEY_STATE = nsKey('state');
const KEY_INDEX = nsKey('index');
const KEY_PROJ_PREFIX = nsKey('proj_');
const KEY_GLIB = nsKey('glib');
const LS_SINGLE_SAFE = 4.5 * 1024 * 1024;
function lsKeyFor(id){ return KEY_PROJ_PREFIX + id; }
;(function migrateSharedOnce(){
  try{
    const mark = nsKey('_nsmig_v1');
    if(localStorage.getItem(mark)) return;   // 本命名空间已迁移过
    const pairs = [
      ['cfg','fyp_cfg'], ['state','fyp_state'], ['index','fyp_index'], ['glib','fyp_glib'],
      ['lib','fyp_lib'], ['toastLog_v1','fyp_toastLog_v1'],
      ['ailog','fyp_ailog'], ['aiRecipeHist_v1','fyp_aiRecipeHist_v1']
    ];
    for(const [nk, oldk] of pairs){
      const np = nsKey(nk);
      const raw = localStorage.getItem(oldk);
      if(raw != null){ try{ if(localStorage.getItem(np) == null) localStorage.setItem(np, raw); }catch(e){} }
    }
    const keysSnapshot = [];
    for(let i=0; i<localStorage.length; i++){ const k = localStorage.key(i); if(k) keysSnapshot.push(k); }
    const prefPairs = [['proj_','fyp_proj_'], ['rp_','fyp_rp_']];
    for(const [np, op] of prefPairs){
      const opl = op.length;
      for(const k of keysSnapshot){
        if(k.indexOf(op) !== 0) continue;
        const nk = nsKey(np) + k.slice(opl);
        const v = localStorage.getItem(k);
        if(v != null){ try{ if(localStorage.getItem(nk) == null) localStorage.setItem(nk, v); }catch(e){} }
      }
    }
    try{ localStorage.setItem(mark, '1'); }catch(e){}
  }catch(e){}
})();
const MAX_PROJECTS = 500;
let lib = { curId: null, items: [] }; // {curId, items:[{id, idea, outline, ..., step, title, logline, updatedAt}]}
let gglib = [];

const state = {
  mode: 'shortfilm',    // 'shortfilm' 短片 / 'longnovel' 经典长篇小说
  wordRange: null,      // (兼容遗留) 不再作为长篇必填；保留字段避免旧快照破坏
  chapterRange: null,   // (兼容遗留) 同上
  totalWords: null,     // (兼容遗留) 同上
  chapterCount: null,   // 全书章节数量（整数 1-200，生成大纲前唯一必填数字；null=未设）
  idea: '',
  coverPrompt: '',      // 整部小说封面提示词（场景页生成 / 长篇模式用）
  coverWithTitle: false,// 封面提示词是否包含「汉字书名」（false=纯画面无文字）
  outline: null,        // {title, logline, chapters:[{title,summary}]}
  outlineConfirmed: false,
  glossAdherence: 80,
  glossAllowFill: false,
  gsCollapsed: false,
  cpCollapsed: false,   // 学校模式：规划师卡默认展开，初始态即铺开其内容（含🏫学校区）
  ctCollapsed: false,
  soCollapsed: false,
  gsCatFold: { main:false, support:false, walkon:false, place:false, proper:false, sub:false },
  deCollapsed: false,
  polishCollapsed: false,
  subAutoFill: true,
  subRecallRatio: 0.4,
  timeAnchor: true,
  timeAnchorsAuto: true,
  teamShape: 'solo',
  bookBeat: 7,
  openingStrategy: 'auto',
  dictmasterHistory: [],
  dictmasterLatest: null,
  dictmasterRan: false,
  originalIdeaSnapshot: '',
  titleWriteBack: false,
  langLayer: true,
  _narrIron: true,
  banList: null,
  useChapterPlans: true,
  plannerFinalized: false,
  chapters: [],         // [{title, content, confirmed, editHistory:[]}]
  characters: [],       // [{name, role, profile:{...}, prompts:{...}}]
  expSel: [],           // 长篇导出勾选的章节索引（随项目快照持久化，P3-4）
  expOpenGroups: [],    // 长篇导出章节选择：手动展开的分组序号（配合限高内滚+分组折叠，缓解超长章节列表，P5）
  hist: { characters:[], scenes:[], cover:[], storyboard:[] },
  chapterStyle: { tags: [], collapsed: false },   // 写作风格（v2.0）：tags=风格id数组（多选，归入章节风格组）
  scenes: [],           // [{name, 作用, description, prompt}]
  storyboard: [],       // [{镜号,章节,时长,景别,角度,运镜,主体,构图,光线,画面描述,对白,转场,出图提示词,连续性,剪辑动机}]
  boardConcepts: [],    // 每章一条 {视觉概念, 母题}（分镜生成时随章节返回）
  titleHistory: [],     // 曾用书名记录 [{name, date}]（改名时追加，最新在前）
  raw: {},              // 容错：各阶段原始返回
  longMemory: { uiOpen: false, foreshadow: [], lastAuditAt: 0 },
};
let currentStep = 1;

state.fcCollapsed = (typeof state.fcCollapsed === 'boolean') ? state.fcCollapsed : false;
state.rsCollapsed = (typeof state.rsCollapsed === 'boolean') ? state.rsCollapsed : false;
state._fixQueue = state._fixQueue || [];
state._chapterPartial = state._chapterPartial || {};
state.timeAnchorsAuto = (typeof state.timeAnchorsAuto === 'boolean') ? state.timeAnchorsAuto : true;
state.timeAnchor = true; // 遗留兼容：已弃用，时间是否生效改为以 outline._globalTimeline 是否存在为准
function _timeAnchorOn(){ const _gt = state.outline && state.outline._globalTimeline; return !!_gt && ( (String(_gt.text||'').trim()) || (Array.isArray(_gt.chapters) && _gt.chapters.length) ); }
function _timeAnchorsAutoOn(){ return isLong() && state.timeAnchorsAuto !== false; }
function _timeBranch(s){ s = String(s||'').trim(); if(!s) return ''; const i = s.search(/[·|｜.．:：－\-]/); return i>0 ? s.slice(0,i).trim() : s; }
function _cnDayNum(n){ const t={'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20}; return t[n]!=null ? t[n] : null; }
function _timeOrdinal(s){
  s = String(s||'').trim(); if(!s) return null;
  let day = null;
  const d1 = s.match(/第\s*(\d+)\s*天/); if(d1) day = +d1[1];
  else { const d2 = s.match(/第\s*([一二三四五六七八九十]+)\s*天/); if(d2) day = _cnDayNum(d2[1]); }
  if(day==null && /次[日天]|翌[日天]/.test(s)) day = 2;
  else if(day==null && /当[日天]|本[日天]/.test(s)) day = 1;
  const hrWords=[['凌晨',3],['清晨',6],['早晨',7],['早上',8],['上午',9],['中午',12],['正午',12],['午后',14],['下午',15],['黄昏',18],['傍晚',18],['晚上',19],['夜晚',20],['夜里',20],['入夜',19],['深夜',23],['半夜',0],['子时',23],['卯时',5],['辰时',7],['巳时',9],['午时',12],['未时',13],['申时',15],['酉时',17],['戌时',19],['亥时',21]];
  let hr=-1; for(const [w,h] of hrWords){ if(s.includes(w)){ hr=h; break; } }
  if(hr===-1){ const hf=s.match(/第\s*(\d+)\s*个?小时|(\d+)\s*(?:点|时)/); if(hf&&(hf[1]||hf[2])) hr = +(hf[1]||hf[2]); }
  if(day==null && hr===-1) return null;
  return ((day==null?0:day-1)*24) + (hr===-1?0:hr);
}
function _timeRewind(a, b){
  if(!String(a||'').trim() || !String(b||'').trim()) return false;
  if(_timeBranch(a) !== _timeBranch(b)) return false;
  const oa = _timeOrdinal(a), ob = _timeOrdinal(b);
  if(oa==null || ob==null) return false;
  return oa > ob;
}

state.aiNetwork = state.aiNetwork || {
  stage: 'idle',          // idle / idea / recipe / outline / titles / plan / writing / review
  running: [],            // 当前正在运行的 AI kind 列表
  completed: [],          // 已完成的 AI kind 列表
  blockedBy: {}           // 每个 AI 被谁阻塞
};

function normalizeOutline(o){
  if(!o) return;
  if(o.structure) delete o.structure;
  o._rollingSummaries = o._rollingSummaries || [];
  o._factCard = o._factCard || { characters:{}, timeline:[], lastScene:'' };
  if(Array.isArray(o.chapterPlans)){
    o.chapterPlans = o.chapterPlans.map(p => {
      if(typeof p === 'string') return { beatsText:'', emotionalArc:'', requiredEntities:[] };   // 旧字符串形态（原主线简述）视为旧数据，直接丢弃
      p = p || {};
      delete p.summary; delete p.advance;   // 主线简述/主线推进字段已彻底移除
      delete p.beats;
      p.requiredEntities = Array.isArray(p.requiredEntities) ? p.requiredEntities : [];
      return p;
    });
  }
  if(o._mainlineLedger) delete o._mainlineLedger;   // 主线进度账随主线简述一并移除（旧存档静默清理）
  if(o._beatsHist) delete o._beatsHist;
}

let charFilters = {q:'', idents:[], gender:'', ageMin:'', ageMax:''};
let charTS = [];
function destroyCharTS(){ charTS.forEach(t=>{ try{ t.destroy(); }catch(e){} }); charTS = []; }
function parseAge(s){
  if(s==null || s==='') return null;
  const m = String(s).match(/\d+/);
  return m ? +m[0] : null;
}

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const TOAST_LOG_KEY = nsKey('toastLog_v1');
function toastLogPush(msg){
  try{
    const a = JSON.parse(localStorage.getItem(TOAST_LOG_KEY)||'[]');
    a.push({ ts: Date.now(), msg: String(msg??'') });
    while(a.length > 200) a.shift();
    localStorage.setItem(TOAST_LOG_KEY, JSON.stringify(a));
  }catch(e){}
}
function toastLogGet(){ try{ return JSON.parse(localStorage.getItem(TOAST_LOG_KEY)||'[]'); }catch(e){ return []; } }
function toastLogClear(){ try{ localStorage.removeItem(TOAST_LOG_KEY); }catch(e){} }
function toast(msg){
  const t = $('#toast');
  toastLogPush(msg);
  t.innerHTML = `<span class="toast-msg">${esc(String(msg??''))}</span><button type="button" class="toast-hist" title="打开消息看板，回看全部提示" data-toast-board>📋</button>`;
  const hb = t.querySelector('[data-toast-board]'); if(hb) hb.onclick = (e)=>{ e.stopPropagation(); openToastBoard(); };
  t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.add('hidden'), 4200);
}
const SND_KEY = (typeof nsKey==='function') ? nsKey('snd') : 'tz_snd_done';
const SND_VOL_KEY = (typeof nsKey==='function') ? nsKey('snd_vol') : 'tz_snd_vol';
const _snd = { ctx:null, enabled:_sndEnabled(), vol:_sndVol() };
function _sndEnabled(){ try{ return localStorage.getItem(SND_KEY) !== '0'; }catch(e){ return true; } }
function _sndVol(){ // 0..1
  try{ const v = parseFloat(localStorage.getItem(SND_VOL_KEY)); return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8; }catch(e){ return 0.8; }
}
function unlockAudio(){
  if(!_snd.enabled) return;
  try{
    if(!_snd.ctx){ const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return; _snd.ctx = new AC(); }
    if(_snd.ctx.state === 'suspended') _snd.ctx.resume().catch(()=>{});
  }catch(e){}
}
function _sndBeep(freq, start, dur, gain){ // 单音（正弦包络：快起快落，避免刺耳）
  if(!_snd.ctx) return;
  try{
    const base = (gain||0.22) * (_snd.vol||0);
    if(base < 0.001) return;   // 音量调至 0 时静音
    const o = _snd.ctx.createOscillator(), g = _snd.ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(_snd.ctx.destination);
    const t = _snd.ctx.currentTime + (start||0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(base, t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t+(dur||0.18));
    o.start(t); o.stop(t+(dur||0.18)+0.05);
  }catch(e){}
}
const SND_SINGLE_PRESETS = [
  { id:'be_paper',  name:'纸页轻响',   seq:[[523.25,0,0.08],[659.25,0.09,0.16]] },
  { id:'be_piano',  name:'柔钢琴点',   seq:[[659.25,0,0.22]] },
  { id:'be_glass',  name:'晶石轻触',   seq:[[783.99,0,0.11],[1046.5,0.13,0.22]] },
  { id:'be_bell',   name:'小钟清鸣',   seq:[[880.0,0,0.12],[1174.66,0.15,0.25]] },
  { id:'be_wood',   name:'木铃短拍',   seq:[[587.33,0,0.09],[783.99,0.11,0.18]] },
  { id:'be_spark',  name:'星屑三音',   seq:[[659.25,0,0.08],[880.0,0.1,0.09],[1318.51,0.21,0.22]] }
];
const SND_ALL_PRESETS = [
  { id:'al_piano',   name:'钢琴上行',   seq:[[523.25,0,0.11],[659.25,0.12,0.12],[783.99,0.25,0.24]] },
  { id:'al_glass',   name:'晶石琶音',   seq:[[659.25,0,0.08],[783.99,0.09,0.08],[1046.5,0.18,0.1],[1318.51,0.3,0.24]] },
  { id:'al_chime',   name:'风铃庆成',   seq:[[783.99,0,0.1],[1046.5,0.11,0.1],[1318.51,0.23,0.28]] },
  { id:'al_chord',   name:'柔和和弦',   seq:[[523.25,0,0.14],[659.25,0.02,0.14],[783.99,0.04,0.22]] },
  { id:'al_spark',   name:'星光四步',   seq:[[659.25,0,0.08],[783.99,0.1,0.08],[1046.5,0.2,0.1],[1567.98,0.32,0.24]] },
  { id:'al_finish',  name:'完成回响',   seq:[[587.33,0,0.1],[783.99,0.12,0.11],[987.77,0.25,0.12],[1174.66,0.39,0.3]] }
];
const SND_TSINGLE_KEY = (typeof nsKey==='function') ? nsKey('snd_t_beats') : 'tz_snd_t_beats'; // 键名沿用旧值，保留用户已选音色
const SND_TALL_KEY   = (typeof nsKey==='function') ? nsKey('snd_t_all')   : 'tz_snd_t_all';
function _sndSingleType(){ try{ const v = localStorage.getItem(SND_TSINGLE_KEY); return SND_SINGLE_PRESETS.some(x=>x.id===v) ? v : 'be_dingdong'; }catch(e){ return 'be_dingdong'; } }
function _sndAllType(){   try{ const v = localStorage.getItem(SND_TALL_KEY);   return SND_ALL_PRESETS.some(x=>x.id===v) ? v : 'al_up2';   }catch(e){ return 'al_up2';   } }
function setSoundSingleType(id){ try{ if(SND_SINGLE_PRESETS.some(x=>x.id===id)) localStorage.setItem(SND_TSINGLE_KEY, id); }catch(e){} }
function setSoundAllType(id){   try{ if(SND_ALL_PRESETS.some(x=>x.id===id))   localStorage.setItem(SND_TALL_KEY,   id); }catch(e){} }
let _lastSoundTs = 0;
let _lastSoundKind = '';
let _soundTimer = null;
function _doPlaySound(kind){
  if(!_snd.enabled) return;
  unlockAudio();
  if(!_snd.ctx || _snd.ctx.state !== 'running') return;
  const lib = (kind==='all') ? SND_ALL_PRESETS : SND_SINGLE_PRESETS;
  const id  = (kind==='all') ? _sndAllType()   : _sndSingleType();
  const p = lib.find(x=>x.id===id) || lib[0];
  (p.seq||[]).forEach(s=> _sndBeep(s[0], s[1], s[2]));
}
function playDoneSound(kind){ // kind:'single' 单个完成 | 'all' 全部完成 —— 各用各的音色库，智能去重防冲突
  if(!_snd.enabled) return;
  const now = Date.now();
  if(kind === 'all'){
    if(_soundTimer){ clearTimeout(_soundTimer); _soundTimer = null; }
    _lastSoundTs = now;
    _lastSoundKind = 'all';
    _doPlaySound('all');
    return;
  }
  if(kind === 'single'){
    if(now - _lastSoundTs < 450 && _lastSoundKind === 'all') return;
    if(_soundTimer) clearTimeout(_soundTimer);
    _soundTimer = setTimeout(()=>{
      _soundTimer = null;
      _lastSoundTs = Date.now();
      _lastSoundKind = 'single';
      _doPlaySound('single');
    }, 120);
  }
}
function initThemeSoundPanel(){
  const sb = document.getElementById('cfgSndSingle'), sa = document.getElementById('cfgSndAll');
  const optsB = SND_SINGLE_PRESETS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  const optsA = SND_ALL_PRESETS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  if(sb){
    if(!sb._tsf){ sb.innerHTML = optsB; sb._tsf = 1; }
    sb.value = _sndSingleType();
    if(!sb._tsb){ sb._tsb = 1; sb.addEventListener('change', ()=>{ setSoundSingleType(sb.value); }); }
  }
  if(sa){
    if(!sa._tsf){ sa.innerHTML = optsA; sa._tsf = 1; }
    sa.value = _sndAllType();
    if(!sa._tsb){ sa._tsb = 1; sa.addEventListener('change', ()=>{ setSoundAllType(sa.value); }); }
  }
  $$('[data-snd-prev]').forEach(b=>{ if(b._tsb) return; b._tsb = 1;
    b.addEventListener('click', (ev)=>{ ev.stopPropagation(); playDoneSound(b.dataset.sndPrev); }); });
}
function setSoundEnabled(on){
  try{ localStorage.setItem(SND_KEY, on?'1':'0'); }catch(e){}
  _snd.enabled = on;
  const s = document.getElementById('cfgSoundDone'); if(s) s.checked = on;
  const c = document.getElementById('cpsSoundDone'); if(c) c.checked = on;
}
function setSoundVol(pct){
  pct = Math.min(100, Math.max(0, Math.round(pct||0)));
  _snd.vol = pct/100;
  try{ localStorage.setItem(SND_VOL_KEY, String(_snd.vol)); }catch(e){}
  const sv = document.getElementById('cfgSoundVol'); if(sv) sv.value = pct;
  const svl = document.getElementById('cfgSoundVolLabel'); if(svl) svl.textContent = pct + '%';
  const cv = document.getElementById('cpsSoundVol'); if(cv) cv.value = pct;
  const cvl = document.getElementById('cpsSoundVolLb'); if(cvl) cvl.textContent = pct + '%';
}
function bindPlannerSoundTool(){
  const ok = document.getElementById('cpsSoundDone');
  const vol = document.getElementById('cpsSoundVol');
  const lb = document.getElementById('cpsSoundVolLb');
  if(!ok && !vol) return;
  if(ok) ok.checked = _sndEnabled();
  if(vol){ vol.value = Math.round((_snd.vol||0)*100); if(lb) lb.textContent = vol.value + '%'; }
  if(ok && !ok._cpsBound){
    ok._cpsBound = true;
    ok.addEventListener('change', ()=> setSoundEnabled(!!ok.checked));
  }
  if(vol && !vol._cpsBound){
    vol._cpsBound = true;
    vol.addEventListener('input', ()=>{ setSoundVol(+vol.value||0); if(lb) lb.textContent = Math.round((_snd.vol||0)*100) + '%'; });
    vol.addEventListener('change', ()=>{ playDoneSound('single'); });   // 松开音量滑杆即试听一声
  }
}
window.addEventListener('pointerdown', unlockAudio, {capture:true});
window.addEventListener('keydown', unlockAudio, {capture:true});
window.addEventListener('touchend', unlockAudio, {capture:true});
(function initSoundUI(){
  const apply = ()=>{ const el = document.getElementById('cfgSoundDone'); if(el) el.checked = _sndEnabled();
    const vl = document.getElementById('cfgSoundVol'), lb = document.getElementById('cfgSoundVolLabel');
    if(vl){ vl.value = Math.round((_snd.vol||0)*100); if(lb) lb.textContent = vl.value + '%'; } };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  const bind = ()=>{ const el = document.getElementById('cfgSoundDone'); if(!el) return;
    el.addEventListener('change', ()=> setSoundEnabled(!!el.checked));
    const vl = document.getElementById('cfgSoundVol');
    if(vl){
      vl.addEventListener('input', ()=>{ setSoundVol(+vl.value||0); });
    } };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
function openToastBoard(){
  const old = $('#toastBoardPanel'); if(old) old.remove();
  const ov = document.createElement('div'); ov.id='toastBoardPanel'; ov.className='gs-overlay';
  const list = toastLogGet().slice().reverse();
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📜 消息看板（${list.length}）</b>
        <span style="display:flex;gap:6px">
          <button class="btn small ghost" data-tb-clear>清空</button>
          <button class="gs-x" data-tb-close>✕</button>
        </span></div>
      <div class="cv-body">
        ${list.length ? list.map(x=>`<div class="tb-row"><span class="tb-ts">${new Date(x.ts).toLocaleString('zh-CN',{hour12:false})}</span><span class="tb-msg">${esc(x.msg)}</span></div>`).join('') : '<p class="muted">暂无消息记录。</p>'}
      </div>
    </div>`;
  ov.addEventListener('click', e=>{
    if(e.target.closest('[data-tb-close]') || e.target===ov){ ov.remove(); return; }
    if(e.target.closest('[data-tb-clear]')){ toastLogClear(); ov.remove(); openToastBoard(); return; }
  });
  document.body.appendChild(ov);
}
async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast('已复制');
  }catch(e){
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); toast('已复制');
  }
}
function esc(s){ return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function download(name, text){
  const blob = new Blob([text], {type:'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

const CJK_ALL = /\p{Script=Han}|[\u3000-\u303f\uff00-\uffef]/gu;
const EN_WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
function countWords(text){
  text = String(text||'');
  const cjk = (text.match(CJK_ALL)||[]).length;
  const rest = text.replace(CJK_ALL, ' ');
  const en = (rest.match(EN_WORD)||[]).length;
  return {cjk, en, total: cjk + en};
}
function wcInner(w){
  const fmt = n => n.toLocaleString('en-US');
  return `📝 <b>${fmt(w.total)}</b><i>字</i>`;
}
function wcBadge(text, attrs){
  const w = countWords(text);
  return `<span class="wc" ${attrs||''} title="中文 ${w.cjk} 字 · 英文 ${w.en} 词">${wcInner(w)}</span>`;
}

let uidSeq = 1000;
let genBatchN = 2;
function remainingEmptyChapters(){ return (state.chapters||[]).filter(c=> !(c.content && String(c.content).trim())).length; }
function uid(p){ return (p||'id')+(++uidSeq)+'-'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
const TM_KEYS = ['idea',
  'principal', 'teacher', 'dictmaster', 'dictEnrich',
  'chapter',
  'strip', 'subplot', 'glossary', 'rolling',
  'contentAdvice', 'assets', 'recipe'];

function glmModels(){ return [
  {name:'glm-4.5-air', label:'GLM-4.5-Air（智谱 · 高性价比，现用）', kind:'pro'},
  {name:'glm-4.5',      label:'GLM-4.5（智谱 · 旗舰满血版）',      kind:'pro'}
]; }
function deepseekModels(){ return [
  {name:'deepseek-v4-pro', label:'deepseek-v4-pro（质量最高，推荐）', kind:'pro'},
  {name:'deepseek-v4-flash', label:'deepseek-v4-flash（最快/最便宜）', kind:'flash'},
  {name:'deepseek-v4-flash-vision-exp', label:'deepseek-v4-flash-vision-exp（带视觉）', kind:'flash'}
]; }
function defaultModels(){ return glmModels().concat(deepseekModels()); }
function cfgZhipuGroup(){ return {id:'zhipu', kind:'openai', label:'智谱 GLM', baseUrl:'https://open.bigmodel.cn/api/paas/v4', keys:[], models:glmModels(), keyInBody:false}; }
function cfgDeepSeekGroup(){ return {id:'deepseek', kind:'openai', label:'DeepSeek 官方', baseUrl:'https://api.deepseek.com', keys:[], models:deepseekModels()}; }

function normalizeCfg(cfg){
  cfg = cfg || {};
  if(!Array.isArray(cfg.groups)){
    const gz = cfgZhipuGroup();
    const gd = cfgDeepSeekGroup();
    if(cfg.apiKey){
      const id = uid('k');
      gd.keys.push({id, label:'默认账号', key:cfg.apiKey});
      cfg.groups = [gz, gd];
      cfg.active = { groupId:'deepseek', keyId:id, model: cfg.model || 'deepseek-v4-pro' };
    } else {
      cfg.groups = [gz, gd];
      cfg.active = { groupId:'zhipu', keyId: (gz.keys[0]||{}).id||null, model: (gz.models[0]||{}).name || 'glm-4.5-air' };
    }
  }
  const _seenG = new Set();
  cfg.groups.forEach(gr=>{
    if(!gr.id || _seenG.has(gr.id)) gr.id = uid('g');
    _seenG.add(gr.id);
  });
  cfg.groups.forEach((gr,i)=>{
    gr.kind = gr.kind || 'openai';
    gr.baseUrl = gr.baseUrl || '';
    gr.keyInBody = !!gr.keyInBody;
    gr.keys = (gr.keys||[]).map((k,j)=>({id: k.id||uid('k'), label: k.label||('账号'+(j+1)), key: k.key||''}));
    gr.models = (gr.models && gr.models.length) ? gr.models : defaultModels();
  });
  const act = cfg.active || {};
  const group = cfg.groups.find(g=>g.id===act.groupId) || cfg.groups[0];
  if(group){
    const key = group.keys.find(k=>k.id===act.keyId) || group.keys[0];
    const model = group.models.find(m=>m.name===act.model)
      || group.models.find(m=>m.name==='glm-4.5-air') || group.models[0];
    cfg.active = { groupId: group.id, keyId: key ? key.id : null, model: model ? model.name : (group.models[0] ? group.models[0].name : '') };
  } else {
    cfg.active = { groupId:null, keyId:null, model:'' };
  }
  const _srcTM = (cfg.taskModels && typeof cfg.taskModels === 'object') ? cfg.taskModels : {};
  const _tm = {};
  TM_KEYS.forEach(k=>{
    const v = _srcTM[k];
    _tm[k] = (v && typeof v==='object' && v.groupId && v.keyId && v.model)
      ? { groupId:String(v.groupId), keyId:String(v.keyId), model:String(v.model) } : '';
  });
  cfg.taskModels = _tm;
  return cfg;
}
function getCfg(){
  try{ return normalizeCfg(JSON.parse(localStorage.getItem(KEY_CFG)) || {}); }catch(e){ return normalizeCfg({}); }
}
function saveCfg(cfg){ localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); }

function resolveActiveSpec(taskKey){
  const cfg = getCfg();
  const act = cfg.active || {};
  let group = cfg.groups.find(g=>g.id===act.groupId) || cfg.groups[0] || {};
  let key = (group.keys||[]).find(k=>k.id===act.keyId) || (group.keys||[])[0] || {};
  let model = (group.models||[]).find(m=>m.name===act.model) || (group.models||[])[0] || {};
  const _tm = taskKey ? (cfg.taskModels||{})[taskKey] : null;
  let _overridden = false;
  if(_tm){
    const tg = cfg.groups.find(g=>g.id===_tm.groupId);
    if(tg){
      const tk = (tg.keys||[]).find(k=>k.id===_tm.keyId) || (tg.keys||[])[0] || {};
      const tmod = (tg.models||[]).find(m=>m.name===_tm.model) || (tg.models||[])[0] || {};
      group = tg; key = tk; model = tmod; _overridden = true;
    }
  }
  return {
    taskKey: taskKey || '',
    taskOverride: _overridden,
    groupId: group.id, groupLabel: group.label,
    keyId: key.id, keyLabel: key.label,
    baseUrl: (group.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey: key.key || '',
    keyInBody: !!group.keyInBody,
    model: model.name || 'deepseek-v4-pro',
    temperature: (cfg.temperature==null ? 0.6 : cfg.temperature),
    ideaTemp:    (cfg.ideaTemp==null ? 0.5 : cfg.ideaTemp),
    principalTemp:(cfg.principalTemp==null ? 0.4 : cfg.principalTemp),
    teacherTemp: (cfg.teacherTemp==null ? 0.4 : cfg.teacherTemp),
    dictmasterTemp: (cfg.dictmasterTemp==null ? 0.4 : cfg.dictmasterTemp),
    dictEnrichTemp: (cfg.dictEnrichTemp==null ? 0.4 : cfg.dictEnrichTemp),
    assetsTemp:  (cfg.assetsTemp==null ? 0.7 : cfg.assetsTemp),
    titleTemp:   (cfg.titleTemp==null ? 0.5 : cfg.titleTemp),
    chapterTemp: (cfg.chapterTemp==null ? 0.5 : cfg.chapterTemp),
    qcTemp:      (cfg.qcTemp==null ? 0.2 : cfg.qcTemp),              // 分任务温度：词库提取（严谨低温）
    stripTemp:   (cfg.stripTemp==null ? 1.0 : cfg.stripTemp),
    subplotTemp: (cfg.subplotTemp==null ? 0.25 : cfg.subplotTemp),    // 分任务温度：支线进度更新（契约类窄采样）
    rollingTemp: (cfg.rollingTemp==null ? 0.3 : cfg.rollingTemp),    // 分任务温度：滚动摘要（忠实压缩）
    contentAdviseTemp: (cfg.contentAdviseTemp==null ? 0.6 : cfg.contentAdviseTemp),  // 分任务温度：内容建议（建议类）
    aiRecipeTemp:(cfg.aiRecipeTemp==null ? 0.9 : cfg.aiRecipeTemp)
  };
}
function currentSpecLabel(){
  const s = resolveActiveSpec();
  const model = s.model.replace('deepseek-v4-','').split('-')[0];
  return (s.groupLabel||'AI') + ' · ' + (s.keyLabel||'默认') + ' · ' + model;
}
function currentIsDeepSeek(){
  const s = resolveActiveSpec();
  return /deepseek/i.test(s.model||'') || /deepseek/i.test(s.groupId||'')
      || /doubao/i.test(s.model||'') || /doubao/i.test(s.groupId||'');
}

const THEMES = ['dark','light','blackboard','mecha','cyber','guofeng','aurora','paper'];
function applyTheme(theme){
  if(THEMES.indexOf(theme) < 0) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  const c = getCfg(); c.theme = theme; saveCfg(c);
  const mtn = $('#mechaTopNav');
  if(mtn) mtn.classList.toggle('hidden', theme !== 'mecha');
  document.body.classList.toggle('has-mecha-bg', theme === 'mecha');
  document.body.classList.toggle('has-cyber-bg', theme === 'cyber');
  document.body.classList.toggle('has-guofeng-bg', theme === 'guofeng');
  $$('.theme-btns .theme').forEach(b=> b.classList.toggle('active', b.dataset.theme === theme));
  updateMechaNav();
  updateWcTotal(); // 主题切换后刷新内嵌总字数
}
function restartCascade(){
  if(document.documentElement.getAttribute('data-theme') !== 'blackboard') return;
  const v = $('#view'); if(!v) return;
  v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
}

function makeId(){ return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function projectSnapshot(){
  return {
    mode: state.mode || 'shortfilm',
    wordRange: state.wordRange || null,
    chapterRange: state.chapterRange || null,
    totalWords: state.totalWords || null,
    chapterCount: (state.chapterCount && +state.chapterCount>0) ? +state.chapterCount : null,
    bookBeat: currentBookBeatId(),
    openingStrategy: currentOpeningStrategyId(),
    idea: state.idea,
    coverPrompt: state.coverPrompt,
    coverWithTitle: state.coverWithTitle,
    outline: state.outline,
    outlineConfirmed: state.outlineConfirmed,
    glossAdherence: state.glossAdherence,
    glossAllowFill: state.glossAllowFill,
    glossSeenTs: Number(state._glossSeenTs) || 0,
    langLayer: (typeof state.langLayer === 'boolean') ? state.langLayer : true,
    _narrIron: state._narrIron,
    banList: (state.banList && typeof state.banList === 'object') ? normalizeBanList(state.banList) : null,
    gsCollapsed: state.gsCollapsed,
    cpCollapsed: state.cpCollapsed,
    soCollapsed: !!state.soCollapsed,
    deCollapsed: !!state.deCollapsed,
    polishCollapsed: !!state.polishCollapsed,
    gsCatFold: (state.gsCatFold && typeof state.gsCatFold === 'object') ? state.gsCatFold : { main:false, support:false, walkon:false, place:false, proper:false, sub:false },   // 词典小类别折叠态（仅存结构，运行时各键默认见 state）
    useChapterPlans: true,
    plannerFinalized: !!state.plannerFinalized,
    expOpenGroups: state.expOpenGroups,
    polishOptions: state.polishOptions,
    polishAdopted: state.polishAdopted,
    polishHistory: state.polishHistory,
    chapters: state.chapters,
    characters: state.characters,
    ctAdviceHist: Array.isArray(state.ctAdviceHist) ? state.ctAdviceHist : [],
    contentAdviceHist: Array.isArray(state.contentAdviceHist) ? state.contentAdviceHist : [],
    expSel: Array.isArray(state.expSel) ? state.expSel : [],
    hist: state.hist || { characters:[], scenes:[], cover:[], storyboard:[] },
    chapterStyle: state.chapterStyle || { tags: [], collapsed: false },
    fcCollapsed: !!state.fcCollapsed,
    rsCollapsed: !!state.rsCollapsed,
    _fixQueue: Array.isArray(state._fixQueue) ? state._fixQueue : [],
    aiNetwork: state.aiNetwork || { stage:'idle', running:[], completed:[], blockedBy:{} },
    teamShape: (state.teamShape==='dual'||state.teamShape==='trio'||state.teamShape==='quad'||state.teamShape==='quint') ? state.teamShape : 'solo',
    _chapterPartial: state._chapterPartial || {},
    scenes: state.scenes,
    storyboard: state.storyboard,
    boardConcepts: state.boardConcepts,
    raw: state.raw,
    titleHistory: state.titleHistory,
    step: currentStep,
    title: (state.outline && state.outline.title) || (state.idea ? state.idea.trim().slice(0,20) : '未命名作品'),
    logline: (state.outline && state.outline.logline) || '',
    _lastCpRaw: state._lastCpRaw || '',
    dictmasterHistory: Array.isArray(state.dictmasterHistory) ? state.dictmasterHistory : [],
    dictmasterLatest: state.dictmasterLatest || null,
    dictmasterRan: !!state.dictmasterRan,
    originalIdeaSnapshot: state.originalIdeaSnapshot || '',
    school: (state.school && typeof state.school === 'object') ? state.school : null,   // 学校模式：校长/老师 产出 + 各步重试/完成标记（随项目持久化）
    longMemory: state.longMemory || { uiOpen:false, foreshadow:[], lastAuditAt:0 }
  };
}
function applyProject(p){
  state.mode = (p.mode === 'longnovel') ? 'longnovel' : 'shortfilm';
  state.wordRange = (p.wordRange && p.wordRange.min && p.wordRange.max) ? {min:+p.wordRange.min, max:+p.wordRange.max} : (p.chapterRange ? null : null);
  state.chapterRange = (p.chapterRange && p.chapterRange.min && p.chapterRange.max) ? {min:+p.chapterRange.min, max:+p.chapterRange.max} : null;
  state.totalWords = (p.totalWords && +p.totalWords>0) ? +p.totalWords : null;
  state.chapterCount = (p.chapterCount && +p.chapterCount>0) ? +p.chapterCount : null;
  state.bookBeat = [4,7,12,15].includes(Number(p.bookBeat)) ? Number(p.bookBeat) : (state.bookBeat || BOOK_BEAT_DEFAULT_ID);
  state.openingStrategy = openingStrategyDef(p.openingStrategy) ? p.openingStrategy : 'auto';
  state.longMemory = (p.longMemory && typeof p.longMemory === 'object') ? p.longMemory : { uiOpen:false, foreshadow:[], lastAuditAt:0 };
  state.idea = p.idea || '';
  state.coverPrompt = p.coverPrompt || '';
  state.coverWithTitle = !!p.coverWithTitle;
  state.outline = p.outline || null;
  if(state.outline && state.outline.chapterPlansHistory) delete state.outline.chapterPlansHistory;
  state.outlineConfirmed = !!p.outlineConfirmed;
  state.glossAdherence = (typeof p.glossAdherence === 'number') ? p.glossAdherence : 60;
  state.glossAllowFill = !!p.glossAllowFill;
  state._glossSeenTs = Number(p.glossSeenTs) || 0;
  state.langLayer = (typeof p.langLayer === 'boolean') ? p.langLayer : true;
  state._narrIron = (typeof p._narrIron === 'boolean') ? p._narrIron : true;
  state.banList = (p.banList && typeof p.banList === 'object') ? normalizeBanList(p.banList) : null;
  state.gsCollapsed = (typeof p.gsCollapsed === 'boolean') ? p.gsCollapsed : false;
  state.cpCollapsed = (typeof p.cpCollapsed === 'boolean') ? p.cpCollapsed : true;
  state.soCollapsed = !!p.soCollapsed;
  state.deCollapsed = !!p.deCollapsed;
  state.polishCollapsed = !!p.polishCollapsed;
  state.gsCatFold = (p.gsCatFold && typeof p.gsCatFold === 'object') ? p.gsCatFold : { main:false, support:false, walkon:false, place:false, proper:false, sub:false };   // 词典小类别折叠态恢复
  const _gcf = state.gsCatFold; if(_gcf && typeof _gcf === 'object'){ ['main','support','walkon'].forEach(k=>{ if(typeof _gcf[k] !== 'boolean') _gcf[k] = false; }); }
  state.useChapterPlans = true;
  state.plannerFinalized = (typeof p.plannerFinalized === 'boolean') ? p.plannerFinalized : false;
  state.expOpenGroups = Array.isArray(p.expOpenGroups) ? p.expOpenGroups : [];
  state.polishOptions = Array.isArray(p.polishOptions) ? p.polishOptions : undefined;
  state.polishAdopted = (typeof p.polishAdopted === 'string') ? p.polishAdopted : undefined;
  state.polishHistory = Array.isArray(p.polishHistory) ? p.polishHistory : undefined;
  state.chapters = p.chapters || [];
  (state.chapters||[]).forEach(c=>{ if(c) delete c.qcRecord; });
  if(state.outline) delete state.outline.titleQC;
  (state.chapters||[]).forEach(c=>{ if(c){ delete c.volume; delete c.volumeTheme; } });
  if(state.outline){ delete state.outline.volumes; delete state.outline._volumes; if(state.outline.structure) delete state.outline.structure; }
  state.characters = p.characters || [];
  state.ctAdviceHist = Array.isArray(p.ctAdviceHist) ? p.ctAdviceHist : [];
  state.contentAdviceHist = Array.isArray(p.contentAdviceHist) ? p.contentAdviceHist : [];
  state.expSel = Array.isArray(p.expSel) ? p.expSel.filter(i=> Number.isInteger(i)) : [];
  state.hist = (p.hist && typeof p.hist === 'object') ? {
    characters: Array.isArray(p.hist.characters)?p.hist.characters:[],
    scenes: Array.isArray(p.hist.scenes)?p.hist.scenes:[],
    cover: Array.isArray(p.hist.cover)?p.hist.cover:[],
    storyboard: Array.isArray(p.hist.storyboard)?p.hist.storyboard:[]
  } : { characters:[], scenes:[], cover:[], storyboard:[] };
  state.chapterStyle = (p.chapterStyle && typeof p.chapterStyle === 'object')
    ? { tags: Array.isArray(p.chapterStyle.tags)?p.chapterStyle.tags:[], collapsed: !!p.chapterStyle.collapsed }
    : { tags: [], collapsed: false };
  wsDraft = null;
  state.scenes = p.scenes || [];
  state.storyboard = p.storyboard || [];
  state.boardConcepts = p.boardConcepts || [];
  state._lastCpRaw = p._lastCpRaw || '';
  state.titleHistory = Array.isArray(p.titleHistory) ? p.titleHistory : [];
  state.raw = p.raw || {};
  currentStep = (p.step && p.step >= 1 && p.step <= 5) ? p.step : 1;
  state.fcCollapsed = !!p.fcCollapsed;
  state.rsCollapsed = !!p.rsCollapsed;
  state._fixQueue = Array.isArray(p._fixQueue) ? p._fixQueue : [];
  state.aiNetwork = (p.aiNetwork && typeof p.aiNetwork === 'object') ? p.aiNetwork : { stage:'idle', running:[], completed:[], blockedBy:{} };
  state.dictmasterHistory = Array.isArray(p.dictmasterHistory) ? p.dictmasterHistory : [];
  state.dictmasterLatest = (p.dictmasterLatest && typeof p.dictmasterLatest === 'object') ? p.dictmasterLatest : null;
  state.dictmasterRan = !!p.dictmasterRan;
  state.originalIdeaSnapshot = (typeof p.originalIdeaSnapshot === 'string') ? p.originalIdeaSnapshot : '';
  state.school = (p.school && typeof p.school === 'object') ? p.school : null;   // 学校模式恢复（校长/老师 产出 + 重试/完成标记）
  if(!state.school || typeof state.school !== 'object') state.school = {};
  if(!state.school.finished || typeof state.school.finished !== 'object') state.school.finished = {};
  if(!state.school.retries || typeof state.school.retries !== 'object') state.school.retries = {};
  if(!Array.isArray(state.school.teachers)) state.school.teachers = [];
  state.teamShape = (p.teamShape==='dual'||p.teamShape==='trio'||p.teamShape==='quad'||p.teamShape==='quint') ? p.teamShape : 'solo';
  state._chapterPartial = (p._chapterPartial && typeof p._chapterPartial === 'object') ? p._chapterPartial : {};
  normalizeOutline(state.outline);
}
function clearState(){
  state.mode = 'shortfilm';
  state.wordRange = null; state.chapterRange = null; state.totalWords = null; state.chapterCount = null;
  state.idea = ''; state.outline = null; state.coverPrompt = ''; state.coverWithTitle = false; state.outlineConfirmed = false;
  state.glossAdherence = 60; state.glossAllowFill = false; state.gsCollapsed = false;
  state.langLayer = true;
  state._narrIron = true;
  state.banList = null;
  state.useChapterPlans = true;
  state.chapters = []; state.characters = []; state.scenes = []; state.storyboard = []; state.boardConcepts = []; state.titleHistory = []; state.raw = {};
  state.ctAdviceHist = []; state.contentAdviceHist = [];
  state.expSel = [];
  state.hist = { characters:[], scenes:[], cover:[], storyboard:[] };
  state.chapterStyle = { tags: [], collapsed: false };
  state.fcCollapsed = false; state.rsCollapsed = false;
  state._fixQueue = [];
  state.dictmasterHistory = [];
  state.dictmasterLatest = null;
  state.dictmasterRan = false;
  state.originalIdeaSnapshot = '';
  state.school = null;   // 学校模式：新项目/重置清空（校长/老师产出 + 重试/完成标记）
  state.longMemory = { uiOpen:false, foreshadow:[], lastAuditAt:0 };
  state.teamShape = 'solo';
  state.openingStrategy = 'auto';
  state.polishCollapsed = false;
  state._chapterPartial = {};
  state.aiNetwork = { stage:'idle', running:[], completed:[], blockedBy:{} };
  state._lastCpRaw = '';
  wsDraft = null;
  currentStep = 1;
}
function writeOneProjectRecord(p){
  if(!p || !p.id) return 'ls';
  try{
    const s = JSON.stringify(p);
    if(s && s.length > LS_SINGLE_SAFE) throw new Error('over-ls-limit');
    localStorage.setItem(lsKeyFor(p.id), s);
    return 'ls';
  }catch(e){
    try{ idbPut(p).catch(function(){}); }catch(e2){}
    try{ localStorage.removeItem(lsKeyFor(p.id)); }catch(e3){}   // 清掉旧的 localStorage 版，避免读到旧数据
    return 'idb';
  }
}
function removeOneProjectRecord(id, wasSt){
  try{ localStorage.removeItem(lsKeyFor(id)); }catch(e){}
  if(wasSt === 'idb' || wasSt == null){ try{ idbDelete(id).catch(function(){}); }catch(e){} }
}
function idbSaveLib(){
  const ids = new Set(lib.items.map(i=> i.id));
  let oldIdx = null;
  try{ oldIdx = JSON.parse(localStorage.getItem(KEY_INDEX)); }catch(e){}
  const oldSt = (oldIdx && oldIdx.st && typeof oldIdx.st === 'object') ? oldIdx.st : {};
  const oldIds = (oldIdx && Array.isArray(oldIdx.ids)) ? oldIdx.ids : [];
  const st = {};
  for(const p of lib.items){
    const isNew = !oldIds.includes(p.id);
    if(p.id === lib.curId || isNew){
      st[p.id] = writeOneProjectRecord(p);
    }else{
      st[p.id] = oldSt[p.id] || 'ls';
    }
  }
  for(const oldId of oldIds){
    if(!ids.has(oldId)) removeOneProjectRecord(oldId, oldSt[oldId]);
  }
  const idx = { curId: lib.curId, ids: lib.items.map(i=> i.id), st };
  try{ localStorage.setItem(KEY_INDEX, JSON.stringify(idx)); }catch(e){}
}
function saveLib(){
  idbSaveLib();   // 同步写 localStorage（降级项目异步写 IDB）
}
function robustSaveLib(){
  while(lib.items.length > MAX_PROJECTS){
    const others = lib.items.filter(i=> i.id !== lib.curId);
    if(!others.length) break;
    others.sort((a,b)=> (a.updatedAt||0) - (b.updatedAt||0));
    lib.items = lib.items.filter(i=> i.id !== others[0].id);
  }
  idbSaveLib();
}
async function loadState(){
  clearState();
  let idx = null;
  try{ idx = JSON.parse(localStorage.getItem(KEY_INDEX)); }catch(e){}
  const ids = (idx && Array.isArray(idx.ids)) ? idx.ids : [];
  const stMap = (idx && idx.st && typeof idx.st === 'object') ? idx.st : {};
  const curId = (idx && idx.curId) || null;
  const items = [];
  for(const id of ids){
    try{
      let p = null;
      if(stMap[id] === 'idb'){
        if(idbAvailable()) p = await idbGet(id);   // 降级项目从 IDB 单条读
      }else{
        const raw = localStorage.getItem(lsKeyFor(id));
        if(raw){ try{ p = JSON.parse(raw); }catch(e){ p = null; } }
      }
      if(p && typeof p === 'object' && p.id) items.push(p);
    }catch(e){ /* 单条损坏/缺失则跳过，不影响其余项目 */ }
  }
  if(items.length){
    lib = { curId: curId, items: items };
    if(!lib.items.some(i=> i.id === lib.curId)) lib.curId = lib.items[0].id;
    const cur = lib.items.find(i=> i.id === lib.curId);
    if(cur) applyProject(cur);
    return;
  }
  if(await migrateLegacyLibrary()) return;
  migrateOldState();
}
async function migrateLegacyLibrary(){
  let legacy = [];
  try{
    const raw = localStorage.getItem(nsKey('lib'));
    if(raw){
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.items)) ? parsed.items : null;
      const curId = (!Array.isArray(parsed) && parsed && parsed.curId) ? parsed.curId : null;
      if(Array.isArray(arr)) legacy = legacy.concat(arr.filter(x=> x && typeof x === 'object' && x.id));
      if(curId && !legacy.some(x=> x.id === curId)){ /* 找不到 curId 归属，忽略 */ }
    }
  }catch(e){}
  try{
    if(idbAvailable() && typeof idbListLegacy === 'function'){
      const list = await idbListLegacy();
      if(Array.isArray(list)) legacy = legacy.concat(list.filter(x=> x && typeof x === 'object' && x.id));
    }
  }catch(e){}
  if(!legacy.length) return false;
  const byId = {};
  legacy.forEach(x=>{ if(x && x.id) byId[x.id] = x; });
  const merged = Object.keys(byId).map(id=>{
    const p = byId[id];
    const snap = normalizeLegacyProject(p);
    return { ...snap, id: id, updatedAt: p.updatedAt || Date.now() };
  });
  if(!merged.length) return false;
  const prevCur = lib && lib.curId;
  lib = { curId: prevCur || merged[0].id, items: merged };
  idbSaveLib();   // 写新索引 + 逐项目（localStorage 单条，超限自动降级）
  const cur = lib.items.find(i=> i.id === lib.curId) || lib.items[0];
  if(cur){ lib.curId = cur.id; applyProject(cur); }
  try{ localStorage.removeItem(nsKey('lib')); }catch(e){}   // 一次性：本站迁移完成即清空本 ns 副本（共享裸 fyp_lib 保留，供其它站各自迁移）
  return true;
}
function normalizeLegacyProject(p){
  const s = p && typeof p === 'object' ? p : {};
  const out = {};
  out.mode = (s.mode === 'longnovel' || s.mode === 'long') ? 'longnovel' : (s.mode || 'shortfilm');
  out.mode = (out.mode === 'long') ? 'longnovel' : out.mode;
  out.mode = (out.mode === 'short' || out.mode === 'shortfilm') ? 'shortfilm' : out.mode;
  out.idea = s.idea != null ? s.idea : '';
  out.outline = s.outline || null;
  out.outlineConfirmed = !!s.outlineConfirmed;
  out.chapters = Array.isArray(s.chapters) ? s.chapters : [];
  out.characters = Array.isArray(s.characters) ? s.characters : [];
  out.scenes = Array.isArray(s.scenes) ? s.scenes : [];
  out.storyboard = Array.isArray(s.storyboard) ? s.storyboard : [];
  out.qcRecord = undefined;   // 无残留
  if(out.outline) delete out.outline.titleQC;
  out.longMemory = (s.longMemory && typeof s.longMemory === 'object') ? s.longMemory : { uiOpen:false, foreshadow:[], lastAuditAt:0 };
  out.chapterStyle = (s.chapterStyle && typeof s.chapterStyle === 'object')
    ? { tags: Array.isArray(s.chapterStyle.tags)?s.chapterStyle.tags:[], collapsed:!!s.chapterStyle.collapsed }
    : { tags:[], collapsed:false };
  out.glossAdherence = (typeof s.glossAdherence === 'number') ? s.glossAdherence : 60;
  out.langLayer = (s.langLayer === undefined) ? true : !!s.langLayer;
  out._narrIron = (s._narrIron === undefined) ? true : !!s._narrIron;
  out.banList = (s.banList && typeof s.banList === 'object') ? normalizeBanList(s.banList) : null;
  out.ctAdviceHist = Array.isArray(s.ctAdviceHist) ? s.ctAdviceHist : [];
  out.contentAdviceHist = Array.isArray(s.contentAdviceHist) ? s.contentAdviceHist : [];
  out.hist = (s.hist && typeof s.hist === 'object') ? s.hist : { characters:[], scenes:[], cover:[], storyboard:[] };
  out.title = s.title || (s.outline && s.outline.title) || '';
  out.logline = s.logline || (s.outline && s.outline.logline) || '';
  out.step = (s.step && s.step >= 1) ? s.step : (out.outlineConfirmed ? 4 : (out.outline ? 2 : 1));
  return out;
}
function migrateOldState(){
  try{
    const s = JSON.parse(localStorage.getItem(KEY_STATE));
    if(!s || typeof s !== 'object') return;
    Object.assign(state, s);
    state.raw = s.raw || {};
    currentStep = (s.step && s.step >= 1 && s.step <= 5) ? s.step : 1;
    const snap = projectSnapshot();
    lib = { curId: snap.id = makeId(), items: [{ ...snap, updatedAt: Date.now() }] };
    saveLib();
    localStorage.removeItem(KEY_STATE);
  }catch(e){}
}
function persist(){
  if(!lib.items.some(i=> i.id === lib.curId)){
    const snap = projectSnapshot();
    const newId = makeId();
    lib.items.unshift({ ...snap, id: newId, updatedAt: Date.now() });
    lib.curId = newId;
  }
  const idx = lib.items.findIndex(i=> i.id === lib.curId);
  if(idx >= 0){
    const snap = projectSnapshot();
    lib.items[idx] = { ...snap, id: lib.curId, updatedAt: Date.now() };
  }
  robustSaveLib();
}


const KEY_AILOG = nsKey('ailog');
let aiLog = [];   // [{ts, task, temp, sys, user, resp, ms, ok, err}]
(function loadAiLog(){ try{ aiLog = JSON.parse(localStorage.getItem(KEY_AILOG)) || []; }catch(e){ aiLog = []; } })();
function aiLogPush(rec){
  aiLog.push(rec);
  if(aiLog.length > 50) aiLog.splice(0, aiLog.length - 50);
  try{ localStorage.setItem(KEY_AILOG, JSON.stringify(aiLog)); }catch(e){ /* 存储满则仅内存保留 */ }
}
function aiLogClear(){ aiLog = []; try{ localStorage.removeItem(KEY_AILOG); }catch(e){} }
function openAiLogPanel(){
  closeAiLogPanel();
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')+':'+String(d.getSeconds()).padStart(2,'0'); };
  const rows = aiLog.length ? [...aiLog].reverse().map((r,ri)=>{
    const task = String(r.task||'').slice(0,40);
    return `<div class="ailog-row">
      <div class="ailog-head">
        <span class="ailog-time">${fmtTs(r.ts)}</span>
        <span class="ailog-task">${esc(task||'（无任务名）')}</span>
        <span class="ailog-meta">${r.temp!=null?('🌡 '+r.temp):''} · ${r.ms!=null?(r.ms+'ms'):''} · <b class="${r.ok?'ok':'err'}">${r.ok?'✓':'✗'}</b>${r.tmo?` · 🎯${esc(String(r.tm||''))}（分任务覆盖）`:''}</span>
        <button type="button" class="btn small ghost" data-ailog-toggle="${ri}">展开</button>
      </div>
      <div class="ailog-body hidden" data-ailog-body="${ri}">
        ${r.err?`<div class="ailog-sec"><b>错误：</b><span class="err">${esc(r.err)}</span></div>`:''}
        <div class="ailog-sec"><b>System · 前500字 / 共 ${(r.sysLen||r.sys.length).toLocaleString('en-US')} 字：</b><div class="ailog-pre">${esc(String(r.sys||''))}</div></div>
        <div class="ailog-sec"><b>User · 前500字 / 共 ${(r.userLen||r.user.length).toLocaleString('en-US')} 字：</b><div class="ailog-pre">${esc(String(r.user||''))}</div></div>
        <div class="ailog-sec"><b>响应 · 前500字 / 共 ${(r.respLen||0).toLocaleString('en-US')} 字：</b><div class="ailog-pre">${esc(String(r.resp||''))}</div></div>
        <p class="muted" style="font-size:11px">50000 字仅为日志预览上限，实际发送/接收为全量，不影响请求。</p>
      </div>
    </div>`;
  }).join('') : '<p class="muted">暂无请求记录。每次调用 AI 都会记录（最近 50 0条，仅存本机）。</p>';
  const ov = document.createElement('div'); ov.id='ailogPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🗒️ AI 请求日志（${aiLog.length}/500）</b>
        <span style="display:flex;gap:6px">
          <button class="gs-x" data-ailog-close>✕</button>
        </span></div>
        <div style="display:flex;gap:6px;padding:0 16px 8px"><button class="btn small ghost" data-ailog-clear>🗑 清空</button></div>
      <div class="cv-body">
        <div class="cv-div">本地请求与响应日志，可一键清空。</div>
        ${rows}
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-ailog-close]').onclick = closeAiLogPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeAiLogPanel(); });
  ov.addEventListener('click', e=>{
    const b = e.target.closest('[data-ailog-toggle]'); if(!b) return;
    const body = ov.querySelector('[data-ailog-body="'+b.dataset.ailogToggle+'"]');
    if(body) body.classList.toggle('hidden');
  });
  ov.querySelector('[data-ailog-clear]').onclick = ()=>{
    if(!window.confirm('清空全部 AI 请求日志？')) return;
    aiLogClear(); closeAiLogPanel(); toast('请求日志已清空');
  };
}
function closeAiLogPanel(){ const p=$('#ailogPanel'); if(p) p.remove(); }

function _f2(x){ const n = Number(x); if(!isFinite(n)) return x; return Math.round(n * 100) / 100; }
async function callDeepSeek(system, user, {temperature=null, topP=null, signal=null, maxTokens=null, onStream=null, retry=2, taskKey=null}={}){
  const _t0 = Date.now();
  function isReasonModel(name){
    const n = String(name||'').toLowerCase();
    return /deepseek-reasoner/.test(n)
      || /(^|[-_/\.])(r1|reasoner|reasoning|think|qwq|1210)([-_/\.]|$)/.test(n)
      || /^(o[134](-[a-z0-9]+)?|grok-4-latest-reasoning|kimi-k2-thinking)$/.test(n);
  }
  const _rec = {
    ts: _t0,
    task: String(system||'').replace(/\s+/g,' ').slice(0,24),
    temp: (temperature==null ? null : temperature),
    sys: String(system||'').slice(0,500),
    user: String(user||'').slice(0,500),
    sysLen: String(system||'').length,
    userLen: String(user||'').length,
    respLen: 0,
    resp: '', ms: null, ok: false, err: '', tm: taskKey || '', tmo: false
  };
  let lastErr;
  for(let attempt=0; attempt<=retry; attempt++){
    try{
      const s = resolveActiveSpec(taskKey);
      if(taskKey) _rec.tmo = !!s.taskOverride;
      if(!s.apiKey) throw new Error('请先在 ⚙️ 配置并选择要使用的 AI 账号（API Key）');
      const url = s.baseUrl + '/chat/completions';
      const streaming = typeof onStream === 'function';
      const _reason = isReasonModel(s.model);
      const body = {
        model: s.model,
        messages: [{role:'system', content: system}, {role:'user', content: user}],
        ...(!_reason ? {
          temperature: _f2(temperature==null ? s.temperature : temperature),
          top_p: _f2(topP==null ? 0.95 : topP)
        } : {}),   // 推理模型通常不支持 temperature/top_p，省略
        stream: streaming
      };
      if(s.keyInBody) body.api_key = s.apiKey;
      if(_reason){
        body.max_completion_tokens = maxTokens && maxTokens>0 ? Math.max(maxTokens, 32768) : 32768;
      } else if(maxTokens && maxTokens>0){
        body.max_tokens = maxTokens;
      }
      const finalSignal = signal || AbortSignal.timeout(180000);
      let res;
      try{
        const hdrs = {'Content-Type':'application/json'};
        if(!s.keyInBody) hdrs['Authorization'] = 'Bearer '+s.apiKey;   // keyInBody 时不发 Bearer 头，规避中转拦截
        if(streaming){ hdrs['Accept'] = 'text/event-stream'; hdrs['Cache-Control'] = 'no-cache'; }
        res = await fetch(url, {
          method:'POST',
          headers: hdrs,
          body: JSON.stringify(body),
          signal: finalSignal
        });
      }catch(e){
        throw new Error('网络/跨域失败：' + e.message + '。若被拦截，可在设置里填一个代理地址。');
      }
      if(!res.ok){
        if(res.status === 429 && attempt < retry){
          const ra = res.headers.get('Retry-After');
          const wait = ra ? parseInt(ra)*1000 : Math.min(4000, 1000*Math.pow(2, attempt));
          await new Promise(r=>setTimeout(r, wait));
          continue;
        }
        let msg = '请求失败 ('+res.status+')';
        try{ const j = await res.json(); if(j.error && j.error.message) msg = j.error.message; }catch(e){}
        throw new Error(msg);
      }
      if(!streaming){
        const data = await res.json();
        const out = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        if(!data.choices || !String(out).trim()){
          throw new Error('响应异常（HTTP 200 但无 choices/content）：' + JSON.stringify(data).slice(0, 160));
        }
        const finishReason = (data.choices && data.choices[0] && data.choices[0].finish_reason) || '';
        const usage = data.usage || null;
        _rec.resp = String(out).slice(0,50000); _rec.respLen = String(out).length; _rec.ms = Date.now()-_t0; _rec.ok = true;
        aiLogPush(_rec);
        return { text: out, finishReason, usage };
      }
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if(!reader) throw new Error('当前浏览器不支持流式响应');
      const decoder = new TextDecoder();
      let buf = '', full = '', finishReason = 'stop';
      const feed = (chunk)=>{
        buf += chunk;
        let nl;
        while((nl = buf.indexOf('\n')) >= 0){
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if(!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if(payload === '[DONE]') continue;
          let j;
          try{ j = JSON.parse(payload); }catch(e){ continue; }
          const delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || '';
          if(delta){ full += delta; onStream(delta); }
          const fr = j.choices && j.choices[0] && j.choices[0].finish_reason;
          if(fr) finishReason = fr;
        }
      };
      while(true){
        const {done, value} = await reader.read();
        if(done) break;
        feed(decoder.decode(value, {stream:true}));
      }
      feed(decoder.decode());
      if(!String(full).trim()){
        throw new Error('响应异常（流式全程无有效内容）');
      }
      _rec.resp = String(full).slice(0,50000); _rec.respLen = String(full).length; _rec.ms = Date.now()-_t0; _rec.ok = true;
      aiLogPush(_rec);
      return { text: full, finishReason, usage: null };
    }catch(e){
      lastErr = e;
      if(signal && signal.aborted){ break; }
      if(attempt >= retry) break;
      await new Promise(r=>setTimeout(r, attempt === 0 ? 2000 : 6000));
    }
  }
  _rec.ms = Date.now()-_t0; _rec.ok = false; _rec.err = (String(lastErr.message||lastErr).slice(0,170) + `（内部已重试 ${retry} 次）`);
  aiLogPush(_rec);
  throw lastErr;
}

function parseJson(text){
  return robustParseJson(text);
}


const AI_ERR = {
  TRUNCATED: 'AI_TRUNCATED',
  PARSE_FAIL: 'AI_PARSE_FAIL',
  COUNT_MISMATCH: 'AI_COUNT_MISMATCH',
  SCHEMA_MISS: 'AI_SCHEMA_MISS',
  TIMEOUT: 'AI_TIMEOUT',
  NETWORK: 'AI_NETWORK'
};

async function callAIWithContract(promise, opt={}){
  const out = { ok:false, text:'', data:null, finishReason:'', usage:null, errorCode:'', error:'' };
  try{
    const res = await promise;
    if(res && typeof res === 'object' && ('text' in res)){
      out.text = String(res.text||'');
      out.finishReason = res.finishReason || '';
      out.usage = res.usage || null;
    } else {
      out.text = String(res||'');
    }
    if(out.finishReason === 'length'){ out.errorCode = AI_ERR.TRUNCATED; out.error='响应被截断'; return out; }
    if(opt.needJson !== false){
      try{ out.data = parseJson(out.text); }catch(e){ out.errorCode=AI_ERR.PARSE_FAIL; out.error='JSON解析失败：'+e.message; return out; }
    }
    if(opt.expectedCount != null && opt.countPath){
      const arr = opt.countPath.split('.').reduce((o,k)=> (o&&o[k]!=null)?o[k]:null, out.data);
      if(!Array.isArray(arr) || arr.length !== opt.expectedCount){
        out.errorCode = AI_ERR.COUNT_MISMATCH;
        out.error = `数量不符：期望 ${opt.expectedCount}，实际 ${Array.isArray(arr)?arr.length:'非数组'}`;
        return out;
      }
    }
    if(opt.schemaValidator && typeof opt.schemaValidator === 'function'){
      const schemaErr = opt.schemaValidator(out.data);
      if(schemaErr){ out.errorCode=AI_ERR.SCHEMA_MISS; out.error=schemaErr; return out; }
    }
    out.ok = true;
  }catch(e){
    out.error = e.message || String(e);
    out.errorCode = (e.name==='AbortError' || /timeout/i.test(out.error)) ? AI_ERR.TIMEOUT : AI_ERR.NETWORK;
  }
  return out;
}

function assertCount(arr, expected, label){
  if(!Array.isArray(arr)) throw new Error(`${label} 不是数组`);
  if(arr.length !== expected) throw new Error(`${label} 数量不符：期望 ${expected}，实际 ${arr.length}`);
}

function robustParseJson(text){
  if(!text) throw new Error('模型返回为空');
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) t = fence[1].trim();
  try{ return JSON.parse(t); }catch(e){}
  const m = t.match(/[\{\[]\s*[\s\S]*[\}\]]/);
  if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
  const fix = t
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
  try{ return JSON.parse(fix); }catch(e){}
  const obj = {};
  const re = /"([^"]+)"\s*:\s*("([^"]*)"|\[[\s\S]*?\]|\{[\s\S]*?\})/g;
  let mm;
  while((mm = re.exec(t)) !== null){
    try{ obj[mm[1]] = JSON.parse(mm[2]); }catch(e){ obj[mm[1]] = mm[2]; }
  }
  if(Object.keys(obj).length > 0) return obj;
  throw new Error('返回不是合法 JSON（已原样保留）');
}

function unwrapAIResult(res){ return (res && typeof res === 'object' && 'text' in res) ? res.text : String(res||''); }

function extractJsonObject(text){
  if(!text) return null;
  const t = String(text).trim();
  try{ return JSON.parse(t); }catch(e){}
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(m){ try{ return JSON.parse(m[1].trim()); }catch(e){} }
  const obj = t.match(/\{[\s\S]*\}/);
  if(obj){ try{ return JSON.parse(obj[0]); }catch(e){} }
  const arr = t.match(/\[[\s\S]*\]/);
  if(arr){ try{ return JSON.parse(arr[0]); }catch(e){} }
  return null;
}
function extractFirstObject(text){
  const t = String(text||'');
  try{ const p = JSON.parse(t); if(p && typeof p === 'object' && !Array.isArray(p)) return p; }catch(e){}
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(m){ try{ const p = JSON.parse(m[1].trim()); if(p && typeof p==='object' && !Array.isArray(p)) return p; }catch(e){} }
  let depth = 0, start = -1, inStr = false, esc = false;
  for(let i=0;i<t.length;i++){
    const c = t[i];
    if(esc){ esc = false; continue; }
    if(c === '\\' && inStr){ esc = true; continue; }
    if(c === '"'){ inStr = !inStr; continue; }
    if(inStr) continue;
    if(c === '{'){ if(start < 0) start = i; depth++; }
    else if(c === '}'){
      depth--;
      if(start >= 0 && depth === 0){
        try{ const o = JSON.parse(t.slice(start, i+1)); if(o && typeof o === 'object' && !Array.isArray(o)) return o; }catch(e){}
        start = -1; depth = 0;
      }
    }
  }
  return null;
}

function salvageOutlineFromText(txt){
  const raw = String(txt||'');
  const compact = raw.replace(/\s+/g,' ').trim();
  const parsed = extractFirstObject(raw);
  if(parsed && String(parsed.title||'').trim() && String(parsed.logline||'').trim()){
    return { o: parsed, salvaged: false };
  }
  const lines = raw.split(/\n+/).map(l => l.replace(/^[#>\-*\s`]+/,'').trim()).filter(Boolean);
  let title  = (parsed && String(parsed.title||'').trim()) || '';
  let logline = (parsed && String(parsed.logline||'').trim()) || '';
  if(!title){
    title = lines.find(l => l.length>=2 && l.length<=40 && !/[。！？]$/.test(l) && !/^\d+[.、：:]/.test(l)) || '';
  }
  if(!logline){
    const cand = lines.find(l => l.length>=6) || '';
    logline = cand.length>180 ? cand.slice(0,180) : cand;
  }
  if(!title){
    const m = compact.match(/[\u4e00-\u9fa5A-Za-z][^。！？\n，,：:]{2,20}(?=[，。！？\n]|$)/);
    if(m) title = m[0].trim();
  }
  if(!logline && title) logline = title;
  if(!title && !logline) return null;
  const o = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  if(!String(o.title||'').trim())   o.title   = title || '（未能识别书名的骨架大纲）';
  if(!String(o.logline||'').trim()) o.logline = logline || '（未能解析简介，请参考原始产出自行整理）';
  if(!Array.isArray(o.chapters)) o.chapters = [];
  o._salvaged = '未能完整解析为标准大纲结构，已自动抢救为可编辑骨架（书名/简介或为推断，请校对后采用）';
  return { o, salvaged: true };
}

function busy(btn, on, label, cls){
  if(on){ btn._txt = btn.innerHTML; btn.disabled = true; btn.classList.add('is-busy'); if(cls) btn.classList.add(cls); btn.innerHTML = '<span class="spinner"></span>'+(label||'生成中…'); }
  else { btn.disabled = false; btn.classList.remove('is-busy'); if(cls) btn.classList.remove(cls); btn.innerHTML = btn._txt; }
}

let _abortCtl = null;           // 当前 AbortController
let _abortBtn = null;           // 当前可见的停止按钮 DOM
function makeStopBtn(){
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'stop-btn'; b.innerHTML = '⏹';
  b.onclick = ()=>{
    if(_abortCtl){ _abortCtl.abort(); _abortCtl = null; }
    hideStopBtn();
  };
  b.style.display = 'none';
  return b;
}
function showStopBtn(parent){
  if(!_abortBtn){ _abortBtn = makeStopBtn(); document.body.appendChild(_abortBtn); }
  _abortCtl = new AbortController();
  _abortBtn.style.display = '';
  parent.appendChild(_abortBtn);
}
function hideStopBtn(){
  if(_abortBtn){ _abortBtn.style.display = 'none'; }
  _abortCtl = null;
}
let _aiOptBusy = false;
function genBusy(){
  if(_aiOptBusy) return true;
  if(_abortCtl) return true;
  const busyAny = document.querySelector('.is-busy, [disabled].cp-gen-btn-loading');
  if(busyAny) return true;
  return false;
}
function guardSwitchStep(){
  if(genBusy()){
    return confirm('当前有生成任务进行中，切换视图会中断其运行，确定继续？');
  }
  return true;
}



const LONG_CHAPTER_SYS_PRO = `你是一位资深长篇小说「章节执行导演」，同时担任本章 consistency 审计员。
【核心任务】基于多层上下文，撰写指定章节的完整正文，并确保在输出前通过内部一致性自检。

【输入上下文层级（L0→L4，优先级递减）】
L0 · 叙事铁律（若开启）：硬铁律（禁则/内心情绪外显/对话口语化/模板词禁用等）与软约束——位于输入上下文最顶层，为最高优先级指令，必须执行。
L1 · 全书导航：书名、简介。
L2 · 本章任务：本章标题、本章节拍表（可依照的素材重心，setup/rise/climax/hook）、本章情绪弧、本章可选用实体（有戏份才落笔，场面不适可不用，禁止为凑名单而生硬点名）。
L3 · 前后衔接：上一章节拍表全文（优先）或上一章正文、上一章结尾状态、下一章标题（仅作承接参照）。
L4 · 滚动摘要与相关设定：最近 3 个滚动摘要区块、相关词典条目（人物/地点/专名）。

【最高优先 · 鲜活性总纲（v1.0.181，优先级高于后续所有编号规则）】
0. 你是在"讲故事"，不是在"交答卷"。下面所有编号硬规则（节拍承接 / 时间锚 / 视角 / 长度 / 输出）约束的是"什么时候不能出错"，是正确性的底线，绝不是"必须照做的写作套路"——不要为了"看起来每一条都做到了"而机械套用、凑模板。正文必须像一位有才华的作者所写：用具体、有画面感的动名词推进；句式长短交错、段落疏密有致；每段写的是本章真实的情绪与进展，而不是"达标工件"。反模板：禁止多个段落/节拍以同类词起头（如连续用时间词、场景词、动作词开段），禁止干巴巴的单句凑数，禁止把时间锚、节拍标签、视角规则等以任何形式原样写进正文。节拍是"剧情推进的参照"，不是"各写各的填空格"——允许按内容需要自然融合节拍、节拍长度不均、节奏快慢不一（紧张处一句顶一句，舒缓处从容铺陈）。当硬规则之间存在张力或某条规则会逼你写出生硬/模板化的句子时，优先保证文字的鲜活、具体与可读。

【输出要求】
1. 仅输出本章正文，不得包含标题、章节序号、元评论、分析、json、markdown 代码块。
1b. 正文末尾**仅允许且必须**追加一行元数据行【本章出场人物】（若本章确有"有名有台词/有戏份"的新增角色）：格式与节拍表的实体清单一致——「人物｜张三｜；人物｜李四｜；地名｜边境镇｜；专名｜玄铁剑｜」，用「类别｜名称｜」分隔、以分号结尾；只列本章新出现且值得被词典收编的核心新实体，**不列**已在词典中、设定已有的常驻名，更不到此登记仅一次出场的氛围路人。若本章没有任何值得收编的新实体，则整行省略。该行仅供「正文收编」环节读取，不计入正文、落库时会被自动剥离。
2. 正文直接以小说段落呈现，段落之间用空行分隔。
3. 正文必须覆盖本章节拍表中的四个事件（setup / rise / climax / hook），不得遗漏；但这些节拍是本章内**按因果连续推进的故事小节，不是几个互不相干的独立片段**——相邻节拍之间必须有自然的衔接与过渡（剧情因果驱动、情绪递进、动作延续，或时间/空间切换的过渡句），严禁生硬跳切、严禁硬转场；只要叙事连续，相邻节拍允许融合在同一场景内连续推进，不必每拍单起一段、各换一个场景。
4. 必须使用本章 requiredEntities 中的全部实体；词典既有实体的设定不得改动或相悖。在此基础上允许按剧情需要自然引入新人物/新地点/新专名，分两类：①有戏份、会再登场或推动情节并值得被词典收编的核心新实体——在文中体现身份/关系等可入典要点，并登记到章末【本章出场人物】（正文自身不直接回填词典，收编统一由「正文收编」环节完成）；②仅作现场氛围的临时路人/小地名/小专名——只一句台词或一个镜头即可，不必刻画任何维度、不入词典、点到即收，也不登记进【本章出场人物】（见【临时闲人】段）。禁止机械式凑数：只在场景自然需要时点缀，绝不为"显得人多"每章硬加、干瘪点名或反复秀存在感。【名字定稿（v244/914）】设定词典已收录的人名/地名/专名一律为最终定稿（含用户手动定名）：必须原样使用，禁止改名、增删字、换写法或自造变体；即便名字看似不合常见命名习惯，也照词典原样使用。
5. 人物言行须符合其性格设定；对话须有辨识度；时间线须与上一章衔接。
6. 若 L0 叙事铁律有禁用词/禁写内容，请在输出前自检：是否已遵守硬铁律的全部禁止项。
7. 结尾须指向下一章标题，埋下线索或悬念，但不得提前揭示下一章具体情节（若上下文未给出下一章标题，则按本章剧情自然收束即可，不强求指向标题）。
8. 正文长度严格以【篇幅体量】块为准，必须在第一次生成时即写足该块硬下限（v1.0.165：取消"不设上限"宽松口径，禁止写成未达下限的梗概式短场景）。
9. 场景与节拍的自然衔接铁律：全章必须是一条连续流动的叙事线——每个节拍事件的结尾自然引出下一个节拍的开头；时间/地点/视点的切换必须给出过渡（时间词、空间移动、镜头焦点转移或因果钩子），禁止节拍间硬跳切、禁止把每个节拍写成孤立片段。节拍之外的衔接与过渡文字（非情节推进的铺垫/转场内容）同样是正文的组成部分，不是多余的填充。
9b. 事件可达性/因果闭环锁（硬规则）：教案写了某个结果，不代表结果天然获得发生资格。任何重大事件在正文落地前，都必须能回答：①为什么现在发生；②为什么在这里发生；③为什么由这个人物经历/触发；④人物凭什么知道或注意到；⑤人物凭什么做到（能力、资源、工具、体力、权限等）；⑥前面哪一件已发生的事把它推到了这里。若六问中存在明显断点，不得直接跳到结果；优先沿教案允许的空间补出必要的线索、观察、行动与中间步骤，或调整事件达成方式。不得凭空新增关键人物、关键情报、关键道具、关键能力、关键地点或关键关系来填因果缺口。偶然事件可以使用，但必须有场景触发、概率依据或事后可理解的因果解释，不能把“巧合”当作万能补丁。
10. 时间锚铁律（若 L1 节拍表标注了时间）：每段节拍标注的【时间】（如 现实·第2天·清晨）是本章时间承接的硬基准——正文各段落在哪个时点、就写那一时段的场景（光线/天色/动静/人物状态，如熹微/烈日/夕照/星夜/烛火/虫鸣/人物衣物与倦意等细节自然交代），上一章末尾落到哪个时点，本章开头就从那个时点或其自然延续接入，禁止时间跳跃开场、禁止把本章剧情安排到上一章主线的更早时点（同主线时点禁止倒退）。但时间一律靠场景细节自然体现，严禁出现在段首报时（"现在是/此刻是/此时是/当下是"）、严禁把时间锚或"第X天"字样原样照抄进正文；仅当时间确实跳跃时才用"翌日""三日后的黄昏"等自然过渡语融入叙述、不作注释式开场。跨支线（回忆/梦境/穿越）须按节拍表的支线标签处理，并在文中显式体现进入与回归，不扰乱主线时间顺序。（v1.0.24x：删除"严禁时间词开篇/首句禁时间状语"绝对禁令——与章首铁律④「时间开句可用（仅限频次）」及承接任务书菜单⑥冲突；开场方式以章首铁律 6 式为准。）
11. 视角与上帝视角铁律（v1.0.180）：默认采用"受限视角"叙述——把"摄影机"约 90% 的时间锁在主角身上，只以主角能看到/听到/摸到/感知到的信息推进叙述；想表现他人内心，一律改从主角的观察与推断出发，禁止直接钻进路人/配角/反派的内心"读心"。仅在下列"合法时机"才允许切到"上帝/他人视角"：(a) 章/节/空行分隔之后（有明确视角分界可用）；(b) 与主角核心目标同场产生重大利益冲突的关键时刻（全章最多一两处，用完立即回到主角）；(c) 只"展示而不解释"的客观信息（写他人"做了什么/什么神态/什么动作"，而不是"心里想什么"）；(d) 背景/世界观/前史等设定信息必须"寄生"在角色的即时感官里（经耳朵听到、鼻子闻到、手触及）传达，禁止作者跳出来大段广播；(e) 悬念揭晓的时刻（对前期已埋设的不确定性的兑现）。禁止项：同一场景内多个角色的内心随意跳切（禁止"跳切"）；禁止用上帝视角提前揭示主角与读者尚不该知道的答案（禁止剥夺"侦探权"）；禁止借上帝视角长篇灌输背景设定（禁止"死神"式信息倾泻）；禁止让配角甚至路人获得与主角同等的心理戏、使情感焦点涣散（禁止稀释"主角感"）。【例外】仅当本章写作风格\/配方中明确采用了「多视角群像」等视角切换类叙事技法时，才允许受控视角切换；此时仍须每个视角边界清晰、各视角有辨识度、切换有明确分界（章节\/空行）、整体仍以主角视角为主轴。未明确选用该类技法时，上述限定视角保持硬性，禁止以"多视角\/群像"为借口放松（v1.0.258 收紧例外）。

【写作任务流程（v1.0.271 · 执行骨架：按此编号依次完成，前一阶段做完才进入下一阶段）】
▶ 阶段一 · 读局（不落笔）——先消化本章节拍表每一段的中枢事件、情绪弧、requiredEntities、上一章节拍表的接续点/收束与下一章标题，在心里排出本章走向：从什么承接点起笔、依次推进哪几段事件、以什么收束。不要马上落笔。
▶ 阶段二 · 开篇承接（写）——用一段自然承接上一章结尾：未完成的动作/对话/悬念直接续上，不返述上章、不跳时间、不用报时语句。篇幅克制，快速进入本章主线。
▶ 阶段三 · 逐场推进（写）——按节拍顺序，把所有节拍事件写成完整连续的场面推进。每写一段事件前，先在心里过一遍节拍表留出的演绎空间，把这一段写成"活的场景"而不是"按模板填格子"：上述"铺垫进入 → 中枢动作/冲突 → 对话与反应往返 → 感官与细节 → 落地余波/收束"只是随手可调度的展开手段库，不是每段都必须依次出现的五段固定格式——按这段剧情的需要自由取舍、合并或调整顺序，写得像一位作者在真实铺排一个场景，该快则快、该慢则慢；段与段之间用因果、情绪或空间过渡自然衔接。这是正文的绝大部分，篇幅主要在这一阶段铺足。
▶ 阶段四 · 收束点题（写）——写到本章收束拍时，视全书进度自然收束：若有下一章标题，在结尾埋下指向它的线索或悬念（但不得提前揭示下章具体情节）；若无，则按本章剧情自然落地收束。
▶ 阶段五 · 自检门（不写入输出，写完后内部核对）——按下方【内部一致性自检】逐项过一遍，并核对【篇幅体量】硬下限是否达成、节拍事件是否全部覆盖；若不达标，就地补足或调整后再交付。
说明：以上是"写作的推进顺序"，不是"给每拍贴标签、逐拍独立成段的格式"——阶段三仍要求整章是一条连续流动的叙事线，场面之间自然衔接，不得生硬跳切。

【内部一致性自检（不写入输出）】
- 时间线不矛盾
- 人物性格/外貌/年龄与词典一致
- 词典既有专名使用无误、无相悖；本章新引入的核心实体均为剧情所需且已交代设定要点，临时闲人/小地名/小专名为氛围点缀、写一句便止
- 上一章结尾未完成的动作/对话已承接
- 重大事件因果闭环成立：每个关键结果均可追溯到前置状态/目标、信息或线索来源、人物行动、能力/资源条件与触发路径；无“突然发现/突然知道/突然拥有/突然遇见/突然出现”的关键剧情捷径
- 伏笔 foreshadowing 已按节拍表埋设
- 叙事铁律未偏离（无禁用词直述内心情绪、无模板词）
- 视角未在同场景内随意跳切、未替配角/反派/路人直接读心；背景信息已寄生于角色感官而非作者广播；主角情感焦点未被配角稀释（v1.0.180 上帝视角治理）
- 未提前兑现本章不应揭示的伏笔、未借上帝视角提前剧透读者与主角尚不该知道的答案（v1.0.258 反剧透自检）

【失败处理】
若自检发现严重冲突无法调和，请只输出正文，并在正文末尾以单行隐藏注释形式输出：<!-- AI_NOTE: 冲突点 -->, 程序将捕获并转人工复核。`;

const PROMPTS = {
  outlineSys: `你是一位专业编剧与故事架构师，擅长短剧/短视频叙事。根据用户的一句或几句话构想，设计一部适合改编为短视频的故事。
请严格只输出如下 JSON（不要任何解释、不要 markdown 代码块）：
{"title":"故事标题","logline":"小说简介（含核心冲突）","chapters":[{"title":"第1章标题","summary":"该章核心事件与转折，1-2句"}]}
要求：chapters 数量按故事体量在 6-12 章之间；summay 体现人物动机与情节推进。重大事件不得凭空发生：必须能由前文已建立的目标、信息、地点、资源、人物行动或可观察线索自然推导；对“发现/获得/遇见/得知/抵达/突破”等结果，优先在概要中留下可解释的前置条件或触发依据，不得只写结果。`, 

  chapterSys: `你是一位擅长网文与短剧的编剧。请根据「故事大纲」与「本章概要」写出本章完整正文。
要求：有强画面感、对话自然、节奏明快、推进剧情；篇幅 800-1500 字；只输出正文，不要标题、不要解释。`,

  characterSys: `你是一位影视角色设定师。根据完整故事，提取主要角色（3-6 个，含主角与关键配角），为每个角色产出「影视前期定妆提示词包」，用于用户粘贴到「即梦(Dreamina)」生成角色参考图。
请严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"characters":[{"name":"角色名","role":"身份/作用","profile":{"年龄":"","性别":"","身份":"","性格":"","外貌":"脸型/发型/瞳色/身形等","常服与配色":"","标志性道具":"","材质质感":""},
"prompts":{"定妆图":"全身定妆图提示词，需固化固定外貌特征以保证后续垫图一致性","三视图":"正面/侧面/背面描述","表情":"喜/怒/哀/惊等表情参考","服饰细节":"衣物纹样与剪裁放大","道具":"武器/饰品/随身物","配色":"主色/辅色/点缀色色板","材质":"布料/金属/皮革等质感"}}]}
要求：所有 prompts 为中文、具体、可直接粘贴即梦；『定妆图』要写清不变的身份特征；风格统一。`,

  sceneSys: `你是一位影视场景设定师。根据故事与角色，提取关键场景（4-8 个），产出即梦出图提示词。
⚠️ 重要：场景是「纯环境/空间设定」——它是无人物、无角色的环境模型（空镜），供视频 AI 作环境参考。**严禁出现任何人物、角色、人形、剪影、拟人元素**。出图提示词必须以环境为主体（空间结构/陈设/材质/光线/氛围/天气/时间感），并在提示词末尾附上负向约束：no people, no characters, no humans, no silhouettes, no figures, empty of people。
请严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"scenes":[{"name":"场景名","作用":"在故事中的功能","description":"场景文字设定","prompt":"即梦出图提示词（中文，含风格/光线/氛围/构图，可直接粘贴；末尾附 no people 等负向约束）"}]}
要求：prompt 贴合即梦习惯，风格与整体基调一致；每条 prompt 必须体现「无人环境」这一核心语义。`,

  storyboardSys: `你是一位资深分镜师/导演。根据故事、角色、场景，为【指定章节】产出导演级短视频分镜表。
工作方法（导演脑前置）：
1. 先提炼本章「视觉概念」：一句可证伪、专属本章、能派生镜头序列的画面主意（拒绝"气氛很好"式空话）。
2. 再设计「母题」：建立(镜N) → 变奏(镜M) → 打破/兑现(镜K) 的镜头落点。
3. 最后拆镜头：每镜是一个连续 take，镜间有受控的剪辑动机；只写可拍摄、可生成、可校验的物理事实（拒绝比喻与情绪散文）。
请严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"视觉概念":"本章一句画面主意","母题":"建立→变奏→打破","shots":[{"镜号":1,"时长":3,"景别":"","角度":"","运镜":"","主体":"本镜主体是谁/什么","构图":"主体位置/景深","光线":"","画面描述":"本镜画面与动作","对白":"台词或旁白，无则空","转场":"","出图提示词":"即梦出图提示词（中文，按 运镜+镜头感+主体+风格+光线+比例 拼装；引用对应角色定妆特征与场景，保证一致性）","连续性":"入口引用/出口状态","剪辑动机":"为什么接这一镜"}]}
【镜头技巧库】取值请从这里选：
- 景别：大特写/特写/近景/中景/全景/远景/过肩
- 角度：平视/仰拍/俯拍/荷兰角/鸟瞰/顶视
- 运镜：推/拉/摇/移/跟/升降/环绕/手持/变焦/航拍
- 光线：黄金时刻/柔光漫射/霓虹背光/体积光/轮廓光/烛光暗调
- 转场：硬切/叠化/淡入淡出/匹配剪辑/甩镜
要求：镜号从 1 开始连续；每章 6-12 镜，按本章情节密度增减；每镜时长 2-6 秒，对话密集或大动作镜头可到 8 秒，须填具体秒数；出图提示词可直接粘贴即梦。`,

  coverSysClean: `你是一位资深书籍装帧设计师与插画师。根据用户提供的小说标题与故事梗概，为这部小说的【封面图】产出一条可粘贴到「即梦(Dreamina)」的中文出图提示词【纯画面版，不含任何文字】。
要求：画面要抓住小说核心意象与情绪（世界观/主角困境/关键场景），构图强烈、光影戏剧化、色彩有记忆点；为封面预留的书法/书名排布位置要留出充足留白（如顶部或居中留白区），方便排版方后期加字；长度 150-280 字；结尾可附风格关键词（如"电影级打光、史诗感、高对比、厚涂插画"）；**严禁生成任何文字/标题/字幕/笔画**，画面里不要出现可辨认的汉字或拼音字母；只输出提示词正文，不要解释、不要 markdown 代码块。`,

  coverSysTitle: `你是一位资深书籍装帧设计师与插画师。根据用户提供的小说标题与故事梗概，为这部小说的【封面图】产出一条可粘贴到「即梦(Dreamina)」的中文出图提示词【含书名文字版】。
要求：画面要抓住小说核心意象与情绪（世界观/主角困境/关键场景），构图强烈、光影戏剧化、色彩有记忆点；**封面需包含书法风格的【书名汉字】作为主体文字**，请把小说标题精准写入提示词，指定其为封面主文字（如"金色书法大字『书名』题于画面中央/顶部，字迹遒劲、带有水墨或烫金质感"）；其余可附风格关键词；长度 150-280 字；只输出提示词正文，不要解释、不要 markdown 代码块。`,

  longChapterSys: LONG_CHAPTER_SYS_PRO,

};

const SIZE_DEFAULT = { min:3000, max:5000 };

let polishMulti = true;

async function polishIdea(btn, force){
  const idea = (state.idea || '').trim();
  if(!idea){
    const kept = Array.isArray(state.polishOptions) && state.polishOptions.length;
    toast(kept ? '输入框为空：请先在上方输入构想，或点某张历史方案卡「✔ 采用此方案」，再点「✨ 优化构想」重新生成' : '请先输入故事构想');
    return;
  }
  const kept = Array.isArray(state.polishOptions) && state.polishOptions.length;
  if(kept && !force){
    if(!confirm(`已有 ${kept} 个保留方案，重新优化将覆盖它们。继续？`)) return;
  }
  const multi = polishMulti || idea.length < 15;   // 极短强制多方案
  if(!canRunAI('idea')){ toast('优化构想暂不可运行'); return; }
  markAIRunning('idea');
  if(btn) busy(btn,true, multi ? '生成多方案构想中…' : '优化构想中…');
  try{
    const txt = await callAIGuarded('idea', { multi }, {temperature: resolveActiveSpec().ideaTemp, maxTokens: clampMaxTokens('polish')});
    const out = String(txt||'').trim();
    if(!out){ toast('优化失败，请重试'); return; }

    showPolishResult(out, multi);
    markAIDone('idea');
    toast('优化完成');
  }catch(e){
    addToFixQueue({kind:'idea', error:e.message});
    toast('优化失败：'+e.message);
  }
  finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='idea');
    if(btn) busy(btn,false);
  }
}

function formatIdeaBrief(b){
  return [
    `题材：${b.genre || ''}`,
    `主角：${b.protagonist || ''}`,
    `核心冲突：${b.coreConflict || ''}`,
    `世界观/规则：${b.worldOrRules || '无'}`,
    `对手/压力：${b.antagonistOrPressure || '无'}`,
    `动机：${b.motivation || ''}`,
    `风格：${b.style || ''}`,
    `读者体验：${b.readerExperience || ''}`
  ].join('\n');
}

function formatIdeaDiagnosis(d){
  if(!d || !Array.isArray(d.missing) || !d.missing.length) return '';
  const qs = (d.questions || []).map(q=>`<li>${esc(q)}</li>`).join('');
  return `<div class="pol-diag" style="margin-bottom:10px;padding:10px;background:var(--warn-bg, #fff8e6);border-radius:6px">
    <b>⚠️ 构想诊断：缺失 ${d.missing.length} 项</b>
    <ul style="margin:6px 0 0;padding-left:18px">${qs}</ul>
  </div>`;
}

function validatePolishOutput(j){
  if(!j || typeof j !== 'object') return '返回不是对象';
  if(!String(j.optimizedIdea||'').trim()) return '缺少 optimizedIdea';
  const b = j.navBeacon;
  if(!b || typeof b !== 'object') return '缺少 navBeacon';
  const required = ['genre','protagonist','coreConflict','tone'];
  for(const k of required) if(!String(b[k]||'').trim()) return `navBeacon 缺少 ${k}`;
  if(!Array.isArray(j.defects) || !j.defects.length) return '缺少缺陷清单 defects';
  if(Array.isArray(j.seedCharacters)){
    for(const c of j.seedCharacters){
      const miss = CHAR_FIELDS.filter(k=> c[k]==null || String(c[k]).trim()==='');
      if(miss.length) return `人物 ${c.name||'?'} 缺少字段：${miss.join('/')}`;
    }
  }
  return '';
}

function splitPolishMultiText(out){
  const t = String(out||'').trim();
  if(!t) return [];
  const DECOR = /[━─—–＿_=＝*＊#＃~〜～\s-]/g;   // 常见装饰/分隔字符（含全半角与空白）
  const cards = [];
  let cur = null;
  t.split('\n').forEach(ln=>{
    const s = String(ln||'').trim();
    let isHead = false, name = '';
    if(s && s.length <= 40){
      const core = s.replace(DECOR, '');
      const m = core.match(/^方案([一二三四五六七八九十\d]{1,2})?(?:[：:、.．,，)）]|$)/);
      if(m){ isHead = true; name = core; }
    }
    if(isHead){
      if(cur) cards.push(cur);
      cur = { name, text: '' };
    } else if(cur){
      cur.text += (cur.text ? '\n' : '') + ln;
    }
  });
  if(cur) cards.push(cur);
  const ok = cards.filter(c=> String(c.text||'').trim());
  if(ok.length < 2) return [];
  return ok.map((c,i)=>({
    name: c.name || ('方案'+(i+1)),
    text: String(c.text||'').trim(),
    _v45: { defects:[], navBeacon:null, seedCharacters:[], seedPlaces:[] }
  }));
}

function showPolishResult(out, multi){
  const box = $('#polishBox'), cards = $('#polishCards');
  if(!box || !cards) return;
  box.style.display = 'block';
  const pickV45 = (o)=> ({
    defects: Array.isArray(o&&o.defects) ? o.defects : [],
    navBeacon: (o && o.navBeacon && typeof o.navBeacon==='object') ? o.navBeacon : null,
    seedCharacters: Array.isArray(o&&o.seedCharacters) ? o.seedCharacters : [],
    seedPlaces: Array.isArray(o&&o.seedPlaces) ? o.seedPlaces : []
  });
  if(multi){
    let j = null;
    if(out && typeof out === 'object'){ j = out; }
    else { try{ j = parseJson(String(out)); }catch(e){ j = {}; } }
    const opts = Array.isArray(j && j.options) ? j.options.filter(o=>o && String(o.optimizedIdea||o.text||'').trim()) : [];
    if(opts.length){
      snapshotPolishBatch('重新优化前');   // 覆盖前把旧整批方案归档为可回退版本（≤5）
      state.polishOptions = opts.map(o=> Object.assign({}, o, {
        text: String(o.optimizedIdea||o.text||'').trim(),
        _v45: pickV45(o)
      }));
      state.polishAdopted = null;   // 新方案列表，尚未采用
      state.polishCollapsed = false;
      persist();
      render(); openPolishBox();
      return;
    }
    if(typeof out === 'string'){
      const segs = splitPolishMultiText(out);
      if(segs.length >= 2){
        snapshotPolishBatch('重新优化前');   // 覆盖前把旧整批方案归档为可回退版本（≤5）
        state.polishOptions = segs;
        state.polishAdopted = null;
        persist();
        render(); openPolishBox();
        return;
      }
    }
    snapshotPolishBatch('重新优化前');
    state.polishOptions = [{ name:'方案1', text: String(typeof out==='object' ? ((out&&out.optimizedIdea)||'') : out).trim(), _v45: pickV45(typeof out==='object'?out:{}) }];
    state.polishAdopted = null;
    state.polishCollapsed = false;
    persist();
    render(); openPolishBox();
    return;
  }
  const single = (out && typeof out === 'object') ? out : { optimizedIdea: String(out||'').trim() };
  snapshotPolishBatch('重新优化前');
  state.polishOptions = [{ name:'方案1', text: String(single.optimizedIdea||single.text||'').trim(), _v45: pickV45(single) }];
  state.polishAdopted = null;
  persist();
  render(); openPolishBox();
}

function applyV45ToOutline(o, d){
  if(!o || !d) return { nC:0, nP:0 };
  if(!o.glossary || typeof o.glossary!=='object') o.glossary = {characters:[],places:[],propernouns:[]};
  const g = o.glossary;
  ['characters','places','propernouns'].forEach(k=>{ if(!Array.isArray(g[k])) g[k]=[]; });
  let nC=0, nP=0;
  (d.seedCharacters||[]).forEach(c=>{
    const nm = String(c&&c.name||'').trim(); if(!nm) return;
    if(g.characters.some(x=>String(x&&x.name||'').trim()===nm)) return;
    g.characters.push({ name:nm, identity:c.identity||'', age:String(c.age==null?'':c.age), gender:c.gender||'', appearance:c.appearance||'', hobby:c.hobby||'', catchphrase:c.catchphrase||'', relation:c.relation||'', trait:c.trait||'' });
    nC++;
  });
  (d.seedPlaces||[]).forEach(p=>{
    const nm = String(p&&p.name||'').trim(); if(!nm) return;
    if(g.places.some(x=>String(x&&x.name||'').trim()===nm)) return;
    g.places.push({ name:nm, type:p.type||'', note:p.note||'' });
    nP++;
  });
  if(d.navBeacon && typeof d.navBeacon==='object'){
    o.navBeacon = d.navBeacon;
  }
  return { nC, nP };
}

function importPolishToState(o){
  const d = (o && o._v45) || {};
  const tone = String((d.navBeacon&&d.navBeacon.tone)||'');
  const toneHit = tone || '';
  if(!state.outline){
    if(d && (d.navBeacon || (d.seedCharacters&&d.seedCharacters.length) || (d.seedPlaces&&d.seedPlaces.length))){
      state.pendingV45 = JSON.parse(JSON.stringify(d));
    }
    persist(); render();
    toast(`设定已暂存${nCh?(' · 章节数已设为 '+n):''}${toneHit?' · 优化构想语气已交给校长评估（不覆盖用户风格）':''}：导航灯塔/种子人物/种子地点将在生成大纲后自动应用`);
    return;
  }
  const r = applyV45ToOutline(state.outline, d);
  persist(); render();
  toast(`已导入设定：导航灯塔${d.navBeacon?1:0} · 种子人物 ${r.nC} · 种子地点 ${r.nP}${nCh?(' · 章节数已设为 '+n):''}${toneHit?' · 优化构想语气已交给校长评估（不覆盖用户风格）':''}`);
}

function openPolishBox(){
  const box = $('#polishBox'), cards = $('#polishCards');
  if(!box || !cards) return;
  state.polishCollapsed = false;
  persist();
  box.style.display = 'block';
  renderPolishCards(cards);
}

function polishIdle(){
  const o = state.outline;
  const hasRealOutline = !!o && (String(o.title||'').trim() || String(o.logline||'').trim() || (Array.isArray(o.chapters)&&o.chapters.length));
  return !hasRealOutline;
}
const POLISH_PALETTE = ['#E8A33D','#D64545','#4C6FD5','#3FA36B','#8E5AC8','#2CA6A4'];
function extractPolishTitle(text){
  const ln = String(text||'').split('\n').map(s=>s.trim()).find(s=>/^书名\s*[：:]\s*\S/.test(s));
  if(!ln) return '';
  return String(ln.replace(/^书名\s*[：:]\s*/, '')).trim();
}
function renderPolishCards(container){
  if(!container) return;
  const opts = Array.isArray(state.polishOptions) ? state.polishOptions : [];
  if(!opts.length){
    container.style.display = 'block';
    container.innerHTML = `<p class="muted" style="margin:8px 0 0">👆 点「✨ 优化构想」从五个方向（商业/反差/情感/悬疑智斗/轻松日常）中按契合度生成 3~5 个候选方案；点某张卡的「✔ 采用此方案」即选中（不覆盖原始构想），再点「生成大纲」搬入书名 / 简介 / 节拍。</p>`;
    return;
  }
  container.style.display = 'block';
  const adopted = state.polishAdopted;
  container.innerHTML = opts.map((o,i)=>{
    const c = POLISH_PALETTE[i % POLISH_PALETTE.length];
    const name = o.name || ('方案'+(i+1));
    const isAdopted = !!adopted && adopted === name;
    const defects = (o._v45 && Array.isArray(o._v45.defects)) ? o._v45.defects.filter(d=>String(d||'').trim()) : [];
    const hasV45 = !!(o._v45 && (o._v45.navBeacon || (o._v45.seedCharacters&&o._v45.seedCharacters.length) || (o._v45.seedPlaces&&o._v45.seedPlaces.length)));
    const pTitle = extractPolishTitle(o.text);
    const pBody = String(o.text||'').replace(/^\s*书名\s*[：:][^\n]*\n?/, '').trim();   // 书名已置顶，正文去掉首行以免重复
    return `<div class="pol-cand${isAdopted?' on':''}" style="--pc:${c}" data-idx="${i}">
      <div class="pol-cand-head">
        <span class="pol-no" style="background:${c}">${i+1}</span>
        <b class="pol-name" style="color:${c}">${esc(name)}</b>
        ${isAdopted?'<span class="pol-adopted-tag">✔ 已采用</span>':''}
        <span class="pol-cand-actions">
          <button type="button" class="btn small ghost" data-pol-copy="${i}" title="复制此方案">📋 复制</button>
        </span>
      </div>
      ${pTitle?`<div class="pol-cand-title" style="background:${c}">📖 ${esc(pTitle)}</div>`:''}
      <div class="pol-cand-body">${esc(pBody ? pBody : String(o.text||''))}</div>
      ${defects.length?`<div class="pol-cand-body" style="opacity:.85"><b>⚠️ 构想缺陷清单：</b><br>${defects.map(d=>'· '+esc(String(d))).join('<br>')}</div>`:''}
      <div class="pol-cand-foot">
        ${hasV45?`<button type="button" class="btn small ghost" data-pol-import="${i}" title="导入结构化设定（导航灯塔/种子人物/种子地点/建议章节数）">📥 导入设定</button>`:''}
        <button type="button" class="btn small pt-accent" data-pol-use="${i}" style="background:${c}">✔ 采用此方案</button>
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll('[data-pol-use]').forEach(b=>{
    b.onclick = (e)=>{ e.preventDefault();
      const o = (state.polishOptions||[])[+b.dataset.polUse]; if(!o) return;
      if(dictmasterLocked()){ toast('词典达人已产出万物词典，②方案已锁定，不可更换'); return; }
      state.polishAdopted = o.name || null;
      persist(); render();
      toast('已选中：'+(o.name||('方案'+(+b.dataset.polUse+1)))+'（不覆盖原始构想；可点「生成大纲」搬入书名/简介/全书节拍）');
    };
  });
  container.querySelectorAll('[data-pol-import]').forEach(b=>{
    b.onclick = (e)=>{ e.preventDefault();
      const o = (state.polishOptions||[])[+b.dataset.polImport]; if(!o) return;
      importPolishToState(o);
    };
  });
  container.querySelectorAll('[data-pol-copy]').forEach(b=>{
    b.onclick = (e)=>{ e.preventDefault();
      const o = (state.polishOptions||[])[+b.dataset.polCopy]; if(!o) return;
      copyText(o.text||'');
    };
  });
}

function bindPolishIdea(){
  const b = $('#btnPolishIdea');
  if(b) b.onclick = ()=> polishIdea(b);
  const chk = $('#chkPolishMulti');
  if(chk){
    const sync = ()=>{
      const short = (state.idea||'').trim().length < 15;
      chk.checked = polishMulti || short;
      chk.disabled = short;
    };
    sync();
    chk.onchange = ()=>{ polishMulti = chk.checked; };
    const idea = $('#ideaInput');
    if(idea) idea.oninput = ()=>{ state.idea = idea.value; sync(); syncOrigIdeaCard(); };
  }
  const disc = $('#btnPolishDiscard');
  if(disc) disc.onclick = ()=>{
    const box = $('#polishBox');
    if(box) box.style.display = 'none';
  };
  const hist = $('[data-pol-keep-hist]');
  if(hist) hist.onclick = (e)=>{ e.stopPropagation(); openPolishBatchPanel(); };
  const view = $('[data-pol-keep-view]');
  if(view) view.onclick = (e)=>{ e.stopPropagation(); openPolishBox(); };
  const again = $('[data-pol-keep-again]');
  if(again) again.onclick = (e)=>{ e.stopPropagation(); polishIdea($('#btnPolishIdea'), true); };
  const clear = $('[data-pol-keep-clear]');
  if(clear) clear.onclick = (e)=>{
    e.stopPropagation();
    if(!confirm('清除全部保留方案？')) return;
    snapshotPolishBatch('清除前');   // 归档当前批，之后仍可在「优化版本」找回
    delete state.polishOptions;
    delete state.polishAdopted;
    persist(); render();
    toast('已清除保留方案');
  };
}
function polishKeepBar(){
  const opts = Array.isArray(state.polishOptions) ? state.polishOptions : [];
  if(!opts.length) return '';
  const cur = state.polishAdopted || opts[0].name || '方案A';
  return `<div class="pol-keep">
    <span class="pol-keep-t">已保留 ${opts.length} 个优化方案（当前采用：${esc(cur)}）</span>
    <span class="pol-keep-btns">
      ${(state.polishHistory&&state.polishHistory.length)?`<button type="button" class="btn small ghost" data-pol-keep-hist>📚 优化版本(${state.polishHistory.length}/50)</button>`:''}
      <button type="button" class="btn small ghost" data-pol-keep-view>🔍 查看全部</button>
      <button type="button" class="btn small ghost" data-pol-keep-again>✨ 重新优化</button>
      <button type="button" class="btn small ghost" data-pol-keep-clear>✕ 清除</button>
    </span>
  </div>`;
}

function polishHistory(){ return Array.isArray(state.polishHistory) ? state.polishHistory : []; }
function snapshotPolishBatch(label){
  const opts = Array.isArray(state.polishOptions) ? state.polishOptions : [];
  if(!opts.length) return;
  const snap = { options: opts.map(o=>({ name:o.name, text:String(o.text||'') })), adopted: state.polishAdopted||null };
  const hist = state.polishHistory = state.polishHistory || [];
  if(hist.length &&
      JSON.stringify(hist[0].options) === JSON.stringify(snap.options) &&
      hist[0].adopted === snap.adopted) return;
  hist.unshift({ ts: Date.now(), label: label||'快照', options: snap.options, adopted: snap.adopted });
  if(hist.length > 50) hist.length = 50;
  persist();
}
function applyPolishBatch(idx){
  const hist = polishHistory(); const b = hist[idx]; if(!b || !Array.isArray(b.options) || !b.options.length) return;
  if(!confirm(`整批应用「${idx+1}. ${b.label||'优化版本'}」（共 ${b.options.length} 个方案）？将覆盖当前保留的方案。`)) return;
  snapshotPolishBatch('切换前');
  state.polishOptions = b.options.map(o=>({ name:o.name, text:String(o.text||'') }));
  state.polishAdopted = (b.adopted && b.options.some(o=>o.name===b.adopted)) ? b.adopted : null;
  persist(); closePolishBatchPanel(); render();
  const box = $('#polishBox'); if(box){ box.style.display='block'; openPolishBox(); }
  toast(`已整批应用该优化版本（${state.polishOptions.length} 个方案）`);
}
function deletePolishBatch(idx){
  const hist = polishHistory(); if(!hist.length) return;
  hist.splice(idx,1);
  if(!hist.length) delete state.polishHistory; else state.polishHistory = hist;
  persist(); closePolishBatchPanel(); openPolishBatchPanel();
  toast('已删除该版本');
}
function openPolishBatchPanel(){
  closePolishBatchPanel();
  const hist = polishHistory(); if(!hist.length){ toast('暂无历史优化版本，运行「✨ 优化构想」后自动记录'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const rows = hist.map((b,idx)=>`
    <div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0">
        <div class="cv-time">${idx+1}. ${esc(b.label||'优化版本')} · ${fmtTs(b.ts)} · ${(b.options||[]).length} 方案</div>
        <div class="cv-t" style="font-size:12px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((b.options||[]).slice(0,3).map(o=>o.name).join(' / '))||'（空）'}</div>
      </div>
      <div class="cv-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button type="button" class="btn ghost cv-b" data-polb-view="${idx}">👁 切换</button>
        <button type="button" class="btn primary cv-b" data-polb-apply="${idx}">应用</button>
        <button type="button" class="btn ghost cv-b" data-polb-del="${idx}">🗑</button>
      </div>
    </div>`).join('');
  const ov = document.createElement('div'); ov.id='polbPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>💾 优化构想 · 批量版本（${hist.length}/50）</b>
        <button class="gs-x" data-polb-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-div">每次优化自动归档快照，支持预览与回退。</div>
        ${rows}
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-polb-close]').onclick = closePolishBatchPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closePolishBatchPanel(); });
  ov.querySelectorAll('[data-polb-view]').forEach(b=> b.onclick = ()=> openPolishBatchPreview(+b.dataset.polbView));
  ov.querySelectorAll('[data-polb-apply]').forEach(b=> b.onclick = ()=> applyPolishBatch(+b.dataset.polbApply));
  ov.querySelectorAll('[data-polb-del]').forEach(b=> b.onclick = ()=> deletePolishBatch(+b.dataset.polbDel));
}
function closePolishBatchPanel(){ const p=$('#polbPanel'); if(p) p.remove(); }
function openPolishBatchPreview(idx){
  closePolishBatchPreview();
  const hist = polishHistory(); const b = hist[idx]; if(!b) return;
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const list = (b.options||[]).map(o=>`<div class="cv-row"><div class="cv-t" style="font-size:12px"><b>${esc(o.name||'')}</b><br>${esc(String(o.text||'').slice(0,120))}${(o.text||'').length>120?'…':''}</div></div>`).join('') || '<p class="muted">（空批）</p>';
  const ov = document.createElement('div'); ov.id='polbPreview'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>👁 优化版本切换 · ${esc(b.label||'优化版本')}（${fmtTs(b.ts)} · ${(b.options||[]).length} 方案）</b>
        <button class="gs-x" data-polbp-close>✕</button></div>
      <div class="cv-body"><div style="max-height:60vh;overflow:auto">${list}</div></div>
      <div class="modal-actions" style="padding:12px 16px;border-top:1px solid var(--line)">
        <button type="button" class="btn ghost cv-b" data-polbp-close2>取消</button>
        <button type="button" class="btn primary cv-b" data-polbp-apply>✔ 应用此版本</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-polbp-close]').onclick = closePolishBatchPreview;
  ov.querySelector('[data-polbp-close2]').onclick = closePolishBatchPreview;
  ov.addEventListener('click', e=>{ if(e.target===ov) closePolishBatchPreview(); });
  ov.querySelector('[data-polbp-apply]').onclick = ()=> applyPolishBatch(idx);
}
function closePolishBatchPreview(){ const p=$('#polbPreview'); if(p) p.remove(); }







const WRITE_STYLES = [
  { id:'wenyi',  group:'element', cat:'语言质感', name:'文艺/范儿',
    note:'意象化、通感、抒情长句、留白，重氛围轻情节（如张嘉佳、琼瑶式）。',
    tips:['多用意象化与通感修辞','抒情长句铺陈心境，节奏舒缓','点到为止，留白让余味生长'],
    avoid:['情节推进过急','直白说破情绪'],
    check:['氛围优先于情节','有 1-2 处可回味的句子'],
    demo:'散场后影厅的灯一瞬亮起，红绒座椅一排排空下去，像退潮的海。他坐在最后一排，等字幕走完，才把攥了一整场的手，慢慢松开。' },
  { id:'ornate', group:'element', cat:'语言质感', name:'华丽辞藻',
    note:'排比、对仗、四字词、浓墨重彩的画面铺陈。',
    tips:['多用排比、对仗、通感','用四字词与色彩意象铺陈','句子密度与节奏感并重'],
    avoid:['华丽但空洞（只有形容词没有实义）','堆砌到影响阅读'],
    check:['至少 2 处排比/对仗','辞藻服务于画面与情绪'],
    demo:'暮色像一匹被揉皱的绸缎，摊在山脊上，流光一寸寸洇开。' },
  { id:'minimal',group:'element', cat:'语言质感', name:'极简/冷峻',
    note:'短句、白描、不抒情，靠动作和留白传达（海明威式）。',
    tips:['短句、白描、删冗余','情绪用动作与环境暗示','把余味留给读者'],
    avoid:['直白喊出情绪','大段心理独白'],
    check:['情绪段落少于直接描写','无直白情绪标签'],
    demo:'他把刀擦干净，放回架子上。窗外雨没停。' },
  { id:'poetic', group:'element', cat:'语言质感', name:'诗化散文化',
    note:'段落像写诗，长短句错落，节奏淡雅。',
    tips:['段落如诗分行，长短句错落','用淡雅意象营造氛围','节奏舒缓、留白多'],
    avoid:['通篇无叙事推进','堆砌意象失去中心'],
    check:['文字有诗性','节奏淡雅不拖沓'],
    demo:'晨雾里，早班的船离了岸。橹声一下，一下，像在江面上，把昨夜的话一句句抹平。岸上有人立了很久，直到雾把船和人一起收走。' },
  { id:'euro',   group:'element', cat:'语言质感', name:'翻译腔/欧美范',
    note:'长定语从句、欧式标点、西式叙述节奏。',
    tips:['长定语从句与倒装','欧式破折号、分号连接','西式冷静的叙述距离感'],
    avoid:['生硬到读不通','堆砌从句失去节奏'],
    check:['有西式笔调','可读性不牺牲'],
    demo:'她把那份写了很久、又反复修改、最终也没能寄出去的告别信，连同那枚旧贝壳，一起锁进那口棕色的、她从童年起就没再打开过的箱子。' },
  { id:'classic',group:'element', cat:'语言质感', name:'古风文言',
    note:'文言字句、古韵气息，骈散兼用，含蓄蕴藉。',
    tips:['以凝练文言与四六骈句铺陈','动词古雅（顾、掷、敛、挑灯）','对话带古白话韵味，不全程掉书袋'],
    avoid:['生僻掉书袋','古腔盖过剧情可读性'],
    check:['读来有古意不晦涩','用词贴合人物身份'],
    demo:'孤鸿声里，城门缓缓阖上。他负手立于城楼，望那盏渐远的灯，终究没说一句留字。' },
  { id:'folktale',group:'element',cat:'语言质感', name:'市井评书腔',
    note:'说书人腔、话本俚俗、烟火锅气，热闹有人味。',
    tips:['以说书人视角交代，带"话说""且听"的烟火话茬','俚语俗谚与市井行话点人点事','节奏热络、听感活泛'],
    avoid:['盲目复古腔调失真','俚俗过度显油滑'],
    check:['读来像听故事','市井气服务于人物环境'],
    demo:'那王二麻子，是方圆十里出了名的抠门主儿——上他家讨口水喝，都得听他把水瓢掂量三回。' },
  { id:'epic',group:'element', cat:'语言质感', name:'史诗庄重',
    note:'沉着宏阔、碑文式质感，字句有时间的重量。',
    tips:['铺陈用宏大意象（山河、长夜、星海）','句式沉稳、节奏凝重','关键处用克制笔法写大事件'],
    avoid:['空洞的大词堆砌','沉重到拖沓'],
    check:['有厚重史诗感','宏阔处仍有具体细节穿透'],
    demo:'星海横贯头顶，是他的国；脚下冻土延展，也是他的国。一将功成，不过是这漫漫长夜里，那些无名者共用的名字。' },
  { id:'airy',group:'element', cat:'语言质感', name:'轻盈灵动',
    note:'明快清新、短句跳跃、俏皮生趣，读来轻快。',
    tips:['短句快行、节奏轻快','比喻清新俏皮、有少年气','对话灵动带小机锋'],
    avoid:['轻飘无实义','俏皮过度发腻'],
    check:['读来轻快不觉累','明快中不失真情'],
    demo:'她把作业本往桌上一拍，像只炸了毛的小猫，眉毛竖得能挂三斤酱油。' },
  { id:'cutting',group:'element', cat:'语言质感', name:'锋利冷冽',
    note:'犀利讽刺、刀刃句式、冷静不留情面。',
    tips:['短句见锋，一句切中要害','冷静语气说狠话，反差更利','讽刺藏在客观陈述里'],
    avoid:['泼妇式叫骂','为毒而毒失分寸'],
    check:['不语带脏字也伤人','锋芒服务于立场交锋'],
    demo:'他的道歉和他的承诺一样廉价——都只够说出口，不够兑现。' },
  { id:'suspense2',group:'element',cat:'情绪与张力', name:'悬疑压抑',
    note:'名词化、阴冷意象、制造不安感的用词。',
    tips:['制造信息差（读者知道得比角色少或多）','句尾留悬念钩子','环境意象偏暗、紧绷'],
    avoid:['提前泄底','为悬疑而故弄玄虚（逻辑不通）'],
    check:['段落间有悬念牵引','悬念符合逻辑、可回收'],
    demo:'他每天下班都路过那家窗贴磨旧、却从不见人进出的花店。今晚他忍不住推门——门没锁，柜台后的墙上挂着一排照片，每一张，都拍的是他。' },
  { id:'sweet',  group:'element', cat:'情绪与张力', name:'甜宠/温柔',
    note:'细腻心理、绵软对话、小动作描写。',
    tips:['多写微小动作与眼神','对话温和、有生活气','细节传递温度'],
    avoid:['刻意煽情','甜腻到失真'],
    check:['有生活细节体现温度','情感自然不煽情'],
    demo:'她随口说想吃那家老店的糖炒栗子。他没答话，第二天下班拎了一袋回来，隔着纸袋还是热的——袋上，他认认真真写了"趁热"两个字。' },
  { id:'heartwarm',group:'element',cat:'情绪与张力', name:'虐心催泪',
    note:'情感落差、写泪点、克制中爆发。',
    tips:['铺垫情感、制造落差','写泪点时克制不喊叫','在高点克制收束'],
    avoid:['全程强行煽情','情绪喊口号化'],
    check:['有清晰情感高点','泪点自然、铺垫足够'],
    demo:'奶奶把存折交给他，说密码是他的生日。他翻到最后一页才看清存款时间——整整三十年前，正是他出生的那年。那笔钱，她替他攒了一辈子。' },
  { id:'flame',  group:'element', cat:'情绪与张力', name:'热血燃动',
    note:'情绪爆发＋动作节奏带出「燃」，靠张力推进不靠血腥。',
    tips:['动作链密集、节奏如鼓点','短促有力的句式让语气一路走高','以意志力、逆袭转折点燃情绪，不依赖血腥'],
    avoid:['血腥暴力与感官刺激堆砌','喊口号式的假燃','靠场面硬撑而无人物情绪'],
    check:['有清晰的情绪沸点','热血但不越界','燃来自人物选择而非血腥'],
    demo:'一剑破空，少年不退反进，眼底燃起整座江湖的灯。' },
  { id:'zhanshi', group:'element', cat:'情绪与张力', name:'写实战争纪实',
    note:'写实战场实感、群像牺牲、冷峻不煽情的纪实悲壮。',
    tips:['战地细节写实、炮火烟尘与噪声具体','群像式牺牲、点到为止不渲染','冷峻克制、用个别镜头折射整体'],
    avoid:['英雄化、个人光环凌驾群像','血腥刺激堆砌','煽情喊口号'],
    check:['有战场实感与氛围','牺牲有分量不廉价','冷静呼吸、不靠煽动'],
    demo:'担架从泥泞里抬过去，谁也没停。枪声一响，他们又都趴回了开阔地。' },
  { id:'terror', group:'element', cat:'情绪与张力', name:'惊悚寒气',
    note:'具象的感官恐惧、细思极恐、寒意入骨。',
    tips:['用触感/听觉营造阴冷（汗毛、脚步声、指甲刮过）','未知比具象更毒，先露一角','恐怖藏在日常细节里'],
    avoid:['血腥猎奇堆砌','一惊一乍而无逻辑'],
    check:['读完后背发凉','恐怖有来源可解释'],
    demo:'他数完最后一级台阶，楼道灯忽然熄灭。黑暗里，有什么正跟着他的步子——他停，那声音也停；他走，那声音贴在他身后，也走。' },
  { id:'warmth', group:'element', cat:'情绪与张力', name:'温情治愈',
    note:'亲情友情的平淡暖意，柴米油盐里的光。',
    tips:['细写照顾、牵挂、笨拙的表达','暖藏在克制与日常里，不喊口号','一个细节点亮一个场景'],
    avoid:['强行煽情','甜腻到失真'],
    check:['读来心里发烫','暖点有生活依据'],
    demo:'她加班到深夜，桌角放着一碗还冒热气的面，碗边压着张纸：趁热吃。她抬头，对面那位总说"你天天不落屋"的保洁阿姨，正假装在擦她早该擦完的那块玻璃。' },
  { id:'standoff', group:'element', cat:'情绪与张力', name:'对峙张力',
    note:'两方角力、一触即发、空气凝住的压迫。',
    tips:['从动作/物件写紧绷（手按枪柄、茶水渐凉）','对话句句试探、句句留尾','用细节的"没发生"代替爆发'],
    avoid:['一上来就摊牌','张力被废话稀释'],
    check:['全程心悬着','对峙有翻盘可能'],
    demo:'他与她隔桌对坐，谁也没碰那盏茶。窗外蝉鸣陡然一停，空气像被抽干——他咽了口唾沫，那一声响，在寂静里放大如雷。' },
  { id:'melancholy', group:'element', cat:'情绪与张力', name:'苍凉悲怆',
    note:'苍茫宿命、万物有时，厚重的悲怆余味。',
    tips:['用时间与物候的流逝写无力（残碑、西风、老树）','悲在点到为止，不泣不成声','以"无归"收束，留下苍凉'],
    avoid:['滥情哀嚎','为悲而悲脱离事件'],
    check:['悲怆有重量感','克制中透出宿命感'],
    demo:'他蹲在旧碑前，指腹一点点抚过那些名字。风过，草伏下去又立起来，像是替他一排排地，给每个名字鞠了一躬。' },
  { id:'thrill', group:'element', cat:'情绪与张力', name:'惊心动魄',
    note:'千钧一发的生死瞬间、大事件高峰的震动。',
    tips:['倒计时式紧迫（再零点几秒就…）','用瞬间抉择压缩张力','高潮后留一帧静默回响'],
    avoid:['全程紧崩到麻木','为震撼而失真'],
    check:['读时屏住呼吸','高潮有回响'],
    demo:'他按下的不是按钮，是整座城的命。警报倒数最后一声时，他闭上了眼——然后睁开的，是响起的钟声。' },
  { id:'fast',   group:'element', cat:'节奏与网感', name:'爽文/快节奏',
    note:'短段落、强动作链、钩子密集、打脸反转。',
    tips:['短段落、信息密度高','动作链推进、钩子密集','打脸反转干脆'],
    avoid:['长句拖慢节奏','仅爽无逻辑'],
    check:['平均句长偏短','节奏有快慢变化'],
    demo:'评委按下淘汰键。他反手把U盘插进主机。全场以为他在作死——三分钟后大屏弹出那段从未公映的预告片，满座哗然：他才是那部片的原作者。' },
  { id:'webman', group:'element', cat:'节奏与网感', name:'网文口语化',
    note:'"咱""咋""整点"这类方言口语、接地气。',
    tips:['用接地气口语','短句、像说话','贴近生活原声'],
    avoid:['文绉绉书面语','生硬翻译腔'],
    check:['读起来像听人说话','口语自然不违和'],
    demo:'老板娘扯着嗓子喊："小师傅，麻辣烫要辣不？"他头也不抬："辣！整大份，莫放香菜，多整两勺油辣子！"' },
  { id:'roast',  group:'element', cat:'节奏与网感', name:'逗趣吐槽',
    note:'吐槽回环、毒舌、冷幽默（偏"解说式吐槽"）。',
    tips:['冷幽默旁观者视角','一本正经说反话的拆台式吐槽','毒舌但留分寸'],
    avoid:['刻薄伤人的恶意嘲讽','吐槽脱离剧情变成作者乱入'],
    check:['吐槽符合人物视角','无恶意攻击'],
    demo:'他说他要开始健身了。我看了眼他怀里那袋薯片，他说这是低卡的。我点点头：对，低卡到只够长在你最不常用的那块肉上。' },
  { id:'sliceoflife',group:'element',cat:'节奏与网感', name:'慢节奏生活流',
    note:'长句舒缓、日常细节、流水账式的治愈感。',
    tips:['长句舒缓','写日常细节与烟火气','节奏慢、治愈感'],
    avoid:['节奏拖沓无信息','平淡到无趣'],
    check:['细节有生活气息','读来治愈不焦躁'],
    demo:'傍晚他去买馒头，老板娘多塞了他一根油条，说是刚出锅的。他回家掰开馒头夹上油条，就着一碗滚烫的豆浆慢慢吃完，天正好黑下来。' },
  { id:'breathe',group:'element',cat:'节奏与网感', name:'张弛起伏',
    note:'快慢交替、张弛有度，情绪张满后给回气口。',
    tips:['激烈桥段后接舒缓过渡，避免全程崩弦','单章内安排1-2次情绪高低谷','节奏服务情绪，快慢都有目的'],
    avoid:['全程高能致疲劳','拖沓无高潮'],
    check:['快慢有对比','张弛有度不闷'],
    demo:'枪声刚落，只剩瓦砾里忽明忽暗的火——他忽然很想抽一会儿烟。' },
  { id:'staccato',group:'element',cat:'节奏与网感', name:'顿挫短句',
    note:'多短句、多句号、顿挫压迫，紧张感靠断句砸出来。',
    tips:['短句密集、句号敲击节奏','关键动作用破折号或单字短句定格','对白惜字加句读制造压迫'],
    avoid:['长句堆叠泄气','顿挫变碎碎念'],
    check:['读来有敲击感','氛围紧绷不碎'],
    demo:'灯灭了。门动了。枪，上了膛。他一动不动。' },
  { id:'shot',group:'element',cat:'节奏与网感', name:'画面分镜',
    note:'镜头语言进文字：切镜、推拉、特写、蒙太奇，画面感强。',
    tips:['靠镜头视角切换组织画面','大场面用推拉/俯瞰再切特写','关键处停格特写留画面'],
    avoid:['镜头跳切无联接','纯描写拖节奏'],
    check:['画面在脑中成像','切镜服从叙事'],
    demo:'镜头从燃着的舰队拉远，落在滩头一双攥紧步枪的手上——那只手在抖。' },
  { id:'meme',group:'element',cat:'节奏与网感', name:'玩梗共鸣',
    note:'适度当代网络梗、表情包化表达，提升年轻网感共鸣。',
    tips:['梗服务于人物与情绪，不做作者乱入','用"懂的都懂"式轻梗，不用陈年老梗','一处1-2个足够，密必俗'],
    avoid:['老梗陈词','梗盖过剧情'],
    check:['无梗也能读懂','梗符合人物身份'],
    demo:'他盯着那条消息看了三遍，缓缓打出一个"6"。' },
  { id:'oneliner',group:'element',cat:'节奏与网感', name:'爆点金句',
    note:'在名场面制造一句被记住、可转发的经典台词。',
    tips:['关键转折前铺垫，台词落在一击上','简洁有锋芒，可独立成句','金句说透情绪，不只耍帅'],
    avoid:['句句都是金句反成废话','为金句硬造'],
    check:['单拎出来仍有味道','贴合人物口吻'],
    demo:'"他们都叫我无名氏，可我记得每个名字。"' },
  { id:'punchline',group:'element',cat:'节奏与网感', name:'三连递进',
    note:'三点递进式爆点：铺垫→升格→砸点，笑点/爽点有结构。',
    tips:['先铺垫再翻一转二再砸底','第二/第三点必须递进更强','结尾落点干脆不拖'],
    avoid:['三连平铺无递增','砸底拖泥带水'],
    check:['一层比一层响','落点干脆'],
    demo:'第一次叫错，他笑了；第二次叫错，他黑了脸；第三次——他教那人把名字写在自己的拳头里。' },
  { id:'nonlinear',group:'element',cat:'叙事技法', name:'非线性插叙',
    note:'时间跳跃、倒叙插叙、视角切换的笔法。',
    tips:['倒叙/插叙布局时间线','适时视角切换','留悬念、逐步揭开'],
    avoid:['时间线混乱难懂','为炫技而跳跃'],
    check:['读者能看懂时间线','插叙服务悬念与情感'],
    demo:'多年后他整理父亲的遗物，翻出一张褪色的火车票：终点是当年他离家那晚没到的地方。他想起来了——那晚父亲追出去，其实一直追到了站台。' },
  { id:'multipov',group:'element',cat:'叙事技法', name:'多视角群像',
    note:'视角切换带来的文体变化。',
    tips:['多角色视角切换','各视角文体略有差异','用视角差制造信息差'],
    avoid:['视角混乱','众角色声音雷同'],
    check:['视角切换清晰','各视角有辨识度'],
    demo:'她在台上笑得落落大方，转身时长裙扫过。站在二楼的他，看见的却是她攥住裙摆的手，指节白了一瞬——那是她说不出口的那记再见。' },
  { id:'jinyong', group:'element', cat:'叙事技法', name:'金庸武侠风',
    note:'白话为骨、清隽文雅，重侠义风骨与「武即德」，打斗点到即止。',
    tips:['文白相间但以白话为主，清朗不拗口','对白见人物心性，谈笑间立场分明','武学重在招如其人、胜负系于胸襟与抉择'],
    avoid:['通篇文言掉书袋','靠境界/数据堆战力而无人格','招式浮夸只剩热闹'],
    check:['打斗不靠数值堆砌','人物立得住、侠义贯穿','武与德互为表里'],
    demo:'他这一剑不伤人，只想破开迷障问一句——当年的恩怨，可曾有半分真假？' },
  { id:'cosmic', group:'element', cat:'叙事技法', name:'克苏鲁/神秘叙事',
    note:'慢热、不可名状的形容、氛围堆叠而非直接说明。',
    tips:['慢热铺垫、氛围堆叠','描述不可名状的怪诞','不直接说明，留神秘'],
    avoid:['直接点破诡异真相','描写喧宾夺主'],
    check:['氛围压抑、层层递进','神秘感不流失'],
    demo:'山谷里的小旅馆只住了他一个客人。后半夜，楼道尽头传来敲门声，两下，停，一下。他壮胆开门——走廊空无一人，而他插在门内侧的那把反锁钥匙，不知何时，已经被拔掉了。' },
  { id:'fan',    group:'element', cat:'叙事技法', name:'魔幻奇幻史诗',
    note:'魔法奇观、异界冒险、史诗宿命，奇幻世界观从容自洽。',
    tips:['魔法与异界设定自洽、有内在法则','经典奇幻的大格局与使命宿命','冒险推进带史诗感、旅程即成长'],
    avoid:['设定堆砌只炫世界','奇幻沦为无敌光环','格局大却空泛'],
    check:['世界法则自洽','冒险有史诗张力','设定服务人物与使命'],
    demo:'山脚的灯一盏盏亮起，他握着旧魔杖站在岔路出口：预言说的是他，可他只想先救下那个女孩。' },
  { id:'space',  group:'element', cat:'叙事技法', name:'宇宙史诗/星际文明',
    note:'放大星空与文明兴衰的宏大尺度，用异族视角与技术奇观铺陈未知。',
    tips:['把尺度拉到星海与文明兴衰的跨度','用技术奇观、异族视角制造宇宙感与疏离','让高于个人恩怨的文明命题作底'],
    avoid:['沦为地球都市科幻','堆设定与数据、只炫科技','把外太空当猎奇背景而无文明内核'],
    check:['有宇宙尺度与想象力','设定服务于主题','文明命题能立住'],
    demo:'当那艘沉寂了一万年的方舟重新亮灯，瞭望塔上最后一个人类忽然明白：我们从未孤独。' },
  { id:'sus3',   group:'element', cat:'叙事技法', name:'科幻惊悚衍生态',
    note:'高科技下的危险美学，惊颤与悬念延续而非设定堆砌。',
    tips:['以技术奇观放大未知威胁','惊悚源自科技的失控与人性','慢热铺垫、悬念层层加码'],
    avoid:['堆设定与术语','靠突然惊吓混悬念','高科技沦为背景板'],
    check:['威胁具体可感','悬念持续推进','科技与人性的张力兼顾'],
    demo:'培育缸里那头东西睁开眼，第一反应不是逃，而是隔着防爆玻璃，安静地打量他。' },
  { id:'jifeng', group:'element', cat:'台词设计', name:'机锋对白',
    note:'短促交锋、话里有话（谍战、职场戏）。',
    tips:['对话短促交锋','话里有话、潜台词丰富','用停顿与留白施压'],
    avoid:['对白直白无张力','所有角色雷同'],
    check:['对话有子面冲突','潜台词清晰可读'],
    demo:'"你早该走了，为什么还留着？""你这话，是想我走，还是怕我听出你舍不得？"他笑了笑，把她面前那杯凉掉的茶，轻轻往她那边推了推。' },
  { id:'cross',  group:'element', cat:'台词设计', name:'插科打诨',
    note:'荤素不忌的相声式对白。',
    tips:['相声式插科打诨','对话热闹、包袱密集','符合人物身份场合'],
    avoid:['低俗失度','为逗而逗脱离剧情'],
    check:['笑点长在人物身上','不失分寸'],
    demo:'"都说了我这人不记仇。""那你上回怎么三个月没理老王？""怪他记性太好——把我早忘了的事，替他记了三个月的仇。"' },
  { id:'storyteller',group:'element',cat:'台词设计', name:'说书人腔',
    note:'旁白式"话说""且听我道来"的叙述介入。',
    tips:['旁白式"话说/且听我道来"','叙述者在场、带节奏','说书式点评与转场'],
    avoid:['旁白过度打断','腔调陈旧呆板'],
    check:['有说书节奏','旁白服务叙事'],
    demo:'话说这码头上，能叫整条船停下来等一个人的主儿，可不多。可这一位啊，偏偏就肯等；这一等，分别的，便成了一段十里八乡都讲不完的交情。' },
  { id:'moli',   group:'element', cat:'叙事技法', name:'无厘头喜剧',
    note:'荒诞夸张、无逻辑转折、错位自嘲，一本正经地胡说八道。',
    tips:['设置夸张与反差、笑点落在荒诞而非逻辑','一本正经说荒唐话、错位自嘲','梗密度高、节奏快、转场跳脱'],
    avoid:['刻意逻辑闭环','低俗恶搞无节制','为搞笑强加剧情'],
    check:['荒诞但有内在喜感','不流于恶俗','笑点服务于人物与剧情'],
    demo:'他认真地思考了三秒，然后很严肃地告诉我：人不能太有钱，因为容易长寿。' },
  { id:'shenghuo', group:'element', cat:'叙事技法', name:'生活情景喜剧',
    note:'家庭日常＋固定人物性格碰撞，误会化解保留温馨底。',
    tips:['生活场景、小冲突环环相扣','用人物固定性格制造笑点与误会','斗嘴后总会化解、留温情收尾'],
    avoid:['冲突升级成狗血','靠强设定硬造笑点','失去生活质感'],
    check:['笑点来自生活与人物关系','误会化解自然','温暖底色不丢'],
    demo:'妈妈问他为什么又考砸，他一本正经：老师把题出得太多，我一时没来得及焦虑。' },
  { id:'fangyan', group:'element', cat:'台词设计', name:'方言/口音区隔',
    note:'用方言俚语、口癖腔调让每个角色开口有辨识度，对话自带地域与身份。',
    tips:['给关键角色赋予标志性口癖与腔调','用少量方言俚语点出身与城，不整段方言','不同地角色用不同语言习惯拉开落差'],
    avoid:['全程方言、读者难读','所有角色腔调雷同','方言作为噱头却无人格'],
    check:['台词不用看名就能分人','方言服务于人物身份','可读性不因口音牺牲'],
    demo:'“听你这口音，是打潞州来的吧？”掌柜的搁下算盘，“俺们这儿不兴这个。”' },
  { id:'qinghua', group:'element', cat:'台词设计', name:'情话/浪漫对白',
    note:'含蓄走心、带诗意的浪漫对白，于细节处表深情。',
    tips:['话里有心意，点到即止不直白','借日常物象与细节表深情','留白，把余味交给读者'],
    avoid:['油腻直白的土味情话','空喊喜欢无行动落点','为美而美、脱离人物语气'],
    check:['含蓄但不晦涩','情出自细节、真实可感','符合人物身份口吻'],
    demo:'他望着她的眼睛，半天只说了句：“今年冬天的雪，我替你先堆好了。”' },
  { id:'yinghan', group:'element', cat:'台词设计', name:'冷峻短促/硬汉对白',
    note:'惜字如金、动作代答，暗示多于直陈的克制型对白。',
    tips:['句子短、信息密，能用一个字不用一句','用动作与沉默代替解释','威胁与真相藏进潜台词'],
    avoid:['废话连篇','情绪过分外露','为装酷而故作高深'],
    check:['每句对白都有信息量','沉默与动作在替人物说话','克制但不冰冷失温'],
    demo:'“去哪？”“走。”“还回来吗？”他没停步，扔下一句：“看运气。”' }
];
const WRITE_COMBOS = [
  { id:'comic',     name:'😆 轻喜剧',  desc:'对白机锋层层叠加诙谐拆台，笑点长在人物与话术上，不硬抖包袱。', tags:['jifeng','cross','roast'] },
  { id:'mystery',   name:'🕵️ 悬疑',   desc:'阴冷压抑＋非线性悬念逐步编织，靠信息差与伏笔牵引推理。', tags:['suspense2','nonlinear'] },
  { id:'burn',      name:'🔥 燃向',   desc:'快节奏加码＋强动作链与密集钩子，情绪与力度一路走高。', tags:['fast','flame'] },
  { id:'aesthetic', name:'🌸 唯美',   desc:'文艺意象＋诗化段落，抒情长句与留白共筑氛围。', tags:['wenyi','poetic'] },
  { id:'speed',     name:'⚡ 快节奏爽文', desc:'爽文节奏＋网文口语与机锋对白，段落短、信息密、不拖沓。', tags:['fast','webman','jifeng'] },
  { id:'moli-combo', name:'🤪 无厘头',     desc:'荒诞夸张、反差自嘲，梗密节奏快，笑点落在荒诞不落在逻辑。', tags:['moli','fast','cross'] },
  { id:'family',   name:'😂 欢脱日常',   desc:'家庭生活小冲突环环相扣，误会化解留温情，笑点来自关系和烟火气。', tags:['shenghuo','sliceoflife','cross'] },
  { id:'jianghu',  name:'🏮 江湖喜剧',   desc:'武侠外壳的生活喜剧：江湖群像斗嘴＋无厘头＋机锋，笑点在人情世故。', tags:['shenghuo','moli','jifeng'] },
  { id:'yosheng',  name:'🦖 侏罗纪式科幻', desc:'高科技惊悚＋冒险奇观：未知威胁延续悬念，科技失控处见人性。', tags:['suspense2','fast','sus3'] },
  { id:'gufeng',   name:'🏯 武侠古风',   desc:'金庸风骨＋古风文言，侠义作魂、古韵为衣，打斗点到即止。', tags:['jinyong','classic','flame'] },
  { id:'romance',  name:'💞 甜宠言情',   desc:'恋爱甜宠＋浪漫对白＋轻盈灵动，细节传情、小动作含糖。', tags:['sweet','qinghua','airy'] },
  { id:'epicfan',  name:'🏰 史诗奇幻',   desc:'奇幻冒险＋史诗厚重＋宇宙尺度，大格局世界观从容铺陈。', tags:['fan','epic','space'] },
  { id:'horror',   name:'👻 惊悚恐怖',   desc:'感官恐惧＋悬念压抑＋顿挫短句，寒意入骨、压迫步步收紧。', tags:['terror','suspense2','staccato'] },
  { id:'heal',     name:'💧 治愈温情',   desc:'平淡暖心＋慢节奏生活流＋轻快灵动，柴米油盐里的光。', tags:['warmth','sliceoflife','airy'] },
  { id:'scheme',   name:'⚔️ 权谋对峙',   desc:'一触即发＋锋利冷冽＋机锋对白，句句试探、胜负在话里。', tags:['standoff','cutting','jifeng'] },
];
function availableCombos(){
  const c = getCfg().styleCustom || {};
  c.customCombos = Array.isArray(c.customCombos) ? c.customCombos : [];
  const removed = Array.isArray(c.comboRemoved) ? c.comboRemoved : [];
  const libIds = writeStyleLib().map(s=>s.id);
  const builtin = WRITE_COMBOS.filter(x=> !removed.includes(x.id));
  const mine = c.customCombos
    .map(x=>({ ...x, custom:true, tags:(x.tags||[]).filter(id=> libIds.includes(id)) }))
    .filter(x=> x.tags.length > 0);
  return builtin.concat(mine);
}
const AI_CAT_LABEL = { '语言质感':'① 语言质感', '情绪与张力':'② 情绪与张力', '节奏与网感':'③ 节奏与网感', '叙事技法':'④ 叙事技法', '台词设计':'⑤ 台词设计', custom:'⭐ 我的自定义' };
let aiRp = null; // {list:[...], err:'' } 运行期临时候选（不持久化；render 重建主卡时会保留，重启清空）
const KEY_AIHIST = nsKey('aiRecipeHist_v1');
const AIHIST_CAP = 30;                       // 快照条数上限
const AIHIST_MAX_BYTES = 3600000;            // 存储体积安全阈值（约 3.4MB）
function getAiHist(){ try{ return JSON.parse(localStorage.getItem(KEY_AIHIST)||'[]'); }catch(e){ return []; } }
function setAiHist(a){
  let list = Array.isArray(a) ? a.slice(-AIHIST_CAP) : [];
  let s;
  try{ s = JSON.stringify(list); }catch(e){ return; }
  while(list.length && s.length > AIHIST_MAX_BYTES){ list.shift(); s = JSON.stringify(list); }
  try{ localStorage.setItem(KEY_AIHIST, s); }catch(e){ /* 超限静默；设独立键，不影响主 cfg */ }
}
function addAiHist(entry){ const a = getAiHist(); a.push(entry); setAiHist(a); return a.length; }
function snapAiHist(){ return getAiHist(); }
function aiHistEntryId(){ return 'ah'+Date.now().toString(36); }
function histState(kind){
  const s = state;
  if(kind === 'ct'){ if(!Array.isArray(s.ctAdviceHist)) s.ctAdviceHist = []; return s.ctAdviceHist; }
  if(kind === 'content'){ if(!Array.isArray(s.contentAdviceHist)) s.contentAdviceHist = []; return s.contentAdviceHist; }
  return [];
}
function addAdvHist(kind, entry){
  const a = histState(kind);
  a.push(entry);
  if(a.length > 30) a.splice(0, a.length - 30);   // 小体积文本，按条数截断即可
  persist();
  return a.length;
}
function openAdvHistPanel(kind){
  const hist = histState(kind).slice();
  const mode = kind === 'content';
  const ov = document.createElement('div'); ov.id='advHistPanel'; ov.className='gs-overlay';
  const entHtml = (e,hi)=>{
    const ei = hist.length-1-hi;   // 倒序序号（与展示一致）
    return `<div class="ws-lib-group ws-lib-fold" style="margin-top:6px">
      <div class="ws-lib-fold-t" data-ah-fold="${ei}" role="button" tabindex="0" title="展开/收起">
        <span>${mode?'📄':'📝'} ${esc(e.desc||'')} <span class="muted" style="font-size:10px">· ${new Date(e.ts).toLocaleString('zh-CN',{hour12:false})}</span></span>
        <span class="sc-fold-ico">▸</span>
      </div>
      <div class="ws-lib-fold-body" style="display:none">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px">
          <button type="button" class="btn small ghost" data-ah-apply="${ei}">↩ 回填首条建议</button>
          <button type="button" class="btn small ghost" data-ah-del="${ei}">删</button>
        </div>
        ${ (Array.isArray(e.list)&&e.list.length) ? e.list.map((c,i)=>aiAdvHistCandHtml(c,i)).join('<hr style="margin:6px 0;opacity:.2">') : '<p class="muted">无建议。</p>' }
      </div>
    </div>`;
  };
  const list = hist.slice().reverse();
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>${mode?'📄':'📝'} ${mode?'章节内容':'章节标题'} AI 建议历史（${hist.length}）</b>
        <span style="display:flex;gap:6px">
          <button class="btn small ghost" data-ah-clear>清空</button>
          <button class="gs-x" data-ah-close>✕</button>
        </span></div>
      <div class="cv-body">
        ${ list.length ? list.map(entHtml).join('') : '<p class="muted">暂无历史。用「✨ AI 优化此建议」生成后即自动保存于此，可随时回看。</p>' }
      </div>
    </div>`;
  const close = ()=>{ const p=$('#advHistPanel'); if(p) p.remove(); };
  ov.addEventListener('click', (e)=>{
    const cl = e.target.closest('[data-ah-close]'); if(cl){ close(); return; }
    const fold = e.target.closest('[data-ah-fold]');
    if(fold){ const body = fold.closest('.ws-lib-group').querySelector('.ws-lib-fold-body'); if(body){ const open = body.style.display!=='none'; body.style.display = open?'none':'block'; fold.querySelector('.sc-fold-ico').textContent = open?'▸':'▾'; } return; }
    const apply = e.target.closest('[data-ah-apply]');
    if(apply){
      const ei=+apply.dataset.ahApply; const entry=hist[ei];
      if(entry && Array.isArray(entry.list) && entry.list.length){
        if(mode){
          aiAdviceCand = entry.list.slice(0,3);
          const out = $('[data-advice-ai-out]'); if(out) out.innerHTML = aiAdviceResultHtml();
          const ta = $('#rpAdvice'); if(ta){ ta.value = (entry.list[0]&&entry.list[0].text)||''; ta.focus(); }
        }else{
          ctAdviceCand = entry.list.slice(0,3); ctAdviceFold = false; ctAdoptedIdx = -1;
          const out = $('[data-cth-ai-out]'); if(out) out.innerHTML = ctAdviceResultHtml();
          updateFoldBtn();
          const inp = $('#rtInput'); if(inp) inp.value = (entry.list[0]&&entry.list[0].text)||'';
        }
        toast('已回填该条建议');
      }
      close(); return;
    }
    const del = e.target.closest('[data-ah-del]');
    if(del){ const ei=+del.dataset.ahDel; const a=histState(kind); if(a[ei]){ a.splice(ei,1); persist(); } refreshAdvHistBadge(kind); const p=$('#advHistPanel'); if(p) p.remove(); openAdvHistPanel(kind); return; }
    const clr = e.target.closest('[data-ah-clear]');
    if(clr){ if(confirm('确认清空全部该建议历史？')){ histState(kind).length = 0; persist(); refreshAdvHistBadge(kind); close(); } return; }
    if(e.target===ov) close();
  });
  document.body.appendChild(ov);
}
function aiAdvHistCandHtml(c,i){
  return `<div class="advice-ai-cand"><div class="advice-ai-head"><span class="advice-ai-idx">${'①②③'[i]||(i+1)}</span><b>${esc(c.title||('方案'+(i+1)))}</b></div><p>${esc(c.text||'')}</p></div>`;
}
function refreshAdvHistBadge(kind){
  if(kind === 'ct'){
    const card = $('.ct-block');
    if(card){ const b = card.querySelector('[data-ctadv-hist] .ai-hist-badge'); if(b) b.textContent = histState('ct').length||''; }
  }else{
    const rp = $('#regenPanel');
    if(rp){ const b = rp.querySelector('[data-advadv-hist] .ai-hist-badge'); if(b) b.textContent = histState('content').length||''; }
  }
}
const AI_RECIPE_SYS_PRO = `你是一位资深长篇小说「风格工程师」，同时为「写作配方设计师」。
【核心任务】根据本小说的②优化构想所选方案（含书名+九要素，其中「风格/题材/氛围/主角气质」等字段是设计配方的首要依据）或用户描述，设计 2~6 个可直接落地的组合配方。

【必须输出的 JSON 结构】
[
  {
    "name": "配方名（≤12字）",
    "desc": "一句话点明这套风格适用的题材/氛围",
    "tags": ["现有词库词条 id，2-5 个"],
    "why": "为何这样选（中文引用词条 name，1-2句）",
    "scenario": "适用场景（题材/章节阶段/文风匹配度，1-2句）",
    "gap": null
    // 或 gap（一次可给多条，务必给全所有缺口）：[
    //   {"name":"...","cat":"语言质感","id":"...","note":"...","tips":["..."],"avoid":["..."],"check":["..."],"demo":"...","reasons":"..."},
    //   {"name":"...","cat":"叙事技法","id":"...","note":"...","tips":["..."],"avoid":["..."],"check":["..."],"demo":"...","reasons":"..."}
    // ]
  }
]

【硬性约束】
1. tags 只能使用现有词库 id。现有词库只是参照、不是天花板，更不是必须迁就的对象：即使现有词条看似可用，只要它不是百分之百贴合本小说（例如只覆盖了一半的意涵），就必须设计完全为本小说量身定制的全新词条放入 gap——这是核心职责（大胆创造），不是加分项。
2. gap 数量由真实缺口决定、不机械硬造：现有词库已能完全覆盖本小说所需时，gap 应为 null（0 条、完全不生成新词条是合理且受鼓励的答案，绝不为了"看起来有缺口"而硬凑词条）；只有当确实存在现有词库无法覆盖的缺口维度时，才把它们写成独立的 gap 词条（需几条给几条，把真实缺口一次给全、不要只给 1 个、不要偷懒合并成一条）。
3. gap 为 null 与 gap 非空都是可接受的自主判断，请勿机械填空、勿为数量而造词：gap 非空时每个词条必须五维齐全（note/tips/avoid/check/demo），缺一作废；尽量覆盖不同的风格维度（语言质感/情绪与张力/节奏与网感/叙事技法/台词设计），避免互相同质重复。
4. 不同候选用词尽量不同、风格拉开差异。
5. why / scenario / reasons 里引用词条时必须使用中文 name，禁止出现英文 id。
6. gap 新词条的 cat 只能取以下五类之一：语言质感、情绪与张力、节奏与网感、叙事技法、台词设计。
7. 只输出上述 JSON 数组，不要 markdown 代码块、不要解释。
8. 控制思考深度：先想清楚再作答，不要把大量 token 花在内部推理上；务必把预算留给正文，输出一个完整、可直接 JSON.parse 的数组。`;

function aiRecipeUser(extra){
  const cand = selectedPolishCandidate();
  const txt = String((cand && cand.text)||'').trim();
  if(txt){
    const body = stripStructureFromIntro(txt);
    const head = '【所选方案完整原文（唯一蓝本：含书名+九要素，配方须百分之百贴合本小说）】\n' + body;
    return extra ? `${head}\n\n以下为对该小说的写作风格配方设计请求：\n${extra}` : head;
  }
  const o = state.outline || {};
  const head = (String(o.title||'').trim() && String(o.logline||'').trim())
    ? `【小说书名】${o.title}\n【小说简介】${o.logline}\n\n以下为该小说的写作风格配方设计请求：`
    : '（尚未生成大纲：为让 AI 依据本小说书名与简介设计更贴合的风格配方，建议先到「大纲」步生成书名与简介。）';
  return extra ? `${head}\n\n${extra}` : head;
}
function aiRecipeSpecNote(s){
  const n = String(s.note||'').trim();
  if(!n) return '';
  const multi = n.includes('\n') && /写法|避免|自查/.test(n);
  const head = n.split('\n')[0].trim();
  return (multi ? (head ? head + '（多行配方·详见词库）' : '（多行配方·详见词库）') : n).slice(0,60);
}
function aiRecipePrompt(userDesc){
  const lib = writeStyleLib();
  const spec = lib.map(s=> `- ${s.id}：${s.name}（${s.cat||'custom'}）｜${aiRecipeSpecNote(s)}`).join('\n');
  return { system: AI_RECIPE_SYS_PRO + '\n\n【现有词库 id/name/cat】：\n' + spec, user: aiRecipeUser(userDesc) };
}
function aiRecipeCard(){
  const lib = writeStyleLib();
  const collapsed = getCfg().aiRecipeCollapsed === true;
  return `<div class="card ai-recipe-card card-theme-recipe${collapsed?' collapsed':''}">
    <div class="ai-recipe-head card-head-bar" data-ai-recipe-fold role="button" tabindex="0" title="展开/收起">
      <div class="ch-left">
        <span class="ch-badge ch-badge-recipe">🧪</span>
        <h3 class="ch-title">AI 配方助手</h3>
        <span class="ch-subtag ch-subtag-recipe">风格设计 · 智能搭配</span>
      </div>
      <div class="ch-right">
        <button type="button" class="ai-upload-btn ai-hist-btn" data-ai-recipe-hist title="AI 配方历史：回看已生成过的候选配方">📖<span class="ai-hist-badge">${snapAiHist().length||''}</span></button>
        <span class="sc-fold-ico">${collapsed?'▸':'▾'}</span>
      </div>
    </div>
    <div class="ai-recipe-body">
      <div class="ai-desc-wrap">
        <textarea id="aiReDesc" rows="3" placeholder="" style="width:100%;box-sizing:border-box"></textarea>
      </div>
      <div class="ai-recipe-tool">
        <button type="button" class="btn primary" data-ai-recipe-gen>✨ 生成配方</button>
        <button type="button" class="btn small ghost" data-ai-recipe-clear>清空</button>
      </div>
      <div data-ai-recipe-out>${ aiRecipeResultHtml(lib) }</div>
    </div>
  </div>`;
}
function aiRecipeResultHtml(lib){
  if(aiRp && aiRp.err) return `<p class="muted" style="color:var(--danger);margin:8px 0 0">⚠️ ${esc(aiRp.err)}</p>`;
  if(!aiRp || !Array.isArray(aiRp.list) || !aiRp.list.length){
    return '';
  }
  const libIds = (lib||writeStyleLib()).map(s=>s.id);
  return aiRp.list.map((c,ci)=>`
    <div class="ai-recipe-cand${ ci===aiRp.hi ? ' hi' : '' }">
      <div class="ai-recipe-cand-head">
        <b>${esc(c.name||('候选'+ (ci+1)))}</b>
        ${ recipeScBadge(c) }
        <span class="muted" style="font-size:11px">${esc(c.desc||'')}</span>
      </div>
      <div class="ai-recipe-tags">${ (c.tags||[]).map(id=>{ const s=writeStyleById(id); return `<span class="ai-recipe-tg"${s?'':' title="引用了词库外 id"'} style="${s?'':'opacity:.65'}">${esc(s?s.name:id)}${s?'':'（词库外）'}</span>`; }).join('') }</div>
      <div class="ai-recipe-sec"><span class="ar-lab">为何这样选</span>${esc(wiseWhyText(c.why||''))}</div>
      <div class="ai-recipe-sec"><span class="ar-lab">适用场景</span>${esc(wiseWhyText(c.scenario||''))}</div>
      <div class="ai-recipe-gap">
        ${ gapHtml(c, ci) }
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn small primary" data-ai-recipe-pick="${ci}">✔ 选用此配方</button>
        <button type="button" class="btn small ghost" data-ai-recipe-save="${ci}" title="仅存入「我的配方」，不应用到写作风格">＋ 收藏不采用</button>
      </div>
    </div>`).join('');
}
function gapFiveHtml(g){
  const hasStruc = Array.isArray(g.tips)||Array.isArray(g.avoid)||Array.isArray(g.check);
  const p = hasStruc
    ? { intro:g.note||'', tips:Array.isArray(g.tips)?g.tips:[], avoid:Array.isArray(g.avoid)?g.avoid:[], check:Array.isArray(g.check)?g.check:[], demo:g.demo||'' }
    : parseCustomStyleNote(g.note||'');
  const parts = [];
  if(String(p.intro||'').trim()) parts.push('<div><b>指令</b>：'+esc(p.intro)+'</div>');
  if(p.tips&&p.tips.length) parts.push('<div><b>写法</b>：'+esc(p.tips.join('；'))+'</div>');
  if(p.avoid&&p.avoid.length) parts.push('<div><b>避免</b>：'+esc(p.avoid.join('；'))+'</div>');
  if(p.check&&p.check.length) parts.push('<div><b>自查</b>：'+esc(p.check.join('；'))+'</div>');
  if(String(p.demo||'').trim()) parts.push('<div class="ar-gap-demo"><b>示例</b>：'+esc(p.demo)+'</div>');
  return parts.join('');
}
function gapHtml(c, ci){
  if(!Array.isArray(c.gap) || !c.gap.length) return `<span class="ar-ok">✓ 现有词库即可覆盖，无需新词条</span>`;
  const pending = c.gap.some(g => !((c.tags||[]).includes(g.id) || libHas(g.id)));
  return `<div class="ar-gaptitle">⚠️ 存在词条缺口（共 ${c.gap.length} 项，可逐条或一键全部加入，确认后立即纳入当前配方）</div>
  ${ c.gap.map((g,gi)=>`
    <div class="ai-recipe-gapitem">
      <div class="ar-gaphead"><b>${esc(g.name||'')}</b><span class="muted" style="font-size:11px">${ (AI_CAT_LABEL[g.cat]||g.cat||'custom') }</span></div>
      <div class="ar-gapwhy">${esc(g.reasons||'')}</div>
      <div class="ar-gapnote">${gapFiveHtml(g)}</div>
      ${ g.warning ? `<div class="ar-gapwarn">⚠️ ${esc(g.warning)}</div>` : '' }
      <button type="button" class="btn small ghost" data-ai-recipe-addgap="${ci}__${gi}" ${ (c.tags||[]).includes(g.id)|| libHas(g.id) ? 'disabled' : '' }>＋ 加入词库</button>
    </div>`).join('') }
  ${ c.gap.length>1 ? `<div style="margin-top:6px"><button type="button" class="btn small primary" data-ai-recipe-addgapall="${ci}" ${pending?'':'disabled'} title="仅加入尚未入库的新词条；已入库的自动跳过">＋ 全部加入词库</button></div>` : '' }`;
}
function libHas(id){ return !!writeStyleById(id); }
function prepRecipeList(list){
  if(!Array.isArray(list)) return list;
  list.forEach(c=>{
    if(c && typeof c==='object'){
      c._gapOk = !(Array.isArray(c.gap) ? c.gap : []).some(n =>
        !n || !String(n.note||'').trim() || !(Array.isArray(n.tips) && n.tips.length) ||
        !(Array.isArray(n.avoid) && n.avoid.length) || !(Array.isArray(n.check) && n.check.length) ||
        !String(n.demo||'').trim());
    }
  });
  return list;
}
function recipeScBadge(c){
  return (c && c._gapOk === false) ? `<span class="ai-recipe-sc bad" title="建议的新词条缺少 note/tips/avoid/check/demo 中的维度，入典前请补全">⚠ 词条缺维</span>` : '';
}
async function aiRecipeProduce(system, user){
  const opt = { maxTokens: clampMaxTokens('recipe'), temperature:(getCfg().aiRecipeTemp==null?0.9:getCfg().aiRecipeTemp), topP:0.5 };
  const FIX = `\n\n【上一轮修正：gap 按需给全、不机械硬造】缺口与否由你自主判断：现有词库能完全覆盖时 gap 应为 null（0 条，不要为凑数而硬造）；确有多条真实缺口时才写 gap，并把它们一次给全（不要只给 1 个、不要合并）；gap 非空时每个新词条必须五维齐全——note（一句话定位）、tips（≥2 条）、avoid（≥1 条）、check（≥1 条）、demo（示例句）。请为非 null 的 gap 给全、给对上述字段。`;
  const FIX_JSON = `\n\n【上一轮修正：JSON 解析失败】上一轮输出无法被解析为合法 JSON 数组。请严格只输出一个 JSON 数组（不要 markdown 代码块、不要解释、不要任何额外文字）。`;
  let list = null, lastJsonOk = false;
  for(let attempt=1; attempt<=2; attempt++){
    const sys = attempt>1 ? String(system) + (lastJsonOk ? FIX : FIX_JSON) : system;
    const raw = unwrapAIResult(await callDeepSeek(sys, user, Object.assign({}, opt, {taskKey:'recipe'})));
    const cands = prepRecipeList(parseAiJsonList(raw));
    lastJsonOk = Array.isArray(cands) && cands.length > 0;
    if(lastJsonOk){ list = cands; break; }
  }
  if(!list || !list.length) throw new Error('AI 未返回有效配方，请重试');
  return list;
}
async function aiRecipeGen(){
  const ta = $('#aiReDesc'); if(!ta) return;
  const desc = (ta.value||'').trim();
  const hasLine = !!((selectedPolishCandidate()||{}).text || '').trim();
  if(!desc && !hasLine){ toast('请先描述你想要的风格'); return; }
  if(!desc && hasLine){ toast('将仅依据所选方案设计配方'); }
  const out = $('[data-ai-recipe-out]'); if(out) out.innerHTML = `<p class="muted" style="margin:8px 0 0">⏳ AI 正在${hasLine?'依据所选方案':'根据你的描述'}设计候选配方与词条缺口……</p>`;
  const gen = $('[data-ai-recipe-gen]'); if(gen){ gen.disabled = true; gen.textContent = '生成中…'; }
  try{
    const {system, user} = aiRecipePrompt(desc);
    const list = await aiRecipeProduce(system, user);   // D2/C①：生成即校验新词条五维齐全，不合格自动重试
    aiRp = { list, hi: 0 };
    addAiHist({ id: aiHistEntryId(), ts: Date.now(), src:'desc', desc: desc || '依据所选方案', list: JSON.parse(JSON.stringify(list)), applied:[] });
  }catch(e){
    aiRp = { list:null, err: (e&&e.message)||'生成失败' };
  }
  if(out) out.innerHTML = aiRecipeResultHtml();
  if(gen){ gen.disabled = false; gen.textContent = '✨ 生成配方'; }
}
function parseAiJsonList(raw){
  let t = String(raw||'').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(m) t = m[1].trim();
  try{ const a = JSON.parse(t); return Array.isArray(a)? a : null; }catch(e){
    try{ const i = t.indexOf('['), j = t.lastIndexOf(']'); if(i>=0&&j>i){ const a = JSON.parse(t.slice(i,j+1)); return Array.isArray(a)? a:null; } }catch(e2){}
    return null;
  }
}
function storeRecipeCandidate(c){
  if(!c) return null;
  const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
  cfg.styleCustom.customCombos = cfg.styleCustom.customCombos || [];
  const libIds = writeStyleLib().map(s=>s.id);
  let name = (c.name||'').trim(); if(!name) name = 'AI配方'+(cfg.styleCustom.customCombos.length+1);
  const names = cfg.styleCustom.customCombos.map(x=>x.name);
  let k = 2; while(names.includes(name)) name = (c.name||('AI配方'+(cfg.styleCustom.customCombos.length+1)))+'·'+ (k++);
  let tags = (c.tags||[]).filter(id=> libIds.includes(id));
  (c.gap||[]).forEach(g=>{ if(g && g.id && libIds.includes(g.id) && !tags.includes(g.id)) tags.push(g.id); });
  cfg.styleCustom.customCombos.push({ id:'cu'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name, desc:(c.desc||''), why: wiseWhyText(c.why||''), tags });
  saveCfg(cfg);
  return { combo:cfg.styleCustom.customCombos[cfg.styleCustom.customCombos.length-1], name };
}
function aiRecipeStore(ci){
  if(!aiRp || !Array.isArray(aiRp.list)) return null;
  return storeRecipeCandidate(aiRp.list[ci]);
}
function applyChosenCandidate(c, opts){
  if(!c) return null;
  const stored = storeRecipeCandidate(c); if(!stored) return null;
  const libIds = writeStyleLib().map(s=>s.id);
  const st2 = writeStyleState();
  const d2 = wsDraftInit();                       // 从生效配置取 tags
  d2.tags = (c.tags||[]).filter(id=> libIds.includes(id));   // 替换而非并集
  (c.gap||[]).forEach(g=>{ if(g && g.id && libIds.includes(g.id) && !d2.tags.includes(g.id)) d2.tags.push(g.id); });
  st2.tags = d2.tags.slice();
  persist();
  wsDraft = null;                                 // 草稿与生效合一 -> 卡片显示「✔已生效」
  if(!opts || opts.render !== false) aiRp = null;
  if(!opts || opts.render !== false){ render(); refreshWsUI(); }
  toast('已应用到「写作风格」：'+stored.name);
  return stored;
}
function aiRecipePick(ci){
  if(!aiRp || !Array.isArray(aiRp.list)) return;
  applyChosenCandidate(aiRp.list[ci]);
}
function aiRecipeApply(idx){
  if(!aiRp || !aiRp.list[idx]) return;
  applyChosenCandidate(aiRp.list[idx], {});
}
function aiRecipeSave(ci){
  if(!aiRp || !Array.isArray(aiRp.list)) return;
  const stored = aiRecipeStore(ci); if(!stored) return;
  toast('已加入「我的配方」（未应用）：'+stored.name);
}
function addGapEntryToLib(g){
  if(!g) return null;
  if(writeStyleById(g.id)) return null;
  const group = ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].includes(g.cat) ? g.cat : 'custom';
  const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
  cfg.styleCustom.added = cfg.styleCustom.added || [];
  const id = (g.id && /^[a-z][a-z0-9_]*$/i.test(g.id)) ? g.id : ('c'+Math.random().toString(36).slice(2,8));
  let finalId = id, mx = 1; const existing = writeStyleLib().map(s=>s.id);
  while(existing.includes(finalId)) finalId = id + (mx++);
  cfg.styleCustom.added.push({ id:finalId, group, name:(g.name||'').trim(), note:(g.note||'').trim(),
    tips:Array.isArray(g.tips)?g.tips.map(x=>String(x||'').trim()).filter(Boolean):[],
    avoid:Array.isArray(g.avoid)?g.avoid.map(x=>String(x||'').trim()).filter(Boolean):[],
    check:Array.isArray(g.check)?g.check.map(x=>String(x||'').trim()).filter(Boolean):[],
    demo:(g.demo||'').trim(), seal:(g.seal===undefined?0:g.seal), warning:(g.warning||'') });
  saveCfg(cfg);
  const d = wsDraftInit(); if(!d.tags.includes(finalId)) d.tags.push(finalId);
  return finalId;
}
function aiRecipeAddGap(key){
  if(!aiRp || !Array.isArray(aiRp.list)) return;
  const [ci, gi] = String(key||'').split('__').map(Number);
  const c = aiRp.list[ci]; if(!c) return;
  const g = (c.gap||[])[gi]; if(!g) return;
  const finalId = addGapEntryToLib(g);
  if(!finalId){ toast('该词条已在词库中'); return; }
  if(c.tags && !c.tags.includes(finalId)) c.tags.push(finalId);
  toast('已加入词库并纳入当前配方：'+(g.name||finalId));
  const out = $('[data-ai-recipe-out]'); if(out) out.innerHTML = aiRecipeResultHtml();
}

function aiHistAddGap(ei, ci, gi){
  const a = getAiHist(); const entry = a[ei]; if(!entry||!Array.isArray(entry.list)) return;
  const c = entry.list[ci]; if(!c) return;
  const g = (c.gap||[])[gi]; if(!g) return;
  const finalId = addGapEntryToLib(g);
  if(!finalId){ toast('该词条已在词库中'); return; }
  toast('已加入词库并纳入当前配方：'+(g.name||finalId));
  const out = $('[data-ai-recipe-out]'); if(out) out.innerHTML = aiRecipeResultHtml();
}
function aiHistAddGapAll(ei, ci){
  const a = getAiHist(); const entry = a[ei]; if(!entry||!Array.isArray(entry.list)) return;
  const c = entry.list[ci]; if(!c||!Array.isArray(c.gap)||!c.gap.length) return;
  let added = 0, skipped = 0;
  c.gap.forEach((g)=>{
    if(!g) return;
    if((c.tags||[]).includes(g.id) || writeStyleById(g.id)){ skipped++; return; }
    if(addGapEntryToLib(g)) added++;
  });
  const out = $('[data-ai-recipe-out]'); if(out) out.innerHTML = aiRecipeResultHtml();
  toast(added ? (skipped ? `已加入 ${added} 条新词条（跳过已入库 ${skipped} 条），并已纳入当前配方` : `已加入 ${added} 条新词条，并已纳入当前配方`) : '这些新词条都已在词库中，无需重复加入');
}

function aiRecipeAddGapAll(ci){
  if(!aiRp || !Array.isArray(aiRp.list)) return;
  const c = aiRp.list[ci]; if(!c || !Array.isArray(c.gap) || !c.gap.length) return;
  let added = 0, skipped = 0;
  c.gap.forEach((g, gi)=>{
    if((c.tags||[]).includes(g.id) || (g && writeStyleById(g.id))){ skipped++; return; }
    aiRecipeAddGap(ci + '__' + gi); added++;
  });
  toast(added ? (skipped ? `已加入 ${added} 条新词条（跳过已入库 ${skipped} 条），并已纳入当前配方` : `已加入 ${added} 条新词条，并已纳入当前配方`) : '这些新词条都已在词库中，无需重复加入');
  const out = $('[data-ai-recipe-out]'); if(out) out.innerHTML = aiRecipeResultHtml();
}

function parseCustomStyleNote(note){
  const tips=[], avoid=[], check=[];
  let intro='', demo='';
  const lines = String(note||'').split(/\n/);
  let mode = null;
  lines.forEach(l=>{
    const t = String(l||'').trim();
    if(!t) return;
    let m;
    if((m=/^指令[:：]\s*(.*)$/.exec(t))){ mode='intro'; if(m[1]) intro=m[1]; return; }
    if((m=/^写法[:：]\s*(.*)$/.exec(t))){ mode='tips'; if(m[1]) tips.push(m[1].replace(/^[①②③④⑤]?[.、）)]?\s*/,'')); return; }
    if((m=/^避免[:：]\s*(.*)$/.exec(t))){ mode='avoid'; if(m[1]) avoid.push(m[1].replace(/^[✗×\-\s]+/,'')); return; }
    if((m=/^自查[:：]\s*(.*)$/.exec(t))){ mode='check'; if(m[1]) check.push(m[1].replace(/^[□✅◇\-\s]+/,'')); return; }
    if((m=/^示例[:：]\s*(.*)$/.exec(t))){ mode='demo'; if(m[1]) demo=m[1]; return; }
    if(mode==='intro'){ if(!intro) intro=t; }
    else if(mode==='tips') tips.push(t.replace(/^[①②③④⑤]?[.、）)]?\s*/,''));
    else if(mode==='avoid') avoid.push(t.replace(/^[✗×\-\s]+/,''));
    else if(mode==='check') check.push(t.replace(/^[□✅◇\-\s]+/,''));
    else if(mode==='demo'){ if(!demo) demo=t; }
  });
  return { intro, tips, avoid, check, demo };
}
function writeStyleLib(){
  const c = getCfg().styleCustom || {};
  const notes = (c && c.notes) || {};
  const removed = Array.isArray(c && c.removed) ? c.removed : [];
  const added = Array.isArray(c && c.added) ? c.added : [];
  const base = WRITE_STYLES.filter(s=> !removed.includes(s.id)).map(s=>{
    const cat = s.cat || 'element';
    return { ...s, group:'element', cat, note: notes[s.id] || s.note };
  });
  const customs = added.map(a=>{
    const hasStruc = (Array.isArray(a.tips)&&a.tips.length) || (Array.isArray(a.avoid)&&a.avoid.length) || (Array.isArray(a.check)&&a.check.length);
    const parsed = hasStruc ? { tips:a.tips||[], avoid:a.avoid||[], check:a.check||[], demo:a.demo||'' } : parseCustomStyleNote(a.note||'');
    const cat = ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].includes(a.group) ? a.group : 'custom';
    return { id:a.id, group:'element', name:a.name||'未命名', note:a.note||'', custom:true, cat, tips:parsed.tips||[], avoid:parsed.avoid||[], check:parsed.check||[], demo:parsed.demo||a.demo||'', seal:(a.seal===undefined?0:a.seal), warning:a.warning||'' };
  });
  return base.concat(customs);
}
function writeStyleById(id){
  return writeStyleLib().find(s=> s.id === id) || null;
}
let _idNameMap = null;
function _idName(){
  if(_idNameMap) return _idNameMap;
  const m = new Map();
  writeStyleLib().forEach(s=>{ if(s.id) m.set(s.id, s.name); });
  return (_idNameMap = m);
}
function wiseWhyText(txt){
  if(!txt) return txt;
  const N = _idName();
  return String(txt).replace(/\b[A-Za-z_]\w*\b/g, w=> (N.has(w) ? N.get(w) : w));
}
function curWriteStyle(override){
  if(override && Array.isArray(override.tags)) return { tags: override.tags };
  const s = state.chapterStyle || {};
  return { tags: Array.isArray(s.tags)?s.tags:[] };
}
function wsGroupStyleTags(override){
  const st = curWriteStyle(override);
  const lib = writeStyleLib();
  return (Array.isArray(st.tags) ? st.tags : []).map(id=> lib.find(s=>s.id===id)).filter(Boolean);
}
function wsStyleNoteBlock(items, headTitle, intro){
  if(!items.length) return '';
  const lines = ['【' + headTitle + '（用户指定 · 最高优先指令）】', intro];
  items.forEach(s=>{
    lines.push('· '+s.name+'（总纲）：'+(s.note||''));
    if(Array.isArray(s.tips) && s.tips.length) lines.push('  写法：' + s.tips.map((t,i)=>`${['①','②','③','④','⑤'][i]||(i+1)+'.'} ${t}`).join('；'));
    if(Array.isArray(s.avoid) && s.avoid.length) lines.push('  避免：✗ ' + s.avoid.join('；✗ '));
    if(s.demo) lines.push('  示范写法：「'+s.demo+'」（可模仿其语感，不要照抄句子）');
    if(Array.isArray(s.check) && s.check.length) lines.push('  自查：' + s.check.map(c=>'□ '+c).join(' '));
  });
  lines.push('红线：以上风格仅约束表达方式，不得破坏人名/地名/专名一致性，不得违反基础剧情逻辑与人物设定。');
  return '\n\n' + lines.join('\n');
}
function chapterStyleNote(override){
  const items = wsGroupStyleTags(override);
  return wsStyleNoteBlock(items, '写作风格', '本指令是本章的表达层最高优先要求：它只决定‘怎么写’，不改写老师教案规定的‘写什么’。若与剧情推进、章节骨架、篇幅等任务发生冲突，不得删改教案事件；若与优化构想、人工润色建议等表达建议冲突，以用户已选写作风格为准。唯一不可逾越的红线：不得破坏人名/地名/专名一致性、不得违反基础剧情逻辑与人物设定。');
}
function writeStyleNamesBlock(){
  const items = wsGroupStyleTags(null);
  if(!items.length) return '';
  const names = items.map(s=>s.name).join('、');
  return `【写作风格（第一优先）】写作风格：${names}。\n本指令为本章规划的最高优先要求：当其与其它要求冲突时以本指令为准；唯一不可逾越红线：不破坏人名/地名/专名一致性、不违反基础剧情逻辑与人物设定。`;
}



function normalRange(r, fallback){
  const min = (typeof r==='object' && +r.min>0) ? +r.min : fallback.min;
  const max = (typeof r==='object' && +r.max>0) ? +r.max : Math.max(min, fallback.max);
  return { min, max: Math.max(min, max) };
}
function selSize(){
  if(state.chapterRange && (state.chapterRange.min>0 || state.chapterRange.max>0)){
    return { kind:'chapter', range: normalRange(state.chapterRange, {min:80,max:100}) };
  }
  if(state.wordRange && (state.wordRange.min>0 || state.wordRange.max>0)){
    return { kind:'word', range: normalRange(state.wordRange, SIZE_DEFAULT) };
  }
  return { kind:'word', range: SIZE_DEFAULT };
}
const fmtRange = r => `${r.min}-${r.max}`;
function chapterCountVal(){
  const v = +state.chapterCount;
  if(Number.isInteger(v) && v>=1 && v<=200) return v;
  return null;
}
const TEAM_OPTIONS = [
  { id:'solo',  label:'主角线',      n:1, kind:'solo', desc:'一位主角，个人视角贯穿全书' },
  { id:'dual',  label:'双主角',      n:2, kind:'dual', desc:'男女主角同为第一主角，双线叙事、双视角（如互为镜像与对照）' },
  { id:'trio',  label:'铁三角 +2',   n:3, kind:'team', desc:'一主角 + 两位主要配角（如鬼吹灯三人组）' },
  { id:'quad',  label:'四方团队 +3', n:4, kind:'team', desc:'一主角 + 三位主要配角' },
  { id:'quint', label:'五人团 +4',   n:5, kind:'team', desc:'一主角 + 四位主要配角' }
];
function currentTeamShape(){
  const v = state.teamShape || 'solo';
  return TEAM_OPTIONS.find(o => o.id === v) || TEAM_OPTIONS[0];
}
function shapeKind(){ return currentTeamShape().kind; }   // 'solo' | 'dual' | 'team'
function isSolo(){ return shapeKind() === 'solo'; }
function isDualStory(){ return shapeKind() === 'dual'; }
function isTeamStory(){ return shapeKind() === 'team'; }
function narrativeShapeBrief(){
  const k = shapeKind();
  if(k === 'solo') return '';
  if(k === 'dual'){
    return `【叙事主体·双主角】本书为「双主角」叙事：男女主角同为第一主角，各有独立且可并行推进的主线与人物弧线，互为镜像/对照/制衡。两条主线都须被整体叙事真正承接并回收，把某方写成另一方的附庸/陪衬即不合格；双视角切换须有明确触发且受控（通常一方为当下行动 POV，另一方线以各自的场景独立推进，交替呈现），禁止无节制的上帝视角跳转；两位主角之间往往存在核心张力的关系（相知/对峙/救赎/羁绊），这是本书主线的重要组成部分。`;
  }
  const ts = currentTeamShape();
  return `【叙事主体·团队】本书为「${ts.label}」：一位主角 + ${ts.n-1} 位主要配角（核心团共 ${ts.n} 人）。团队必须"缺一不可"——每位成员都应有可被剧情反复调用的独特能力/资源/担当（如解谜、武力、决策、沟通、补给等），谁也无法单独完成核心目标；成员间存在化学反应与暗流（互补、默契、分歧、救场、归队），并在故事推进中被逐一兑现。禁止把成员写成背景板，禁止主角单刷、队友全程挂机。`;
}
function teamShapeBrief(){ return narrativeShapeBrief(); }
function chapterCountHint(){
  const v = chapterCountVal();
  return v ? `全书 ${v} 章` : '请填写全书章节数（1-200，必填）';
}
const OPENING_STRATEGIES = [
  {id:'auto', label:'AI 推荐', desc:'按全书章节数与故事体量自动选择，首章优先进入主线。'},
  {id:'action', label:'事件直入', desc:'从正在发生的关键事件切入，适合短篇幅、强卖点题材。'},
  {id:'crisis', label:'危机开场', desc:'先给危险、冲突或倒计时，再逐步解释原因。'},
  {id:'result', label:'结果先行', desc:'先展示一个异常结果，再回到前因，适合悬疑与反转。'},
  {id:'normal', label:'日常破局', desc:'先建立人物日常，再让异常事件打破平衡。'},
  {id:'world', label:'世界异常', desc:'从一个反常世界现象切入，用事件带出世界规则。'},
  {id:'secret', label:'人物秘密', desc:'从秘密、隐瞒或关系裂缝切入，先立人物钩子。'},
  {id:'future', label:'未来片段', desc:'用预言、未来片段或结局影子制造问题，再回到当下。'}
];
function openingStrategyDef(id){ return OPENING_STRATEGIES.find(x=>x.id===id); }
function currentOpeningStrategyId(){ return openingStrategyDef(state.openingStrategy) ? state.openingStrategy : 'auto'; }
function recommendedOpeningStrategy(){
  const n = chapterCountVal() || 0;
  if(n <= 3) return 'crisis';
  if(n <= 8) return 'action';
  if(n <= 20) return 'normal';
  if(n <= 50) return 'secret';
  return 'world';
}
function openingBudget(){
  const n = chapterCountVal() || 0;
  if(n <= 3) return 1;
  if(n <= 8) return 2;
  if(n <= 20) return 3;
  if(n <= 50) return 5;
  return 8;
}
function openingStrategyExecutionCard(i=0){
  if(!isLong() || i!==0) return '';
  const selected = openingStrategyDef(currentOpeningStrategyId());
  const rec = openingStrategyDef(recommendedOpeningStrategy());
  const actual = currentOpeningStrategyId()==='auto' ? rec : selected;
  const jobs = {
    crisis:'第一段直接把读者放进正在发生的危机或倒计时中；随后只补最少必要背景。',
    action:'先给一个可视化动作/事件，再在动作中自然带出主角、目标与冲突。',
    normal:'先给一个有生活质感的具体场景，再让一个明确异常打破日常平衡。',
    secret:'先露出人物隐瞒、关系裂缝或异常反应，再让读者追问秘密是什么。',
    world:'先展示一个反常且可感知的世界现象，用人物反应把世界规则带出来。',
    result:'先展示一个已经发生的结果或代价，再倒推出“为什么会走到这里”。',
    future:'先给未来片段/预兆/结局影子，制造一个必须追问的悬念，再切回当下。',
    action2:'先给一个可视化动作/事件，再在动作中自然带出主角、目标与冲突。'
  };
  const job = jobs[actual.id] || actual.desc;
  return `【第一章开篇任务卡】
策略：${actual.label}
开篇职责：${job}
首拍硬目标：首段尽早让读者看见“谁在什么处境中、正在发生什么问题”，并形成一个明确的继续阅读问题。
首章前800字控制：以事件/人物现场为主，背景说明只允许为理解当前动作所必需的最小信息；禁止先写大段世界观说明、人物履历或空泛抒情。
首拍验收：开篇方式必须能被读者从正文实际动作/场景中辨认，而不是只在教案里写“按${actual.label}开篇”。`;
}
function principalOpeningTaskExcerpt(){
  const pr=(state.school&&state.school.principal)||{};
  if(pr.raw){
    const raw=String(pr.raw);
    const heads=['## 第一章开篇任务卡','# 第一章开篇任务卡','第一章开篇任务卡'];
    for(const h of heads){ const a=raw.indexOf(h); if(a>=0){ const tail=raw.slice(a); const m=tail.search(/\n#(?!#)|\n## /); const sec=(m>0?tail.slice(0,m):tail.slice(0,3000)).trim(); if(sec) return sec; } }
  }
  return openingStrategyExecutionCard(0);
}
function openingStrategyBrief(){
  if(!isLong()) return '';
  const selected = openingStrategyDef(currentOpeningStrategyId());
  const rec = openingStrategyDef(recommendedOpeningStrategy());
  const actual = currentOpeningStrategyId()==='auto' ? rec : selected;
  const n = chapterCountVal() || realChapterCount() || 0;
  return `【开篇引擎】全书${n||'未定'}章；开篇预算约${openingBudget()}章。策略=${actual.label}：${actual.desc}\n执行：第1章必须尽早建立核心人物、类型信号、可见问题与继续阅读的下一问；预算只是允许用于启动故事引擎的章节上限，不代表可以慢热拖延。${n>0&&n<5?'当前篇幅少于5章，首章应直接进入主线，最多用极短铺垫，不安排长背景章。':''}`;
}
function openingStrategyHtml(){
  if(!isLong()) return '';
  const cur=currentOpeningStrategyId(), rec=openingStrategyDef(recommendedOpeningStrategy());
  return `<div class="tw-panel" style="margin-bottom:10px"><div class="poly-head"><span class="poly-ic">🚪</span><b>开篇策略</b><span class="poly-rule">推荐：${esc(rec.label)} · 预算约${openingBudget()}章</span></div><div class="book-beat-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px">${OPENING_STRATEGIES.map(x=>`<label class="book-beat-card ${x.id===cur?'selected':''}" style="border:2px solid ${x.id===cur?'var(--accent,#4a90e2)':'var(--line,#e0e0e0)'};border-radius:8px;padding:10px;cursor:pointer"><input type="radio" name="openingStrategy" value="${x.id}" ${x.id===cur?'checked':''} style="display:none"><b>${esc(x.label)}${x.id===rec.id?' · AI推荐':''}</b><div class="muted" style="font-size:12px;line-height:1.5;margin-top:4px">${esc(x.desc)}</div></label>`).join('')}</div><div class="muted" style="font-size:12px;line-height:1.6;margin-top:8px">开篇预算不是“允许水”的章数，而是允许故事完成启动工作的范围。1–3章尽快入局；4–8章可有短铺垫；9章以上才逐步允许秘密、回忆与世界观承担更多开篇任务。</div></div>`;
}
function realChapterCount(){
  const n = (state.outline && Array.isArray(state.outline.chapters)) ? state.outline.chapters.length : 0;
  if(n>0) return n;
  return chapterCountVal();
}
function totalWordsBase(){ return (state.totalWords && +state.totalWords>0) ? +state.totalWords : 300000; }
const totalWan = () => (totalWordsBase()/10000).toLocaleString('en-US');
function estCounterpart(sz){
  const mid = (sz.range.min + sz.range.max) / 2;
  if(!mid) return null;
  return Math.round(totalWordsBase()/mid);
}
function sizeHintText(){
  const hasW = state.wordRange && (state.wordRange.min>0 || state.wordRange.max>0);
  const hasC = state.chapterRange && (state.chapterRange.min>0 || state.chapterRange.max>0);
  if(!hasW && !hasC) return '请先 ☑ 勾选「每章字数」或「全书章节」其中一项，再滑动滑条调整区间。';
  const sz = selSize();
  const cnt = estCounterpart(sz);
  if(sz.kind==='word') return `按每章 ${fmtRange(sz.range)} 字，全书约需 ${cnt} 章。`;
  return `全书约 ${fmtRange(sz.range)} 章，每章据此约 ${cnt} 字。`;
}
function sizeSlider(side, label, lo, hi, step, r, on){
  const dflt = side==='word' ? {min:3000,max:5000} : {min:80,max:100};
  const v = (r && +r.min>0 && +r.max>0) ? {min:+r.min, max:+r.max} : dflt;
  v.min = Math.max(lo, Math.min(hi, v.min));
  v.max = Math.max(lo, Math.min(hi, v.max));
  if(v.max < v.min) v.max = v.min;
  const cls = on ? 'size-block on' : 'size-block';
  const fmt = n => side==='word' ? n.toLocaleString() : String(n);
  return `<div class="${cls}" data-side="${side}">
      <button type="button" class="size-pick" data-pick="${side}" aria-pressed="${on}">
        <span class="size-radio">${on?'✓':''}</span>
        <span class="size-lbl">${label}</span>
      </button>
      <span class="size-val"><b data-dr-val="${side}">${fmt(v.min)} ~ ${fmt(v.max)}</b></span>
      <div class="drs ${on?'':'ds-off'}" data-drs="${side}" data-min="${lo}" data-max="${hi}" data-step="${step}"></div>
      <span class="size-scale">${lo.toLocaleString()} ~ ${hi.toLocaleString()}${side==='word'?' 字':' 章'}</span>
    </div>`;
}
function initDRS(){
  $$('.drs').forEach(drs=>{
    const side = drs.dataset.drs;
    const lo = +drs.dataset.min, hi = +drs.dataset.max, step = +drs.dataset.step;
    const stateR = side==='word' ? state.wordRange : state.chapterRange;
    const dflt = side==='word' ? {min:3000,max:5000} : {min:80,max:100};
    let v0 = (stateR && +stateR.min>0) ? +stateR.min : dflt.min;
    let v1 = (stateR && +stateR.max>0) ? +stateR.max : dflt.max;
    v0 = Math.max(lo, Math.min(hi, v0));
    v1 = Math.max(lo, Math.min(hi, v1));
    if(v1 < v0) v1 = v0;
    if(drs.noUiSlider){ drs.noUiSlider.destroy(); drs.noUiSlider = null; } // render 会重建；先销毁旧实例
    if(drs.classList.contains('ds-off')) return;
    noUiSlider.create(drs, {
      start: [v0, v1],
      connect: true,
      step: step,
      margin: step,
      range: { min: lo, max: hi }
    });
    const lbl = drs.parentElement.querySelector('[data-dr-val="'+side+'"]');
    const fmt = n => side==='word' ? n.toLocaleString() : String(n);
    drs.noUiSlider.on('update', (vals)=>{
      if(lbl){ const a=+vals[0], b=+vals[1]; lbl.textContent = fmt(a)+' ~ '+fmt(b); }
    });
    drs.noUiSlider.on('change', (vals)=>{
      const R = { min: Math.round(+vals[0]), max: Math.round(+vals[1]) };
      if(side==='word'){ state.wordRange=R; state.chapterRange=null; }
      else { state.chapterRange=R; state.wordRange=null; }
      const hint = $('#sizeHint'); if(hint) hint.textContent = sizeHintText();
      persist(); render();
    });
  });
}
function pickSize(side){
  if(side==='word'){
    if(!(state.wordRange && +state.wordRange.min>0)) state.wordRange = { min:3000, max:5000 };
    state.chapterRange = null;
  }else{
    if(!(state.chapterRange && +state.chapterRange.min>0)) state.chapterRange = { min:80, max:100 };
    state.wordRange = null;
  }
  const hint = $('#sizeHint'); if(hint) hint.textContent = sizeHintText();
  persist(); render();
}

function chapterMaxTokens(){
  return clampMaxTokens('chapter');
}
function clampMaxTokens(task){
  const limits = {
    chapter: 7000,      // 正文最大单次输出（目标 3000—3600 字，留约 2 倍缓冲；上限过高会放任模型把单章拖成 1.6w）
    principal: 16384,   // 校长统筹总控
    teacher: 16384,     // 老师分批教案
    dictmaster: 16384,  // 万物词典生成
    dictEnrich: 8192,   // 词典充实与收编
    glossary: 9216,
    json: 4096,         // JSON 类契约输出
    recipe: 8192,
    polish: 8192,
    plannerAux: 8192,
    continue: 8192,     // 续写补充段
    summary: 2048,      // 梗概/摘要
    strip: 5000         // 速读梗概
  };
  return limits[task] || 4096;
}
function dynamicChapterParams(idx){
  const o = state.outline;
  const base = resolveActiveSpec().chapterTemp;
  const total = (o && o.chapters && o.chapters.length) || 1;
  const ratio = (idx + 1) / total;
  let phase = 'act1';
  const stages = chapterPlanStages(o);
  if(stages.length >= 3){
    if(ratio <= 0.33) phase = 'act1';
    else if(ratio <= 0.66) phase = 'act2';
    else phase = 'act3';
  } else if(ratio > 0.75) phase = 'act3';
  else if(ratio > 0.35) phase = 'act2';
  const map = {
    act1: { temperature: 0.70, topP: 0.95 },   // 立人设：低温稳
    act2: { temperature: 0.85, topP: 0.95 },   // 中段铺陈：稍高激发变化
    act3: { temperature: 0.80, topP: 0.90 }    // 高潮+收束：收紧采样
  };
  const p = map[phase] || map.act2;
  const t = base + (p.temperature - 0.75);
  return {
    temperature: Math.max(0.1, Math.min(1.2, t)),
    topP: p.topP,
    phase
  };
}
function chapterPlanStages(o){
  const outline = o || state.outline || {};
  const chs = Array.isArray(outline.chapters) ? outline.chapters : [];
  const plan = bookStagePlan(chs.length);
  if(!plan.length) return [];
  const stages = []; let cur = 0;
  plan.forEach((p)=>{
    const n = p.n;
    const slice = chs.slice(cur, cur + n);
    const first = cur + 1;
    cur += n;
    stages.push({ first, last: cur, name: p.name, titles: slice.map(c => (c && c.title) ? String(c.title) : '') });
  });
  return stages;
}
function chapterActBlock(i){
  const stages = chapterPlanStages(state.outline);
  if(!stages.length) return '';
  const st = stages.find(s => (i+1) >= s.first && (i+1) <= s.last) || null;
  if(!st) return '';
  return `【本章结构定位】本章（第 ${i+1} 章）落在全书「${currentBookBeatCfg().label}」的「${st.name}」阶段（第 ${st.first}—${st.last} 章）。本章节拍事件须落在此阶段内、服务该阶段走向；属于本阶段的节拍事件必须兑现，不属于本阶段的事件不得越过阶段提前兑现。`;
}
function bookStagePlan(chapterCount){
  const full = beatStageNames();
  const C = Math.floor(chapterCount) || 0;
  const M = full.length;
  if(!C || !M) return [];
  if(C >= M){
    const base = Math.floor(C / M), rem = C % M;
    return full.map((name, si) => ({ name, n: base + (si < rem ? 1 : 0) }));
  }
  const groups = [];
  for(let g = 0; g < C; g++){
    const s = Math.floor(g * M / C);
    const e = Math.floor((g + 1) * M / C) - 1;
    groups.push({ name: mergedBeatName(full, s, e), n: 1 });
  }
  return groups;
}
function mergedBeatName(full, s, e){
  const a = full[s] || full[0];
  if(e <= s) return a;
  return `${a}→${full[e] || a}`;
}
const SCHOOL_GROUP_MIN = 6;    // 判定"过短"的组章数下限
const SCHOOL_GROUP_MAX = 20;   // 每师上限
function schoolStageGroups(){
  const o = state.outline || {};
  let N = (Array.isArray(o.chapters) ? o.chapters.length : 0);
  if(!N){ const c = Math.floor(Number(chapterCountVal())||0); if(c>=1&&c<=200) N = c; }
  if(!N) return [];
  let groups = [];
  let plan = null; try{ plan = bookStagePlan(N); }catch(e){ plan = null; }
  if(plan && plan.length){
    let cur = 1;
    const CN = '一二三四五六七八九十';
    for(const st of plan){
      const n = Math.max(0, Math.floor(st.n)||0); if(!n) continue;
      const k = (n<=SCHOOL_GROUP_MAX) ? 1 : Math.ceil(n/SCHOOL_GROUP_MAX);
      const base = Math.floor(n/k), rem = n%k;
      for(let i=0;i<k;i++){
        const c = base + (i<rem?1:0); if(c<=0) continue;
        const nm = k>1 ? `${st.name||''}·${CN[i]||(i+1)}` : (st.name||'');
        groups.push({ stage: nm, first: cur, last: cur+c-1 });
        cur += c;
      }
    }
  } else {
    const k0 = Math.max(1, Math.ceil(N/SCHOOL_GROUP_MAX));
    let k = k0; while(k < N && Math.ceil(N/k) > SCHOOL_GROUP_MAX) k++;
    const base = Math.floor(N/k), rem = N%k;
    let cur = 1;
    for(let i=0;i<k;i++){
      const c = base + (i<rem?1:0); if(c<=0) continue;
      groups.push({ stage:`第${i+1}组`, first:cur, last:cur+c-1 });
      cur += c;
    }
    return groups;
  }
  const len = g => g.last - g.first + 1;
  const join = (a,b)=> a===b ? a : `${a}→${b}`;
  let guard = 0;
  while(guard++ < groups.length * 6){
    let idx = -1;
    for(let i=0;i<groups.length;i++){ if(len(groups[i]) < SCHOOL_GROUP_MIN){ idx = i; break; } }
    if(idx < 0) break;
    const L = len(groups[idx]);
    const lOk = idx>0   && L + len(groups[idx-1]) <= SCHOOL_GROUP_MAX;
    const rOk = idx<groups.length-1 && L + len(groups[idx+1]) <= SCHOOL_GROUP_MAX;
    if(lOk && rOk){
      const lsz = len(groups[idx-1]), rsz = len(groups[idx+1]);
      if(rsz < lsz){ groups[idx] = { stage:join(groups[idx].stage, groups[idx+1].stage), first:groups[idx].first, last:groups[idx+1].last }; groups.splice(idx+1,1); }
      else { groups[idx-1] = { stage:join(groups[idx-1].stage, groups[idx].stage), first:groups[idx-1].first, last:groups[idx].last }; groups.splice(idx,1); }
    } else if(lOk){ groups[idx-1] = { stage:join(groups[idx-1].stage, groups[idx].stage), first:groups[idx-1].first, last:groups[idx].last }; groups.splice(idx,1); }
    else if(rOk){ groups[idx] = { stage:join(groups[idx].stage, groups[idx+1].stage), first:groups[idx].first, last:groups[idx+1].last }; groups.splice(idx+1,1); }
    else { break; }
  }
  return groups;
}
function schoolGroupsLabel(){
  const g = schoolStageGroups();
  if(!g.length) return '';
  return `${g.length} 位老师 · ` + g.map(x => `老师${g.indexOf(x)+1}（${x.first}-${x.last}章${x.stage?('·'+x.stage):''}）`).join(' · ');
}
function chapterOfPlan(ci){
  if(!state.school) return -1;
  const groups = schoolStageGroups();
  const teachers = state.school.teachers || [];
  for(let gi=0; gi<groups.length; gi++){ const g = groups[gi]; if(teachers[gi] && ci+1>=g.first && ci+1<=g.last) return gi; }
  return -1;
}
function teacherChapterPlan(ci){
  const gi = chapterOfPlan(ci); if(gi < 0) return '';
  const t = state.school.teachers && state.school.teachers[gi]; if(!t || !t.raw) return '';

  const lines = String(t.raw).replace(/\r\n?/g, '\n').split('\n');
  const target = ci + 1;
  const starts = [];
  const headRe = /^\s*(?:#{1,6}\s*)?第\s*(\d+)\s*章(?:\s+.*|\s*(?:《[^》]*》|\([^)]*\)|（[^）]*）|[:：、.．\-–—].*))?\s*$/;

  for(let i=0; i<lines.length; i++){
    const m = lines[i].match(headRe);
    if(m) starts.push({ line:i, ch:parseInt(m[1],10) });
  }

  const pos = starts.findIndex(x => x.ch === target);
  if(pos < 0) return '';
  const begin = starts[pos].line;
  const end = pos + 1 < starts.length ? starts[pos + 1].line : lines.length;
  const block = lines.slice(begin, end).join('\n').trim();
  return block;
}

const SCHOOL_RETRY_MAX = 16;
function scHealState(){
  const sc = state.school;
  if(!sc || typeof sc !== 'object') return;
  sc.finished = sc.finished || {};
  if(sc.principal && sc.principal.raw && String(sc.principal.raw).trim()){
    sc.finished.principal = true;
    if(isSchoolFolded() || sc.principal.folded){
      sc.finished.t0 = true;
      sc.finished.teacher = true;
    }
  }
  if(Array.isArray(sc.teachers)){
    sc.teachers.forEach((t, i)=>{
      if(t && t.raw && String(t.raw).trim()){
        sc.finished['t'+i] = true;
      }
    });
  }
  const groups = schoolStageGroups();
  if(groups.length > 0 && groups.every((g, i) => sc.finished['t'+i])){
    sc.finished.teacher = true;
  }
}
function scState(){
  if(!state.school || typeof state.school !== 'object') state.school = {};
  state.school.finished = state.school.finished || {};
  state.school.failed   = state.school.failed   || {};
  state.school.retries  = state.school.retries  || {};
  state.school.teachers = Array.isArray(state.school.teachers) ? state.school.teachers : [];
  scHealState();
  return state.school;
}
function scRetry(key){ return scState().retries[key] || 0; }
function setScRetry(key, n){ scState().retries[key] = Math.max(0, Math.min(SCHOOL_RETRY_MAX, n||0)); persist(); }
function scDone(key){ const sc = scState(); return !!(sc && sc.finished && sc.finished[key]); }
function scFailed(key){ const sc = scState(); return !scDone(key) && !!(sc && sc.failed && sc.failed[key]); }
function scSetFailed(key, val){
  const sc = scState();
  sc.failed = sc.failed || {};
  sc.failed[key] = !!val;
  if(val && sc.finished) delete sc.finished[key];
  persist();
}
function scMark(key, done){
  const sc = scState();
  sc.finished[key] = !!done;
  if(done){
    setScRetry(key, 0);
    if(sc.failed) delete sc.failed[key];
  }
  persist();
}
function getSchoolStepStatus(key){
  const sc = scState();
  const run = state._schoolRunning;
  const groups = schoolStageGroups();
  const folded = isSchoolFolded();

  let isDone = false;
  if(key === 'dictMaster') isDone = scDone('dictMaster');
  else if(key === 'dictEnrich') isDone = scDone('dictEnrich');
  else if(key === 'principal') isDone = scDone('principal');
  else if(key === 'teacher'){
    if(scDone('teacher')) isDone = true;
    else if(folded){
      isDone = !!(sc.teachers && sc.teachers[0] && sc.teachers[0].raw && String(sc.teachers[0].raw).trim());
    } else {
      isDone = groups.length > 0 && groups.every((g,i)=>scDone('t'+i));
    }
  }

  let isRunning = false;
  if(run){
    if(run.activeKey === key) isRunning = true;
    else if(key === 'teacher' && (run.activeKey === 'teacher' || (typeof run.activeKey === 'string' && run.activeKey.startsWith('t')))){
      isRunning = true;
    }
  }

  let isFailed = !isDone && !isRunning && scFailed(key);

  let status = 'default'; // 蓝色
  if(isRunning) status = 'running'; // 绿色
  else if(isDone) status = 'done'; // 金黄色
  else if(isFailed) status = 'failed'; // 红色

  return { isDone, isRunning, isFailed, status };
}
function scBadge(key){
  const n = scRetry(key);
  return n > 0 ? `<b class="sc-retry-badge" title="本步已自动重试 ${n}/${SCHOOL_RETRY_MAX} 次（失败重试，成功清零）">↻${n}</b>` : '';
}
function scRefreshBadge(el, key){
  if(el && el.querySelectorAll){ el.querySelectorAll('.sc-retry-badge').forEach(x => x.remove()); }
  const n = scRetry(key);
  if(el){
    if(n > 0){ el.insertAdjacentHTML('beforeend', `<b class="sc-retry-badge" title="本步已自动重试 ${n}/${SCHOOL_RETRY_MAX} 次">↻${n}</b>`); el.classList.add('sc-failed'); }
    else if(!scFailed(key)) el.classList.remove('sc-failed');
  }
}
function schoolStepBtn(key, icon, label, title){
  const st = getSchoolStepStatus(key);
  let cls = 'sc-step';
  if(st.isRunning) cls += ' running';
  else if(st.isDone) cls += ' done';
  else if(st.isFailed) cls += ' failed sc-failed';
  else cls += ' sc-step-default';
  return `<button type="button" class="${cls}" data-scp-step="${key}" title="${esc(title||'')}">${icon}<span class="sc-lab">${esc(label)}</span><i class="sc-tick">${st.isDone?'✓':(st.isRunning?'⏳':(st.isFailed?'✕':''))}</i>${scBadge(key)}</button>`;
}
function schoolTeacherBtn(g, i){
  const folded = isSchoolFolded();
  const key = 't'+i, done = scDone(key);
  const nCh = g.last - g.first + 1;
  const sc = g.stage || `第${i+1}组`;
  const range = `${g.first}-${g.last} 章`;
  if(folded){
    return `<div class="sc-teacher-card ${done?'done':'todo'} sc-teacher-folded">
      <div class="sc-tc-h">
        <span class="sc-tc-no">🎓 老师</span>
        <span class="sc-tc-stage">${esc(sc)} <small class="muted">(1-20章·单老师负责制)</small></span>
        <span class="sc-tc-ch">${esc(range)} (${nCh}章)</span>
        <span class="sc-tc-st ${done?'done':'todo'}">${done?'✓ 逐章教案已备':'⏳ 待备课'}</span>
      </div>
      <div class="sc-tc-b">
        <button type="button" class="sc-step sc-teacher ${done?'done':''}" data-scp-step="principal" title="全书≤20章：单老师负责制，直接出齐守则、标题与逐章教案">${done?'重新备课':'🎓 老师备课'}${scBadge('principal')}</button>
        <button type="button" class="sc-plan-btn" data-scp-plan="0" title="${done?'查看逐章教案（六栏目预览 / 原始稿切换）':'尚未生成，请先点击备课'}">📖 读教案</button>
      </div>
    </div>`;
  }
  return `<div class="sc-teacher-card ${done?'done':'todo'}">
    <div class="sc-tc-h">
      <span class="sc-tc-no">🎓 老师${i+1}</span>
      <span class="sc-tc-stage">${esc(sc)}</span>
      <span class="sc-tc-ch">${esc(range)} (${nCh}章)</span>
      <span class="sc-tc-st ${done?'done':'todo'}">${done?'✓ 已备':'⏳ 未备'}</span>
    </div>
    <div class="sc-tc-b">
      <button type="button" class="sc-step sc-teacher ${done?'done':''}" data-scp-step="teacher" data-scp-teacher="${i}" title="老师${i+1}：负责第 ${g.first}-${g.last} 章（${esc(g.stage||'')}），一次备完全组逐章教案">🎓 老师${i+1}备课${scBadge(key)}</button>
      <button type="button" class="sc-plan-btn" data-scp-plan="${i}" title="${done?('查看老师'+ (i+1) +'本组教案（预览 / 原始稿切换）'):'该组教案尚未生成，先生成后才能阅读'}">📖 读教案</button>
    </div>
  </div>`;
}
function scStyleBrief(){
  const parts = [];
  const tags = (state.chapterStyle && Array.isArray(state.chapterStyle.tags)) ? state.chapterStyle.tags : [];
  if(tags.length) parts.push('写作风格词条：' + tags.join('、'));
  try{ const c = selectedPolishCandidate && selectedPolishCandidate(); if(c && c.name) parts.push('②优化构想所选方案：' + String(c.name)); }catch(e){}
  return parts.length ? parts.join('\n') : '（尚未选配方；由校长依简介与词典自行凝练守则）';
}
function scGlossaryBrief(maxChar){
  const g = (state.outline && state.outline.glossary) || {};
  const lines = [];
  const cap=[]; (g.characters||[]).forEach(x=>{ const nm = `${String((x&&x.name)||'').trim()}${x&&String(x.identity||'').trim()?('·'+String(x.identity).trim()):''}`; if(nm) cap.push(nm); });
  if(cap.length) lines.push('人物：' + cap.slice(0,80).join('、'));
  const pl=[]; (g.places||[]).forEach(x=>{ if(x&&String(x.name||'').trim()) pl.push(`${String(x.name).trim()}${String(x.type||'').trim()?('·'+String(x.type).trim()):''}`); });
  if(pl.length) lines.push('地名：' + pl.slice(0,40).join('、'));
  const pn=[]; (g.propernouns||[]).forEach(x=>{ if(x&&String(x.name||'').trim()) pn.push(String(x.name).trim()); });
  if(pn.length) lines.push('专名/设定：' + pn.slice(0,40).join('、'));
  const wr=[]; (g._worldRules||[]).forEach(x=>{ const r=String((x&&x.rule)||'').trim(); if(r) wr.push(r); });
  if(wr.length) lines.push('世界观规则：\n' + wr.slice(0,30).map(r=>'- '+r).join('\n'));
  const rel=[]; (g._relationshipTable||[]).forEach(x=>{ if(x && x.a && x.b) rel.push(`${x.a}(${x.relation||'关系'})${x.b}`); });
  if(rel.length) lines.push('人物关系：' + rel.slice(0,40).join('、'));
  let s = lines.join('\n');
  const m = maxChar || 7000;
  if(s.length > m) s = s.slice(0, m) + '…（已截断）';
  return s || '（暂无词典，正文将在老师教案中按需自洽）';
}
function scGroupBeats(g, maxChar){
  const plans = (state.outline && Array.isArray(state.outline.chapterPlans)) ? state.outline.chapterPlans : [];
  const out = [];
  for(let i=g.first-1;i<g.last;i++){
    const ch = i+1;
    const title = (state.outline && state.outline.chapters && state.outline.chapters[i] && String(state.outline.chapters[i].title||'').trim()) || '';
    const bt = plans[i] && String(plans[i].beatsText||'').trim();
    out.push(`第${ch}章${title?('《'+title+'》'):''}${bt?('\n'+bt):''}`);
  }
  let s = out.join('\n\n');
  const m = maxChar || 6000;
  if(s.length > m) s = s.slice(0, m) + '…（已截断）';
  return s || '（本章节拍为空，老师依全校守则与本组框架自拟）';
}
function scAllGroupsBeats(groups, maxChar){
  const parts = groups.map((g,i)=>`— 组${i+1}·老师${i+1}（第${g.first}-${g.last}章${g.stage?('·'+g.stage):''}） —\n${scGroupBeats(g, 5000)}`);
  let s = parts.join('\n\n');
  const m = maxChar || 12000;
  if(s.length > m) s = s.slice(0, m) + '…（已截断）';
  return s;
}
function isSchoolFolded(){
  const g = schoolStageGroups();
  return g.length === 1;
}
function extractSection(txt, from, until){
  const s = String(txt||'');
  const i = s.indexOf(from); if(i < 0) return '';
  const j = until ? s.indexOf(until, i + from.length) : -1;
  const seg = j > i ? s.slice(i, j) : s.slice(i);
  return seg.trim();
}
function parsePrincipalTitles(raw){
  if(!raw) return [];
  const sec = extractSection(raw, '全书章节标题总表', '') || raw;
  const list = [];
  const lines = String(sec).split('\n');
  for(const line of lines){
    const clean = line.replace(/^[#*\-\s]+/, '').trim();
    const m = clean.match(/^(?:第\s*(\d+)\s*章|(\d+)[\.、\s])\s*[:：、\s]*(?:《([^》]+)》|([^\n\r#*]+))/);
    if(m){
      const num = parseInt(m[1] || m[2], 10);
      const title = String(m[3] || m[4] || '').trim().replace(/^《|》$/g, '');
      if(num > 0 && title && !list.find(x => x.num === num)){
        list.push({ num, title });
      }
    }
  }
  list.sort((a,b) => a.num - b.num);
  return list;
}
function isPrincipalTitlesApplied(){
  const titles = (state.school && state.school.principal && state.school.principal.titles) || [];
  if(!titles.length || !state.outline || !Array.isArray(state.outline.chapters)) return false;
  const oCh = state.outline.chapters;
  return titles.every(t => {
    const ch = oCh[t.num - 1];
    return ch && String(ch.title || '').trim() === t.title;
  });
}
function applyPrincipalTitles(){
  const titles = (state.school && state.school.principal && state.school.principal.titles) || [];
  if(!titles.length){ toast('未检测到校长拟定的标题'); return false; }
  if(!state.outline) state.outline = { chapters: [] };
  if(!Array.isArray(state.outline.chapters)) state.outline.chapters = [];

  const diffs = [];
  titles.forEach(t => {
    const idx = t.num - 1;
    const cur = state.outline.chapters[idx];
    const curTitle = cur && String(cur.title || '').trim();
    if(curTitle && curTitle !== t.title){
      diffs.push({ num: t.num, oldTitle: curTitle, newTitle: t.title });
    }
  });

  if(diffs.length > 0){
    showTitleDiffModal(titles, diffs);
    return true;
  }
  return doApplyTitles(titles);
}

function doApplyTitles(titles, opts){
  opts = opts || {};
  if(!state.outline) state.outline = { chapters: [] };
  if(!Array.isArray(state.outline.chapters)) state.outline.chapters = [];
  const maxNum = Math.max(...titles.map(t=>t.num), state.outline.chapters.length);
  while(state.outline.chapters.length < maxNum){
    state.outline.chapters.push({ title: '' });
  }
  if(!Array.isArray(state.chapters)) state.chapters = [];
  while(state.chapters.length < maxNum){
    state.chapters.push({ title: '', content: '' });
  }
  snapshotTitleBatch('选用校长拟定标题');
  titles.forEach(t => {
    const idx = t.num - 1;
    if(idx >= 0 && idx < state.outline.chapters.length){
      state.outline.chapters[idx].title = t.title;
    }
    if(idx >= 0 && idx < state.chapters.length){
      state.chapters[idx].title = t.title;
    }
  });
  persist();
  render();
  if(!opts.silent) toast(`已成功将校长拟定的 ${titles.length} 章标题应用到全书大纲与章节！`);
  return true;
}

function showTitleDiffModal(titles, diffs){
  const ov = document.createElement('div');
  ov.className = 'gs-overlay';
  ov.innerHTML = `<div class="gs-modal sc-diff-modal" style="max-width:540px;">
    <div class="gs-modal-head">
      <b>✨ 选用校长拟定标题</b>
      <span class="sc-plan-meta muted">检测到 ${diffs.length} 处既有标题变更</span>
      <button class="gs-x" data-diff-close>✕</button>
    </div>
    <div class="sc-diff-body" style="padding:14px 16px;max-height:60vh;overflow-y:auto">
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;line-height:1.5">
        校长拟定共 <b>${titles.length}</b> 章标题。其中 <b>${diffs.length}</b> 处与当前已存在标题不同。请确认是否统一替换为校长拟定标题：
      </div>
      <div class="sc-diff-list" style="display:flex;flex-direction:column;gap:6px">
        ${diffs.map(d => `
          <div class="sc-diff-item" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel2);font-size:12px">
            <span style="font-weight:750;color:var(--accent);min-width:48px">第${d.num}章</span>
            <span style="color:var(--muted);text-decoration:line-through;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.oldTitle)}</span>
            <span style="color:var(--accent)">➔</span>
            <span style="color:var(--txt);font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.newTitle)}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="sc-diff-foot" style="display:flex;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid var(--line)">
      <button type="button" class="btn ghost" data-diff-cancel>取消</button>
      <button type="button" class="btn primary" data-diff-confirm>确认替换 (${titles.length}章)</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  const close = ()=> ov.remove();
  ov.querySelector('[data-diff-close]').onclick = close;
  ov.querySelector('[data-diff-cancel]').onclick = close;
  ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
  ov.querySelector('[data-diff-confirm]').onclick = ()=>{
    close();
    doApplyTitles(titles);
  };
}
function scGroupTitles(g){
  const out = [];
  const pTitles = (state.school && state.school.principal && Array.isArray(state.school.principal.titles)) ? state.school.principal.titles : [];
  for(let i=g.first-1;i<g.last;i++){
    const pt = pTitles.find(x=>x.num === i+1);
    const ot = (state.outline && state.outline.chapters && state.outline.chapters[i] && String(state.outline.chapters[i].title||'').trim()) || '';
    const title = (pt && pt.title) ? pt.title : ot;
    out.push(`第${i+1}章 ${title?('《'+title+'》'):'（待命）'}`);
  }
  return out;
}

const PRINCIPAL_SYS = `你是一位统筹一部长篇小说的「校长」（治学总舵手）。你接收到关于本部小说的全部完整资源（大纲、全量词典、写作配方、以及全书微拍总纲），一次性产出全校统筹与管理指令，供下属各「老师」逐一备课，再由正文作家严格照章执行。

【输入格式】(user 消息按【键】分节装载，逐节使用、缺失标「无」)
【长篇小说】书名；【全书简介】；【优化构想·所选方案】；【全校章节数】；【全书微拍总纲与节奏体系】；【写作风格/配方】；【全量万物词典·共享不切片】；【既有《全书节拍》·阶段优先分组】及《全书节拍》节选。

【任务·逐项产出全校管理成果】
① 全校写作守则——必须完成「风格冲突解决」，不是简单摘要：
   · 配方锚点：逐条浓缩「写作风格/配方」原文要点，保留原句风格特征（防层层凝练失真）。
   · 风格融合总纲：先以用户已选【写作风格/配方】为表达层唯一权威，再评估【优化构想】是否兼容；兼容则吸收为辅助表现手段，冲突则舍弃优化构想的冲突部分，绝不得反向修改用户风格。明确「主风格 / 剧情机制 / 情绪落点」三层关系，并写清何时谁主导。
   · 风格施工规则：必须把融合后的风格落实到「叙事、对白、节奏、场景、情绪、幽默/悬疑/治愈等具体机制」，给出可执行动作，而非只写形容词。
   · 风格验收标准：列出正文完成后可检查的正向指标与禁用项，供老师与正文 AI 逐章自检。
   · 可执行纪律：全体老师与正文一致遵循的写作纪律，统帅【全书微拍节奏】与【章间过桥律】（跨章尾留钩子首接余波，前章定格状态必须平滑过桥，严禁硬跳切与瞬移；跨组接力严守因果链，后组首章必须紧密承接前组末章真实收束状态；人物言行一致、时间不倒流、术语定稿不改）。
   · 因果闭环总纲：对全书重大事件做“发生资格审查”。任何发现、获得、遇见、得知、抵达、突破、转折、救援、反转等关键结果，都必须能追溯到此前已经成立的前置状态、人物目标/动机、信息或线索来源、行动路径、能力/资源条件与可观察触发；若条件不足，不得让老师或正文直接把结果写出来，应在更早章节补铺垫、调整事件达成方式或降低事件确定性。尤其禁止“走着走着发现关键地点”“突然知道秘密”“恰好带着关键道具”“陌生关键人物无来源出现”等凭空推进。偶然事件可以发生，但必须符合世界规则与场景概率，并给出最低限度的可解释触发。
   · 因果审计输出：请在全书规划中识别高风险重大事件，明确其前置条件/来源/触发路径/结果，并指出尚缺的铺垫；不得为了完成节拍而牺牲因果成立。
   · 权限边界：用户风格决定「怎么写」；老师教案决定「本章写什么」；词典决定事实一致性；正文 AI 不负责重新裁决风格组合。
② 各组组级框架——每组一份、逐组齐全。每份固定字段：
   · 起止章与剧情段；每章功能分工（仅到「引入/推进/转折/高潮/收束」标签 + 一句目标）；整组节奏与情绪曲线；跨组承接（承上=承接上一组末章收束后本组从何接续、首组按【开篇引擎】执行；启下=末章给下一组留的钩）；重点调用词典要素。
③ 第一章开篇任务卡：必须把【开篇引擎】从抽象策略转换成可执行的首章施工卡，至少明确：策略、首拍动作/场景、前800字必须建立的读者认知、禁止事项、继续阅读问题。该卡必须真正约束第1章教案，不得只写“按开篇引擎执行”。
④ 全书章节标题总表——为全部章节各拟一题，一批拉通给出、前后呼应。

【输出契约·严格遵守】
- 只输出纯文本 Markdown；禁止 JSON、禁止用三个反引号围栏包裹输出、禁止引语/开场白/结束语/解释。
- 严格按下述小节与标记组织，段名与章节号逐项齐全、不得省略：
# 全校写作守则
## 配方锚点
## 风格融合总纲
## 风格施工规则
## 风格验收标准
## 因果闭环总纲
## 可执行纪律
# 第一章开篇任务卡
策略：……
首拍动作/场景：……
前800字必须建立：……
禁止事项：……
继续阅读问题：……
# 各组组级框架
## 组1 · 老师1（第1-20章 · 段名）
- 功能分工：第1章=引入/…；第2章=…
- 节奏与情绪曲线：…
- 跨组承接：承上=…（首组按【开篇引擎】执行）；启下=…
- 重点调用词典要素：…
## 组2 · 老师2（第21-35章 · 段名）
…（逐组齐全，直到组K）
# 全书章节标题总表
第1章 《标题》
第2章 《标题》
…（连排到全书最后一章）`;

const PRINCIPAL_FOLDED_SYS = `你是一位身兼「校长」与「任课教师」的长篇小说统筹大师。在当前全书篇幅（≤20章）下，三层架构折叠为单层：由你统领全量材料（大纲、全量词典、配方、微拍体系）直接一次性施教，免去层层传达损耗。

【输入格式】(user 消息按【键】分节装载，逐节使用、缺失标「无」)
【长篇小说】书名；【全书简介】；【优化构想·所选方案】；【全校章节数】；【全书微拍总纲与节奏体系】；【写作风格/配方】；【全量万物词典】(全量共享不切片)；【既有《全书节拍》】。

【任务·一次性出齐三大成果】
① 全校写作守则：
   · 配方锚点：逐条浓缩写作配方要点，保留原汁原味。
   · 风格融合总纲：用户已选写作风格是表达层唯一权威；优化构想只能作为候选辅助，不得覆盖用户风格。必须解决多风格之间的主次、兼容方式与冲突裁决。
   · 风格施工规则：把融合后的风格转译为叙事、对白、节奏、场景、情绪的可执行规则，避免把选择题留给正文 AI。
   · 风格验收标准：给出逐章可检查的正向指标与禁用项。
   · 可执行纪律：微拍节奏指令与章间过桥律（尾留钩子首接余波，平滑对缝，严禁瞬移硬跳；时间不倒流，术语定稿不改）。
   · 因果闭环总纲：逐章审查重大事件的发生资格；任何关键结果都必须有前置状态、人物目标/动机、信息或线索来源、行动路径、能力/资源条件与触发依据。条件不足时必须补铺垫或调整达成方式，严禁为了完成节拍让事件凭空出现。偶然事件可以保留，但必须符合世界规则并具备最低限度的可解释触发。
   · 权限边界：用户风格决定「怎么写」；逐章教案决定「写什么」；正文 AI 只执行，不重新选风格。
② 第一章开篇任务卡：把【开篇引擎】转成第1章可直接施工的首拍任务，明确首拍动作/场景、前800字必须建立的认知、禁止事项与继续阅读问题，并让第1章教案第①环节严格执行。
③ 全书章节标题总表：
   为全书第1章至最后一章各拟定一题，连贯排布、前后呼应。
③ 逐章教案（第1章 ~ 最后一章）：
   直接为每一章备出标准化教案，一章不少！每章严格遵循六栏（冒号紧跟）：
   - 本章风格施工指令：把已裁决的【风格融合总纲】【风格施工规则】翻译为本章具体执行命令；明确场景/人物/节拍中的风格主次与表达方式，不得重新裁决风格冲突。
   - 功能与位置：本章在全书结构中的定位与必须完成的核心事件。
   - 剧情时间落点：具体时间范围与起止时点（时/日/旬/月/季/年，非机械编号；跨章时间不回退，时长随剧情，不机械排满一天）。
   - 本章推进骨架：按所选【章节微拍】节奏，逐拍写清场景地点、在场人物、具体冲突与事件动作（建议5-8环节，密而留白，不套字数）。
   - 情绪走向与突出点：情绪弧度与章内高光张力点（示例锚点一两句话点到为止，禁代写成品段）。
   - 连续性：承上（接上一章末尾动作/定格）、启下（章末留钩子给下一章）。首章承上按【开篇引擎】执行。
   - 本章出场名单：本章必须出场人物（仅限词典与剧情核心角色）。

【输出契约·严格遵守】
- 严格输出纯文本 Markdown，禁止 JSON、禁止三个反引号代码块包裹、禁止引语和客套。
- 格式严格如下（段名顶格）：
# 全校写作守则
## 配方锚点
## 风格融合总纲
## 风格施工规则
## 风格验收标准
## 因果闭环总纲
## 可执行纪律
# 第一章开篇任务卡
策略：……
首拍动作/场景：……
前800字必须建立：……
禁止事项：……
继续阅读问题：……
# 全书章节标题总表
第1章 《标题》
第2章 《标题》
…（连排到最后一章）
# 逐章教案
第1章 《标题》
- 本章风格施工指令：……
- 功能与位置：……
- 剧情时间落点：……
- 本章推进骨架：……
- 情绪走向与突出点：……
- 连续性：承上=……；启下=……
- 本章出场名单：……
第2章 《标题》
……（逐章齐全，连排到最后一章）`;

function buildPrincipalUser(groups){
  const o = state.outline || {};
  const lines = [];
  lines.push(`【长篇小说】${o.title||'（未定书名）'}`);
  if(o.logline) lines.push(`【全书简介】${o.logline}`);
  let cand = null; try{ cand = selectedPolishCandidate && selectedPolishCandidate(); }catch(e){}
  if(cand && cand.name) lines.push(`【优化构想·所选方案】${String(cand.name).trim()}${cand.brief?('\n'+String(cand.brief).trim()):''}`);
  lines.push(`【全校章节数】${(o.chapters||[]).length || chapterCountVal() || '未知'} 章`);
  const _opening = openingStrategyBrief(); if(_opening) lines.push(_opening);
  const _openingTask = openingStrategyExecutionCard(0); if(_openingTask) lines.push(_openingTask);
  const bc = currentBeatCfg ? currentBeatCfg() : null;
  if(bc && bc.label){
    const beatDetail = (bc.types||[]).map((t, idx) => `  ${idx+1}. 【${t.label}】(type=${t.key})：${t.note || ''} ${t.aiDirective ? `[执行指令: ${t.aiDirective}]` : ''}`).join('\n');
    lines.push(`【全书微拍总纲与节奏体系（校长全量统领并下达管理指令）】
微拍型号：${bc.label} (${bc.emoji || ''})
节拍说明：${bc.desc || ''}
逐拍节奏结构定义：
${beatDetail}
校长统帅与管理要求：
1. 校长作为全校最高统领，全量掌握此微拍节奏总纲，并将其升华为「全校写作守则 · 可执行纪律」；
2. 在全校守则中明确要求下属任课老师在备课时，将本微拍节奏分解落实至各章的「本章推进骨架」与「情绪走向与突出点」；
3. 确保全校宏观规划与单章微观节奏形成统一闭环。`);
  }
  lines.push('【写作风格/配方】\n' + scStyleBrief());
  lines.push('【全量万物词典·共享不切片】\n' + scGlossaryBrief(7000));
  if(isSchoolFolded()){
    lines.push('【篇幅说明】当前全书篇幅 ≤20 章，三层架构折叠为单层：由校长兼任课教师一人直接持全部材料备齐全书每一章教案。');
    lines.push('\n【对应的《全书节拍》】\n' + scAllGroupsBeats(groups, 10000));
    lines.push('\n请按输出契约一次性出齐【全校写作守则】【全书章节标题总表】【逐章教案】三大成果（全书每一章教案均齐全），只给纯文本 Markdown。');
  } else {
    lines.push('【既有《全书节拍》· 阶段优先分组】');
    groups.forEach((g,i)=>{ lines.push(`组${i+1}·老师${i+1}（第${g.first}-${g.last}章${g.stage?('·'+g.stage):''}）`); });
    lines.push('\n【各组对应的《全书节拍》节选】\n' + scAllGroupsBeats(groups, 10000));
    lines.push('\n请按输出契约产出【全校写作守则】【各组组级框架】【全书章节标题总表】三段（逐组齐全），只给纯文本 Markdown。');
  }
  return lines.join('\n\n');
}
async function genPrincipal(btn, opts){
  if(!isLong()){ toast('仅长篇小说模式支持校长统筹'); return false; }
  const groups = schoolStageGroups(); if(!groups.length){ toast('请先填写章节数，才能分组'); return false; }
  scState();
  const folded = isSchoolFolded();
  const sys = folded ? PRINCIPAL_FOLDED_SYS : PRINCIPAL_SYS;
  markAIRunning('principal'); if(btn) busy(btn, true, folded ? '校长兼任课教师备课中…' : '校长统筹中…'); if(btn && btn.parentNode) showStopBtn(btn.parentNode);
  try{
    const spec = resolveActiveSpec('principal');
    const temp = (spec && spec.principalTemp != null) ? spec.principalTemp : 0.4;
    for(let attempt=1; attempt<=SCHOOL_RETRY_MAX; attempt++){
      try{
        const txt = await callAIGuarded('principal', sys, buildPrincipalUser(groups), {}, { temperature:temp, maxTokens:16384, signal:_abortCtl?.signal });
        if(!txt || !String(txt||'').trim()){ setScRetry('principal', attempt); scRefreshBadge(btn,'principal'); throw new Error('校长返回空'); }
        const sc = scState();
        const titles = parsePrincipalTitles(txt);
        if(titles && titles.length){
          doApplyTitles(titles, { silent: true });
        }
        if(folded){
          const lessonRaw = extractSection(txt, '# 逐章教案', '') || extractSection(txt, '逐章教案', '') || txt;
          sc.principal = { ts:Date.now(), folded:true, groups: [{ gi:0, stage: groups[0].stage, first: groups[0].first, last: groups[0].last }], raw:String(txt), titles };
          sc.teachers = [{ gi:0, ts:Date.now(), raw:String(lessonRaw) }];
          scMark('principal', true);
          scMark('t0', true);
          markAIDone('principal');
          markAIDone('t0');
          render();
          toast(`校长兼老师备课完成：守则 + ${titles.length||groups[0].last}章标题（已自动定稿）+ 逐章教案就绪！`);
        } else {
          sc.principal = { ts:Date.now(), folded:false, groups: groups.map((g,gi)=>({ gi, stage:g.stage, first:g.first, last:g.last })), raw:String(txt), titles };
          scMark('principal', true);
          markAIDone('principal');
          render();
          toast(`校长统筹完成：${groups.length} 位老师分组 + 全校守则 + 组级框架 + ${titles.length}章标题已自动定稿应用！`);
        }
        playDoneSound('single');
        return true;
      }catch(e){
        if(e && e.name === 'AbortError'){ setScRetry('principal', attempt); toast('已停止校长统筹'); return false; }
        setScRetry('principal', attempt); scRefreshBadge(btn,'principal');
        if(attempt < SCHOOL_RETRY_MAX) await new Promise(r=>setTimeout(r,1500));
      }
    }
    toast(`校长统筹失败（已自动重试 ${SCHOOL_RETRY_MAX} 次）`);
    return false;
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='principal');
    hideStopBtn(); if(btn) busy(btn,false); scRefreshBadge(btn,'principal');
  }
}

const TEACHER_SYS = `你是一位长篇小说「老师」（任课教师），负责对校长分给你的一整组章节，一次性备好组内每一章的「本章写作框架（教案）」，供下面的「学生（正文 AI）」照此写正文。

【教学观·必须贯穿始终】
你是老师，给的是"怎么教"的写作指令，不是"代写答案"。你立好本章的框架骨架——它告诉学生"这一章从哪里写到哪里、期间要走完哪些环节、每环节的落点是什么"，把框架缝隙铺得密一点、好带学生走完一整章；但你要给学生留出充分的创作空间，绝不要替学生把正文写出来，也不要给一整段成品范文让他照抄。示例只允许"点到为止"：一句话的情绪基调、一个代表性动作或氛围点，作示范方向即可，严禁成段示范散文、严禁把某段正文替你写掉。框架是用来"引学生写长、写完整"，不是"紧箍咒"——禁止强制字数配比或逐句规定把学生框死。
【单源真理·微拍深度融合】：教案与微拍深度合一！请直接将【章节微拍】的节奏走向与高低起伏融入「本章推进骨架」各环节中，不再作为割裂体系，使教案成为正文 AI 执笔时的唯一航海图。
【骨架首拍预留接引弹性】：你备课时并未看到上一章落地后的字面正文细节。因此，每章教案「本章推进骨架」的第 ① 环节必须兼备"承上启下"的弹性——它既能吸纳上一章正文末尾可能遗留的短暂动作/对话余波，又能给出通向本章新事件的平滑过渡方向，绝不要把第 ① 环节写成突兀割裂的硬跳切。

【首章开篇执行锁】如果本组包含第1章，必须把输入中的【第一章开篇任务卡】直接落实为第1章教案的第一环节；不得只写“按开篇引擎执行”。教案必须明确：首拍发生什么、读者先看到什么、前800字应建立什么、哪些内容不得提前倾倒。

【输入格式】(user 消息按【键】分节装载，逐节使用、缺失标「无」)
【全校写作守则】/【本组组级框架】/【本组章节标题】/【全量词典·共享不切片】/【本组《全书节拍》节选】/【教师交接棒契约】。

【任务】
① 对组内每一章产出一份教案，逐章齐全直到本组最后一章。每份教案固定字段（一个不少）：
- 本章风格施工指令：严格继承校长已经裁决好的【风格融合总纲】【风格施工规则】；按本章场景/人物/节拍逐项翻译成可执行的表达指令。只负责‘怎么写’，不得改写本章剧情教案，也不得重新裁决风格冲突。
- 功能与位置：本章在本组 / 全书中的角色
- 剧情时间落点：给出本章正文发生的时间范围（如"从 第X日·清晨 到 第X日·傍晚"，或口语化"第二日清晨到次日傍晚，即第三日傍晚"）。三条松守则——仅防"多章时间倒退/重叠/换算错位"，绝不限制创作自由：
  (1) 落点让读者与正文不再错位即可：尽量给"第X日·时段"的绝对日序；若你想用"次日/翌日/次晨"等相对词，顺手换算一句（如"次日=第三日"）即可，不必硬性禁用。
  (2) 跨章时间不回退：本章时间范围的起点不早于上一章教案「剧情时间落点」的终点（可同时刻紧接、不可往回倒）；保证整个故事的时间线整体向前即可。
  (3) 别为"覆盖完整"牺牲节奏：一章可以只写一小时的关键场景，可以写满一整天，也可以跨数天跳跃。时间跨度长短由剧情决定。
- 本章推进骨架（从哪写到哪）：把本章从开篇承接点到收尾的整条推进路线，拆成一连串更细的环节（建议 5-8 个推进环节，深度融合微拍节奏，覆盖 承接点→铺垫→第一次小冲突/变化→推进→转折/升温→高潮→余波→收束/钩子），按顺序逐个写出每个环节"这一环节要发生/要写到什么"（一两句话说明该环节的落点即可，点到即止）。环节之间要有先后与因果。
- 事件因果施工：对本章每一个重大事件，在骨架中同时交代“发生前提→触发/线索→人物为什么采取行动→行动如何导致结果”。尤其是发现、获得、遇见、得知、抵达、突破、救援、反转等结果，不得只写结果。若某结果依赖前章信息或资源，必须在【连续性】或骨架中明确承接来源；若当前材料无法支撑，应先补铺垫或改写达成路径，不得让正文 AI 自行凭空补一个关键理由。
  - 【随微拍调密·骨架环节数不等同微拍拍数】骨架始终拆满 5-8 个环节。双拍结构按"铺垫多环节 + 揭示少环节"排布。微三拍可压缩至 4-5 环节，微七拍可展开至 8 环节。
- 情绪走向与突出点：推向什么情绪、突出什么（示例锚点一句话即可，禁止代写成段正文）
- 连续性：上一章收尾到哪、本章从何承接。写明两项：①【承接物理态】（写明承接自第几章哪个具体人物处境、定格动作或未决悬念）；②【转场过桥建议】（若本章时间或场景有跨度，给出 1-2 句如何自然平滑过渡到本章骨架第①环节的笔法建议，防生硬跳切）。
- 本章出场名单：本章推进骨架中涉及的全部有名角色（骨架与名单 100% 严格对齐，骨架有戏必有名单点名，无戏绝不混入；名单外角色正文一律不可写、不可提）。
② 【教师交接棒机制】：在本组全部章节备课完毕后，必须在最末尾附加输出【本阶段向下一阶段移交的 3 大关键悬念与阶段高潮成果】，为下一位老师立好交接棒！

【输出契约·严格遵守】
- 只输出纯文本 Markdown；禁止 JSON、禁止用三个反引号围栏包裹输出、禁止额外说明/开场白/结束语。
- 严格按章编号逐章输出直到本组最后一章，最后附上交接板块：
第X章 《标题》
- 本章风格施工指令：…
- 功能与位置：…
- 剧情时间落点：…
- 本章推进骨架：①… → ②… → ③… → ④… → ⑤… → ⑥… → ⑦… → ⑧…
- 情绪走向与突出点：…
- 连续性：…
- 本章出场名单：…
……（逐章连排至本组最后一章）

# 本阶段向下一阶段移交的 3 大关键悬念与阶段高潮成果
1. 【主线核心悬念/危机】：……
2. 【核心角色定格状态与处境】：……
3. 【阶段高潮结算与关键道具/情报】：……`;

function buildTeacherUser(g, gi){
  const pr = (state.school && state.school.principal) || {};
  const o = state.outline || {};
  const lines = [];
  lines.push(`【全校写作守则】\n${(pr.raw && extractSection(pr.raw,'全校写作守则','各组组级框架')) || '（校长未产出守则）'}`);
  lines.push(`【校长已裁决的风格融合总纲】\n${principalStyleExecutionExcerpt()}`);
  lines.push(`【本组组级框架（组${gi+1}·老师${gi+1}，第${g.first}-${g.last}章）】\n${(pr.raw && extractSection(pr.raw,'各组组级框架','全书章节标题总表')) || (pr.raw || '（校长未产出组级框架）')}`);
  lines.push(`【本组章节标题】\n${scGroupTitles(g).join('\n')}`);
  const _bc = currentBeatCfg ? currentBeatCfg() : null;
  if(_bc && _bc.label) lines.push(`【章节微拍（单源真理·内嵌骨架）】名称=${_bc.label}${_bc.desc?('；说明='+_bc.desc):''}${_bc.types?('；拍=('+_bc.types.map(t=>t.label).join('，')+')'):''}\n要求：将此微拍节奏直接融铸在每章教案的「本章推进骨架」中，形成单一执行标准的超级教案。`);
  lines.push('【全量词典（共享不切片）】\n' + scGlossaryBrief(7000));
  lines.push(`【本组《全书节拍》节选】\n${scGroupBeats(g, 8000)}`);
  const _opening = openingStrategyBrief(); if(_opening) lines.push(_opening);
  if(g && g.first===1){ const _openingTask = principalOpeningTaskExcerpt() || openingStrategyExecutionCard(0); if(_openingTask) lines.push(_openingTask); }
  lines.push(prevGroupTailState(gi, g));
  if(isLong()) lines.push(`【长篇记忆层·老师备课参考】\n${longMemoryBrief(g.first-1) || '（尚无已落地正文状态；以校长交接棒和本组教案输入为准。）'}\n执行要求：记忆层只用于保持状态、因果与伏笔连续，不得擅自新增剧情；本组每章重大事件仍须给出前置条件→触发/线索→人物行动→结果。`);
  lines.push('\n请对本组每一章产出一份「本章写作框架」，并在文末附上【本阶段向下一阶段移交的 3 大关键悬念与阶段高潮成果】。');
  return lines.join('\n\n');
}

function prevGroupTailState(gi, g){
  const groups = schoolStageGroups();
  if(gi <= 0 || !groups[gi-1]) return '【上一组末章·收束状态】\n（本组为全书首组：开篇）——首章按【开篇引擎】选定的策略开篇，无需承接前文。';
  const prev = (state.school && state.school.teachers && state.school.teachers[gi-1]) || null;
  const prevGroup = groups[gi-1];
  if(!prev || !prev.raw || !prevGroup) return '【上一组末章·收束状态】\n（上一组（老师'+gi+'）尚未备课）：请本组首章按「承上节的钩」自行设计衔接。';
  const lastCh = prevGroup.last;
  
  const reLastCh = new RegExp(`^第\\s*${lastCh}\\s*章\\b[\\s\\S]*?(?=^第\\s*\\d+\\s*章\\b|^#+\\s*本阶段向下一阶段移交|$)`, 'm');
  const mLastCh = String(prev.raw).match(reLastCh);
  const lastChPlan = mLastCh ? String(mLastCh[0]).trim() : '';

  const reBaton = /#+\s*本阶段向下一阶段移交[^\n]*\n([\s\S]*?)$/m;
  const mBaton = String(prev.raw).match(reBaton);
  const batonText = mBaton ? mBaton[1].trim() : '';

  const parts = [];
  if(g && g.first===1){ const ot=principalOpeningTaskExcerpt() || openingStrategyExecutionCard(0); if(ot) parts.push(ot); }
  parts.push(`【教师交接棒契约（上一位老师${gi}移交 · 最高优先级硬性输入）】
上一位老师负责第 ${prevGroup.first}-${prevGroup.last} 章。为彻底消除阶段之间的割裂感，本组（第 ${g.first}-${g.last} 章）第 1 章（第 ${g.first} 章）必须作为交接棒的第一承接者：`);
  
  if(lastChPlan){
    parts.push(`◆ 上一组末章（第 ${lastCh} 章）完整教案：\n${lastChPlan.slice(0, 1200)}`);
  }
  if(batonText){
    parts.push(`◆ 上一组移交的 3 大关键悬念与高潮成果：\n${batonText.slice(0, 800)}`);
  } else {
    parts.push(`◆ 上一组末章收束重点：请紧扣第 ${lastCh} 章的连续性与未解悬念，无缝推进到本组第 ${g.first} 章。`);
  }
  parts.push(`【交接执行令】本组第 ${g.first} 章教案的「本章推进骨架」第 ① 环节与「连续性」，必须 100% 严密对缝承接第 ${lastCh} 章定格的真实物理处境与上述悬念，严禁凭空跳跃！`);
  return parts.join('\n\n');
}

async function genTeacher(btn, gi){
  if(!isLong()){ toast('仅长篇小说模式支持老师施教'); return false; }
  const groups = schoolStageGroups(); const g = groups[gi];
  if(!g){ toast('未找到该分组'); return false; }
  if(!scDone('principal')){ toast('请先生成校长（分组/守则/组级框架）'); return false; }
  const key = 't'+gi;
  scState();
  markAIRunning(key); if(btn) busy(btn, true, '备课中…'); if(btn && btn.parentNode) showStopBtn(btn.parentNode);
  try{
    const spec = resolveActiveSpec('teacher');
    const temp = (spec && spec.teacherTemp != null) ? spec.teacherTemp : 0.4;
    for(let attempt=1; attempt<=SCHOOL_RETRY_MAX; attempt++){
      try{
        const txt = await callAIGuarded('teacher', TEACHER_SYS, buildTeacherUser(g, gi), {}, { temperature:temp, maxTokens:16384, signal:_abortCtl?.signal });
        if(!txt || !String(txt||'').trim()){ setScRetry(key, attempt); scRefreshBadge(btn,key); throw new Error('老师返回空'); }
        const sc = scState(); sc.teachers[gi] = { gi, ts:Date.now(), raw:String(txt) };
        scMark(key, true); markAIDone(key);
        render();
        toast(`老师${gi+1}备课完成：第 ${g.first}-${g.last} 章共 ${g.last-g.first+1} 份教案已就绪`);
        playDoneSound('single');
        return true;
      }catch(e){
        if(e && e.name === 'AbortError'){ setScRetry(key, attempt); toast('已停止备课'); return false; }
        setScRetry(key, attempt); scRefreshBadge(btn,key);
        if(attempt < SCHOOL_RETRY_MAX) await new Promise(r=>setTimeout(r,1500));
      }
    }
    toast(`老师${gi+1}备课失败（已自动重试 ${SCHOOL_RETRY_MAX} 次）`);
    return false;
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!==key);
    hideStopBtn(); if(btn) busy(btn,false); scRefreshBadge(btn,key);
  }
}

async function nailRetry(key, label, run, btn){
  for(let attempt=1; attempt<=SCHOOL_RETRY_MAX; attempt++){
    let ok = false; try{ ok = await run(); }catch(e){ ok = false; }
    if(ok){ scMark(key, true); scRefreshBadge(btn, key); return true; }
    setScRetry(key, attempt); scRefreshBadge(btn, key);
    if(attempt < SCHOOL_RETRY_MAX) await new Promise(r=>setTimeout(r,1200));
  }
  toast(`${label}失败（已自动重试 ${SCHOOL_RETRY_MAX} 次）`);
  scRefreshBadge(btn, key);
  return false;
}

function refreshSchoolProgressUi(){
  const topText = document.querySelector('.sc-pipe-t');
  const pipeIn = document.querySelector('.sc-pipe-in');
  const pipeMeta = document.querySelector('.sc-pipe-m');
  const allBtn = document.querySelector('[data-scp-all]');
  const subtag = document.querySelector('.ch-subtag-school');
  const stepKeys = ['dictMaster','dictEnrich','principal','teacher'];
  const doneSteps = stepKeys.filter(k => getSchoolStepStatus(k).isDone).length;
  const pct = Math.round(doneSteps / 4 * 100);

  if(pipeIn) pipeIn.style.width = pct + '%';
  if(pipeMeta) pipeMeta.textContent = `${doneSteps}/4 步就绪 · ${pct}%`;
  if(subtag) subtag.textContent = `${doneSteps}/4 步就绪 · ${pct}%`;

  if(state._schoolRunning){
    const run = state._schoolRunning;
    if(topText) topText.innerHTML = `⚡ <b>一键开学进行中</b>（${run.stepIndex+1}/${run.totalSteps||4} · ${esc(run.label)}）…`;
    if(allBtn){
      allBtn.classList.add('running');
      allBtn.innerHTML = `⚡ 一键开学中（${run.stepIndex+1}/${run.totalSteps||4} · ${esc(run.label)}）…`;
    }
  } else {
    if(topText) topText.textContent = '⏳ 设定就绪 → 学校开学（四步标准管线）';
    if(allBtn){
      allBtn.classList.remove('running');
      allBtn.innerHTML = '⚡ 一键开学（全链路备课）';
    }
  }

  stepKeys.forEach(k=>{
    const el = document.querySelector(`.sc-pipe-steps [data-scp-step="${k}"]`) || document.querySelector(`[data-scp-step="${k}"]`);
    if(el){
      const st = getSchoolStepStatus(k);
      el.classList.toggle('running', st.isRunning);
      el.classList.toggle('done', st.isDone);
      el.classList.toggle('failed', st.isFailed);
      el.classList.toggle('sc-failed', st.isFailed);
      el.classList.toggle('sc-step-default', !st.isRunning && !st.isDone && !st.isFailed);

      let tick = el.querySelector('.sc-tick');
      if(!tick){
        tick = document.createElement('i');
        tick.className = 'sc-tick';
        el.appendChild(tick);
      }
      if(st.isRunning){
        tick.className = 'sc-tick sc-tick-run';
        tick.textContent = '⏳';
      } else if(st.isDone){
        tick.className = 'sc-tick sc-tick-done';
        tick.textContent = '✓';
      } else if(st.isFailed){
        tick.className = 'sc-tick sc-tick-fail';
        tick.textContent = '✕';
      } else {
        tick.className = 'sc-tick';
        tick.textContent = '';
      }
      scRefreshBadge(el, k);
    }
  });

  const groups = schoolStageGroups();
  groups.forEach((g, i)=>{
    const tBtn = document.querySelector(`[data-scp-teacher="${i}"]`);
    if(tBtn){
      const tDone = scDone('t'+i);
      tBtn.classList.toggle('done', tDone);
    }
  });
}

async function genSchoolAll(btn){
  if(genBusy()){ toast('已有生成任务进行中，请稍候'); return; }
  const groups = schoolStageGroups(); if(!groups.length){ toast('请先填写章节数，才能一键开学'); return; }
  const folded = isSchoolFolded();
  const steps = [
    { key:'dictMaster', label:'词典达人', run:()=> genDictMaster(null) },
    { key:'dictEnrich', label:'词典充实', run:()=> genDictEnrich(null,{force:true}) },
    { key:'principal', label:'校长', run:()=> genPrincipal(null) },
    {
      key:'teacher',
      label:'老师',
      run: async ()=>{
        if(folded){
          const sc = scState();
          if(sc.teachers && sc.teachers[0] && sc.teachers[0].raw && String(sc.teachers[0].raw).trim()){
            return true;
          }
          return await genPrincipal(null);
        } else {
          let allT = true;
          for(let j=0; j<groups.length; j++){
            if(scDone('t'+j)) continue;
            state._schoolRunning = { activeKey:'teacher', teacherIndex:j, stepIndex:3, totalSteps:4, label:`老师${j+1}备课` };
            refreshSchoolProgressUi();
            const okT = await genTeacher(null, j);
            if(!okT){ allT = false; break; }
            scMark('t'+j, true);
          }
          return allT;
        }
      }
    }
  ];
  const allBtn = ()=> document.querySelector('[data-scp-all]');
  const presetTitles = ()=>{
    const titles = (state.school && state.school.principal && Array.isArray(state.school.principal.titles)) ? state.school.principal.titles : [];
    if(titles.length && !isPrincipalTitlesApplied()) doApplyTitles(titles, { silent:true });
  };
  if(scDone('principal')) presetTitles();
  const finish = ()=>{
    state._schoolRunning = null;
    const b = allBtn();
    if(b){
      if(b._txt !== undefined){ b.innerHTML = b._txt; delete b._txt; }
      b.classList.remove('running');
    }
    refreshSchoolProgressUi();
  };
  const b0 = allBtn();
  if(b0 && b0._txt === undefined) b0._txt = b0.innerHTML;
  try{
    for(let i=0; i<steps.length; i++){
      const st = steps[i];
      if(getSchoolStepStatus(st.key).isDone) continue;
      scSetFailed(st.key, false);
      state._schoolRunning = { activeKey:st.key, stepIndex:i, totalSteps:4, label:st.label };
      refreshSchoolProgressUi();
      const zone = document.querySelector('.school-zone');
      let stopped = false;
      if(zone){ showStopBtn(zone); zone.classList.add('cp-stopping'); if(_abortCtl) _abortCtl.signal.addEventListener('abort', ()=>{ stopped = true; }, {once:true}); }
      let ok = false;
      try{
        ok = await st.run();
      }catch(err){
        console.error(`[genSchoolAll] step ${st.key} error:`, err);
        ok = false;
      }
      hideStopBtn(); if(zone) zone.classList.remove('cp-stopping');
      if(ok){
        scMark(st.key, true);
        if(st.key==='principal'){
          const titles = (state.school && state.school.principal && Array.isArray(state.school.principal.titles)) ? state.school.principal.titles : [];
          if(titles.length && !isPrincipalTitlesApplied()){
            doApplyTitles(titles, { silent:true });
          }
        }
      } else {
        scSetFailed(st.key, true);
      }
      refreshSchoolProgressUi();
      if(!ok){
        toast(stopped ? `已停止学校一键（停在「${st.label}」）` : `学校一键中断于「${st.label}」，可单独点该步骤重试`);
        return;
      }
    }
    toast('学校一键全部完成：词典达人→词典充实→校长→老师全链路就绪，标题已自动定稿！');
    playDoneSound('all');
  }finally{ finish(); render(); }
}

function bindSchoolSteps(){
  const all = $('[data-scp-all]'); if(all) all.onclick = ()=> genSchoolAll(all);
  const applyBtn = $('[data-scp-apply-titles]');
  if(applyBtn) applyBtn.onclick = ()=> applyPrincipalTitles();
  $$('[data-scp-step]').forEach(btn=>{
    if(btn._sB) return; btn._sB = 1;
    btn.onclick = async ()=>{
      const step = btn.dataset.scpStep;
      if(step === 'dictMaster'){
        scSetFailed('dictMaster', false);
        state._schoolRunning = { activeKey:'dictMaster', stepIndex:0, totalSteps:4, label:'词典达人' };
        refreshSchoolProgressUi();
        try {
          const ok = await nailRetry('dictMaster','词典达人', ()=> genDictMaster(btn), btn);
          if(ok){ scMark('dictMaster', true); playDoneSound('single'); }
          else { scSetFailed('dictMaster', true); }
        } catch(e){
          scSetFailed('dictMaster', true);
        } finally {
          state._schoolRunning = null;
          refreshSchoolProgressUi();
        }
        return;
      }
      if(step === 'dictEnrich'){
        scSetFailed('dictEnrich', false);
        state._schoolRunning = { activeKey:'dictEnrich', stepIndex:1, totalSteps:4, label:'词典充实' };
        refreshSchoolProgressUi();
        try {
          const ok = await nailRetry('dictEnrich','词典充实', ()=> genDictEnrich(btn,{}), btn);
          if(ok){ scMark('dictEnrich', true); playDoneSound('single'); }
          else { scSetFailed('dictEnrich', true); }
        } catch(e){
          scSetFailed('dictEnrich', true);
        } finally {
          state._schoolRunning = null;
          refreshSchoolProgressUi();
        }
        return;
      }
      if(step === 'principal'){
        scSetFailed('principal', false);
        state._schoolRunning = { activeKey:'principal', stepIndex:2, totalSteps:4, label:'校长' };
        refreshSchoolProgressUi();
        try {
          const ok = await genPrincipal(btn);
          if(ok){
            scMark('principal', true);
            const titles = (state.school && state.school.principal && Array.isArray(state.school.principal.titles)) ? state.school.principal.titles : [];
            if(titles.length && !isPrincipalTitlesApplied()) doApplyTitles(titles, { silent:true });
            playDoneSound('single');
          } else {
            scSetFailed('principal', true);
          }
        } catch(e){
          scSetFailed('principal', true);
        } finally {
          state._schoolRunning = null;
          refreshSchoolProgressUi();
        }
        return;
      }
      if(step === 'teacher' || step === 'teacherAll'){
        const groups = schoolStageGroups();
        if(!groups.length){ toast('请先填写章节数，才能备课'); return; }
        const folded = isSchoolFolded();
        scSetFailed('teacher', false);
        state._schoolRunning = { activeKey:'teacher', stepIndex:3, totalSteps:4, label:'老师' };
        refreshSchoolProgressUi();
        try {
          if(folded){
            const ok = await nailRetry('principal', '老师备课', ()=> genPrincipal(null), btn);
            if(ok){ scMark('teacher', true); playDoneSound('single'); }
            else { scSetFailed('teacher', true); }
          } else {
            let allOk = true;
            for(let i=0; i<groups.length; i++){
              if(scDone('t'+i)) continue;
              const ok = await genTeacher(null, i);
              if(!ok){ allOk = false; scSetFailed('teacher', true); break; }
              scMark('t'+i, true);
            }
            if(allOk){ scMark('teacher', true); playDoneSound('single'); }
          }
        } catch(e){
          scSetFailed('teacher', true);
        } finally {
          state._schoolRunning = null;
          refreshSchoolProgressUi();
        }
        return;
      }
      if(step === 'teacherSingle'){
        const gi = Number(btn.dataset.scpTeacher);
        const ok = await genTeacher(btn, gi);
        if(ok){
          scMark('t'+gi, true);
          const groups = schoolStageGroups();
          if(groups.every((g,i)=>scDone('t'+i))) scMark('teacher', true);
        }
        refreshSchoolProgressUi();
        return;
      }
    };
  });
  $$('[data-scp-plan]').forEach(b=>{ b.onclick = ()=> openSchoolPlanReader(+b.dataset.scpPlan); });
  const pv = $('[data-scp-plan-pr]');
  if(pv) pv.onclick = ()=> openSchoolPrincipalReader();
  bindPlannerSoundTool();
}

function getFieldTagClass(k){
  if(/时间|落点|时点/.test(k)) return 'sc-tag-blue';
  if(/连续|承上|启下|承接|过桥/.test(k)) return 'sc-tag-green';
  if(/推进|骨架|拍|事件/.test(k)) return 'sc-tag-amber';
  if(/功能|位置|分工/.test(k)) return 'sc-tag-purple';
  if(/情绪|弧|高潮|突出/.test(k)) return 'sc-tag-pink';
  if(/出场|名单|人物|实体/.test(k)) return 'sc-tag-teal';
  return 'sc-tag-blue';
}

function saveTeacherFieldEdit(gi, ch, k, newV){
  const t = state.school && state.school.teachers && state.school.teachers[gi];
  if(!t || !t.raw) return;
  const lines = String(t.raw).split('\n');
  let inCh = false;
  let replaced = false;
  for(let i=0; i<lines.length; i++){
    const ln = lines[i];
    const mCh = ln.match(/^\s*第\s*(\d+)\s*章/);
    if(mCh){
      if(parseInt(mCh[1],10) === ch){ inCh = true; }
      else if(inCh){ break; }
    }
    if(inCh){
      const mF = ln.match(/^(\s*(?:[-•*>\d().]+\s*)*)([^：:]{1,10})([：:])\s*(.*)$/);
      if(mF && mF[2].trim() === k){
        lines[i] = `${mF[1]}${mF[2]}${mF[3]} ${newV.trim()}`;
        replaced = true;
        break;
      }
    }
  }
  if(!replaced && inCh){
    lines.push(`- ${k}：${newV.trim()}`);
    replaced = true;
  }
  if(replaced){
    t.raw = lines.join('\n');
    persist();
    toast(`第${ch}章「${k}」已保存修改`);
  }
}

const PLAN_FIELD_KEYS = ['功能与位置','剧情时间落点','本章推进骨架','情绪走向与突出点','连续性','本章出场名单'];
function splitTeacherPlanChapters(raw){
  const res = [];
  let cur = null;
  String(raw||'').split('\n').forEach(ln=>{
    const m = String(ln).match(/^\s*第\s*(\d+)\s*章[^(《（]*\s*(.*)$/);
    if(m){ cur = { ch:+m[1], title:String(m[2]||'').replace(/[《》（）()【】]/g,'').trim(), fields:[] }; res.push(cur); return; }
    if(cur){
      const f = String(ln).match(/^\s*(?:[-•*>\d().]+\s*)*([^：:]{1,10})[：:]\s*(.*)$/);
      if(f && PLAN_FIELD_KEYS.indexOf(f[1].trim()) >= 0 && String(f[2]||'').trim()){
        cur.fields.push({ k:f[1].trim(), v:String(f[2]).trim() });
      }
    }
  });
  return res;
}
let _planCUR_GI = 0, _planCUR_VIEW = 'card';
function openSchoolPlanReader(gi, jumpCh){
  const sc = scState();
  const t = sc && sc.teachers && sc.teachers[gi];
  const g = schoolStageGroups()[gi];
  if(!g){ toast('未找到该章节分组'); return; }
  _planCUR_GI = gi; _planCUR_VIEW = 'raw';
  const n = g.last - g.first + 1;
  const ov = document.createElement('div'); ov.className='gs-overlay';
  const isFolded = isSchoolFolded();
  const titleText = isFolded ? '🎓 老师 · 全书教案 (1-20章·单老师负责制)' : `🎓 老师${gi+1} · 本组教案`;
  ov.innerHTML = `<div class="gs-modal school-plan-modal">
    <div class="gs-modal-head"><b>${titleText}</b><span class="sc-plan-meta muted">${isFolded ? '单老师负责制直出' : `段「${esc(g.stage||'')}」`} · 第 ${g.first}-${g.last} 章 · ${n} 章</span></div>
    <div class="sc-plan-tool">
      <span class="sc-plan-tgl" id="scPlanTgl">
        <span class="sp-tgl-itm on" data-v="raw">原稿纯文本</span><span class="sp-tgl-itm" data-v="card">栏目结构化</span>
      </span>
      <button class="gs-x" data-sp-close>✕</button>
    </div>
    <div class="sc-plan-body" id="scPlanBody" style="max-height:68vh;overflow:auto;padding:12px 16px 20px"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-sp-close]').onclick = ()=> ov.remove();
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  ov.querySelectorAll('.sp-tgl-itm').forEach(el=>{
    el.onclick = ()=>{ _planCUR_VIEW = el.dataset.v; ov.querySelectorAll('.sp-tgl-itm').forEach(x=>x.classList.toggle('on', x===el)); renderSchoolPlanBody(ov, gi, jumpCh); };
  });
  renderSchoolPlanBody(ov, gi, jumpCh);
  if(jumpCh){ setTimeout(()=>{ const el = ov.querySelector('#planCh-'+jumpCh); if(el){ el.style.transition='box-shadow .5s,background .5s'; el.style.boxShadow='0 0 0 2px var(--accent)'; el.style.background='color-mix(in srgb, var(--accent) 12%, transparent)'; setTimeout(()=>{ el.style.boxShadow=''; el.style.background=''; },1600); el.scrollIntoView({block:'center',behavior:'smooth'}); } },80); }
}
function renderSchoolPlanBody(ov, gi, jumpCh){
  const g = schoolStageGroups()[gi];
  const sc = scState();
  const t = sc.teachers && sc.teachers[gi];
  const isFolded = isSchoolFolded();
  const body = ov.querySelector('#scPlanBody'); if(!body || !g) return;

  if(!t || !t.raw || !String(t.raw).trim()){
    body.innerHTML = `
      <div class="sc-plan-empty" style="text-align:center;padding:42px 20px;display:flex;flex-direction:column;align-items:center;gap:12px;">
        <span style="font-size:38px;opacity:0.85">📖</span>
        <h4 style="margin:0;font-size:16px;font-weight:750;color:var(--txt)">本组逐章教案尚未生成</h4>
        <p style="margin:0;font-size:13px;color:var(--muted);max-width:380px;line-height:1.6">
          ${isFolded ? `全书共 ${g.last} 章（≤20章折叠模式）。校长兼任课教师可一次性统筹出齐守则、章节标题与逐章教案。` : `本组负责第 ${g.first} 至 ${g.last} 章（共 ${g.last - g.first + 1} 章${g.stage ? ' · ' + g.stage : ''}）。点击下方按钮开始备课。`}
        </p>
        <button type="button" class="btn primary" id="scEmptyPlanStart" style="padding:9px 24px;border-radius:10px;font-size:13.5px;font-weight:750;margin-top:8px">
          ${isFolded ? '🎓 立即备课' : `🎓 立即让老师${gi+1}备课`}
        </button>
      </div>
    `;
    const btn = body.querySelector('#scEmptyPlanStart');
    if(btn){
      btn.onclick = async ()=>{
        ov.remove();
        if(isFolded){
          await nailRetry('principal', '老师备课', ()=> genPrincipal(null), null);
        } else {
          await nailRetry('t'+gi, `老师${gi+1}备课`, ()=> genTeacher(null, gi), null);
        }
        openSchoolPlanReader(gi, jumpCh);
      };
    }
    return;
  }

  if(_planCUR_VIEW === 'raw'){
    const wrap = document.createElement('div');
    wrap.className = 'sc-plan-raw-box';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:6px 12px;border-radius:8px;background:var(--panel2);border:1px solid var(--line)">
        <span style="font-size:12px;font-weight:700;color:var(--txt)">📄 老师逐章教案 · 原稿纯文本</span>
        <button type="button" class="btn small" id="scCopyPlanBtn" style="font-size:11.5px;padding:3px 12px;border-radius:6px;cursor:pointer">📋 复制纯文本全文</button>
      </div>
      <pre class="sc-plan-raw" style="user-select:text;margin:0"></pre>
    `;
    wrap.querySelector('.sc-plan-raw').textContent = t.raw;
    const cpBtn = wrap.querySelector('#scCopyPlanBtn');
    if(cpBtn){
      cpBtn.onclick = ()=>{
        navigator.clipboard.writeText(t.raw).then(()=>{
          cpBtn.textContent = '✓ 已复制全文';
          setTimeout(()=>{ cpBtn.textContent = '📋 复制纯文本全文'; }, 1800);
        });
      };
    }
    body.innerHTML = '';
    body.appendChild(wrap);
    return;
  }
  const blocks = splitTeacherPlanChapters(t.raw);
  const byCh = new Map(blocks.map(b=>[b.ch,b]));
  let html = '';
  for(let ch=g.first; ch<=g.last; ch++){
    const b = byCh.get(ch) || null;
    let rows = '';
    if(b && b.fields.length){
      rows = b.fields.map(f => {
        const isLongText = f.v.length > 110;
        const tagCls = getFieldTagClass(f.k);
        return `
          <div class="sc-kf">
            <span class="sc-kf-k ${tagCls}">${esc(f.k)}</span>
            <div class="sc-kf-v-col">
              <div class="sc-kf-v ${isLongText ? 'sc-collapse-clamp' : ''}" data-val-raw="${esc(f.v)}">${esc(f.v)}</div>
              ${isLongText ? `<button type="button" class="sc-expand-btn">展开全文 ▾</button>` : ''}
            </div>
            <button type="button" class="sc-field-edit-btn" data-edit-ch="${ch}" data-edit-k="${esc(f.k)}" title="编辑该字段">✎</button>
          </div>
        `;
      }).join('');
    } else {
      rows = '<div class="sc-kf"><span class="sc-kf-k sc-tag-blue">提示</span><span class="sc-kf-v">该章节教案缺少可读字段，可切「原始稿」查看。</span></div>';
    }
    html += `<div class="sc-plan-ch" id="planCh-${ch}">
      <div class="sc-plan-ch-t">第${ch}章${b&&b.title?(' · '+esc(b.title)):''}</div>
      <div class="sc-kf-wrap">${rows}</div>
    </div>`;
  }
  body.innerHTML = html;

  body.querySelectorAll('.sc-expand-btn').forEach(btn => {
    btn.onclick = () => {
      const vEl = btn.previousElementSibling;
      vEl.classList.toggle('sc-collapse-clamp');
      btn.textContent = vEl.classList.contains('sc-collapse-clamp') ? '展开全文 ▾' : '收起 ▴';
    };
  });

  body.querySelectorAll('.sc-field-edit-btn').forEach(btn => {
    btn.onclick = () => {
      const ch = +btn.dataset.editCh;
      const k = btn.dataset.editK;
      const row = btn.closest('.sc-kf');
      const valCol = row.querySelector('.sc-kf-v-col');
      const oldVal = valCol.querySelector('.sc-kf-v').getAttribute('data-val-raw') || '';
      valCol.innerHTML = `
        <div class="sc-kf-edit-box" style="display:flex;flex-direction:column;gap:6px;width:100%;margin-top:4px;">
          <textarea class="sc-kf-edit-area" style="width:100%;min-height:85px;font-size:12.5px;padding:8px 10px;border-radius:8px;border:1px solid var(--accent);background:var(--panel);color:var(--txt);line-height:1.6;">${esc(oldVal)}</textarea>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn small primary" data-save>保存修改</button>
            <button type="button" class="btn small ghost" data-cancel>取消</button>
          </div>
        </div>
      `;
      btn.style.display = 'none';
      valCol.querySelector('[data-save]').onclick = () => {
        const newV = valCol.querySelector('textarea').value;
        saveTeacherFieldEdit(gi, ch, k, newV);
        renderSchoolPlanBody(ov, gi, ch);
      };
      valCol.querySelector('[data-cancel]').onclick = () => {
        renderSchoolPlanBody(ov, gi, ch);
      };
    };
  });
}

let _prCUR_VIEW = 'card';
function openSchoolPrincipalReader(){
  const sc = state.school;
  const p = sc && sc.principal;
  const raw = (p && p.raw) || '';
  if(!raw){
    toast('校长统筹成果尚未生成，请先点击「校长统筹」或「一键开学」');
    return;
  }
  _prCUR_VIEW = 'card';
  const ov = document.createElement('div'); ov.className = 'gs-overlay';
  ov.innerHTML = `
  <div class="gs-modal school-plan-modal" style="max-width:920px">
    <div class="gs-modal-head">
      <b>👑 校长统筹全局成果</b>
      <span class="sc-plan-meta muted">全校写作守则 · 各组组级框架 · 全书章节标题总表</span>
    </div>
    <div class="sc-plan-tool">
      <span class="sc-plan-tgl">
        <span class="sp-tgl-itm on" data-prv="card">结构化卡片</span>
        <span class="sp-tgl-itm" data-prv="raw">原始稿</span>
      </span>
      <button class="gs-x" data-pr-close>✕</button>
    </div>
    <div class="sc-plan-body" id="scPrincipalBody" style="max-height:72vh;overflow:auto;padding:14px 18px 22px"></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-pr-close]').onclick = ()=> ov.remove();
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  ov.querySelectorAll('[data-prv]').forEach(el=>{
    el.onclick = ()=>{
      _prCUR_VIEW = el.dataset.prv;
      ov.querySelectorAll('[data-prv]').forEach(x=>x.classList.toggle('on', x===el));
      renderSchoolPrincipalBody(ov, raw);
    };
  });
  renderSchoolPrincipalBody(ov, raw);
}

function renderSchoolPrincipalBody(ov, raw){
  const body = ov.querySelector('#scPrincipalBody');
  if(!body) return;
  if(_prCUR_VIEW === 'raw'){
    body.innerHTML = `<pre class="sc-plan-raw">${esc(raw||'（暂无内容）')}</pre>`;
    return;
  }
  
  const rulesSec = extractSection(raw, '全校写作守则', '各组组级框架') || extractSection(raw, '全校写作守则', '全书章节标题总表') || '';
  const frameSec = extractSection(raw, '各组组级框架', '全书章节标题总表') || '';
  const titles = (state.school && state.school.principal && state.school.principal.titles && state.school.principal.titles.length)
    ? state.school.principal.titles
    : parsePrincipalTitles(raw);
  const titlesApplied = isPrincipalTitlesApplied();
  
  let html = '';
  
  if(rulesSec){
    html += `
    <div class="sc-pr-card">
      <div class="sc-pr-card-h"><span class="sc-pr-card-ic">📜</span> <b>全校写作守则（配方锚点与可执行纪律）</b></div>
      <div class="sc-pr-card-b">
        <div class="sc-pr-rules-wrap">${esc(rulesSec).replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
  }
  
  if(frameSec){
    html += `
    <div class="sc-pr-card">
      <div class="sc-pr-card-h"><span class="sc-pr-card-ic">🗺</span> <b>各组组级框架</b></div>
      <div class="sc-pr-card-b">
        <div class="sc-pr-rules-wrap">${esc(frameSec).replace(/\n/g, '<br>')}</div>
      </div>
    </div>`;
  } else if(isSchoolFolded()){
    html += `
    <div class="sc-pr-card">
      <div class="sc-pr-card-h"><span class="sc-pr-card-ic">⚡</span> <b>单组折叠架构（≤20章直通）</b></div>
      <div class="sc-pr-card-b">
        <div class="muted">当前篇幅 ≤20 章，三层折叠为单层：校长兼任课教师，免去组级框架中间传递损耗，直接出齐全校守则、章节标题与逐章教案。</div>
      </div>
    </div>`;
  }
  
  html += `
  <div class="sc-pr-card">
    <div class="sc-pr-card-h" style="display:flex;align-items:center;justify-content:space-between">
      <span><span class="sc-pr-card-ic">📑</span> <b>全书章节标题总表（共 ${titles.length} 章）</b></span>
      ${titles.length ? `<button type="button" class="btn primary small" id="btnPrApplyTitles" ${titlesApplied?'disabled style="opacity:0.75"':''}>${titlesApplied ? '✓ 标题已全部应用至全书' : `✨ 选用这套章节标题（${titles.length} 章）`}</button>` : ''}
    </div>
    <div class="sc-pr-card-b">
      ${titles.length ? `
        <div class="sc-title-grid">
          ${titles.map(t=>`
            <div class="sc-title-item">
              <span class="sc-t-no">第${t.num}章</span>
              <span class="sc-t-name">《${esc(t.title)}》</span>
            </div>
          `).join('')}
        </div>
      ` : '<div class="muted">未能从原始稿中解析出标题列表，可切换到「原始稿」查看。</div>'}
    </div>
  </div>`;
  
  body.innerHTML = html;
  
  const btnApply = body.querySelector('#btnPrApplyTitles');
  if(btnApply && !titlesApplied){
    btnApply.onclick = ()=>{
      const ok = applyPrincipalTitles();
      if(ok){
        renderSchoolPrincipalBody(ov, raw);
      }
    };
  }
}

function openSchoolRawPanel(title, sub, raw){
  const ov = document.createElement('div'); ov.className='gs-overlay';
  ov.innerHTML = `<div class="gs-modal school-plan-modal">
    <div class="gs-modal-head"><b>${esc(title)}</b><button class="gs-x" data-sp-close>✕</button></div>
    ${sub?`<div class="gs-modal-sub">${esc(sub)}</div>`:''}
    <div class="sc-plan-body" style="max-height:68vh;overflow:auto;padding:12px 16px 20px"><pre class="sc-plan-raw">${esc(raw||'（暂无内容）')}</pre></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-sp-close]').onclick = ()=> ov.remove();
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
}


const NM_SURNAME_1 = new Set('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'.split(''));
const NM_SURNAME_2 = new Set(['万俟','司马','上官','欧阳','夏侯','诸葛','闻人','东方','赫连','皇甫','尉迟','公羊','澹台','公冶','宗政','濮阳','淳于','单于','太叔','申屠','公孙','仲孙','轩辕','令狐','钟离','宇文','长孙','慕容','鲜于','闾丘','司徒','司空','亓官','司寇','仉督','子车','颛孙','端木','巫马','公西','漆雕','乐正','壤驷','公良','拓跋','夹谷','宰父','谷梁','段干','百里','东郭','南门','呼延','归海','羊舌','微生','梁丘','左丘','东门','西门']);
const NM_WEB_BLACKLIST = ['林晚','苏晚','顾沉','云深','顾言','江晚','许墨','陆离','沈舟','苏念','林陌'];
const NM_BANNED_CHARS = ['晚','砚','秋','檐'];   // 姓名中禁止出现这四个汉字（任何位置）
const NM_BANNED_NAMES = [   // 逐字精确禁用名单（含去空格），命中即判违规
  '林辰','苏辰','顾夜寒','陆泽','墨渊','叶辰','江亦琛','傅景深','沈辞','萧景琰','凌夜','顾言','裴衍','楚慕言','厉承勋','谢珩','温景然','云烬','宋砚','慕云凡',
  '苏清月','晚卿','沈知予','顾晚柠','林晚星','慕晚晴','苏沐瑶','温妤','夏晚璃','楚清鸢','叶轻寒','姜知微','云舒','苏念汐','洛清欢','白若曦','顾绾绾','江晚渔','宋知晚','宁疏影'
];
const BANLIST_DEFAULT = {
  enabled: true,                            // 总开关（默认开）：清单是否参与注入
  chars: [],                                // 禁用字/词（人名/专名任何位置命中即拒，由校验器联动）；默认沿用 NM_BANNED_CHARS 读取
  names: [],                                // 禁用姓名（逐字精确）；默认沿用 NM_BANNED_NAMES
  phrases: [],                              // 禁用短语/模板词（仅正文注入，控词频）
  rules: [],                                 // 附加规则条目：每条声明生效 AI 范围
  scopeAi: ['chapter']                       // 缺省生效范围（仅正文）；用户可按 AI 扩展大纲/标题/规划师
};
function nmNameRuleViolation(nm){
  const s = String(nm||'').trim();
  if(!s) return '';
  if(!/^[\u4e00-\u9fa5]+$/.test(s)) return '';           // 含非汉字（外文名）不约束
  const bv = banListViolation(s);
  if(bv) return bv;
  let surLen = 0;
  if(NM_SURNAME_2.has(s.slice(0,2))) surLen = 2;
  else if(NM_SURNAME_1.has(s.charAt(0))) surLen = 1;
  if(!surLen) return '';                                   // 首字(两字)非百家姓 → 外国角色不约束
  const exp = surLen + 2;                                  // 姓 + 两字名
  if(s.length !== exp) return `姓名应为百家姓(${surLen}字姓)+两字名＝${exp}字（当前「${s}」为${s.length}字）`;
  const given = s.slice(surLen);
  if(/([\u4e00-\u9fa5])\1/.test(given)) return `名字不得叠字（「${s}」）`;
  if(NM_WEB_BLACKLIST.some(w => s.indexOf(w) >= 0)) return `疑似网文高频名（「${s}」）`;
  return '';
}

function normalizeBanList(b){
  if(!b || typeof b !== 'object') return null;
  const out = { enabled: !(b.enabled === false) };
  out.chars = Array.isArray(b.chars) ? b.chars.filter(x=>x&&String(x).trim()) : [];
  out.names = Array.isArray(b.names) ? b.names.filter(x=>x&&String(x).trim()) : [];
  out.phrases = Array.isArray(b.phrases) ? b.phrases.filter(x=>x&&String(x).trim()) : [];
  out.rules = Array.isArray(b.rules) ? b.rules.filter(r=>r&&r.text).map(r=>({ text:String(r.text), ai:Array.isArray(r.ai)?r.ai:[] })) : [];
  out.scopeAi = Array.isArray(b.scopeAi) ? b.scopeAi.filter(x=>x) : (Array.isArray(BANLIST_DEFAULT.scopeAi) ? BANLIST_DEFAULT.scopeAi.slice() : []);
  return out;
}
function banListRaw(){ return (state.banList && typeof state.banList === 'object') ? state.banList : BANLIST_DEFAULT; }
function stateBanEnabled(){ const b = banListRaw(); return !(b && b.enabled === false); }
function banListChars(){ const c = banListRaw().chars; return (Array.isArray(c) && c.length) ? c : NM_BANNED_CHARS; }
function banListNames(){ const n = banListRaw().names; return (Array.isArray(n) && n.length) ? n : NM_BANNED_NAMES; }
function banListAiActive(role){
  const sc = banListRaw().scopeAi;
  if(!Array.isArray(sc) || !sc.length) return true;
  return sc.indexOf(role) >= 0;
}
function banListBlockFor(role){
  if(!isLong()) return '';
  if(!stateBanEnabled()) return '';
  const b = banListRaw();
  const lines = [];
  const chars = banListChars(), names = banListNames();
  if(chars.length && banListAiActive(role)) lines.push('人名禁用字：' + chars.join('、') + '（姓名任何位置命中即违规）');
  if(names.length && banListAiActive(role)) lines.push('禁用姓名（不得逐字原样使用或当作现成名）：' + names.join('、'));
  const rules = Array.isArray(b.rules) ? b.rules : [];
  rules.forEach(r => {
    if(!r || !r.text) return;
    const ai = Array.isArray(r.ai) ? r.ai : [];
    if(ai.indexOf(role) >= 0) lines.push(r.text);
  });
  const phrases = Array.isArray(b.phrases) ? b.phrases : [];
  if(role === 'chapter' && phrases.length) lines.push('规避高频模板词/禁用短语：' + phrases.join('、'));
  if(!lines.length) return '';
  return '\n\n【用户禁则清单（最高优先）】\n' + lines.join('\n');
}
function banListViolation(nm){
  const s = String(nm||'').trim(); if(!s) return '';
  const ch = banListChars().find(c => s.indexOf(c) >= 0);
  if(ch) return `名字含禁用字「${ch}」（禁则清单）`;
  if(banListNames().indexOf(s) >= 0) return `命中禁则名单「${s}」`;
  return '';
}



const BOOK_BEAT_OPTIONS = [
  { id:4,  label:'四拍', emoji:'📜', subtitle:'万法之祖 · 四段底层骨架', desc:'中国古典乃至全世界故事的底层骨架：起（铺垫）→承（推进）→转（转折/高潮）→合（后果收束/结局）。', pro:'极度合适、永不过时；结构清晰，适合篇幅中等、想在落笔前先立龙骨的作品。', con:'太过骨架化——大神靠四字就能写出神作，新手实操易卡文，常不知每部分具体该塞什么。', note:'按「起→承→转→合」划分全书三幕/四段。',
    ai:{ stages:['铺垫','推进','高潮','结局收束'],
      duty:['交代世界观、主角处境与主要目标','展开冲突，主角行动升级',
        '全书最高强度的核心高潮事件（关系/利益/真相的关键节点）','收束各线，给出明确结局与余味；若为分卷/续集，可在结局后预留续接口'],
      must:'必须按以上 4 个阶段顺序升格推进；每个阶段必须设置一个明确的阶段高潮事件并标注其性质（如夺得神器/收服人心/破解身世/决战宿敌/绝境反击/真相揭露/关系破冰）；相邻两阶段的性质必须不同。',
      forbid:'禁止跳过任一阶段；禁止把多个阶段揉进同一章；禁止全书反复使用同一种性质的高潮；禁止在阶段内注水无进展的填充内容。' } },
  { id:7,  label:'七拍', emoji:'⚡', subtitle:'商业网文首选 · 七段强节奏', desc:'把「承」拆成两次推进、再以高潮后的收束收尾到结局：铺垫→推进→转折→推进→高潮→后果收束→结局收束。', pro:'节奏感极强，读者像坐过山车；快节奏强冲突，男频升级流 / 女频飒爽文的标配。', con:'全书都是 7 步循环，读多了容易让读者产生「套路疲劳」。', note:'全书大循环按七段推进，情绪高低交替，章节衔接处可留钩，全末尾段必收束到结局。',
    ai:{ stages:['铺垫','推进','转折','推进','高潮','后果收束','结局收束'],
      duty:['交代世界观、主角现状与首个目标','展开首次冲突，主角开始行动','引入变化、阻力升级，计划被打乱','第二阶段加压，主角调整策略继续推进','情绪或利益最高点，本阶段核心回报','高能量回落，收拾后果；若为全书最终段，则收束全书主线并给出明确结局','收束各线，给出全书明确结局与余味；若为分卷/续集，可在结局后预留续接口'],
      must:'必须按以上 7 个阶段顺序升格推进；每个阶段必须设置一个明确的阶段高潮事件并标注其性质（如夺得神器/收服人心/破解身世/决战宿敌/绝境反击/真相揭露/关系破冰）；相邻两阶段的性质必须不同。',
      forbid:'禁止跳过任一阶段；禁止把多个阶段揉进同一章；禁止全书反复使用同一种性质的高潮；禁止在阶段内注水无进展的填充内容。' } },
  { id:12, label:'十二拍', emoji:'🏛️', subtitle:'奇幻/成长史诗 · 心理蜕变', desc:'极细地刻画主角内心成长的每一个心理阶段（拒绝召唤、历险试炼、灵魂黑夜等），心理线与剧情线同步推进。', pro:'长线叙事、心理蜕变刻画深，适合玄幻修仙 / 奇幻冒险 / 人物传记。', con:'前期铺垫过长（前 5 拍都在准备出发），不适合开局就要炸场的题材。', note:'前期铺垫较长，重点写心理蜕变与伙伴/敌人矩阵。',
    ai:{ stages:['日常铺垫','意外触发','内心犹豫','助力推进','决心行动','试炼推进','逼近核心','绝境高潮','压力回落','再生变数','终局高潮','结局收束'],
      duty:['呈现主角常规生活与隐藏诉求','一起意外打破日常，主角被动卷入','主角犹豫是否行动，内心拉扯显形','获得助力/情报，主角定下行动决心','走出舒适区，主动出击','一路试炼积累能力与同伴','逼近主要矛盾核心，阻力全面升级','接近绝境的高压强情绪点（中段高点）','危机暂解，压力回落','再生变数或引发身份真相','全书终局最高强度的对决/揭晓','收束各线，给出结局与余味'],
      must:'必须按以上 12 个阶段顺序升格推进；前期铺垫节奏适中，心理线须随剧情线同步进度；每个阶段必须设置一个明确的阶段高潮事件并标注其性质；相邻两阶段的性质必须不同。',
      forbid:'禁止跳过任一阶段；禁止把多个阶段揉进同一章；禁止全书反复使用同一种性质的高潮；禁止在阶段内注水无进展的填充内容。' } },
  { id:15, label:'十五拍', emoji:'🎬', subtitle:'剧本感/悬疑推理 · 中段拆分', desc:'把「中段」拆得最细：中点、坏人逼近、一无所有、灵魂黑夜、反击、决战，层层反转。', pro:'逻辑严密、多重反转，适合悬疑 / 推理 / 职场商战等注重布局的故事。', con:'对新手过于繁琐，容易为了填满 15 拍而注水。', note:'强调中段布局与多线并置，反转节点需提前预埋。',
    ai:{ stages:['开篇铺垫','主题铺垫','背景铺垫','变故触发','内心质变','换场推进','副线铺垫','轻松推进','中部转折','压力推进','绝境极点','低谷重整','反击转折','终局高潮','结局收束'],
      duty:['立境并给出主角目标','亮出核心命题与主角立场','补世界观与势力关系','由触发事件打破平衡，主角入局','主角第一次重大权衡/质变','进入新环境、新阶段','埋入支线人物与伏笔','相对平缓的一拍，蓄力并埋钩','全书中点的关键转向','局势收紧，主角处处受制','接近绝境的高压强情绪点','低潮收拾、短暂重整','主人公重新集结、发起反击','终局最高强度的对决/揭示','收束各线结局，留余味'],
      must:'必须按以上 15 个阶段顺序升格推进；中段（中部转折至反击转折）须布局多线并置，反转节点必须提前预埋；每个阶段必须设置一个明确的阶段高潮事件并标注其性质；相邻两阶段的性质必须不同。',
      forbid:'禁止为了凑满 15 拍而注水；禁止跳过任一阶段；禁止把多个阶段揉进同一章；禁止全书反复使用同一种性质的高潮；禁止在阶段内无进展地填充内容。' } }
];
const BOOK_BEAT_DEFAULT_ID = 7;
function currentBookBeatId(){ return state.bookBeat ? Number(state.bookBeat) : BOOK_BEAT_DEFAULT_ID; }
function currentBookBeatCfg(){ return BOOK_BEAT_OPTIONS.find(b=>b.id===currentBookBeatId()) || BOOK_BEAT_OPTIONS[0]; }
function bookBeatHtml(){
  const cur = currentBookBeatId();
  return `<div class="book-beat-panel" style="margin:10px 0">
    <div class="poly-head"><span class="poly-ic">🥁</span><b>全书拍子</b><span class="poly-rule">生成大纲前选择</span></div>
    <div class="book-beat-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px">
      ${BOOK_BEAT_OPTIONS.map(b=>`
        <label class="book-beat-card ${b.id===cur?'selected':''}" style="border:2px solid ${b.id===cur?'var(--accent,#4a90e2)':'var(--line,#e0e0e0)'};border-radius:8px;padding:10px;cursor:pointer;transition:.15s">
          <input type="radio" name="bookBeat" value="${b.id}" ${b.id===cur?'checked':''} style="display:none">
          <div style="font-size:18px;margin-bottom:4px">${b.emoji} ${b.label}</div>
          <div style="font-weight:600;font-size:13px;margin-bottom:4px">${b.subtitle}</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.4">${b.desc}</div>
          ${b.pro?`<div class="book-beat-pc pro"><span class="pc-k">优点</span>${b.pro}</div>`:''}
          ${b.con?`<div class="book-beat-pc con"><span class="pc-k">缺点</span>${b.con}</div>`:''}
        </label>
      `).join('')}
    </div>
  </div>`;
}

function bookBeatBriefHtml(){
  const bb = currentBookBeatCfg();
  const stages = (bb.ai && bb.ai.stages) || [];
  return `<div class="decision-brief book-beat-brief">
    <span class="db-lock">🔒</span><b>全书拍子已先定</b>
    <span class="db-main">${bb.emoji} ${esc(bb.label)}</span>
    <span class="db-sub">${esc(bb.subtitle)}</span>
    <span class="db-stages">${stages.map(esc).join(' → ')}</span>
  </div>`;
}

const BEAT_OPTIONS = [
  { id:5,  label:'微五拍', emoji:'⚖️', desc:'五段式最稳妥：起头→推进→加转折→交出一项成果→结尾留钩子，节奏不赶不拖、最百搭', types:[
      { key:'setup',  label:'开篇铺垫', uiHint:'开头先说清：在哪里、和谁、要做什么，别急着倒信息。', note:'交代本章的时间、地点与在场人物，说明当前要做的事', aiDirective:'必须用简短铺垫立境（场景＋此刻要做的事）；禁止在本拍灌注大段设定或人物背景。' },
      { key:'rise',   label:'冲突推进', uiHint:'推进主线，制造一处具体阻力或新信息，让情节往前动。', note:'引入一个具体的阻力或新信息，推动本章目标向前进展', aiDirective:'必须引入具体的阻力或新信息推动目标进展，事件要具体可感；禁止原地重复、禁止只剩对话而无动作推进。' },
      { key:'turn',   label:'意外转折', uiHint:'先让人以为会怎样，再给出变化，超出读者预判。', note:'先建立预期，再呈现计划之外的变化，使发展超出读者预判', aiDirective:'必须先立预期再呈现计划外的变化；禁止无铺垫的随意反转、禁止反转后与主线脱节。' },
      { key:'climax', label:'阶段高潮', uiHint:'收拢整段的积累，给出一次明确的成果或回报。', note:'收拢本章积累，达成一次明确的成果或回报', aiDirective:'必须收拢前面积累并交付一项明确的成果/回报/认知；禁止在无积累时凭空给奖励、禁止重复已用过的回报类型。' },
      { key:'hook',   label:'收束+悬念', uiHint:'把这一拍收好，在结尾留一个新信息或钩子给下一章。', note:'收束本章，并以一处伏笔或新信息为下一章留下接口', aiDirective:'必须收束本拍阶段情绪，并在章末留出新信息/新目标/关系变化作为续读钩子；禁止以总结句或无关陈述收尾。' }
  ]},
  { id:3,  label:'微三拍', emoji:'🚀', desc:'三段快速爽：开头一小节，中段一口气猛推进，结尾收尾+留钩，一章一个明确节点', types:[
      { key:'setup',  label:'开局铺垫', uiHint:'一两句话交代主角处境和本章要处理的问题，快速入题。', note:'交代主角当前处境与本章要处理的问题', aiDirective:'必须简洁交代主角当前处境与本章要解决的问题并迅速进入；禁止用长篇心理或环境描写拖慢节奏。' },
      { key:'climax', label:'核心进展', uiHint:'给出本章最要紧的进展或成果，回应开头的期待。', note:'给出本章的关键进展或成果，回应开头建立的期待', aiDirective:'必须给出本章关键进展并回应前文期待、占篇幅最大；禁止无进展的注水对白或冗余环节。' },
      { key:'hook',   label:'收束+悬念', uiHint:'收好本章成果，在衔接处留个新信息点当引子。', note:'收束本章成果，在衔接处留下新的信息点以引出下一章', aiDirective:'必须收束本章成果，并在章末留下一个新信息点引出下一章；禁止以强行悬念或重复信息收尾。' }
  ]},
  { id:7,  label:'微七拍', emoji:'🍵', desc:'七段慢慢升温、主打细腻走心：靠人物互动和情绪一点点拉近，不追快进度，结尾留暖意', types:[
      { key:'daily',     label:'日常铺垫', uiHint:'先立时间、地点、气温等感官氛围，让读者进得来。', note:'以时节/气温/光线等感官细节立境，交代时间地点与主角当下去向', aiDirective:'必须用具体的气候、光线、气味等感官细节把日常铺开并立境；禁止在本拍制造冲突或信息倾倒。' },
      { key:'interact',  label:'小互动', uiHint:'引入一个活物或熟识的人，几句最简往来，让画面活起来。', note:'借一个活物或熟识的人带出极简对话的细微往来', aiDirective:'必须借具体活物或熟人带出一段日常互动、对话点到为止；禁止空泛寒暄、禁止长篇对话独白。' },
      { key:'misunder',  label:'小误会', uiHint:'一次轻微又双向的理解偏差，带起一点克制的小波澜。', note:'一次双向无恶意的轻微误解，读者是"早知道"的知情者', aiDirective:'必须设计成双向无恶意的轻微偏差、并让读者处于知情位置制造张力；禁止让误会失控成激烈对立或长时间冷场。' },
      { key:'heart',     label:'谈心推进', uiHint:'借一件共同的琐事把两人推近，走到情感破冰的一刻。', note:'借外在事件（雨/食事/修葺等）促成靠近，推动一次真心交流', aiDirective:'必须用一个具体外在契机把两人推近并推进一段走心对话；禁止用说教或空谈代替具体情节。' },
      { key:'warm',      label:'温馨高点', uiHint:'全段唯一的小高点，力度极轻：只写身体本能，不靠告白。', note:'本段唯一高点但力度极轻：以手温/指尖/汤暖等生理细节呈现暖意', aiDirective:'必须以极轻的生理细节（心跳漏拍、耳朵发烫、低头搅汤、嘴角微弯）呈现暖意；禁止直接表白、禁止大动作煽情。' },
      { key:'glow',      label:'余味收束', uiHint:'情绪缓缓回落，镜头拉远到周遭的声音、气味与光。', note:'情绪回落，镜头拉远收进环境的声音/气味/光线，余味悠长', aiDirective:'必须让上一拍的情绪自然回落、以环境感官细节收束；禁止突然跳入新冲突。' },
      { key:'promise',   label:'明日约定', uiHint:'用一句"明天/改日"的约定或期许收章，留一个弱悬念与盼头。', note:'以一句约定/期许收章，留弱悬念与明日的延续感', aiDirective:'必须以约定/期许/承诺收章并留弱悬念与延续感；禁止封闭式总结、禁止开放式烂尾。' }
  ]},
  { id:2,  label:'双拍结构', emoji:'🔍', desc:'前头一大段慢慢铺陈（看似平淡、其实全是伏笔），最后一小段集中揭晓真相/抛出惊吓，专治悬疑惊悚推理', types:[
      { key:'hold',   label:'长段铺垫', uiHint:'前面一大段都用来铺线索、攒信息，把气氛一点点垫起来。', note:'用较长篇幅铺设线索、逐步积累信息，营造渐进的氛围', aiDirective:'必须用长篇幅连续铺设线索、逐步积累信息、营造渐进氛围；禁止情绪化辞藻堆砌、禁止段落间信息断裂。' },
      { key:'burst',  label:'揭示收束', uiHint:'结尾极短篇幅，把前面线索一次性揭示、收束，并留一句事件后果。', note:'在较短篇幅给出关键揭示并收束前面积累的线索，末尾再以一句交代事件后果或余味', aiDirective:'必须在结尾用较短篇幅对前面积累的线索给出关键揭示并收束，各线索须自洽串起；揭示收束后必须再以一句交代事件后果或余味再结束；禁止为反转引入未铺垫的新元素、禁止悬而未决、禁止揭晓后戛然而止无任何收尾。' }
  ]}
];
const BEAT_DEFAULT_ID = 5;
const BEAT_LABEL_ALL = (()=>{ const m={}; BEAT_OPTIONS.forEach(c=>c.types.forEach(t=>{ m[t.key]=t.label; })); return m; })();
const BEAT_LEGACY_LABEL = {
  rise2:'推进', after:'后果收束', turn:'转折', incident:'意外触发', hesitate:'内心犹豫', assist:'助力推进',
  resolve:'决心行动', trial:'试炼推进', core:'逼近核心', abyss:'绝境高潮', afterglow:'压力回落',
  return_turn:'再生变数', final_climax:'终局高潮', harmony:'结局收束', open:'开篇铺垫', theme:'主题铺垫',
  bg:'背景铺垫', catalyst:'变故触发', inner_turn:'内心质变', new_world:'换场推进', subline:'副线铺垫',
  easy:'轻松推进', mid_turn:'中部转折', pressure:'压力推进', dark_climax:'绝境极点', despair:'低谷重整',
  counter:'反击转折', close:'结局收束'
};
const BEAT_HINT_ALL = (()=>{ const m={}; BEAT_OPTIONS.forEach(c=>c.types.forEach(t=>{ m[t.key]=t.uiHint||''; })); return m; })();
const BEAT_ENDING = {
  key:'ending', label:'全书结局',
  uiHint:'（仅全书末章使用）收束全书主线与各主要人物归宿，给出核心冲突的最终解决与确定结局或余味，不再留悬念钩子。',
  note:'仅当该章为全书最后一章时作为末拍使用：收束全书主线、交代各主要人物归宿与冲突的最终解决（~500字）',
  aiDirective:'仅作为全书最后一章的末拍使用：必须对全书主线与各主要人物归宿作收束、给出确定结局或明确余味；禁止再留悬念钩子、禁止开放式烂尾。'
};
if(!BEAT_LABEL_ALL[BEAT_ENDING.key]) BEAT_LABEL_ALL[BEAT_ENDING.key] = BEAT_ENDING.label;   // 显示层识别「结局」拍
if(!BEAT_HINT_ALL[BEAT_ENDING.key])  BEAT_HINT_ALL[BEAT_ENDING.key]  = BEAT_ENDING.uiHint;  // 提示层识别「结局」拍
function currentBeatId(){
  const o=state.outline;
  let v = o && o.beatCount ? Number(o.beatCount) : BEAT_DEFAULT_ID;
  if(!BEAT_OPTIONS.some(b=>b.id===v)) v = BEAT_DEFAULT_ID;
  return v;
}
function currentBeatCfg(){ return BEAT_OPTIONS.find(b=>b.id===currentBeatId()) || BEAT_OPTIONS[0]; }
function beatTypesDefs(){ return currentBeatCfg().types; }
function beatTypeKeys(){ return beatTypesDefs().map(t=>t.key); }
function beatCnt(){ return beatTypesDefs().length; }
function beatLabelFor(key){ return BEAT_LABEL_ALL[key] || BEAT_LEGACY_LABEL[key] || (()=>{ const t=beatTypesDefs().find(x=>x.key===key); return t?t.label:key; })(); }
function beatNoteFor(key){ return BEAT_HINT_ALL[key] || ''; }
function isClimaxType(key){ return /高潮|高点/.test(BEAT_LABEL_ALL[key] || key); }

const STRIP_READ_SYS_LEGACY = `你是一名长篇章节「速读梗概」撰写助手。本章梗概的最大来源是本章正文，其余（词典）仅作参考；你要做的是把本章正文压缩到约 1/3 的字数，让没耐心读完全文的读者能省时读完，却基本不失信息。
要求：
1. 只依据【本章真实正文】概括，覆盖：主要情节推进、关键对话意图、人物状态变化、情绪转折、章末悬念/钩子。
2. 可舍弃：环境描写、场景铺陈、修辞排比、次要过程性动作。
3. 不得遗漏正文中的人物、地点、专名、关键事件与因果；不得虚构正文没有的内容；不剧透下一章。
4. 目标字数约 [TARGET_ZHS] 字，请落在目标字数的 0.9–1.1 倍区间内（即 [LO_HI] 字之间）。
5. 只输出梗概正文本身，不要 markdown 代码块、不要「第N章」前缀、不要解释。`;

const STRIP_READ_SYS_PRO = `你是一位资深长篇章节「速读梗概专员」。
【核心任务】把本章正文压缩到约 1/3 字数，让没耐心读完全文的读者省时读完且基本不失信息。

【输出要求】
1. 只依据【本章真实正文】概括，覆盖：主要情节推进、关键对话意图、人物状态变化、情绪转折、章末悬念/钩子。
2. 可舍弃：环境描写、场景铺陈、修辞排比、次要过程性动作。
3. 不得遗漏正文中的人物、地点、专名、关键事件与因果；不得虚构正文没有的内容；不剧透下一章。
4. 目标字数 [TARGET_ZHS] 字，必须落在 [LO_HI] 字之间（目标字数的 0.9–1.1 倍）。
5. 只输出梗概正文本身，不要 markdown 代码块、不要「第N章」前缀、不要解释。

【失败处理】
若无法达到字数区间，请在输出末尾附加单行：<!-- STRIP_LEN: 实际字数 -->，程序将捕获并提示用户。`;

const STRIP_READ_SYS = STRIP_READ_SYS_PRO;

function validateStripLen(text, target){
  const len = countWords(String(text||'')).cjk;
  const lo = Math.round(target * 0.9);
  const hi = Math.round(target * 1.1);
  return { ok: len >= lo && len <= hi, len, lo, hi };
}

const AIValidators = {
  idea: validateIdeaProOutput,
  titles: validateTitleOutput,
  subplot: validateSubplotOutput,
    glossary: validateGlossaryExtract,
    strip: validateStripLen,
    dictmaster: validateDictMasterOutput
};

function ideaKeyTerms(idea){
  const t = String(idea||'').trim();
  const coined = new Set(), soft = new Set();
  (t.match(/[“"「『《]([^”"」』》]{1,12})[”"」』》]/g)||[]).forEach(s=>{ const w=s.slice(1,-1).trim(); if(w) coined.add(w); });
  const words = t.match(/[\u4e00-\u9fa5a-zA-Z0-9]{2,8}/g)||[];
  const STOP = new Set(['一个','一种','这个','那个','什么','怎么','可以','我们','他们','自己','故事','主角','因为','所以','但是','然后','就是','不是','也是','也要','就会','就要','才能','只能','只会','还要','都会','都在','其实','虽然','甚至','以及','或许','几乎','感觉','知道','发现','以为','如果','但是','可能','只是','因为','于是','可是','不是','没有','着','却','就']);
  const freq = {}; words.forEach(w=>{ if(!STOP.has(w)) freq[w]=(freq[w]||0)+1; });
  Object.keys(freq).forEach(w=>{ if(freq[w]>=2) (coined.has(w) ? coined : soft).add(w); });
  const short = t.length < 15;
  return { coined:[...coined], soft:[...soft], short };
}
function validateIdeaFaithful(j, idea){
  const { coined, soft, short } = ideaKeyTerms(idea);
  if(short || (!coined.length && !soft.length)) return '';       // 极短/无关键词：豁免
  const blob = JSON.stringify(j);
  const missC = coined.filter(w => !blob.includes(w));
  const missS = soft.filter(w => !blob.includes(w));
  const total = coined.length + soft.length;
  if(missC.length >= 2){
    return `未保留用户核心专名（丢 ${missC.length}/${coined.length}）：${missC.slice(0,5).join('、')}`;
  }
  if(total && (missC.length + missS.length) > Math.ceil(total * 2 / 3)){
    return `核心设定词命中率偏低（丢 ${missC.length + missS.length}/${total}）：${(missC.concat(missS)).slice(0,5).join('、')}`;
  }
  return '';
}
function validateIdeaProOutput(j, ctx){
  if(j === null || j === undefined) return {ok:true};          // 纯文本无 JSON：放行
  if(typeof j !== 'object') return {ok:false, code:'EMPTY'};   // 非 null 但非对象（罕见脏数据）仍拒
  if(j.brief && typeof j.brief === 'object'){
    return {ok:true};
  }
  if(Array.isArray(j.options) && j.options.length){
    return {ok:true};
  }
  const err = validatePolishOutput(j);
  return err ? {ok:false, code:'SCHEMA', details:err} : {ok:true};
}

function validateAIOutput(kind, raw, ctx){
  const j = extractJsonObject(raw);
  if(j && j.error) return {ok:false, code:'AI_ERROR', details:j.error};
  const fn = AIValidators[kind];
  if(!fn) return {ok:true};
  const arg = (kind === 'chapter' || kind === 'strip') ? raw : j;
  const r = fn(arg, ctx);
  if(r && typeof r === 'object' && 'ok' in r) return r;                       // {ok} 对象约定
  if(typeof r === 'string') return r ? {ok:false, code:'SCHEMA', details:r} : {ok:true};
  return r ? {ok:false, code:'SCHEMA', details:String(r)} : {ok:true};
}

async function callAIGuarded(kind, systemOrExtra, userOrOpts, ctx, opts){
  const _tmKey = TM_KEYS.includes(kind) ? kind : null;
  const _unwrap = (res) => {
    const txt = unwrapAIResult(res);
    if(res && res.finishReason === 'length'){
      throw new Error(`${kind} AI 输出被截断，请增大输出上限或减少篇幅后重试`);
    }
    return txt;
  };
  if(typeof systemOrExtra === 'string'){
    const txt = _unwrap(await callDeepSeek(systemOrExtra, userOrOpts, Object.assign({}, opts||{}, _tmKey?{taskKey:_tmKey}:{})));
    const report = validateAIOutput(kind, txt, ctx);
    if(!report.ok){
      throw new Error(`${kind} AI 输出校验失败：${report.code} ${report.details || ''}`);
    }
    return txt;
  }
  const extra = systemOrExtra || {};
  const callOpts = Object.assign({}, userOrOpts||{}, _tmKey?{taskKey:_tmKey}:{});
  const system = getSystemPrompt(kind, extra);
  const user = buildAIPrompt(kind, extra);
  const busCtx = AIBus.get(kind, extra);
  const txt = _unwrap(await callDeepSeek(system, user, callOpts));
  const report = validateAIOutput(kind, txt, busCtx);
  if(!report.ok){
    throw new Error(`${kind} AI 输出校验失败：${report.code} ${report.details || ''}`);
  }
  return txt;
}

const AIBus = {
  get(kind, extra){
    const o = state.outline || {};
    const nb = o.navBeacon || '';
    const base = {
      mode: state.mode,
      longMode: isLong(),
      navBeacon: nb,
      idea: state.idea || ''
    };
    switch(kind){
      case 'idea': return { ...base, rawIdea: state.idea || '' };
      case 'titles': return { ...base, outline: o, glossary: o.glossary, expectedN: extra?.n || (o.chapters||[]).length };
      case 'chapter': return this._chapterCtx(extra?.idx);
      case 'subplot': return { ...base, chapterIdx: extra?.idx, content: state.chapters[extra?.idx]?.content, prevLog: (o.glossary?.subplots)||[] };
      case 'glossary': return { ...base, chapterIdx: extra?.idx, content: state.chapters[extra?.idx]?.content, existingGlossary: o.glossary };
      case 'strip': return { ...base, chapterIdx: extra?.idx, content: state.chapters[extra?.idx]?.content, targetZhs: extra?.targetZhs };
      case 'dictmaster': return { ...base, outline: o, candidate: (selectedPolishCandidate && selectedPolishCandidate()) || null };
      default: return base;
    }
  },

  _chapterCtx(idx){
    const o = state.outline || {};
    const c = state.chapters[idx];
    const prev = state.chapters[idx-1];
    const next = state.chapters[idx+1];
    const plan = (o.chapterPlans||[])[idx] || {};
    return {
      mode: state.mode, longMode: isLong(),
      navBeacon: o.navBeacon || '',
      L1_outline: { title: o.title, logline: o.logline, tone: o.tone, total: (o.chapters||[]).length, idx: idx+1 },
      L2_chapter: { title: c?.title, beatsText: (plan && String(plan.beatsText||'').trim()) ? plan.beatsText : '', emotionalArc: plan.emotionalArc, requiredEntities: plan.requiredEntities },
      L3_neighbor: { prevTitle: prev?.title, prevTail: prev?.content?.slice(-300), nextTitle: next?.title, lastScene: o._factCard?.lastScene },
      L4_context: { rollingSummaries: buildRollingSummary(idx), relevantGlossary: relevantGlossaryForChapter(idx) }
    };
  }
};

function getSystemPrompt(kind, extra){
  switch(kind){
    case 'idea': return IDEA_POLISH_SYS + (extra && extra.multi ? POLISH_MULTI_MODE : '');
    case 'titles': return REGEN_TITLES_SYS;
    case 'chapter': return longChapterSys();
    case 'subplot': return SUBPROGRESS_UPDATE_SYS;
    case 'glossary': return GLOSSARY_EXTRACT_SYS;
    case 'dictmaster': return DICTMASTER_SYS;
    case 'strip': {
      const ctx = AIBus.get('strip', extra);
      const target = ctx.targetZhs || 300;
      const lo = Math.round(target*0.9), hi = Math.round(target*1.1);
      return STRIP_READ_SYS.replace('[TARGET_ZHS]', target).replace('[LO_HI]', `${lo}–${hi}`);
    }
    default: throw new Error('未知 AI kind: '+kind);
  }
}

function buildAIPrompt(kind, extra){
  const ctx = AIBus.get(kind, extra);
  switch(kind){
    case 'idea': return buildIdeaPolishUser(ctx);
    case 'titles': return titlesGenUser(extra);
    case 'chapter': return buildChapterUser(extra?.idx, extra);
    case 'subplot': return buildSubplotUser(ctx);
    case 'glossary': return buildGlossaryExtractUser(ctx);
    case 'dictmaster': return buildDictMasterUser(ctx);
    case 'strip': return buildStripUser(ctx);
    default: throw new Error('未知 AI kind: '+kind);
  }
}

function buildIdeaPolishUser(ctx){
  const lines = [`【用户构想】\n${String(ctx.rawIdea || '').trim()}`];
  const wsItems = wsGroupStyleTags(null);
  if(wsItems && wsItems.length){
    const names = wsItems.map(s=>s.name).join(' + ');
    const details = wsItems.map(s=> `· ${s.name}：${s.note||''}${Array.isArray(s.tips)&&s.tips.length?`（写法：${s.tips.join('；')}）`:''}`).join('\n');
    lines.push(`【用户已锁定的写作风格（所有方案必须严格服从的最高基准）】\n已选定风格：${names}\n风格核心要求：\n${details}\n【硬性要求】本次生成的全部方案中，「风格」字段及行文基调都必须严格以用户选定的上述写作风格为核心基石；允许且鼓励在此基础上为不同方案做契合的【风格补充】（如针对该方案特色的细节侧重、氛围点缀），但补充的风格必须与用户已选定的主风格完全和谐、绝不冲突违和。`);
  }
  const bb = currentBookBeatCfg();
  const mb = currentBeatCfg();
  const cc = chapterCountVal();
  const parts = [];
  if(bb) parts.push(`全书拍子·${bb.label}（${bb.subtitle}）\n阶段：${((bb.ai && bb.ai.stages) || []).join(' → ')}`);
  if(mb) parts.push(`章节微拍·${mb.label}${mb.wc ? `（${mb.wc}）` : ''}`);
  if(cc) parts.push(`全书章节数：${cc} 章`);
  if(cc){
    const plan = bookStagePlan(cc);
    if(plan && plan.length){
      const seg = []; let cur = 0;
      plan.forEach(p=>{ const a = cur + 1; cur += p.n; seg.push(`第 ${a}—${cur} 章「${p.name}」`); });
      parts.push(`【章节↔全书拍子落位】全书 ${cc} 章按当前拍子解析为 ${plan.length} 段：${seg.join('；')}`);
    }
  }
  const tb = teamShapeBrief();
  if(tb) parts.push(tb);
  if(parts.length) lines.push(`【已选叙事结构】\n${parts.join('\n\n')}`);
  return lines.join('\n\n');
}
function buildSubplotUser(ctx){
  const chIdx = ctx.chapterIdx;
  const body = String(ctx.content || '').trim();
  const o = state.outline || {};
  const g = (o.glossary) || {};
  const subs = (Array.isArray(g.subplots)?g.subplots:[]).filter(Boolean);
  const prog = subs.map(s=>{
    const nm = String(s.name||'').trim() || '（未命名）';
    const ts = (Array.isArray(s.log)?s.log:[]).map(x=>`第${x.ch}章${x.note?`（${x.note.trim()}）`:''}`).join(' → ');
    const q = String(s.question||'').trim();
    return `· ${nm}（${['进行中','搁置','已收束'].includes(s.status)?s.status:'进行中'}）${q?`｜问：${q}`:''}\n  ${ts||'（尚无进度）'}`;
  }).join('\n') || '（暂无副线）';
  return `【本章正文（第 ${chIdx+1} 章）】\n${String(body).slice(-50000)}\n\n【现有副线进度】\n${prog}`;
}
function buildGlossaryExtractUser(ctx){
  const o = state.outline || {};
  const g = (o.glossary) || {};
  const dict = [['characters','人物'],['places','地点'],['propernouns','专名']].map(([k,label])=>{
    const arr = (g[k]||[]).map(x=>x&&x.name).filter(Boolean);
    return arr.length ? `${label}：${arr.join('、')}` : `${label}：（无）`;
  }).join('\n');
  return `【现有词典】\n${dict}\n\n【本章正文】\n${String(ctx.content||'').slice(-50000)}`;
}
function buildStripUser(ctx){
  const chIdx = ctx.chapterIdx;
  const o = state.outline || {};
  const body = String(ctx.content||'').trim();
  return `【本章真实正文】\n${body.slice(-50000) || '（本章暂无正文）'}`;
}



function canRunAI(kind){
  const deps = {
    idea: [],
    recipe: [],
    outline: ['idea'],
    titles: ['outline'],
    chapterPlan: ['outline','titles'],
    chapter: ['outline','titles','chapterPlan'],
    subplot: ['chapter'],
    glossary: ['chapter'],
    strip: ['chapter']
  };
  const net = state.aiNetwork;
  return (deps[kind]||[]).every(d => d === 'idea' || net.completed?.includes(d) || d === kind);
}

function markAIRunning(kind){
  state.aiNetwork.running = Array.from(new Set([...(state.aiNetwork.running||[]), kind]));
  persist();
}

function markAIDone(kind){
  state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!==kind);
  state.aiNetwork.completed = Array.from(new Set([...(state.aiNetwork.completed||[]), kind]));
  persist();
}

function addToFixQueue(entry){
  state._fixQueue = state._fixQueue || [];
  if(entry && Number.isInteger(entry.ch)){
    const exist = state._fixQueue.find(x => x.ch === entry.ch);
    if(exist){ exist.attempts = (exist.attempts||1) + 1; exist.ts = Date.now(); }
    else state._fixQueue.push({ ch:entry.ch, code:entry.code, errors:entry.errors||[], attempts:1, ts:Date.now() });
  } else if(entry && entry.kind){
    const exist = state._fixQueue.find(x => x.kind === entry.kind && !Number.isInteger(x.ch));
    if(exist){ exist.error = entry.error; exist.attempts = (exist.attempts||1)+1; exist.ts = Date.now(); }
    else state._fixQueue.push({ kind:entry.kind, error:entry.error, raw:entry.raw||'', attempts:1, ts:Date.now() });
  }
  persist();
}

const LANG_LAYER_SYS = `【语言分层（硬约束）】
可读性自检：逐句自问"读者需要拐弯才能懂吗？"需要即改大白话。`;

function langLayerInjection(){
  if(!isLong() || !state.langLayer) return '';
  return '\n\n' + LANG_LAYER_SYS;
}

const NARRATIVE_IRON_HARD = `〔硬约束 · 铁律，不可逾越，冲突时以此为准〕
· 禁止直接叙述人物内心情绪。禁止出现直白内心描写；必须改用动作、微表情、下意识小动作来外显情绪，但外显所用意象必须克制且不重复：同章内同一种微表情/小动作（如 咬牙、攥拳、拧眉、垂眸、绞手）最多出现一次，全书不得反复堆同一套动作当情绪标签。
· 禁止频繁使用网文模板词（倏然、眸光、眼底、凤眸、邪魅一笑、轻嗤）。同章内同类模板词必须最多出现一次，能删必修。
· 对白必须口语化，禁止「端着」的书面腔台词。允许半截话、吐槽、短暂停顿；古风也必须写现代人能读懂的「人话」，例：写「我瞧着这事不妥」，禁止写「吾观此事实为不妥」。
· 人物行为必须有清晰动机，禁止无故推进剧情。禁止过度美化人物：言行必须与境界相符，允许小瑕疵、怯懦、私心、口误。
· 书面语是藏起来的底牌：旁白可按题材适度书面，但对白必须口语；书面语必须只在超大高潮、深情告白、终极顿悟时用来「提咖」，禁止在赶路、打斗、系统提示等快节奏场景滥用。`;

const NARRATIVE_IRON_SOFT = `〔软约束 · 尽力而为、随题材微调〕
· 可给核心人物绑定 1-2 个专属口头禅，写到自然出现、不刻意。
· 生活化细碎细节（真实毛边）应随情节自然分布：只在能推进氛围/塑造人物时出现，禁止为凑数量而每章硬塞、禁止同一种细节反复复用。
· 语言底色必须随题材稳定贯穿全书，禁止中途漂移：都市/网游/沙雕→贴近生活口语；仙侠/红楼风→适度书面高级感。
· 快节奏场景必须优先大白话短句，禁止绕弯长句，保证读者一目十行不卡壳。`;

function narrativeIronBlock(role, opts){
  const parts = [];
  const ban = banListBlockFor(role);
  if(ban) parts.push(ban);
  if(role === 'chapter'){
    const lang = langLayerInjection();
    if(lang) parts.push(lang);
  }
  const sep = '\n\n';
  opts = opts || {};
  if(opts.lean){
    const head = '【规划纪律（精简）】节拍事件须有清晰动机、禁止无故推进剧情、禁止各章事件雷同或套模板。';
    return parts.filter(Boolean).length ? sep + head + '\n' + parts.join('\n') : head;
  }
  if(state._narrIron === false){
    const block = parts.filter(Boolean).join('\n');
    return block ? sep + '【叙事纪律（铁律已关闭，仅保留禁则/语言分层等中间件）】\n' + block : '';
  }
  const iron = role === 'chapter' ? NARRATIVE_IRON_HARD + '\n' + NARRATIVE_IRON_SOFT : NARRATIVE_IRON_HARD;
  let ironFull = iron;
  if(role === 'chapter' && shapeKind() === 'team'){
    ironFull += '\n【团队铁律】本书为团队叙事，核心团各成员凡在本章出场就必须有"存在性"——有对话、有动作、或有专属于该成员的反应/细节，不得被写成背景板或纯提线木偶；禁止主角一人单刷全篇、队友全程挂机——凡危机须体现靠成员互补能力/配合拆解；多人对话要有可辨识的声口与立场，避免把多条声音堆成一片没有区别的对白。';
  } else if(role === 'chapter' && shapeKind() === 'dual'){
    ironFull += '\n【双主角铁律】本书为双主角叙事，两名主角各有独立行动场景与弧线：本章凡涉及双主角，须给双方各自实质性的镜头与推进，不得把某一方写成另一方的附庸/背景；双视角切换必须有明确触发点与衔接（换场景/换段），禁止在同一场景内无节制的视角跳转；两人同场时，其对视/争执/配合要写得有张力与辨识声口。';
  }
  if(role === 'chapter'){
    ironFull += '\n【章首铁律】章首开法**必须**有变化：**禁止**全书或连续多章重复同一种开法、**禁止**每章都以同一类人物动作或同一类时间词起句、也**禁止**连续两章雷同，小说整体**禁止**某一种开法超过三成。下面各方式**可以**混用、**必须**轮流换着来：①续写式（优先）：优先从上一章结局未完成的对话/动作/悬念切入（承接细则以该章承接任务书为准）；例："『这话可说不得。』上回话到一半，屋里便只剩扇子敲桌沿的声响。"；②场景/环境式：从能即时带出情绪与冲突的场景细节/物件/光线/动静切入，人物稍后才点名；例："檐角铜铃被夜风拨响时，堂屋的灯还亮着，桌上摊着两封未拆的信。"；③人物开句式：以人物称谓开句**可以**，但须与前后章错开、**禁止**连续两章相同；④时间开句式：以时间词开句**可以**，但**禁止**连续两章都用时间词开句；⑤他人/群像式：从他人口中或反应侧写入物处境，出场人物不占句首；例："『那人的名讳一提就烫嘴。』有人压着嗓子嘀咕。"；⑥悬念回接式：以章末钩子的延续、一句质问或一个反常细节起首；例："那封密信最终会不会落到衙门手中，成了压在每个人心口的石头。"';
  }
  if(role === 'chapter'){
    ironFull += '\n【视角与反剧透铁律】全章以主角的受限感知推进：只写主角能\/看到听到摸到感知到的；想表现他人内心，一律从主角的观察与推断出发，禁止直接钻进路人\/配角\/反派的内心"读心"。禁止提前揭示读者与主角尚不该知道的答案：伏笔只许一笔带过地埋伏笔，不点破、不解释、不揭示答案（不剥夺读者的"侦探权"）。背景\/世界观\/前史情报必须"寄生"在角色的即时感官里（听\/闻\/触）传达，禁止作者跳出来大段广播。仅在章\/节分界明显、或关键时刻"只展示不解释"的客观动作、或悬念兑现时，才可短暂切出并立即回到主角。';
  }
  const head = role === 'chapter'
    ? '【叙事铁律 · 本章写作总纲】'
    : '【叙事铁律 · 规划纪律总纲】（禁止项同样约束规划阶段的设计）';
  return sep + head + '\n' + parts.filter(Boolean).join('\n') + '\n' + ironFull;
}

const REGEN_TITLES_SYS_LEGACY = `你是一位深谙标题艺术与长篇小说结构的章节标题策划师。

【核心任务】
根据小说书名、简介、导航灯塔（navBeacon）、设定词典，为每一章生成一个既有表现力又服从全书节奏的标题。

【输出格式】
严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"titles":["第1章 标题","第2章 标题",...]}

【硬性约束】
1. titles 数量必须严格等于【全书章节数 N】，一章不增、一章不减。
2. 每个标题必须满足：
   a. 与本书简介、navBeacon.coreConflict 保持一致；
   b. 不剧透后续反转与结局；
   c. 不引入设定词典之外的新人物/地名/专名；
   d. 立意从本作独特设定推导，避免"xx之怒/惊变/震惊"式流水线命名。
3. 标题必须服从全书节奏：贴合本章当前的叙事推进职责，不得提前透露后续阶段剧情。
4. 若用户提供了【标题风格】（归纳/画龙点睛/文学语句/字数工整），所有标题必须统一服从该风格；若提供了多种风格，以第一个为准。
5. 若用户提供了【重生成要求】，以该要求为最高优先级，但不得违反设定一致性。
6. 相邻标题不得重名或高度相似；同一核心意象全书使用不超过 3 次。
7. 每个标题 ≤ 20 字。`;

const REGEN_TITLES_SYS_PRO = `你是一位资深长篇小说「章节标题策展人」，同时是标题审计师。
【核心任务】根据给定的小说信息，在【不改变章节数量与顺序】的前提下，为每一章生成一版最终标题。

【输出格式（纯文本 · 一个标题一行）】
第1章 标题
第2章 标题
……
第N章 标题
（N 为章节总数，由用户提示给定）

【标题生成契约】
1. 每行一个标题，必须以「第N章 」开头（N 为阿拉伯数字），后接空格，再接章节名；行数必须严格等于章节总数，一章不多、一章不少。
2. 每个标题名 ≤18 字。
3. 标题必须：贴合本章剧情走向、不剧透后续反转、不泄露结局、不与相邻章标题重名或高度相似。
4. 标题风格必须贴合【所选方案蓝本】中的「风格 / 基调 / 核心词」与【写作风格】；若风格为「冷峻克制」，标题不得煽情；若风格为「热血燃向」，标题不得过于婉约。
5. 标题中不得引入设定词典以外的新人名/地名/专名。
6. 只输出上述纯文本，不要 JSON、不要 markdown 代码块、不要任何解释与前缀后缀。

【输出示例】
第1章 雾中第七日
第2章 旧信
第3章 退休法医`;

const REGEN_TITLES_SYS = REGEN_TITLES_SYS_PRO;


const IDEA_POLISH_SYS_PRO =  `你是一位深谙网文与影视叙事的构想编辑。
【核心任务】把用户输入的粗糙故事构想，优化成一份"字段化简报"——每版都必须先给出一个可直接使用的书名，再按下面固定的 7 个字段逐项列出，保留用户全部原始意图、补全可推导的具体细节，让后续大纲 AI 能逐字段直接引用、零翻译损耗。
【硬性约束】
0. 输入极短（少于 15 字，仅题材/方向词，如"穿越文""重生复仇""校园"）时：切换到「骨架展开模式」——按该题材经典类型惯例，仍按下述 7 字段框架生成一份通用化报，必须在该报最上方标注"（基于题材惯例的通用展开，非用户原话）"，末尾附一行"💡 建议补充：主角身份？核心设定/金手指？结构阶段？风格基调？——补充后再优化效果更好"；不得把骨架表述成用户提供的、不得声称唯一写法。
1. 绝不删减、篡改用户明确表达的内容（题材/元素/风格都须保留），只能在原意上细化；
2. 不替用户新增故事设定（不凭空加角色/势力/冲突/金手指），只补全"可推导的通用细节"；
3. 严格按下述【输出格式】的 8 个字段分点输出：固定标签、固定顺序，每字段占一行"标签：内容"，不要新增其它大标题；首项「书名」必须具体可直接用作最终书名（若你更有把握，可在同一行内用 / 另列 2-3 个备选），且须切中本作的题材与核心冲突/主角钩点、避免《重生之xxx》《xxx系统》《xxx的xxx》这类高频套路名；每字段须给出具体、可执行的实质内容，禁止留空、禁止笼统一句话；"核心词"字段必须收列用户在构想里用引号标出的专名与固定短语（无则写"无"）；
4. ★【写作风格继承与和谐补充（核心红线）】：若上方【用户构想】中提供了【用户已锁定的写作风格】，则生成的所有方案（包括多方案的每个候选）中，「风格」字段必须严格以用户选定的该写作风格为主基准/核心，绝不可擅自替换或背离；在此前提下，每一版方案可在该选定风格的基础上进行该方案专属的【风格补充】（如针对该方案题材特性的视点微调、冷峻/温情细节侧重、节奏快慢点缀等），但补充的风格必须与用户选定的主风格高度和谐、融洽自洽、绝不相冲违和；若用户未指定风格，则按构想基调给出契合风格并给出 2-3 个落地方式；
5. 全报告 180-360 字：除下述 8 个字段外，不要解释、不要引子、不要 markdown 代码块、不要输出 JSON；末尾可附一行以"💡"开头的编辑建议（可选，不计入字段）。
【输出格式】
书名（全书标题：1 个主选即可，可用 / 在同行附 2-3 个备选；≤12 字；须切中题材与核心冲突/主角钩点，避免《重生之xxx》《xxx系统》《xxx的xxx》高频套路名；直接可用作最终书名）：…
题材（时代/类型基调）：…
主角（身份/目标/核心缺陷/钩点）：…
核心冲突（全书的引擎：谁与什么冲突、为何难解）：…
结构（全书阶段与大致比例：若上方【用户构想】后已给出【已选叙事结构】（含全书拍子阶段/章节微拍/章节数/【章节↔全书拍子落位】），全书阶段必须严格贴合该落位给出的"第 N—M 章「阶段名」"划分、与该拍子贯通，勿自创一套不相容的分段；未给出则按一般起承转合给出比例）：…
团队（仅当上方已给出【叙事主体·团队】时必填，否则整行省略：主心骨是谁 + 每位成员的定位/能力担当 + 成员间化学反应与暗流 + "为什么必须组队"即缺一不可的理由）：…
风格（用户选定的主写作风格 + 契合该方案特性的和谐风格补充 + 2-3 个具体落地方式）：…
目标（想带给读者的体验）：…
核心词（必须原样保留入书名/简介/锚点的专名与固定短语，用引号括起）：…
【自由发挥区】各字段措辞与补充方向由你把握：若构想含预设外的核心题材（金手指/感情线/谜题/势力格局/无限流/种田等），可在末尾补一个"情节/设定补充：…"字段（≤2 项）承载同类信息，保持 7 字段在前、补充在后，让化报读起来具体、可执行、贴合原意。`;

const IDEA_POLISH_SYS = IDEA_POLISH_SYS_PRO;

const POLISH_MULTI_MODE = `\n\n【本次输出模式：多方案】在上述要求基础上，围绕一个固定的「五个方向候选池」来设计优化构想。五个方向定义如下：
· 稳健商业向——市场验证过的爽点结构，节奏稳、可长期追读；卖点是"稳"且"爽"。
· 高概念反差向——一个强反差的核心设定/金手指撑起全篇；卖点是概念本身的新奇（身份、世界观与常规预期的错位）。
· 情感人物向——以人物情感、羁绊、成长为核心驱动；卖点是"人"与"情"的浓度。
· 悬疑智斗向——靠信息差与严密逻辑链制造"颅内高潮"，读者追更想看主角怎么破局；卖点是烧脑解谜。
· 轻松日常/沙雕向——解压的情绪按摩，靠反差萌与吐槽感让人嘴角上扬；卖点是轻松解压、适合短视频化传播。

★【所有多方案的风格继承与补充要求】：无论 5 个方向方案（稳健商业向/高概念反差向/情感人物向/悬疑智斗向/轻松日常向）各自侧重何种剧情与卖点，所有方案的「风格」字段都必须严格服从并使用用户前面选定的写作风格作为主基石，并在其基础上做不相冲、不违和的风格特色补充（如：主风格为「冷峻硬汉+侦探白描」，稳健向可在其基础上补充「紧凑凌厉的线索切片」，情感向可补充「克制深沉的眼神细节」，轻松向可补充「冷面幽默与黑色反差吐槽」，绝不可直接抛弃主风格去写浮夸甜宠等相悖风格）。

每一版都必须足够具体、可执行，并尽量贴合用户原意。请从这五个方向中，选择与本书题材/构想真正契合的方向各写一版：一般 3~5 版，契合几个就给几版；明显不适配该题材的方向可跳过不给；若确有五个方向都覆盖不了的极契合新方向，允许额外补一版新方向。每个方案用一行分隔符开头：「━━ 方案N：方案名 ━━」，随后是按上述结构的一段条目式构想（必须先以「书名：…」开头给出该版书名，再依次列其余字段），并在方案末尾加一行「推荐理由：…（这个方案给谁、适合什么口味；若该方向偏小众或门槛高——如悬疑智斗极费脑、轻松沙雕易同质——请如实点明其取舍）」。方案之间方向要明显拉开，各版书名务必各不相同、切中该方向；仍不要输出 JSON、不要 markdown 代码块。`;

const GLOSSARY_EXTRACT_SYS_LEGACY = `你是长篇小说设定整理助手。给定【本章正文】与【现有词典】，提取正文中出现但现有词典【未收录】的新人物、新地名、新专名。
请严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"characters":[{"name":"人名","identity":"身份/职业/社会身份","age":"岁数/年龄","gender":"性别","appearance":"外貌特征","hobby":"爱好","catchphrase":"口头禅","relation":"与该人的血缘/人际关联","trait":"性格要点"}],"places":[{"name":"地名","type":"类型","note":"设定要点"}],"propernouns":[{"name":"专名","note":"含义"}]}
规则：
1. 只提取正文中真实出现、且有明确所指（被命名）的实体；纯叙述性泛指不提取。
2. 必须与现有词典逐名去重：同名条目一律不再输出。
3. ★【人物必须输出全部 8 个字段：identity / age / gender / appearance / hobby / catchphrase / relation / trait】
   · 禁止只输出人名、禁止缺字段、禁止省略任何字段；
   · 从正文中提取该人物的身份、年龄、性别、外貌、爱好、口头禅、关系、性格等信息，正文未明说的字段按上下文合理推断后填写；
   · 实在无法推断的字段填「未知」，不得留空、不得删除该字段；
   · catchphrase（口头禅）：正文出现该人物的专属口头禅就写具体内容（如「口头禅'稳了'」），判定其没有就填「无」；
   · relation 与 identity 务必区分：身份词（捕快/市长/船女）归 identity；带"谁的"的人际关联（XX的妹妹/她的仆人）归 relation；relation 只写一句话关系摘要（≤20字），与他人多组关系的逐条明细由「人物关系表」承载，禁止堆砌多组关系。
   · ★推断须自洽：填写的 age 与履历/居住年限类设定不得矛盾（如"在此已住30年"却23岁、"18岁却已当官5年"）；子代须小于亲代；转世/穿越/长生/修仙等特殊预设可豁免，但需有对应标注。
4. 无明显新实体时输出 {"characters":[],"places":[],"propernouns":[]}。`;

const GLOSSARY_EXTRACT_SYS_PRO = `你是一位资深长篇小说「设定审计师」。
【核心任务】给定本章正文与现有词典，提取正文中出现但现有词典未收录的新人物、新地名、新专名，并做字段自洽审查。

【必须输出的 JSON 结构】
{"characters":[{"name":"人名","identity":"身份/职业/社会身份","age":"岁数/年龄","gender":"性别","appearance":"外貌特征","hobby":"爱好","catchphrase":"口头禅","relation":"与该人的血缘/人际关联","trait":"性格要点"}],"places":[{"name":"地名","type":"类型","note":"设定要点"}],"propernouns":[{"name":"专名","note":"含义"}]}

【硬性约束】
1. 只提取正文中真实出现、且有明确所指（被命名）的实体；纯叙述性泛指不提取。
2. 与现有词典逐名去重：同名条目一律不再输出。
3. 人物必须输出全部 8 个字段：identity / age / gender / appearance / hobby / catchphrase / relation / trait；禁止缺字段、留空；无法推断的字段填「未知」。catchphrase（口头禅）并非人人都有：正文出现其专属口头禅就写具体内容，判定没有则填「无」。
4. relation 与 identity 区分：身份词（捕快/市长/船女）归 identity；带"谁的"的人际关联归 relation；relation 只写一句话关系摘要（≤20字），与他人多组关系的逐条明细由「人物关系表」承载，禁止在 relation 里堆砌多组关系。
5. 字段自洽：age 与履历/居住年限不得矛盾；子代须小于亲代；特殊预设（转世/穿越/长生/修仙）可豁免但需标注。
6. 无明显新实体时输出 {"characters":[], "places":[], "propernouns":[]}。
7. 只输出上述 JSON，不要 markdown 代码块、不要解释。`;

const GLOSSARY_EXTRACT_SYS = GLOSSARY_EXTRACT_SYS_PRO;

function validateGlossaryExtract(j){
  if(!j) return {ok:false, code:'EMPTY'};
  for(const c of (j.characters || [])){
    const missing = ['name','identity','age','gender','appearance','hobby','catchphrase','relation','trait'].filter(k => !String(c[k]||'').trim());
    if(missing.length) return {ok:false, code:'CHAR_FIELD_MISSING', details: c.name};
    const nameViol = nmNameRuleViolation(String(c.name||'').trim());
    if(nameViol) return {ok:false, code:'CHAR_NAME_RULE', details: nameViol};
  }
  return {ok:true};
}

const SUBPROGRESS_UPDATE_SYS_LEGACY = `你是长篇小说副线追踪助手。给定【本章正文】与【现有副线进度】，判断本章推进、新建或收束了哪些副线。
请严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"subplots":[{"name":"副线名","status":"进行中|搁置|已收束","question":"该副线提出的核心问题","arc":{"from":"起点状态","to":"当前状态"},"pivot":"对主线的影响(有才填，没有就别写)","note":"本章进展一句话，只写本章新增，不重复旧进度，≤60字"}]}
规则：
1. 只输出本章【确有推进或新建】的副线；本章未触碰的一律不出现。
2. 已存在副线按 name 同名合并；仅当本章确实引出一条新的跨章叙事线索（有延续悬念、将多次出现）才允许新建，一次性事件/路人戏不建。
3. status 只能是三态之一：进行中 / 搁置 / 已收束，禁止其它值。
4. 首次新建某副线时尽量给出 question（该线索提出的核心问题）与 arc.from；一时给不出也要输出该副线，question 留空字符串（程序会标记"待补充"），禁止为凑数硬编问题。
5. 推进时若人物状态发生跃迁，更新 arc.to；若本章该副线与主线交织并影响主线，补 pivot（确有关联才填，绝不硬造）。
6. 当该副线的核心问题已被回答（哪怕开放式结局，如没抓到凶手但回答了追查动机）→ status 改「已收束」，note 说明它以何种方式完成闭合（回应问题 / 状态到位）。
7. 已收束的副线本章又明显复活推进 → 显式改回「进行中」再追加。
8. 与既有进度冲突时以既有进度为准，不得改写或推翻旧进度；note 只记录本章新增内容。
9. 本章无任何副线推进时输出 {"subplots":[]}。`;

const SUBPROGRESS_UPDATE_SYS_PRO = `你是一位资深长篇小说「副线审计师」。
【核心任务】阅读本章正文，判断本章推进、新建或收束了哪些副线，并以严格的 JSON 输出。

【必须输出的 JSON 结构】
{"subplots":[{"name":"副线名","status":"进行中|搁置|已收束","question":"该副线提出的核心问题（必填，≤60字）","arc":{"from":"起点状态","to":"当前状态"},"pivot":"对主线的影响（有才填，没有就空字符串）","note":"本章进展一句话，只写本章新增，≤60字"}]}

【硬性约束】
1. 只输出本章确有推进或新建的副线；未触碰的一律不出现。
2. status 只能是：进行中 / 搁置 / 已收束。其他值视为无效。
3. 首次新建某副线时尽量给出 question；给不出时输出空字符串并保留该副线，禁止硬编问题。
4. arc.from / arc.to 必须能体现状态跃迁；没有变化时两者可相同。
5. pivot 只在确实影响主线时才填；没有就空字符串，禁止硬造。
6. 与既有进度冲突时以既有进度为准，不得改写旧进度。
7. 本章无任何副线推进时输出 {"subplots":[]}。
8. 只输出 JSON，不要 markdown 代码块、不要解释。`;

const SUBPROGRESS_UPDATE_SYS = SUBPROGRESS_UPDATE_SYS_PRO;

function validateSubplotOutput(j){
  if(!j || !Array.isArray(j.subplots)) return {ok:false, code:'NOT_ARRAY'};
  for(const s of j.subplots){
    if(!['进行中','搁置','已收束'].includes(s.status)) return {ok:false, code:'BAD_STATUS'};
    if(!String(s.name||'').trim()) return {ok:false, code:'MISSING_NAME'};
    if(!String(s.question||'').trim()) return {ok:false, code:'MISSING_QUESTION'};
  }
  return {ok:true};
}






function glossaryForAI(){
  const g = (state.outline && state.outline.glossary) || {};
  const nrm = s => String(s||'').trim();
  const sortByName = arr => (arr||[]).slice().sort((a,b)=>String(a&&a.name||'').localeCompare(String(b&&b.name||''),'zh-Hans-CN'));
  const characters = sortByName(g.characters);
  const places     = sortByName(g.places);
  const propernouns= sortByName(g.propernouns);
  const repeatIn = arr => {
    const m = {};
    arr.forEach(it=>{ const n = nrm(it.name); if(n) m[n] = (m[n]||0)+1; });
    return Object.keys(m).filter(n=>m[n]>1).map(n=>({name:n, count:m[n]})).sort((a,b)=>b.count-a.count);
  };
  const tag = {characters:'人物', places:'地点', propernouns:'专名'};
  const seen = {};
  [[characters,'characters'],[places,'places'],[propernouns,'propernouns']].forEach(([arr,cat])=>{
    arr.forEach(it=>{ const n = nrm(it.name); if(n) (seen[n]=seen[n]||[]).push(cat); });
  });
  const cross = Object.keys(seen).filter(n=>seen[n].length>1).map(n=>({name:n, cats:seen[n].map(c=>tag[c])}));
  return { characters, places, propernouns, repeatIn, cross, empty: sourceHasGlossary(g) ? '' : '（无）' };
}
function glossaryDupNoteHtml(){
  const rf = glossaryForAI();
  const repLabels = {characters:'人物', places:'地点', propernouns:'专名'};
  const lines = [];
  [['characters',rf.characters],['places',rf.places],['propernouns',rf.propernouns]].forEach(([cat,arr])=>{
    const dup = rf.repeatIn(arr);
    if(dup.length) lines.push(`${repLabels[cat]}：「${dup.map(d=>`${d.name}×${d.count}`).join('」、')}」`);
  });
  if(rf.cross.length) lines.push('跨类同名：'+rf.cross.map(x=>`${x.name}（${x.cats.join('+')}）`).join('、'));
  if(!lines.length) return '';
  return `<div class="gs-panel gs-dup-note"><div class="gs-panel-title">⚠️ 重复情况检查（仅提示，未做任何删除/合并；原词典原样保留）</div>
    <pre class="gs-pre">${esc(lines.join('\n'))}</pre></div>`;
}

function chapterGlossaryBlock(curN, opts){
  const o = state.outline;
  if(!o) return '';
  opts = opts || {};
  const lean = !!opts.lean;
  if(opts.names){
    const g = (o && o.glossary) || {};
    if(!sourceHasGlossary(g)) return '';
    const rf = glossaryForAI();
    const cs = rf.characters.map(c=>String(c.name||'').trim()).filter(Boolean).join('、');
    const ws = (g.walkons||[]).map(w=>String(w.name||'').trim()).filter(Boolean).join('、');
    const ps = rf.places.map(p=>String(p.name||'').trim()).filter(Boolean).join('、');
    const pn = rf.propernouns.map(p=>String(p.name||'').trim()).filter(Boolean).join('、');
    return `【设定词典（名称清单，标题不得引入清单外的新人名/地名/专名）】\n人物：${cs||'（无）'}\n路人龙套：${ws||'（无）'}\n地点：${ps||'（无）'}\n专名：${pn||'（无）'}`;
  }
  let body = `\n\n【全局创作上下文（严格服从：有台词/有戏份、或贯穿反复出现的重要人地专名不得自造、须取用词典保持全书一致；仅作氛围的临时路人/小地名/小专名允许现场点缀一次、不入词典）】`;
  const g = (o && o.glossary) || {};
  if(sourceHasGlossary(g)){
    const rf = glossaryForAI();
    const cDetail = lean
      ? c => [c.identity?`身份:${c.identity}`:'', c.relation?`关系:${c.relation}`:''].filter(Boolean).join('；')
      : c => [c.identity?`身份:${c.identity}`:'', c.age?`岁数:${c.age}`:'', c.gender?`性别:${c.gender}`:'', c.appearance?`外貌:${c.appearance}`:'', c.hobby?`爱好:${c.hobby}`:'', (c.catchphrase&&c.catchphrase!=='无')?`口头禅:${c.catchphrase}`:'', c.relation?`关系:${c.relation}`:'', c.trait?`性格:${c.trait}`:''].filter(Boolean).join('；');
    const pDetail = p => [p.type?`类型:${p.type}`:'', p.note?`说明:${p.note}`:''].filter(Boolean).join('；');
    const cs = rf.characters.map(c=> `${c.name}${cDetail(c)?`（${cDetail(c)}）`:''}`).join('、');
    const ps = rf.places.map(p=> `${p.name}${pDetail(p)?`（${pDetail(p)}）`:''}`).join('、');
    const pn = rf.propernouns.map(p=> `${p.name}${p.note?`（${p.note}）`:''}`).join('、');
    const repLabels = {characters:'人物', places:'地点', propernouns:'专名'};
    const repeatNotes = [];
    [['characters',rf.characters],['places',rf.places],['propernouns',rf.propernouns]].forEach(([cat,arr])=>{
      const dup = rf.repeatIn(arr);
      if(dup.length) repeatNotes.push(`${repLabels[cat]}：${dup.map(d=>`「${d.name}」×${d.count}`).join('、')}`);
    });
    const repeatNote = repeatNotes.length ? `\n【词典同名提示（非删除，仅供知悉）】以下名称在同一类别中出现多次，均按原样保留：${repeatNotes.join('；')}` : '';
    const crossNote = rf.cross.length ? `\n【跨类同名提示】以下名称在多类中出现（系同一实体分属多类，原样保留，不要当成两条新增，也不要据此另造新名）：${rf.cross.map(x=>`${x.name}（${x.cats.join('+')}）`).join('、')}` : '';
    body += `\n·【设定词典】（给定的人/地/专名，正文一律采用：凡有台词/有戏份、或贯穿反复出现的人地专名务必取用本词典并保持全书一致，禁止另起炉灶自造核心名；仅作氛围的临时路人/小地名/小专名不在此限——可现场点缀一次、不入词典。人物关系/性格、地点类型、专名含义按此统一）\n人物：${cs||'（无）'}\n地点：${ps||'（无）'}\n专名：${pn||'（无）'}${repeatNote}${crossNote}`;
    const wk = (g.walkons||[]).filter(w=>String(w&&w.name||'').trim()).map(w=>`${String(w.name).trim()}${String(w&&w.note||'').trim()?`（${String(w.note).trim()}）`:''}`).join('、');
    if(wk) body += `\n·【路人龙套】（词典充实新增的闲人：只说一句台词、只露一个镜头即可，无需塑造九维；写到相关场景（街市/酒肆/夜巡/围观/办事）时就近选用登场，让群像鲜活，避免整章主角独角戏。此清单之外，允许正文为个别氛围当场自拟"临时闲人"——规则见正文【临时闲人】段）\n${wk}`;
    const relTable = validAssoc(g._relationshipTable,'a','b').map(x=>`${x.a} ←${x.relation||'？'}→ ${x.b}${x.note?`（${x.note}）`:''}`).filter(Boolean).join('；');
    const pcTable  = validAssoc(g._placeContacts,'from','to').map(x=>`${x.from} ↔ ${x.to}${x.relation?`（${x.relation}）`:''}${x.note?`：${x.note}`:''}`).filter(Boolean).join('；');
    const prcTable = validAssoc(g._properContacts,'from','to').map(x=>`${x.from} ↔ ${x.to}${x.relation?`（${x.relation}）`:''}${x.note?`：${x.note}`:''}`).filter(Boolean).join('；');
    if(relTable) body += `\n·【重要人物关系】（正文人物关系/立场须与此一致）\n${relTable}`;
    if(pcTable)  body += `\n·【地名关联表】（地域往来/通行逻辑须与此一致，只列地名与地名之间的关联）\n${pcTable}`;
    if(prcTable) body += `\n·【专名关联表】（专名与专名、专名用法须与此一致，只列专名与专名之间的关联）\n${prcTable}`;
    const wrTable = (g._worldRules||[]).map(fmtWR).filter(Boolean).join('；');
    if(wrTable) body += `\n·【世界观规则】（本书世界实际如何运转的具体规则，正文据此写作、不得违背该世界逻辑：劳动作息/社会制度/力量体系/金钱物价/地理交通/秩序法则等）\n${wrTable}`;
  }
  body += subplotProgressBlock(curN);
  return body;
}
function subplotProgressBlock(curN){
  const o = state.outline; if(!o) return '';
  const g = (o.glossary) || {};
  const subs = (Array.isArray(g.subplots) ? g.subplots : []).filter(Boolean);
  if(!subs.length) return '';
  const full = (o.chapters||[]).length || 1;
  const cur = (Number.isFinite(curN) && curN>0) ? curN : (o.chapters||[]).length;   // 当前章：正文生成传 i+1；规划/标题无当前章则用全书章数
  const lines = subs.map(s=>{
    const nm = String(s.name||'').trim() || '（未命名副线）';
    const st = ['进行中','搁置','已收束'].includes(s.status) ? s.status : '进行中';
    const q = String(s.question||'').trim();
    const arc = (s.arc && (s.arc.from || s.arc.to))
      ? `${s.arc.from||'？'}→${s.arc.to||'——'}`
      : '';
    const pivot = String(s.pivot||'').trim();
    const lastCh = Number.isFinite(s._lastCh) ? s._lastCh : (s.log&&s.log.length ? Math.max(...s.log.map(x=>x.ch||0)) : 0);
    const ts = (Array.isArray(s.log)?s.log:[]).map(x=>`第${x.ch}章${x.note?`（${x.note.trim()}）`:''}`).join(' → ');
    let head = `· ${nm}（${st}）`;
    if(q) head += `｜问：${q}`;
    if(arc) head += `｜态：${arc}`;
    let block = `${head}\n  ${ts||'（尚无进度记录）'}`;
    const gap = lastCh ? (cur - lastCh) : -1;
    if(lastCh>0 && gap > full * state.subRecallRatio){
      block += `\n  ⚠ 本条已消失超全书 ${Math.round(state.subRecallRatio*100)}%（约 ${gap} 章未出现），读者可能淡忘：本章若回归，必须先用 ≤20 字一句话轻提前情，再续写。`;
    }
    if(pivot) block += `\n  蝴蝶效应：${pivot}`;
    return block;
  }).join('\n');
  return `\n\n【副线进度（截至第 ${cur} 章）】\n${lines}\n【副线创作契约】
· 是否推进某条副线由你判断：适合则自然写一笔；强行加入会生硬/喧宾夺主则本章不推进，正文照常。
· 回归一条消失过久的副线，开篇以 ≤20 字轻提前情，避免读者认知断裂。
· 闭环是硬性要求：副线可开放式结局（如没抓到凶手），但必须回应其【核心问题】；理想收束是完成状态 A→B 并给主线留出蝴蝶效应（见各条 pivot）。
· 未推进的副线不勉强提及；不得推翻既有进度；「已收束」的副线本章不复活（除非本章有重大理由并显式改回「进行中」）。`;
}
function checkGlossaryCoverage(){
  const g = (state.outline && state.outline.glossary) || {};
  const body = state.chapters.filter(c=>c && c.content).map(c=>String(c.content)).join('\n');
  const summary = { total:0, hit:0, chars:{used:[],unused:[]}, places:{used:[],unused:[]}, props:{used:[],unused:[]} };
  const scan = (arr, bucket)=>{
    (arr||[]).forEach(it=>{
      const nm = String(it.name||'').trim(); if(!nm) return;
      summary.total++;
      const re = new RegExp(escRe(nm), 'g');
      const n = body.match(re) ? body.match(re).length : 0;
      (n>0 ? bucket.used : bucket.unused).push({name:nm, count:n});
      if(n>0) summary.hit++;
    });
  };
  scan(g.characters, summary.chars);
  scan(g.places, summary.places);
  scan(g.propernouns, summary.props);
  return summary;
}
const CHAR_FIELDS = ['identity','age','gender','appearance','hobby','relation','trait','catchphrase'];
const CHAR_FIELD_LABEL = { identity:'身份', age:'岁数', gender:'性别', appearance:'外貌', hobby:'爱好', relation:'关系', trait:'性格', catchphrase:'口头禅' };
function completeCharFields(c){
  CHAR_FIELDS.forEach(k=>{
    if(c[k]==null || String(c[k]).trim()==='') c[k] = (k==='catchphrase') ? '无' : '未知';
  });
  return c;
}
function sanitizeGlossaryExtract(j){
  j = j || {};
  const keepChar = c => {
    if(c.name == null || !String(c.name).trim()) return null;
    const o = { name: String(c.name).trim() };
    CHAR_FIELDS.forEach(k=>{ if(c[k]!=null) o[k] = String(c[k]).trim(); });
    return completeCharFields(o);
  };
  const keepPlace = p => { const o = {}; ['name','type','note'].forEach(k=>{ if(p[k]!=null) o[k]=String(p[k]).trim(); }); return o.name ? o : null; };
  const keepProp = p => { const o = {}; ['name','note'].forEach(k=>{ if(p[k]!=null) o[k]=String(p[k]).trim(); }); return o.name ? o : null; };
  return {
    characters: (Array.isArray(j.characters)?j.characters:[]).map(keepChar).filter(Boolean),
    places:     (Array.isArray(j.places)?j.places:[]).map(keepPlace).filter(Boolean),
    propernouns:(Array.isArray(j.propernouns)?j.propernouns:[]).map(keepProp).filter(Boolean)
  };
}
async function extractNewGlossary(bodyTexts){
  const g = (state.outline && state.outline.glossary) || {};
  const allText = (bodyTexts||[]).filter(Boolean).map(String).join('\n\n');
  const _o = state.outline;
  if(_o && !_o._v45) _o._v45 = {};
  const _LIMIT = 50000;
  let body;
  if(allText.length <= _LIMIT){
    body = allText;
    if(_o) _o._v45.glossCursor = allText.length;
  }else{
    let _cur = Math.min((_o && _o._v45.glossCursor) || 0, allText.length);
    if(allText.length - _cur < _LIMIT) _cur = allText.length - _LIMIT;   // 尾部不足一窗时对齐到末窗
    body = allText.slice(_cur, _cur + _LIMIT);
    if(_o) _o._v45.glossCursor = _cur + body.length;
  }
  if(!body.trim()) return {characters:[], places:[], propernouns:[]};
  const user = buildAIPrompt('glossary', { content: body });
  const txt = unwrapAIResult(await callDeepSeek(GLOSSARY_EXTRACT_SYS, user, {maxTokens: clampMaxTokens('glossary'), temperature: resolveActiveSpec().qcTemp, topP: 0.5, taskKey:'glossary'}));
  const j = parseJson(txt) || {};
  const _glRep = validateGlossaryExtract(j);
  if(!_glRep.ok) console.warn('[词典] 输出校验未通过（不阻断）：', _glRep.code, _glRep.details||'');
  return sanitizeGlossaryExtract(j);
}
function mergeExtractedGlossary(ext, src){
  const o = state.outline; if(!o) return {c:0,p:0,k:0,total:0};
  if(!o.glossary) o.glossary = {characters:[], places:[], propernouns:[]};
  const gl = o.glossary;
  const n = {c:0, p:0, k:0, flagged:0};
  const _aliasMap = glossaryAliases();
  const mergeArr = (cur, add, tag, checkName) => {
    const have = new Set((cur||[]).map(x=>String(x&&x.name||'').trim()).filter(Boolean));
    (add||[]).forEach(it=>{
      const nm = String(it.name||'').trim(); if(!nm || have.has(nm)) return;
      if(_aliasMap.has(nm)) return;
      const nv = checkName ? nmNameRuleViolation(nm) : '';
      if(nv) n.flagged++;
      cur.push({ ...it, ...(nv?{_nameFlag:nv}:{}), _auto:true, _srcCh: (typeof src==='number'&&src>0)?src:0, _srcHow: typeof src==='string'?src:'', _srcTs: Date.now() }); have.add(nm); n[tag]++;
    });
  };
  mergeArr(gl.characters, ext.characters, 'c', true);
  mergeArr(gl.places, ext.places, 'p');
  mergeArr(gl.propernouns, ext.propernouns, 'k');
  n.total = n.c + n.p + n.k;
  return n;
}
function bindPlannerTitles(newTitles){
  const o = state.outline; if(!o) return false;
  const n = (o.chapters||[]).length;
  if(!Array.isArray(newTitles) || newTitles.length !== n) return false;
  if(syncChaptersFromOutline()) persist();
  snapshotTitleBatch('规划师定稿前');
  const applied = setAllTitles(newTitles);
  if(applied > 0){
    state.plannerFinalized = true;
    persist();
  }
  return applied > 0;
}

const SUB_STATUSES = ['进行中','搁置','已收束'];
async function extractSubplotUpdates(chIdx, content){
  const o = state.outline;
  const g = (o && o.glossary) || {};
  const body = String(content||'').trim();
  if(!body) return {subplots:[]};
  const user = buildAIPrompt('subplot', { idx: chIdx });
  const txt = unwrapAIResult(await callDeepSeek(SUBPROGRESS_UPDATE_SYS, user, {maxTokens: clampMaxTokens('json'), temperature: resolveActiveSpec().subplotTemp, topP: 0.5, taskKey:'subplot'}));
  const j = parseJson(txt) || {};
  const _subRep = validateSubplotOutput(j);
  if(!_subRep.ok) console.warn('[副线] 输出校验未通过（不阻断）：', _subRep.code, _subRep.details||'');
  const norm = (Array.isArray(j.subplots)?j.subplots:[]).map(s=>{
    const name = String(s&&s.name||'').trim(); if(!name) return null;
    const note = String(s&&s.note||'').trim();
    const o2 = {
      name,
      status: SUB_STATUSES.includes(s.status) ? s.status : '进行中',
      question: String(s.question||'').trim(),
      arc: { from: String((s.arc&&s.arc.from)||'').trim(), to: String((s.arc&&s.arc.to)||'').trim() },
      pivot: String(s.pivot||'').trim(),
      note
    };
    return o2;
  }).filter(Boolean);
  return { subplots: norm };
}
function mergeSubplotUpdates(ext, chIdx){
  const o = state.outline; if(!o) return {total:0,newCount:0,noQuestionCount:0};
  if(!o.glossary) o.glossary = {characters:[], places:[], propernouns:[]};
  const gl = o.glossary;
  if(!Array.isArray(gl.subplots)) gl.subplots = [];
  const cur = gl.subplots;
  let total=0, newCount=0, noQuestionCount=0;
  (ext&&ext.subplots||[]).forEach(s=>{
    const name = String(s.name||'').trim(); if(!name) return;
    const exist = cur.find(x=> String(x.name||'').trim() === name);
    if(!exist){
      if(!String(s.question||'').trim()){ s.question = '待补充：该副线的核心问题尚未明确'; }
      const entry = {
        name,
        status: s.status || '进行中',
        question: String(s.question).trim(),
        arc: { from: s.arc&&s.arc.from?s.arc.from:'', to: s.arc&&s.arc.to?s.arc.to:'' },
        pivot: s.pivot||'',
        log: s.note ? [{ch: chIdx, note: s.note}] : [],
        _lastCh: s.note ? chIdx : 0,
        _auto: true
      };
      cur.push(entry); total++; newCount++;
      return;
    }
    exist.status = SUB_STATUSES.includes(s.status) ? s.status : exist.status;
    if(s.question) exist.question = String(s.question).trim();
    if(s.arc && (s.arc.from||s.arc.to)){ exist.arc = exist.arc || {from:'',to:''}; if(s.arc.from) exist.arc.from = String(s.arc.from).trim(); if(s.arc.to) exist.arc.to = String(s.arc.to).trim(); }
    if(s.pivot) exist.pivot = String(s.pivot).trim();
    if(s.note){
      if(!Array.isArray(exist.log)) exist.log = [];
      const ch = chIdx; let lo=0, hi=exist.log.length;
      while(lo<hi){ const mid=(lo+hi)>>1; if((exist.log[mid].ch||0) <= ch) lo=mid+1; else hi=mid; }
      exist.log.splice(lo, 0, {ch: chIdx, note: String(s.note).trim()});
      exist._lastCh = Math.max(...exist.log.map(x=>x.ch||0));
    }
    total++;
  });
  return {total, newCount, noQuestionCount};
}
async function autoUpdateSubplots(){
  if(!isLong() || !state.subAutoFill) return;
  startBgTask();
  try{
    const o = state.outline; if(!o) return;
    if(!o.glossary) o.glossary = {characters:[], places:[], propernouns:[]};
    if(!Array.isArray(o.glossary.subplots)) o.glossary.subplots = [];
    const absorbed = Array.isArray(o.glossary._subAbsorbed) ? o.glossary._subAbsorbed : [];
    const todo = state.chapters.map((c,i)=> (c && c.content && String(c.content).trim()) ? i : -1)
      .filter(i=> i>=0 && !absorbed.includes(i)).sort((a,b)=>a-b);
    if(!todo.length) return;
    let noQ = 0, total = 0;
    try{
      for(const i of todo){
        const c = state.chapters[i];
        const ext = await extractSubplotUpdates(i, c.content);
        const n = mergeSubplotUpdates(ext, i+1);
        noQ += n.noQuestionCount; total += n.total;
        absorbed.push(i);
      }
      o.glossary._subAbsorbed = absorbed;
      if(total>0 || noQ>0) persist();
      if(noQ>0) toast(`副线追踪：${total} 条推进；${noQ} 条因缺核心问题未入库`);
      else if(total>0) toast(`副线追踪：${total} 条副线进度已更新`);
    }catch(e){ /* 静默失败，不阻塞章节生成 */ }
  }finally{ endBgTask(); }
}
function scanUnusedGlossary(){
  const s = checkGlossaryCoverage();
  const g = (state.outline && state.outline.glossary) || {};
  const withAuto = (unused, src) => (unused||[]).map(x => {
    const it = (src||[]).find(y=> String(y&&y.name||'').trim() === x.name);
    return { name: x.name, _auto: !!(it && it._auto) };
  });
  return {
    characters: withAuto(s.chars.unused, g.characters),
    places:     withAuto(s.places.unused, g.places),
    propernouns:withAuto(s.props.unused, g.propernouns)
  };
}
async function manualExtractGlossary(){
  const written = state.chapters.filter(c=> c && c.content && String(c.content).trim()).map(c=>c.content);
  if(!written.length){ toast('尚无已生成章节正文'); return; }
  toast('正在提取新增词典条目…');
  try{
    const ext = await extractNewGlossary(written);
    const n = mergeExtractedGlossary(ext, '手动提取');
    if(n.total > 0){ persist(); render(); toast(`词典已补全：+${n.c} 人物（含完整设定）、+${n.p} 地名、+${n.k} 专名`); }
    else toast('未发现词典未收录的新实体');
  }catch(e){ toast('提取失败：'+e.message); }
}
function openCleanPanel(){
  const closePanel = ()=>{ const p=$('#cleanPanel'); if(p) p.remove(); };
  const s = scanUnusedGlossary();
  const written = state.chapters.filter(c=>c && c.content && String(c.content).trim()).length;
  const row = (arr, icon) => arr.length ? arr.map(x=>`
    <label class="gs-hit"><input type="checkbox" class="gs-clean-cb" data-name="${esc(x.name)}" ${x._auto?'checked':''} />
      <span>${esc(x.name)}</span>${x._auto?'<i class="gs-auto-tag">🆕 自动补全</i>':'<i class="gs-orig-tag">原始条目</i>'}</label>`).join('') : '';
  const empty = !s.characters.length && !s.places.length && !s.propernouns.length;
  const ov = document.createElement('div');
  ov.id='cleanPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🧹 清理未使用条目</b><button class="gs-x" data-clean-close>✕</button></div>
      <div class="gs-modal-sub">已生成 ${written} 章。以下条目在全部已生成正文中均未出现，可能因重生成覆盖而失效；尚未写的章节可能仍会用到，请谨慎勾选。</div>
      <div class="gs-body">
        ${empty ? '<p class="muted">✓ 没有需要清理的条目（全部词典条目都已在正文中出现）。</p>' : `
          ${s.characters.length?`<div class="gs-q">👤 人物</div>${row(s.characters,'👤')}`:''}
          ${s.places.length?`<div class="gs-q">🏞️ 地名</div>${row(s.places,'🏞️')}`:''}
          ${s.propernouns.length?`<div class="gs-q">📌 专名</div>${row(s.propernouns,'📌')}`:''}
        `}
      </div>
      ${empty
        ? `<div class="gs-modal-head" style="justify-content:flex-end;border:none"><button class="btn ghost" data-clean-close>关闭</button></div>`
        : `<div class="gs-modal-head" style="justify-content:flex-end;border:none"><button class="btn ghost" data-clean-close>取消</button><button class="btn primary" data-clean-do>确认删除勾选项</button></div>`}
    </div>`;
  document.body.appendChild(ov);
  $$('[data-clean-close]').forEach(b=> b.onclick = closePanel);
  const doBtn = $('[data-clean-do]');
  if(doBtn) doBtn.onclick = ()=>{
    const picked = $$('.gs-clean-cb:checked').map(cb=> cb.dataset.name);
    if(!picked.length){ toast('未勾选任何条目'); return; }
    const g = state.outline && state.outline.glossary; if(!g){ closePanel(); return; }
    let c=0,p=0,k=0;
    g.characters = (g.characters||[]).filter(x=>{ if(picked.includes(String(x&&x.name||'').trim())){ c++; return false; } return true; });
    g.places     = (g.places||[]).filter(x=>{ if(picked.includes(String(x&&x.name||'').trim())){ p++; return false; } return true; });
    g.propernouns= (g.propernouns||[]).filter(x=>{ if(picked.includes(String(x&&x.name||'').trim())){ k++; return false; } return true; });
    persist(); closePanel(); render();
    toast(`已清理：-${c} 人物、-${p} 地名、-${k} 专名`);
  };
}
function openCoveragePanel(){
  closeCoveragePanel();
  const s = checkGlossaryCoverage();
  const row = (arr, icon)=> arr.length ? arr.map(x=>`<div class="cv-row ${x.count===0?'cv-zero':''}"><span class="cv-icon">${icon}</span><b>${esc(x.name)}</b><span class="cv-cnt">${x.count===0?'未用到':x.count+' 次'}</span></div>`).join('') : '';
  const pct = s.total ? Math.round(s.hit/s.total*100) : 0;
  const ov = document.createElement('div');
  ov.id='cvPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📊 词典覆盖面自检</b><button class="gs-x" data-cv-close>✕</button></div>
      <div class="gs-body">
        <p class="muted" style="margin:0 0 8px">对已在正文中出现过的章节做统计；0 次的条目可能未被使用，可考虑精简。共 ${s.total} 条 · 已覆盖 ${s.hit} 条（${pct}%）</p>
        ${s.chars.used.length||s.chars.unused.length?`<div class="cv-sec">👤 人物</div>${row(s.chars.used.concat(s.chars.unused),'👤')}`:''}
        ${s.places.used.length||s.places.unused.length?`<div class="cv-sec">📍 地点</div>${row(s.places.used.concat(s.places.unused),'📍')}`:''}
        ${s.props.used.length||s.props.unused.length?`<div class="cv-sec">🔤 专名</div>${row(s.props.used.concat(s.props.unused),'🔤')}`:''}
      </div>
      <div class="gs-actions"><button class="btn" data-cv-close>关闭</button></div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-cv-close]').forEach(b=> b.onclick = ()=>{ closeCoveragePanel(); });
  ov.addEventListener('click', e=>{ if(e.target===ov) closeCoveragePanel(); });
}
function closeCoveragePanel(){ const p=$('#cvPanel'); if(p) p.remove(); }
const TIME_ANCHOR_SYS = `你是长篇小说「章节收束时间锚」提取器。给定【本章正文】，只判断一件事：本章正文在结尾落幕时，故事落在哪条时间支线、哪个时点。
只判断【正文最后一幕】真正落到哪里；正文确实没写清时点则按第3条输出空。
请严格只输出如下 JSON（不要 markdown 代码块、不要解释）：
{"time":"支线·时点，如 现实·第2天·清晨 / 回忆·主线第1天前 / 梦境·现实第2天夜 / 穿越·主线第7天（≤14字）"}
约束：
1. 支线只能取 现实 / 回忆 / 梦境 / 穿越 之一；时点给一个自然语言表述（第N天+时段，或相对锚点）。
2. 以正文最后一段、最后一幕为准；正文有明确表述就用正文表述，正文含糊则按第3条输出空。
3. 若实在无法判断，输出 {"time":""}。`;
async function extractChapterEndTime(chIdx, content){
  const o = state.outline;
  const body = String(content||'').trim();
  if(!body) return { time: '' };
  const user = `【本章正文（第 ${chIdx+1} 章）】
${String(body).slice(-30000)}`;
  const txt = unwrapAIResult(await callDeepSeek(TIME_ANCHOR_SYS, user, {maxTokens: clampMaxTokens('json'), temperature: 0.2, topP: 0.5, taskKey:'timeAnchor'}));
  const j = parseJson(txt) || {};
  const t = String((j && j.time)||'').trim();
  return { time: t };
}
async function autoUpdateTimeAnchors(){
  if(!_timeAnchorsAutoOn()) return;
  startBgTask();
  try{
    const o = state.outline; if(!o || !o._factCard) return;
    const fc = o._factCard;
    fc.timeAnchors = fc.timeAnchors || [];
    const todo = state.chapters.map((c,i)=> (c && c.content && String(c.content).trim()) ? i : -1)
      .filter(i => i>=0 && !fc.timeAnchors.some(t => t.ch===i && t.src==='ai')).sort((a,b)=>a-b);
    let updated = 0;
    try{
      for(const i of todo){
        const c = state.chapters[i];
        const ext = await extractChapterEndTime(i, c.content);
        if(ext.time){
          fc.timeAnchors = fc.timeAnchors.filter(x => x.ch !== i);
          fc.timeAnchors.push({ ch: i, time: ext.time, src: 'ai' });
          const _gt = o._globalTimeline;
          if(_gt && Array.isArray(_gt.chapters)){
            const _gc = _gt.chapters.find(x => Number(x.index) === i);
            if(_gc && String(_gc.to||'').trim() !== String(ext.time||'').trim()){
              if(!('planTo' in _gc)) _gc.planTo = String(_gc.to||'');
              _gc.to = ext.time; _gc.realEnd = true;
            }
          }
          updated++;
        }
      }
      if(updated) persist();
      if(updated) toast(`时间锚：${updated} 章已更新真实收尾时点`);
    }catch(e){ /* 静默失败，不阻塞章节生成 */ }
  }finally{ endBgTask(); }
}

function openSubplotBoard(){
  const old = $('#subBoard'); if(old) old.remove();
  const g = (state.outline && state.outline.glossary) || {};
  const subs = (Array.isArray(g.subplots)?g.subplots:[]).filter(Boolean);
  if(!subs.length){ toast('暂无副线'); return; }
  const full = (state.outline&&state.outline.chapters||[]).length || 1;
  const cur = Math.max(0, ...(state.chapters||[]).map((c,i)=> (c && c.content && String(c.content).trim()) ? i+1 : 0));
  const ratio = Number.isFinite(state.subRecallRatio) ? state.subRecallRatio : 0.4;
  const rows = subs.map((s,i)=>{
    const nm = String(s.name||'').trim() || '（未命名）';
    const st = SUB_STATUSES.includes(s.status) ? s.status : '进行中';
    const closed = st==='已收束';
    const q = String(s.question||'').trim();
    const lastCh = Number.isFinite(s._lastCh) ? s._lastCh : (s.log&&s.log.length?Math.max(...s.log.map(x=>x.ch||0)):0);
    const gap = lastCh ? (cur-lastCh) : -1;
    const lost = lastCh>0 && gap > full*ratio;
    const statusTxt = closed ? (q ? '✅ 已收束（核心问题已回答）' : '🔒 已收束（未记录核心问题）') : (lost ? '⚠️ 未收束 · 已消失过久' : '🟢 进行中');
    const rowCls = closed ? 'sb-closed' : (lost ? 'sb-lost' : '');
    return `<div class="sb-row ${rowCls}">
      <div class="sb-head"><b>${esc(nm)}</b><span class="sb-status">${statusTxt}</span></div>
      <div class="sb-meta">${q?`问：${esc(q)}`:''}${lost?` · 距最新已生成章（第 ${cur} 章）已缺席 ${gap} 章（超全书 ${Math.round(ratio*100)}%）`:''}</div>
      <div class="sb-meta muted">${closed ? '已闭合，无需回归' : (lost ? '建议在后续章节安排一次回归并轻提前情' : '尚未收束，可继续自然推进')}</div>
    </div>`;
  }).join('');
  const ov = document.createElement('div');
  ov.id='subBoard'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🧵 副线收束看板</b><button class="gs-x" data-sb-close>✕</button></div>
      <div class="gs-body">
        <p class="muted" style="margin:0 0 8px">闭环硬性要求：副线可开放式结局，但必须回应其核心问题。消失超全书 ${Math.round(ratio*100)}% 的副线读者容易淡忘，建议安排回归（回归时 ≤20 字轻提前情）。</p>
        ${rows}
      </div>
      <div class="gs-actions"><button class="btn" data-sb-close>关闭</button></div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-sb-close]').forEach(b=> b.onclick = ()=>{ const p=$('#subBoard'); if(p) p.remove(); });
  ov.addEventListener('click', e=>{ if(e.target===ov){ const p=$('#subBoard'); if(p) p.remove(); } });
}
function openTimelineBoard(){
  const old = $('#tlBoard'); if(old) old.remove();
  const o = state.outline || {};
  const gt = o._globalTimeline;
  let body = '';
  const tlText = gt && String(gt.text||'').trim();
  if(tlText){
    body = `<div class="so-logline">${renderLoglineHtml(tlText)}</div>`;
  } else if(gt && Array.isArray(gt.chapters) && gt.chapters.length){
    const rows = gt.chapters.map(c=>{
      const t = cleanChapterTitle((o.chapters[c.index]&&o.chapters[c.index].title)||'');
      const jt = String(c.jump||'').trim();
      return `第${c.index+1}章《${t||'?'}》：${String(c.from||'?').trim()} → ${String(c.to||'?').trim()}${jt?`（跳跃：${jt}）`:''}`;
    });
    const notes = gt.notes ? `\n【节奏】${gt.notes}` : '';
    body = `<div class="so-logline">${renderLoglineHtml(rows.join('\n')+notes)}</div>`;
  } else {
    toast('暂无全局时间线（请先在④规划师生成全书时间线）');
    return;
  }
  const ov = document.createElement('div'); ov.id='tlBoard'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal" style="max-width:780px">
      <div class="gs-modal-head"><b>⏱ 全书时间线</b><button class="gs-x" data-tb-close>✕</button></div>
      <div class="gs-body">
        <p class="muted" style="margin:0 0 8px">全书跨各章的现实时间轴：首章起始 → 末章章末（单调推进）；带大跨度/跨支线的章已括号注明。</p>
        ${body || '<span class="muted">暂无可显示的时间线</span>'}
      </div>
      <div class="gs-actions"><button class="btn" data-tb-close>关闭</button></div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-tb-close]').forEach(b=> b.onclick = ()=>{ const p=$('#tlBoard'); if(p) p.remove(); });
  ov.addEventListener('click', e=>{ if(e.target===ov){ const p=$('#tlBoard'); if(p) p.remove(); } });
}
function chapterLenBounds(){
  const wr = (state.wordRange && +state.wordRange.min > 0 && +state.wordRange.max > 0)
    ? state.wordRange : { min: 3000, max: 3600 };
  const lo = Math.min(+wr.min, +wr.max), hi = Math.max(+wr.min, +wr.max);
  return { lo, hi, floor: Math.max(200, Math.round(lo * 0.9)) };
}
function sizeChapterInjection(){
  const n = realChapterCount();
  const b = chapterLenBounds();
  const floor = (b && +b.floor > 0) ? b.floor : 2700;
  const hi = (b && +b.hi > 0) ? +b.hi : 3600;
  const cap = Math.max(hi, Math.round(hi * 1.15));
  const total = n ? `全书共 ${n} 章；` : '';
  return `${total}本章正文目标 ${b.lo.toLocaleString()}—${b.hi.toLocaleString()} 字，硬下限 ${floor.toLocaleString()} 字（一次写完、当场达标，禁止靠事后补字数）。
【字数铁律 · 首写即达标】
· 本章必须一次写足到 ≥ ${floor.toLocaleString()} 字才算完成；这是硬性交付标准，禁止写成梗概式短场景、禁止一笔带过、禁止提前收尾。
· 开写前先按节拍表里每一拍标注的「（约X字）」明确各段分量：**每一拍都要被展开到接近其标注的约X字篇幅**（例如「冲突推进（约800字）」就须写出约800字的正文，而不是150字一带而过），逐拍累加即达本章目标；写正文时把它们自然衔接成一篇连续正文、不拆成独立小节，由上拍剧情引到下拍；某拍在节拍表里素材偏少时，允许在该拍内通过场景铺陈、动作拆解、多轮对话、心理活动与环境氛围的合理扩写来凑足该拍字数；严禁把多个节拍事件挤进一句话带过；每段事件一律用五感细节（视觉/听觉/触觉/嗅觉/味觉）、连贯动作、人物对话、心理活动与环境氛围写实写足。
· 剧情完整的前提下优先增厚铺垫、交锋与收官，禁止把多个节拍事件挤进一句话带过，也不得堆砌标点/空行凑数。
· 一边写一边对照：节拍表里每一段事件是否都已写到、是否写足应有的分量；不足必须继续扩写到位，而不是就此了事。
· 同时设硬顶：成文超过 ${hi.toLocaleString()} 字（上限 ${cap.toLocaleString()} 字）即判超长，达到目标区间就应立即收束本章，禁止无限铺陈、禁止为了"更多字数"再追加内容。
· 长度以正文落库为准，末尾不输出任何 LEN/字数标记。
【厚写展开法 · 防照抄应付（v1.0.270）】禁止把节拍 event 的字面内容"一转述就完事"：正文的实际篇幅必须明显大于节拍事件的字面内容。要写厚，就主动给每段事件叠加这些展开维度（按情节需要选，不必每拍全用）——(a) 前置铺垫：事件发生前，主角进入现场、环境气氛、人物状态的变化；(b) 动作拆解：把"一个动作"写成连续的小步骤与肢体/表情细节；(c) 对话往返回合：同一冲突用一来一回的多轮对话推进，而非一句带过；(d) 感官与环境：光线、声音、气味、触感的具象描写；(e) 延宕与收束：冲突落地后的人物反应、情绪余波与场面收尾。只有把事件展开到"看得见、感得到、有过程"，才算完成本拍，才算达标。`;
}
function bindSizeHint(){
  const el = $('#sizeHint'); if(!el) return;
  el.textContent = sizeHintText();
  $$('[data-size-lbl]').forEach(b=>{
    const key = b.dataset.sizeLbl;          // e.g. 'word-min'
    const [side, kind] = key.split('-');
    const r = side==='word' ? state.wordRange : state.chapterRange;
    if(r && +r[kind]>0){ b.textContent = side==='word' ? (+r[kind]).toLocaleString() : r[kind]; }
  });
}
function chapterSysBase(){
  const keys = beatTypeKeys().join(' / ');
  const cnt = beatCnt();
  const base = LONG_CHAPTER_SYS_PRO
    .split('setup/rise/climax/hook').join(beatTypeKeys().join('/'))
    .split('setup / rise / climax / hook').join(keys)
    .split('四个事件').join(cnt + ' 段节拍事件');
  const closedGate = `【正文作家·纯双注入执行铁律（闭卷创作规范）】
你是长篇小说的「正文作家（学生）」，只专注文学笔力、对白交锋与生动场面铺展。你的所有创作信息**严格且仅来自于两大唯一源泉**，绝无任何第三方夹带：
· 【两大唯一输入源泉】：
  1. 来源一【老师指令 · 本章教案（最高任务航海图）】：这是本章文学创作的唯一蓝图。本章剧情时间落点、推进骨架环节、情绪走向曲线、出场人物名单均已由老师统领吸收了微拍总纲与全局词典，你必须严格依此教案逐拍写透写足，不漏环节、不擅改主线。
  2. 来源二【上一章末尾 · 物理接力（开笔物理现实基准）】：若本章带有「上一章末尾·物理接力」文字，该段文字为开笔的【绝对物理起点】。第一段必须从其收尾处的景象、动作、未完对话、人物处境或即时情绪自然起笔接续，做到"伤口对缝"，严禁另起炉灶或空降新场景。若为全书第 1 章，则依教案【开篇引擎】策略起笔。
· 【转场过桥律】：若上一章末尾的物理状态与本章教案「剧情时间落点」或骨架第①拍存在时空跨度（如上章深夜结束、教案要求次日清晨赶路），必须在首段顺势用 1~2 句自然笔法交代时空流转或环境位移，平滑过桥，严禁生硬瞬移，也严禁原地打转死扣上章不往前走。
· 【严禁越权发散】：正文作家不再直接读取原始微拍或全量词典，严禁自行越过老师教案去翻看或脑补外部设定；名单外人物一律不写不提，严防提前剧透。
· 【龙套点缀纪律】：当场景自然需要店小二、茶客、更夫等过场闲人时，可现场即兴取名写一两句即止，只作氛围烘托，不得推动主线，不入词典，点到即收。
· 【成篇写法与达标收束】：按教案推进骨架顺序自然流淌推进，相邻环节自然过渡融合，字数达到篇幅契约即自然收束，严禁逐拍写标签或写散装提纲。
`;
  return closedGate + base;
}

const longChapterSys = (styleOverride) => {
  const parts = [];
  parts.push(chapterSysBase());
  const styleNote = chapterStyleNote(styleOverride);
  if(styleNote) parts.unshift(styleNote);          // 写作风格说明置顶
  const iron = narrativeIronBlock('chapter');
  if(iron) parts.push(iron);
  parts.push('\n【篇幅体量】\n'+sizeChapterInjection());
  return parts.join('\n\n');
};

function fullStoryText(){
  return state.chapters.map(c => `【${c.title}】\n${c.content}`).join('\n\n');
}

function isLong(){ return state.mode === 'longnovel'; }

function renderStepper(){
  const steps = [
    {n:1,t:'故事构想'},{n:2,t:'角色提示词'},{n:3,t:'场景提示词'},
    {n:4,t:'分镜文字'},{n:5,t:'导出资产包'}
  ];
  $('#stepper').innerHTML = steps.map(s=>{
    const cls = s.n===currentStep ? 'active' : (s.n<currentStep ? 'done' : '');
    return `<span class="chip ${cls}">${s.n<currentStep?'✓ ':''}${s.t}</span>`;
  }).join('');
}

function updateMechaNav(){
  const mtn = $('#mechaTopNav'); if(!mtn) return;
  $$('.cap', mtn).forEach(c=>{
    const n = c.dataset.step ? +c.dataset.step : null;
    c.classList.toggle('active', n && n === currentStep);
  });
}

function render(){
  const _restY = (window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0);
  normalizeOutline(state.outline);
  destroyCharTS(); // 先销毁旧 Tom Select，避免 DOM 残留/重复实例
  restartCascade();
  renderStepper();
  updateMechaNav();
  $$('.tab').forEach(t=>{
    const n = +t.dataset.step;
    const hideLong = isLong() && (n===2 || n===4);
    t.classList.toggle('hidden', hideLong);
    t.classList.toggle('active', n===currentStep);
  });
  const v = $('#view');
  if(currentStep===1) v.innerHTML = viewStory();
  else if(currentStep===2) v.innerHTML = viewCharacters();
  else if(currentStep===3) v.innerHTML = viewScenes();
  else if(currentStep===4) v.innerHTML = viewStoryboard();
  else if(currentStep===5) v.innerHTML = viewExport();
  bindView();
  if(currentStep===1) bindFlowSideNav();
  updateWcTotal();
  if(_restY >= 0){ try{ window.scrollTo(0, _restY); }catch(e){} }
}


function currentTitle(){
  const o = state.outline;
  if(o && o.title) return o.title;
  return state.idea ? state.idea.trim().slice(0,20) : '未命名作品';
}
function pushTitleHistory(oldName){
  if(!oldName) return;
  const d = new Date();
  const date = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
    + ' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  state.titleHistory.unshift({ name: oldName, date });
  if(state.titleHistory.length > 50) state.titleHistory = state.titleHistory.slice(0,50);
}
function renameTitle(newName){
  newName = String(newName||'').trim();
  if(!newName){ toast('书名不能为空'); return; }
  const oldName = currentTitle();
  if(oldName === newName){ toast('书名未变化'); return; }
  pushTitleHistory(oldName);
  if(state.outline) state.outline.title = newName;
  persist(); render();
  toast(`已改名为「${newName}」，原「${oldName}」已记入曾用名`);
}
function titleManagerHtml(){
  let histRows;
  if(state.titleHistory && state.titleHistory.length){
    histRows = state.titleHistory.map((h,idx)=>
      `<div class="hist-row"><span class="hist-name">${esc(h.name)}</span><span class="hist-date">${esc(h.date)}</span>
        <span class="hist-ops">
          <button type="button" class="icon-btn hist-op" data-hist-restore="${esc(h.name)}" title="恢复为此名">↩</button>
          <button type="button" class="icon-btn hist-op" data-hist-del="${idx}" title="删除该记录">🗑</button>
        </span></div>`
    ).join('');
  }else{
    histRows = `<div class="hist-empty">暂无曾用名</div>`;
  }
  return `
    <div class="title-manager">
      <span class="tm-cur" id="tmCur" title="点击改名">${esc(currentTitle())}</span>
      <button type="button" class="icon-btn tm-tri" id="btnTmTri" title="曾用名" data-tm-tri>▾</button>
      <div class="tm-hist hidden" id="tmHist">
        <div class="hist-title">曾用名</div>
        ${histRows}
      </div>
    </div>`;
}
const CYBER_HOME_GRID = `
  <div class="cyber-home-grid">
    <button class="cyber-card-btn purple" data-step="1"><span class="ico">📖</span><span class="lab">故事</span><span class="sub">输入构想并生成章节</span></button>
    <button class="cyber-card-btn cyan" data-step="2"><span class="ico">🧑</span><span class="lab">角色</span><span class="sub">生成角色定妆提示词</span></button>
    <button class="cyber-card-btn pink" data-step="3"><span class="ico">🏞️</span><span class="lab">场景</span><span class="sub">生成场景即梦提示词</span></button>
    <button class="cyber-card-btn orange" data-step="4"><span class="ico">🎞️</span><span class="lab">分镜</span><span class="sub">生成视频分镜文字</span></button>
  </div>`;

const WRITE_PRESETS = [
  { id:'clear',          name:'🧹 默认（无风格）', tags:[] },
  { id:'preset-humor',   name:'😆 网感轻喜',  tags:['roast','webman','fast'] },
  { id:'preset-art',     name:'🌸 文艺唯美',  tags:['wenyi','poetic','minimal'] },
  { id:'preset-classic', name:'🏮 古典文学',  tags:['jinyong','ornate','storyteller'] },
  { id:'preset-mystery', name:'🕵️ 悬疑压抑',  tags:['suspense2','jifeng','multipov'] },
  { id:'preset-passion', name:'🔥 热血燃向',  tags:['fast','sliceoflife'] }
];
function writeStyleState(){ return state.chapterStyle = state.chapterStyle || { tags:[], collapsed:false }; }
let wsDraft = null;   // null=未编辑（与生效一致）；非 null=有草稿待应用
function wsDraftInit(){
  if(!wsDraft){ const st = writeStyleState(); wsDraft = { tags:(st.tags||[]).slice() }; }
  return wsDraft;
}
function wsDraftDirty(d, st){
  const a = ((d&&d.tags)||[]).slice().sort().join(',');
  const b = ((st&&st.tags)||[]).slice().sort().join(',');
  return a !== b;
}
function refreshWsUI(){
  const st = writeStyleState();
  const dirty = !!wsDraft && wsDraftDirty(wsDraft, st);
  const draft = wsDraft || st;
  const selName = (draft.tags||[]).map(id=>{ const s=writeStyleById(id); return s?s.name:id; }).join(' + ') || '无';
  const sum = $('.ws-sum');
  if(sum){ sum.textContent = (dirty?'⚠️ 待应用':'✔ 已生效')+' · '+(draft.tags||[]).length+' 项 · '+selName; sum.classList.toggle('dirty', dirty); }
  $$('[data-ws-tag]').forEach(b=> b.classList.toggle('on', (draft.tags||[]).includes(b.dataset.wsTag)));
  $$('[data-ws-combo]').forEach(b=>{
    const combo = availableCombos().find(c=> c.id === b.dataset.wsCombo);
    if(!combo) return;
    const active = combo.tags&&combo.tags.length && combo.tags.every(t=>(draft.tags||[]).includes(t));
    b.classList.toggle('on', active);
  });
  $$('.ws-subcat').forEach(sub=>{
    if(sub.classList.contains('open')) return;
    if(sub.querySelector('.ws-opt.on')){
      sub.classList.add('open');
      const ico = sub.querySelector('.ws-subcat-t .sc-fold-ico'); if(ico) ico.textContent='▾';
    }
  });
  const ap = $('[data-ws-apply]');
  if(ap){ ap.disabled = !dirty; ap.classList.toggle('disabled', !dirty); }
  const hint = $('.ws-dirty-hint');
  if(hint) hint.style.display = dirty ? '' : 'none';
}
const WS_COLOR_SCHEMES = [
  { id:'none',    name:'默认（无配色）', c:[] },
  { id:'s1',  name:'活力橙紫青', c:['#2fb4af'] },
  { id:'s2',  name:'海洋蓝青',   c:['#b1e4e7'] },
  { id:'s3',  name:'皇家蓝绛红', c:['#dcb582'] },
  { id:'s4',  name:'蔷薇粉紫',   c:['#e2d8ef'] },
  { id:'s5',  name:'绯红玫紫',   c:['#fcbed4'] },
  { id:'s6',  name:'绯红钢青',   c:['#f8b79a'] },
  { id:'s7',  name:'青黄珊瑚',   c:['#f65150'] },
  { id:'s8',  name:'深蓝明黄',   c:['#4fcbe9'] },
  { id:'s9',  name:'薄荷明黄',   c:['#24b4a5'] },
  { id:'s10', name:'暖金珊瑚',   c:['#f9e9da'] },
  { id:'s11', name:'自然翠金',   c:['#f5b11e'] },
];
function wsColorCfgOf(c){ c.styleCustom = c.styleCustom || { notes:{},added:[],removed:[] }; c.styleCustom.colorSchemes = c.styleCustom.colorSchemes || { custom:[], removedCustom:[], removedBuiltin:[], undo:[] }; return c.styleCustom.colorSchemes; }
function wsColorCfg(){ return wsColorCfgOf(getCfg()); }               // 只读访问
function wsCustomColors(){ return wsColorCfg().custom || []; }        // 未删除的自定义
function wsRemovedBuiltin(){ return wsColorCfg().removedBuiltin || []; }
function wsRemovedCustom(){ return wsColorCfg().removedCustom || []; }
function wsUndoLog(){ return wsColorCfg().undo || []; }
function wsColorSchemesList(){
  const rm = wsRemovedBuiltin();
  return WS_COLOR_SCHEMES.filter(s=>!rm.includes(s.id)).concat(wsCustomColors());
}
function wsSchemeColors(id){
  if(id==='none') return [];
  const s = WS_COLOR_SCHEMES.find(x=>x.id===id) || wsCustomColors().find(x=>x.id===id) || wsRemovedCustom().find(x=>x.id===id);
  return s ? (s.c||[]) : [];
}
function wsSchemeName(id){
  if(id==='none') return '默认（无配色）';
  const s = WS_COLOR_SCHEMES.find(x=>x.id===id) || wsCustomColors().find(x=>x.id===id);
  return s ? s.name : id;
}
function wsColorSchemeId(){
  const sc = getCfg().styleCustom||{};
  const id = sc.colorScheme || 'none';
  if(id==='none') return 'none';
  if(WS_COLOR_SCHEMES.find(s=>s.id===id) && !wsRemovedBuiltin().includes(id)) return id;
  if(wsCustomColors().find(s=>s.id===id)) return id;
  return 'none';
}
function rebuildCustomColorCss(){
  let el = document.getElementById('wsCustomCss');
  if(!el){ el = document.createElement('style'); el.id='wsCustomCss'; document.head.appendChild(el); }
  el.textContent = wsCustomColors().map(s=>{ const col=(s.c&&s.c.length)? s.c[s.c.length-1] : ''; return col ? `[data-cs="${s.id}"]{--c-element:${col}}` : ''; }).filter(Boolean).join('\n');
}
function writeStyleChipsHtml(sel, dataPrefix, opts){
  opts = opts || {};
  const lib = writeStyleLib();
  const CAT_LABEL = { '语言质感':'① 语言质感', '情绪与张力':'② 情绪与张力', '节奏与网感':'③ 节奏与网感', '叙事技法':'④ 叙事技法', '台词设计':'⑤ 台词设计', custom:'⭐ 我的自定义' };
  const CAT_ORDER = ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计','custom'];
  const items = lib.filter(s=>s.group==='element');
  const mkOpt = s=>`<div class="ws-opt ${(sel.tags||[]).includes(s.id)?'on':''}" data-${dataPrefix}-tag="${s.id}">
    <div class="ws-opt-name">${esc(s.name)}</div>
    <div class="ws-opt-note">${esc(s.note)}</div>
  </div>`;
  const plus = opts.plus ? `<button type="button" class="ws-chip ws-chip-plus" data-${dataPrefix}-add="element" title="点击新建文风词条">＋</button>` : '';
  const useFold = dataPrefix === 'ws';
  const catOpen = (useFold && writeStyleState().catOpen) || {};
  const blocks = CAT_ORDER.map(cat=>{
    const its = items.filter(s=>(s.cat||'element')===cat);
    if(!its.length) return '';
    const hits = its.filter(s=>(sel.tags||[]).includes(s.id));
    const expanded = useFold ? (catOpen[cat] === true) : false;    // 展开态=显示本类全部
    const hasSel = hits.length > 0;
    const showBody = useFold ? (expanded || hasSel) : true;        // 专注态下：有已选则展示体(只显已选)，无已选则收成标题
    const shown = expanded ? its : hits;                            // 展开=全部；专注=仅已选
    const fold = useFold ? `<span class="sc-fold-ico">${expanded?'▾':'▸'}</span>` : '';
    return `<div class="ws-subcat${showBody?' open':''}"${useFold?` data-ws-catfold="${cat}"`:''}>
      <div class="ws-subcat-t"${useFold?' role="button" tabindex="0" title="专注态只显示已选词条，点此展开查看本类全部"':''}>${CAT_LABEL[cat]||cat}${useFold?`（${expanded ? `共 ${its.length}` : `已选 ${hits.length}`}）`:''}${fold}</div>
      <div class="ws-subcat-fold"><div class="ws-opt-list">${shown.map(mkOpt).join('')}</div></div>
    </div>`;
  }).filter(Boolean).join('');
  const comboList = dataPrefix==='ws' ? availableCombos() : [];
  const comboRemovedN = (getCfg().styleCustom||{}).comboRemoved && getCfg().styleCustom.comboRemoved.length ? getCfg().styleCustom.comboRemoved.length : 0;
  const customCombos = dataPrefix==='ws' ? ((getCfg().styleCustom||{}).customCombos||[]) : [];
  const comboOpen = (dataPrefix==='ws' && getCfg().styleCustom && getCfg().styleCustom.comboOpen) || {};
  const comboActive = c => !!(c.tags&&c.tags.length && (c.tags||[]).every(t=>(sel.tags||[]).includes(t)));
  const mkCombo = c=> `<div class="ws-opt ws-combo-btn${comboActive(c)?' on':''}" data-ws-combo="${c.id}"><span class="ws-combo-del" data-ws-combo-del="${c.id}" title="删除此组合">✕</span><div class="ws-opt-name">${esc(c.name)}</div><div class="ws-opt-note">${esc(c.desc||'')}</div></div>`;
  const comboBar = dataPrefix==='ws'
    ? `<div class="ws-combo${comboOpen.builtin===false?'':' open'}" data-ws-combofold="builtin">
       <div class="ws-subcat-t" role="button" tabindex="0" title="展开/收起">
         <span class="ws-combo-title"><span class="sc-fold-ico">${comboOpen.builtin===false?'▸':'▾'}</span> 🎬 组合配方 <span class="muted" style="font-size:10px;font-weight:400">点击即替换当前选择，可再叠加细项</span></span>
         ${comboRemovedN?`<button type="button" class="ws-combo-restore" data-ws-combo-restore>恢复已删组合(${comboRemovedN})</button>`:''}
       </div>
       <div class="ws-subcat-fold"><div class="ws-opt-list">${comboList.filter(c=>!c.custom).map(mkCombo).join('')}</div></div>
     </div>
     <div class="ws-combo ws-combo-mine${comboOpen.custom===false?'':' open'}" data-ws-combofold="custom">
       <div class="ws-subcat-t" role="button" tabindex="0" title="展开/收起">
         <span class="ws-combo-title"><span class="sc-fold-ico">${comboOpen.custom===false?'▸':'▾'}</span> 🏷 我的配方</span>
         <button type="button" class="ws-combo-add" data-ws-combo-add title="把当前草稿保存为自定义组合配方">＋</button>
       </div>
       <div class="ws-subcat-fold"><div class="ws-opt-list">${customCombos.map(mkCombo).join('')}</div></div>
     </div>`
    : '';
  const chipsTail = (opts.plus || opts.showTip !== false)
    ? `<div class="ws-chips">${opts.showTip !== false ? '<span class="ws-group-tip">可多选</span>' : ''}${plus}</div>` : '';
  return `${comboBar}${blocks}${chipsTail}`;
}

function toggleWriteTag(sel, id){
  const s = writeStyleById(id); if(!s) return;
  if(sel.tags.includes(id)){
    sel.tags = sel.tags.filter(x=>x!==id);
  } else {
    if(!sel.tags.includes(id)) sel.tags.push(id);
  }
}
function writeStyleCard(){
  const st = writeStyleState();
  const draft = wsDraft || st;
  const dirty = !!wsDraft && wsDraftDirty(wsDraft, st);
  const selName = (draft.tags||[]).map(id=>{ const s=writeStyleById(id); return s?s.name:id; }).join(' + ') || '无';
  const sumTxt = (dirty?'⚠️ 待应用':'✔ 已生效')+' · 🔒 表达层'+((draft.tags||[]).length?'已锁定':'待选择')+' · '+(draft.tags||[]).length+' 项 · '+selName;
  return `<div class="card ws-card card-theme-style${st.collapsed?' ws-collapsed':''}" data-cs="${wsColorSchemeId()}">
    <div class="ws-head card-head-bar" data-ws-fold role="button" tabindex="0" title="展开/收起">
      <div class="ch-left">
        <span class="ch-badge ch-badge-style">🎨</span>
        <h3 class="ch-title">写作风格基调</h3>
        <span class="ch-subtag ch-subtag-style${dirty?' dirty':''}">${sumTxt}</span>
      </div>
      <div class="ch-right">
        <button type="button" class="btn ghost ws-manage-btn" data-ws-lib title="编辑风格词库与我的收藏">⚙️ 管理</button>
        <span class="sc-fold-ico">${st.collapsed?'▸':'▾'}</span>
      </div>
    </div>
    <div class="ws-body"${st.collapsed?' hidden':''}>
      <div class="ws-fold-tools">
        <button type="button" class="btn small ghost" data-ws-fold-all title="展开全部词条类别">⤵ 全部展开</button>
        <button type="button" class="btn small ghost" data-ws-fold-none title="收起全部词条类别">⤴ 全部收起</button>
      </div>
      ${writeStyleChipsHtml(draft, 'ws', { plus:false, cardFold:true, showTip:false })}
      <div class="ws-tools">
        <button type="button" class="ws-chip ws-chip-plus" data-ws-add="element" title="点击新建文风词条">＋</button>
        <button type="button" class="btn small primary ws-apply${dirty?'':' disabled'}" data-ws-apply ${dirty?'':'disabled'} title="把当前草稿设为生效配置（从此生成用这套风格）">✔ 应用并保存</button>
        <button type="button" class="btn small ghost" data-ws-save title="把当前草稿收藏为预设（跨作品可用）">💾 收藏当前</button>
        <button type="button" class="btn small ghost" data-ws-clear>✕ 清空</button>
      </div>
      <p class="ws-dirty-hint" style="display:${dirty?'':'none'}">⚠️ 存在未生效的修改，点「✔ 应用并保存」生效</p>
    </div>
  </div>`;
}
function bindWriteStyle(){
  const st = writeStyleState();
  const head = $('[data-ws-fold]');
  if(head) head.onclick = ()=>{
    st.collapsed = !st.collapsed; persist();
    const body = $('.ws-body'); if(body) body.hidden = st.collapsed;
    const ico = head.querySelector('.sc-fold-ico'); if(ico) ico.textContent = st.collapsed?'▸':'▾';
  };
  $$('[data-ws-tag]').forEach(b=> b.onclick = ()=>{
    toggleWriteTag(wsDraftInit(), b.dataset.wsTag);
    refreshWsUI();
  });
  $$('[data-ws-combo]').forEach(b=> b.onclick = ()=>{
    const combo = availableCombos().find(c=> c.id === b.dataset.wsCombo); if(!combo) return;
    const d = wsDraftInit();
    const libIds = writeStyleLib().map(s=>s.id);
    d.tags = (combo.tags||[]).filter(id=> libIds.includes(id));
    render();
    toast(`已套用组合「${combo.name}」：${(d.tags.map(id=>{const s=writeStyleById(id);return s?s.name:id}).join(' + '))||'（部分词条已删，未套用）'}，点「✔ 应用并保存」生效`);
  });
  $$('[data-ws-combo-del]').forEach(b=> b.onclick = (e)=>{
    e.stopPropagation();
    const id = b.dataset.wsComboDel; if(!id) return;
    const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
    const isBuiltin = WRITE_COMBOS.some(c=> c.id === id);
    if(isBuiltin){
      const combo = WRITE_COMBOS.find(c=> c.id === id);
      if(!combo) return;
      if(!window.confirm(`删除组合「${combo.name}」后不再显示，可通过「恢复已删组合」还原。确定删除？`)) return;
      cfg.styleCustom.comboRemoved = cfg.styleCustom.comboRemoved || [];
      if(!cfg.styleCustom.comboRemoved.includes(id)) cfg.styleCustom.comboRemoved.push(id);
      saveCfg(cfg); render(); toast(`已删除组合「${combo.name}」`);
    } else {
      const combo = (cfg.styleCustom.customCombos||[]).find(c=> c.id === id);
      if(window.confirm(`删除自定义组合「${combo?combo.name:id}」？删后不可撤销。确定删除？`)){
        cfg.styleCustom.customCombos = (cfg.styleCustom.customCombos||[]).filter(x=> x.id !== id);
        saveCfg(cfg); render(); toast('已删除自定义组合');
      }
    }
  });
  const cadd = $('[data-ws-combo-add]');
  if(cadd) cadd.onclick = ()=>{
    const cur = wsDraft || writeStyleState();
    const tags = (cur.tags||[]).slice();
    if(!tags.length){ toast('当前无风格，暂无可保存的组合配方'); return; }
    const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
    cfg.styleCustom.customCombos = cfg.styleCustom.customCombos || [];
    const name = prompt('给这个组合配方起个名字：', '我的配方' + (cfg.styleCustom.customCombos.length + 1));
    if(!name || !name.trim()) return;
    const desc = tags.map(id=>{ const s=writeStyleById(id); return s? s.name : id; }).join(' + ');
    cfg.styleCustom.customCombos.push({ id:'cu'+Date.now().toString(36), name:name.trim(), desc, tags });
    saveCfg(cfg); render();
    toast('已保存为自定义组合「' + name.trim() + '」，点它即可一键套用');
  };
  const cre = $('[data-ws-combo-restore]');
  if(cre) cre.onclick = ()=>{
    if(!window.confirm('恢复全部被删除的组合配方？')) return;
    const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
    cfg.styleCustom.comboRemoved = [];
    saveCfg(cfg); render(); toast('已恢复全部默认组合');
  };
  const sel = $('#wsPreset');
  const ap = $('[data-ws-apply]');
  if(ap) ap.onclick = ()=>{
    if(!wsDraft) return;
    const st2 = writeStyleState();
    st2.tags = wsDraft.tags.slice();
    persist();
    const name = wsDraft.tags.map(id=>{ const s=writeStyleById(id); return s?s.name:id; }).join(' + ') || '无';
    wsDraft = null;
    refreshWsUI();
    toast('写作风格已生效：'+(name==='无'?'无风格（AI 默认文风）':name));
  };
  const sv = $('[data-ws-save]');
  if(sv) sv.onclick = ()=>{
    const cur = wsDraft || writeStyleState();
    if(!cur.tags.length){ toast('当前无风格，无需收藏'); return; }
    const cfg = getCfg(); if(!Array.isArray(cfg.stylePresets)) cfg.stylePresets = [];
    const name = prompt('给这个风格组合起个名字：', '我的风格'+(cfg.stylePresets.length+1));
    if(!name || !name.trim()) return;
    cfg.stylePresets.push({ id:'sp'+Date.now().toString(36), name:name.trim(), tags:cur.tags.slice() });
    saveCfg(cfg); render();
    toast('已收藏：'+name.trim());
  };
  const lb = $('[data-ws-lib]');
  if(lb) lb.onclick = (e)=>{ e.stopPropagation(); openStyleLibPanel(); };
  const cl = $('[data-ws-clear]');
  if(cl) cl.onclick = ()=>{ const d = wsDraftInit(); d.tags=[]; refreshWsUI(); toast('已清空草稿，点「✔ 应用并保存」生效'); };
  const wsCard = $('.ws-card');
  const fa = wsCard && wsCard.querySelector('[data-ws-fold-all]');
  if(fa) fa.onclick = ()=>{ const st=writeStyleState(); st.catOpen=st.catOpen||{};
    ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].forEach(k=> st.catOpen[k]=true);
    persist(); render(); };
  const fn = wsCard && wsCard.querySelector('[data-ws-fold-none]');
  if(fn) fn.onclick = ()=>{ const st=writeStyleState(); st.catOpen=st.catOpen||{};
    ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].forEach(k=> st.catOpen[k]=false);
    persist(); render(); };
  if(wsCard && !wsCard.dataset.catfoldBound){
    wsCard.dataset.catfoldBound = '1';
    wsCard.addEventListener('click', e=>{
      const t = e.target.closest('.ws-subcat-t');
      if(!t || !t.hasAttribute('role')) return;
      if(e.target.closest('.ws-combo-add, .ws-combo-restore')) return;
      const sub = t.closest('.ws-subcat, .ws-combo');
      if(!sub) return;
      if(sub.dataset.wsCombofold!==undefined){
        const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || {};
        cfg.styleCustom.comboOpen = cfg.styleCustom.comboOpen || {};
        const open = !sub.classList.contains('open');
        cfg.styleCustom.comboOpen[sub.dataset.wsCombofold] = open; saveCfg(cfg);
        sub.classList.toggle('open', open);
        const ico = t.querySelector('.sc-fold-ico'); if(ico) ico.textContent = open?'▾':'▸';
        return;
      }
      if(sub.dataset.wsCatfold===undefined) return;
      const st = writeStyleState(); st.catOpen = st.catOpen || {};
      st.catOpen[sub.dataset.wsCatfold] = !(st.catOpen[sub.dataset.wsCatfold]===true); persist();
      render();
    });
  }
  $$('[data-ws-add]').forEach(b=> b.onclick = ()=> openStyleNewDialog(b.dataset.wsAdd));
}
function openStyleNewDialog(group){
  closeStyleNewDialog();
  const CAT_LABEL = { '语言质感':'① 语言质感', '情绪与张力':'② 情绪与张力', '节奏与网感':'③ 节奏与网感', '叙事技法':'④ 叙事技法', '台词设计':'⑤ 台词设计', custom:'⭐ 我的自定义' };
  const catLabel = ()=> CAT_LABEL[group] || '自定义';
  const ov = document.createElement('div'); ov.id='wsNewPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>＋ 新建文风词条</b>
        <button class="gs-x" data-wsn-close>✕</button></div>
      <div class="cv-body">
        <label style="font-size:12px;color:var(--sub)">归属分类</label>
        <select id="wsnCat" style="margin:4px 0 10px">
          <option value="语言质感"${group==='语言质感'?' selected':''}>① 语言质感</option>
          <option value="情绪与张力"${group==='情绪与张力'?' selected':''}>② 情绪与张力</option>
          <option value="节奏与网感"${group==='节奏与网感'?' selected':''}>③ 节奏与网感</option>
          <option value="叙事技法"${group==='叙事技法'?' selected':''}>④ 叙事技法</option>
          <option value="台词设计"${group==='台词设计'?' selected':''}>⑤ 台词设计</option>
          <option value="custom"${group==='custom'?' selected':''}>⭐ 我的自定义</option>
        </select>
        <label style="font-size:12px;color:var(--sub)">风格名称（≤20字）*</label>
        <input type="text" id="wsnName" maxlength="20" placeholder="如：民国腔调 / 冷硬悬疑" style="margin:4px 0 10px" />
        <label style="font-size:12px;color:var(--sub)">指令文本（≤500字）</label>
        <textarea id="wsnNote" rows="4" maxlength="500" placeholder="推荐三行配方：&#10;写法：…&#10;避免：…&#10;自查：…" style="margin:4px 0 6px"></textarea>
        <div class="muted" style="font-size:11px">确认后将于「<span data-wsn-catlab>${catLabel()}</span>」分类下添加并默认勾选（草稿态，点「✔ 应用并保存」正式生效）。</div>
      </div>
      <div class="modal-actions" style="padding:12px 16px;border-top:1px solid var(--line)">
        <button type="button" class="btn ghost" data-wsn-close2>取消</button>
        <button type="button" class="btn primary" data-wsn-ok>✔ 确认新建</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const lab = ov.querySelector('[data-wsn-catlab]');
  const catSel = ov.querySelector('#wsnCat');
  if(catSel && lab) catSel.onchange = ()=> lab.textContent = CAT_LABEL[catSel.value] || '自定义';
  const close = ()=> closeStyleNewDialog();
  ov.querySelector('[data-wsn-close]').onclick = close;
  ov.querySelector('[data-wsn-close2]').onclick = close;
  ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
  ov.querySelector('[data-wsn-ok]').onclick = ()=>{
    const name = ($('#wsnName') && $('#wsnName').value.trim()) || '';
    if(!name){ toast('请填写风格名称'); return; }
    const note = ($('#wsnNote') && $('#wsnNote').value.trim().slice(0,500)) || '';
    const cat = (catSel && catSel.value) || group || 'custom';
    const c = getCfg(); c.styleCustom = c.styleCustom || { notes:{}, added:[], removed:[] };
    c.styleCustom.added = c.styleCustom.added || [];
    const id = 'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    c.styleCustom.added.push({ id, group:cat, name, note });
    saveCfg(c);
    const d = wsDraftInit(); if(!d.tags.includes(id)) d.tags.push(id);
    closeStyleNewDialog();
    render();
    toast('已新建并加入「'+name+'」');
  };
  const inp = $('#wsnName'); if(inp) inp.focus();
}
function closeStyleNewDialog(){ const p=$('#wsNewPanel'); if(p) p.remove(); }
function applyWritePresetDraft(v){
  const d = wsDraftInit();
  if(v === 'clear'){ d.tags=[]; }
  else if(v.indexOf('u:')===0){
    const cfg = getCfg();
    const p = (Array.isArray(cfg.stylePresets)?cfg.stylePresets:[]).find(x=>x.id===v.slice(2));
    if(p){ d.tags = (p.tags||[]).slice(); }
  } else {
    const p = WRITE_PRESETS.find(x=>x.id===v);
    if(p){ d.tags = p.tags.slice(); }
  }
  refreshWsUI();
}
function openStyleLibPanel(){
  closeStyleLibPanel();
  const cfg = getCfg();
  if(!cfg.styleCustom) cfg.styleCustom = { notes:{}, added:[], removed:[], comboRemoved:[] };
  const lib = writeStyleLib();
  const CAT_LABEL = { '语言质感':'① 语言质感', '情绪与张力':'② 情绪与张力', '节奏与网感':'③ 节奏与网感', '叙事技法':'④ 叙事技法', '台词设计':'⑤ 台词设计', custom:'⭐ 我的自定义' };
  const groups = Object.keys(CAT_LABEL);
  const notes = cfg.styleCustom.notes || {};
  const groupHtml = groups.map(g=>{
    const its = lib.filter(s=>(s.cat||'element')===g);
    return `<div class="ws-lib-group ws-lib-fold">
      <div class="ws-lib-fold-t" data-lib-fold="${g}" role="button" tabindex="0" title="展开/收起">
        <span>${CAT_LABEL[g]}${its.length?`（${its.length}）`:'（空）'}</span><span class="sc-fold-ico">▸</span>
      </div>
      <div class="ws-lib-fold-b" hidden>
        ${its.map(s=>`
        <div class="ws-lib-item">
          <div class="ws-lib-name">${esc(s.name)}${notes[s.id]?'<span class="ws-changed">已改</span>':''}${s.custom?'<span class="ws-custom">自定义</span>':''}</div>
          <textarea class="ws-lib-note" data-lib-note="${s.id}" rows="2" maxlength="500" placeholder="指令文本（≤500字；可用 写法:/避免:/自查: 三行写配方）">${esc(s.note||'')}</textarea>
          <div class="ws-lib-tools">
            ${s.custom?`<button type="button" class="btn small ghost" data-lib-del="${s.id}" title="删除该自定义词条">🗑 删除</button>`:`<button type="button" class="btn small ghost" data-lib-hide="${s.id}" title="从选择中移除该词条（「恢复默认」可还原）">🚫 停用</button>`}
          </div>
        </div>`).join('')}
        ${its.length?'':`<p class="muted" style="margin:4px 0">该组暂无词条：回到写作风格卡片点该组「＋」新建。</p>`}
      </div>
    </div>`;
  }).join('');
  const mine = (Array.isArray(cfg.stylePresets)?cfg.stylePresets:[]).map((p,i)=>`
    <div class="ws-lib-item">
      <div class="ws-lib-name">⭐ ${esc(p.name||'未命名')}</div>
      <span class="muted" style="font-size:11px">${(p.tags||[]).map(id=>{const s=writeStyleById(id); return s?s.name:id;}).join('+')||'无'}</span>
      <button type="button" class="btn small ghost del" data-sp-del="${i}">删</button>
    </div>`).join('') || '<p class="muted">暂无收藏。</p>';
  const combos_ = availableCombos();
  const combosHtml = combos_.length ? combos_.map(c=>`
    <div class="ws-lib-item">
      <div class="ws-lib-name">${c.custom?'🏷':'🎬'} ${esc(c.name||'未命名')}</div>
      <div class="ws-lib-note" style="white-space:pre-wrap;margin:2px 0 4px">${esc(c.desc||'')}</div>
      ${c.why?`<div class="ws-lib-why">💡 为何这样选：${esc(wiseWhyText(c.why))}</div>`:''}
      <span class="muted" style="font-size:11px">词条：${(c.tags||[]).map(id=>{const s=writeStyleById(id); return s?s.name:id;}).join(' + ')||'无'}</span>
    </div>`).join('') : '<p class="muted">暂无配方。</p>';
  const ov = document.createElement('div'); ov.id='wsLibPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>⚙️ 写作风格管理</b>
        <span style="display:flex;gap:6px">
          <button class="btn small ghost" data-lib-read>📖 阅读</button>
          <button class="btn small ghost" data-lib-reset>恢复默认</button>
          <button class="gs-x" data-lib-close>✕</button>
        </span></div>
      <!-- v239/905-1：管理第二行去掉「📜 消息看板」（看板入口保留在「叙事」菜单与 toast 📋 按钮）；「📦 选择导出」改为仅导出写作风格卡片内容（组合配方/我的配方/五大类词条） -->
      <div class="ws-lib-toprow">
        <span class="muted" style="font-size:11px;flex:0 0 auto">导入 / 导出：</span>
        <button type="button" class="btn small ghost" data-lib-rexcenter title="打开导出中心：平铺勾选组合配方、我的配方与五大类词条，打包导出">📦 选择导出</button>
        <button type="button" class="btn small ghost" data-lib-import title="导入风格词条包（合并式：只添加我没有的）">⬆ 导入词条</button>
        <button type="button" class="btn small ghost" data-lib-rimport title="导入配方包 JSON（先预览勾选，再确认导入；词条自动合并进词库）">⬆ 导入配方包</button>
        <input type="file" id="wsLibImportFile" accept=".json,application/json" hidden />
        <input type="file" id="wsRecipeImportFile" accept=".json,application/json" hidden />
      </div>
      <div class="cv-body">
        <div class="ws-lib-group ws-lib-fold">
          <div class="ws-lib-fold-t" data-lib-fold="combos" role="button" tabindex="0" title="展开/收起">
            <span>🧪 全部配方（${combos_.length}）</span><span class="sc-fold-ico">▾</span>
          </div>
          <div class="ws-lib-fold-b">${combosHtml}</div>
        </div>
        <div class="cv-div">支持在线编辑指令、停用内置词条或删除自定义项，实时生效。</div>
        ${groupHtml}
        <div class="ws-lib-group ws-lib-fold">
          <div class="ws-lib-fold-t" data-lib-fold="mine" role="button" tabindex="0" title="展开/收起">
            <span>⭐ 我的收藏</span><span class="sc-fold-ico">▸</span>
          </div>
          <div class="ws-lib-fold-b" hidden>${mine}</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-lib-close]').onclick = closeStyleLibPanel;
  ov.querySelector('[data-lib-read]').onclick = () => openStyleLibReader();
  ov.querySelector('[data-lib-import]').onclick = ()=>{ const f=$('#wsLibImportFile'); if(f) f.click(); };
  const wlImp = ov.querySelector('#wsLibImportFile'); if(wlImp) wlImp.onchange = e=>{ const file=e.target.files && e.target.files[0]; if(file) importWsStyleBundle(file); e.target.value=''; };
  const rexc = ov.querySelector('[data-lib-rexcenter]'); if(rexc) rexc.onclick = ()=> openExportCenter();
  ov.querySelector('[data-lib-rimport]').onclick = ()=>{ const f=$('#wsRecipeImportFile'); if(f) f.click(); };
  const rImp = ov.querySelector('#wsRecipeImportFile'); if(rImp) rImp.onchange = e=>{ const file=e.target.files && e.target.files[0]; if(file) importRecipeBundle(file); e.target.value=''; };
  ov.addEventListener('click', e=>{ if(e.target===ov) closeStyleLibPanel(); });
  ov.querySelectorAll('[data-lib-fold]').forEach(h=> h.onclick = ()=>{
    const b = h.nextElementSibling; if(!b) return;
    const ico = h.querySelector('.sc-fold-ico'); if(ico) ico.textContent = b.hidden ? '▾' : '▸';
    b.hidden = !b.hidden;
  });
  ov.querySelectorAll('[data-lib-note]').forEach(ta=>{
    ta.onchange = ()=>{
      const id = ta.dataset.libNote;
      const v = ta.value.trim().slice(0,500);
      if(v) cfg.styleCustom.notes[id] = v; else delete cfg.styleCustom.notes[id];
      saveCfg(cfg);
      const it = ta.closest('.ws-lib-item'); const nm = it && it.querySelector('.ws-lib-name');
      if(nm){
        let badge = nm.querySelector('.ws-changed');
        if(v){ if(!badge){ badge=document.createElement('span'); badge.className='ws-changed'; badge.textContent='已改'; nm.appendChild(badge); } }
        else if(badge) badge.remove();
      }
      toast('已保存指令');
    };
  });
  ov.querySelectorAll('[data-lib-del]').forEach(b=>{
    b.onclick = ()=>{
      cfg.styleCustom.added = (cfg.styleCustom.added||[]).filter(x=>x.id!==b.dataset.libDel);
      saveCfg(cfg); render(); toast('已删除自定义风格');
      closeStyleLibPanel(); openStyleLibPanel();   // 立即刷新面板，删除项即时消失
    };
  });
  ov.querySelectorAll('[data-lib-hide]').forEach(b=>{
    b.onclick = ()=>{
      if(!window.confirm('停用后该词条将从选择中移除，可通过「恢复默认」还原。确定停用？')) return;
      cfg.styleCustom.removed = cfg.styleCustom.removed || [];
      if(!cfg.styleCustom.removed.includes(b.dataset.libHide)) cfg.styleCustom.removed.push(b.dataset.libHide);
      saveCfg(cfg); render(); toast('已停用该词条');
      closeStyleLibPanel(); openStyleLibPanel();
    };
  });
  ov.querySelectorAll('[data-sp-del]').forEach(b=>{
    b.onclick = ()=>{
      cfg.stylePresets.splice(+b.dataset.spDel,1);
      saveCfg(cfg); render(); toast('已删除收藏');
      closeStyleLibPanel(); openStyleLibPanel();   // 立即刷新面板，删除项即时消失
    };
  });
  ov.querySelector('[data-lib-reset]').onclick = ()=>{
    if(!window.confirm('恢复默认将清空全部词库改动（自定义新增也会删除）。确定？')) return;
    cfg.styleCustom = { notes:{}, added:[], removed:[], comboRemoved:[] };
    saveCfg(cfg); render(); toast('已恢复默认词库');
    closeStyleLibPanel(); openStyleLibPanel();   // 立即重建面板：清掉「已改」标记、自定义项与编辑过的指令
  };
}
function importWsStyleBundle(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(e){ toast('导入失败：文件不是合法 JSON'); return; }
    if(data && data.kind === 'wsStylePack'){
      const builtinEntryIds = new Set((WRITE_STYLES||[]).map(s=> s && s.id).filter(Boolean));
      const builtinComboIds = new Set((WRITE_COMBOS||[]).map(c=> c && c.id).filter(Boolean));
      const CATS = ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'];
      const entries = Array.isArray(data.entries) ? data.entries : [];
      const added = entries
        .filter(x=> x && x.id && x.name && !builtinEntryIds.has(String(x.id)))
        .map(x=>({ id:String(x.id), group: CATS.includes(x.cat)?x.cat:(CATS.includes(x.group)?x.group:'custom'), name:String(x.name), note:String(x.note||''), demo:x.demo?String(x.demo):'', seal:(x.seal===undefined?0:x.seal), warning:x.warning?String(x.warning):'' }));
      const notes = {};
      entries.forEach(x=>{
        if(x && x.id && builtinEntryIds.has(String(x.id))){
          const b = (WRITE_STYLES||[]).find(s=> s && s.id===x.id);
          if(b && String(x.note||'') !== String(b.note||'')) notes[String(x.id)] = String(x.note||'');
        }
      });
      const myC = (Array.isArray(data.myCombos)?data.myCombos:[]).filter(c=> c && c.id && c.name);
      const extraC = (Array.isArray(data.combos)?data.combos:[]).filter(c=> c && c.id && c.name && !builtinComboIds.has(String(c.id)));
      data = { styleCustom: { notes, added, removed:[], comboRemoved:[], customCombos: myC.concat(extraC) } };
    }
    if(!data || typeof data !== 'object' || !data.styleCustom || typeof data.styleCustom !== 'object'){
      toast('导入失败：不是合法的写作风格配方 JSON'); return;
    }
    const sc = data.styleCustom;
    const strArr = v => Array.isArray(v) ? v.map(String).filter(x=> !!x) : [];
    const builtinIds = [].concat(WRITE_STYLES || []).map(s=> s && s.id).filter(Boolean);
    const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || { notes:{}, added:[], removed:[], comboRemoved:[] };
    let addedN=0, keptN=0;
    const notes = (sc.notes && typeof sc.notes==='object') ? sc.notes : {};
    Object.keys(notes).forEach(id=>{ if(!(id in cfg.styleCustom.notes)) cfg.styleCustom.notes[id] = notes[id]; });
    const haveIds = new Set((cfg.styleCustom.added||[]).map(x=> x && x.id));
    (Array.isArray(sc.added) ? sc.added : [])
      .filter(x=> x && x.id && x.name)
      .map(x=>({ id:String(x.id), group:['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].includes(x.group)?x.group:'custom', name:String(x.name), note:String(x.note||''), demo:x.demo?String(x.demo):'', seal:(x.seal===undefined?0:x.seal), warning:x.warning?String(x.warning):'' }))
      .forEach(x=>{ if(haveIds.has(x.id)){ keptN++; return; } cfg.styleCustom.added.push(x); haveIds.add(x.id); addedN++; });
    const rmSet = new Set(strArr(cfg.styleCustom.removed));
    strArr(sc.removed).filter(id=> builtinIds.includes(id)).forEach(id=> rmSet.add(id));
    cfg.styleCustom.removed = Array.from(rmSet);
    const crSet = new Set(strArr(cfg.styleCustom.comboRemoved));
    strArr(sc.comboRemoved).filter(id=> (WRITE_COMBOS||[]).some(c=> c.id === id)).forEach(id=> crSet.add(id));
    cfg.styleCustom.comboRemoved = Array.from(crSet);
    const libNowIds = new Set(writeStyleLib().map(s=> s.id));
    const haveCombo = new Set((cfg.styleCustom.customCombos||[]).map(x=> x && x.id));
    (Array.isArray(sc.customCombos) ? sc.customCombos : [])
      .filter(x=> x && x.id && x.name)
      .map(x=>({ id:String(x.id), name:String(x.name), desc:String(x.desc||''), tags:strArr(x.tags).filter(id=> libNowIds.has(id)) }))
      .forEach(x=>{ if(haveCombo.has(x.id)){ keptN++; return; } cfg.styleCustom.customCombos.push(x); haveCombo.add(x.id); addedN++; });
    saveCfg(cfg); render();
    toast(`已合并导入：新增 ${addedN} 项 · 已有保留 ${keptN} 项`);
    closeStyleLibPanel(); openStyleLibPanel();   // 重建面板，导入内容立即可见
  };
  reader.readAsText(file);
}
function closeStyleLibPanel(){ const p=$('#wsLibPanel'); if(p) p.remove(); }

function openStyleLibReader(){
  closeStyleLibReader();
  const lib = writeStyleLib();
  const CAT_LABEL = { '语言质感':'① 语言质感', '情绪与张力':'② 情绪与张力', '节奏与网感':'③ 节奏与网感', '叙事技法':'④ 叙事技法', '台词设计':'⑤ 台词设计', custom:'⭐ 我的自定义' };
  const groups = {};
  lib.forEach(s=>{
    const cat = s.cat || 'custom';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(s);
  });
  const order = Object.keys(CAT_LABEL).filter(g=>groups[g] && groups[g].length);
  (Object.keys(groups).filter(g=>!Object.prototype.hasOwnProperty.call(CAT_LABEL,g))).forEach(g=>order.push(g));
  let html = order.map(cat=>{
    let catHtml = `<h2>${CAT_LABEL[cat] || cat}（${groups[cat].length}）</h2>`;
    catHtml += groups[cat].map(s=>`
      <div class="style-recipe">
        <h3>【${esc(s.name)}】${s.custom?'<span class="ws-custom">自定义</span>':''}</h3>
        <p><strong>指令：</strong>${esc(s.note||'')}</p>
        ${s.tips && s.tips.length ? `<p><strong>写法：</strong>${s.tips.map((t,i)=>`${i+1}. ${esc(t)}`).join('；')}</p>` : ''}
        ${s.avoid && s.avoid.length ? `<p><strong>避免：</strong>${s.avoid.map(a=>'✗ '+esc(a)).join('；')}</p>` : ''}
        ${s.check && s.check.length ? `<p><strong>自查：</strong>${s.check.map(c=>'□ '+esc(c)).join('　')}</p>` : ''}
        ${s.demo ? `<p><strong>示例：</strong>「${esc(s.demo)}」</p>` : ''}
      </div>`).join('');
    return catHtml;
  }).join('');
  const ov = document.createElement('div'); ov.id='wsLibReader'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal reader-modal">
      <div class="gs-modal-head"><b>📖 写作风格配方大全</b>
        <span style="display:flex;gap:6px">
          <button class="btn small ghost" data-lib-read-copy>复制全文</button>
          <button class="gs-x" data-lib-read-close>✕</button>
        </span></div>
      <div class="cv-body"><div class="reader-body">${html}</div></div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-lib-read-close]').onclick = closeStyleLibReader;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeStyleLibReader(); });
  ov.querySelector('[data-lib-read-copy]').onclick = ()=>{
    let txt = '写作风格配方大全\n' + '='.repeat(24) + '\n\n';
    order.forEach(cat=>{
      txt += `${CAT_LABEL[cat] || cat}（${groups[cat].length}）\n${'-'.repeat(20)}\n`;
      groups[cat].forEach(s=>{
        txt += `\n【${s.name}】${s.custom?'[自定义]':''}\n`;
        if(s.note) txt += `指令：${s.note}\n`;
        if(s.tips && s.tips.length) txt += `写法：${s.tips.map((t,i)=>`${i+1}. ${t}`).join('；')}\n`;
        if(s.avoid && s.avoid.length) txt += `避免：✗ ${s.avoid.join('；✗ ')}\n`;
        if(s.check && s.check.length) txt += `自查：${s.check.map(c=>`□ ${c}`).join('　')}\n`;
        if(s.demo) txt += `示例：「${s.demo}」\n`;
      });
      txt += '\n';
    });
    copyText(txt);
  };
}
function closeStyleLibReader(){ const p=$('#wsLibReader'); if(p) p.remove(); }

const FLOW_NAV = [
  ['风','[data-flow="1"]'],     // 用户写作风格：表达层最高权威
  ['基','[data-flow="2"]'],     // 章节数/全书四七十二十五拍/叙事主体：优化前置决策
  ['构','[data-flow="3"], [data-flow="2"]'],     // 原始构想 + 优化构想：AI建议层
  ['配方','.ai-recipe-card, [data-flow="4"], [data-flow="3"]', 'recipe'],     // 写作配方：把已锁定风格转成可执行规则
  ['节','[data-flow="5"], [data-flow="4"]'],     // 全书节拍成果
  ['典','[data-flow="6"], [data-flow="5"]'],     // 词典达人：建设者
  ['充','[data-flow="7"], [data-flow="6"]'],     // 词典充实：深化者
  ['校','[data-flow="8"], [data-flow="7"]'],     // 校长/学校统筹
  ['词','[data-flow="7.5"], [data-flow="8.5"], .card-theme-glossary, .gs-card'],     // 万物词典：全书共享事实数据库
  ['正','[data-flow="9"], [data-flow="8"]']      // 正文作家 · 章节创作
];
function flowNavItems(){
  return FLOW_NAV.filter(([l, sel, key])=>{
    try{
      if(l === '配方' || key === 'recipe') return !!(document && (document.querySelector('.ai-recipe-card') || document.querySelector(sel)));
      return !!(document && document.querySelector(sel));
    }catch(e){ return false; }
  });
}
function flowNavHtml(){
  const items = flowNavItems();
  return `<div class="flow-sidenav">${items.map(([l, sel, key])=>{
    const isRecipe = (l === '配方' || key === 'recipe');
    return `<button type="button" class="fsd-btn${isRecipe?' fsd-btn-recipe':''}" ${isRecipe?'data-nav-key="recipe"':''} title="跳到「${l}」">${l}</button>`;
  }).join('')}</div>`;
}
function bindFlowSideNav(){
  const old = document.querySelector('.flow-sidenav'); if(old && old.parentNode) old.parentNode.removeChild(old);
  const items = flowNavItems(); if(!items.length) return;
  const nav = document.createElement('div');
  nav.className = 'flow-sidenav';
  items.forEach(([l, sel, key])=>{
    const b = document.createElement('button');
    b.type = 'button';
    const isRecipe = (l === '配方' || key === 'recipe');
    b.className = 'fsd-btn' + (isRecipe ? ' fsd-btn-recipe' : '');
    b.dataset.navSel = sel;
    if(isRecipe) b.dataset.navKey = 'recipe';
    b.title = '跳到「'+l+'」';
    b.textContent = l;
    b.onclick = ()=>{
      let el = null;
      if(isRecipe){
        el = document.querySelector('.ai-recipe-card') || document.querySelector('[data-ai-recipe-fold]') || document.querySelector(sel);
      } else {
        el = document.querySelector(sel);
      }
      if(el){
        if(isRecipe){
          const card = el.closest ? (el.closest('.ai-recipe-card') || el) : el;
          if(card && card.classList && card.classList.contains('collapsed')){
            card.classList.remove('collapsed');
            const ico = card.querySelector('.sc-fold-ico');
            if(ico) ico.textContent = '▾';
            const cfg = getCfg();
            cfg.aiRecipeCollapsed = false;
            saveCfg(cfg);
          }
          try{
            el.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
          }catch(e){
            el.scrollIntoView(true);
          }
        } else if(l === '正'){
          const targetCard = el.querySelector('#chaptersWrap') || el.querySelector('.ch-card') || el.querySelector('.card') || el;
          try{
            targetCard.scrollIntoView({ behavior:'smooth', block:'center', inline:'nearest' });
          }catch(e){
            targetCard.scrollIntoView(true);
          }
          targetCard.classList.add('gs-flash');
          setTimeout(()=> targetCard.classList.remove('gs-flash'), 1600);
          return;
        } else {
          el.scrollIntoView({ behavior:'smooth', block:'start' });
        }
        el.classList.add('gs-flash');
        setTimeout(()=> el.classList.remove('gs-flash'), 1600);
      }
    };
    nav.appendChild(b);
  });
  ((document.getElementById('view') ? document.getElementById('view').parentElement : document.body) || document.body).appendChild(nav);
}
function flowPlaceholderSec(n, name, note, icon, desc){
  return `<section class="flow-sec" data-flow="${n}">
    <div class="flow-sec-head"><span class="fs-no">${n}</span><span class="fs-name">${name}</span><span class="fs-note">${note}</span></div>
    <div class="dict-master-placeholder">${icon} ${desc}</div>
  </section>`;
}
function openFactCardModal(){ openNeModal('事实与一致性看板', factCardHtml() || '<div class="empty">暂无事实与一致性数据。</div>'); }
function openRollingSummaryModal(){ openNeModal('滚动摘要', rollingSummaryCardHtml() || '<div class="empty">暂无滚动摘要。</div>'); }

function consistencyReportHtml(){
  const o = state.outline; const g = (o && o.glossary) || {};
  const totalN = (o && Array.isArray(o.chapters)) ? o.chapters.length : 0;
  const rows = [];
  const dupGroups = [];
  ['characters','places','propernouns'].forEach(k=>{
    const byName = {};
    (g[k]||[]).forEach(x=>{ const n=String(x&&x.name||'').trim(); if(!n) return; (byName[n]=byName[n]||[]).push(x); });
    Object.keys(byName).forEach(n=>{ if(byName[n].length>1) dupGroups.push({cat:k, name:n, count:byName[n].length, list:byName[n]}); });
  });
  if(dupGroups.length){
    rows.push(`<div class="chk-item bad">✗ 词典存在同名重复（${dupGroups.length} 组）</div>`);
    dupGroups.forEach(d=>{
      const src = d.list.map(x=> x._dictmaster?'词典达人' : (x._auto?'逐章提取':'手工')).join('、');
      rows.push(`<div class="chk-sub">【${d.cat==='characters'?'人物':(d.cat==='places'?'地名':'专名')}】「${esc(d.name)}」×${d.count}（来源：${esc(src)}），应仅保留高优先级一份。</div>`);
    });
  } else {
    rows.push(`<div class="chk-item ok">✓ 词典无同名重复（人物 ${(g.characters||[]).length} · 地名 ${(g.places||[]).length} · 专名 ${(g.propernouns||[]).length}）</div>`);
  }
  const noBeat = [];
  for(let i=0;i<totalN;i++){
    const p = (Array.isArray(o.chapterPlans) && o.chapterPlans[i]) || null;
    if(!String(p && p.beatsText || '').trim()) noBeat.push(i+1);
  }
  if(noBeat.length) rows.push(`<div class="chk-item bad">✗ 章节拍悬空：第 ${noBeat.join('、')} 章节拍表为空（缺节拍）</div>`);
  else if(totalN) rows.push(`<div class="chk-item ok">✓ 全部 ${totalN} 章均有节拍表，无悬空</div>`);
  const tl = (o && o._globalTimeline) || null;
  const tlText = tl && String(tl.text||'').trim();
  if(!tl || (!tlText && !Array.isArray(tl.chapters))){
    rows.push(`<div class="chk-item warn">△ 全局时间线未生成（可为规划师③步后补），时间锚悬空无法校验</div>`);
  } else if(tlText){
    rows.push(`<div class="chk-item ok">✓ 全局时间线已生成（纯文本，每章时点已内联，正文据此承接）</div>`);
  } else {
    const anchors = tl.chapters;
    const covered = new Set(anchors.map(a=>a&&a.index).filter(n=>Number.isFinite(n)));
    const missCh = [];
    for(let i=0;i<totalN;i++){ if(!covered.has(i)) missCh.push(i+1); }
    const mono = [];
    const sorted = anchors.slice().sort((a,b)=>(a.index-b.index));
    for(let k=1;k<sorted.length;k++){
      const prevT = sorted[k-1].to, curT = sorted[k].from;   // 上一章结尾 vs 本章开头
      if(!prevT || !curT) continue;
      const a = normTimeW(prevT), b = normTimeW(curT);
      if(a!=null && b!=null && b < a) mono.push(`第${sorted[k-1].index+1}章末「${esc(prevT)}」→ 第${sorted[k].index+1}章初「${esc(curT)}」`);
    }
    if(mono.length) rows.push(`<div class="chk-item bad">✗ 时间锚疑似回退（${mono.length} 处）：${mono.slice(0,3).join('；')}${mono.length>3?'…':''}</div>`);
    else rows.push(`<div class="chk-item ok">✓ 时间锚未发现明显回退</div>`);
    if(missCh.length) rows.push(`<div class="chk-item warn">△ 全局时间表未覆盖章节：第 ${missCh.join('、')} 章（可点规划师③步重排补落位）</div>`);
    else if(totalN) rows.push(`<div class="chk-item ok">✓ 全局时间表每章均有落点（${anchors.length} 锚 / ${totalN} 章）</div>`);
  }
  if(!totalN) rows.push(`<div class="chk-item warn">△ 尚无章节，无法做节拍/时间线自检</div>`);
  const hasDup = dupGroups.length>0, hasBeat = noBeat.length>0, hasMono = /✗ 时间锚/.test(rows.join(''));
  rows.push(`<div class="chk-summary">累计：${hasDup||hasBeat||hasMono ? '发现问题，请按提示修正后重跑。' : '各项通过 ✓'}</div>`);
  return `<div class="chk-wrap">${rows.join('')}</div>`;
}
function normTimeW(t){
  const s = String(t||'').trim(); if(!s) return null;
  if(/^[\d.]+$/.test(s)){ const f=parseFloat(s); return Number.isFinite(f)?f:null; }
  const digits = s.replace(/[^0-9]+/g,''); if(digits.length){ const n=+digits; return Number.isFinite(n)?n:null; }
  return null;
}
function openConsistencyCheck(){ openNeModal('一致性自检（阶段4）', consistencyReportHtml() || '<div class="empty">暂无数据。</div>'); }

function safeCard(fn, fb){
  try{ return fn(); }catch(e){ console.error('[safeCard]', e); return fb || ''; }
}

function ensureLongMemory(){
  state.longMemory = state.longMemory || {uiOpen:false, foreshadow:[], lastAuditAt:0};
  if(!Array.isArray(state.longMemory.foreshadow)) state.longMemory.foreshadow=[];
  return state.longMemory;
}
function writtenChapterCount(){
  return (state.chapters||[]).filter(c=>c && String(c.content||'').trim()).length;
}
function currentWrittenIndex(){
  for(let i=(state.chapters||[]).length-1;i>=0;i--) if(state.chapters[i] && String(state.chapters[i].content||'').trim()) return i;
  return -1;
}
function extractPlanField(plan, names){
  const t=String(plan&&plan.beatsText||'');
  for(const n of names){
    const re=new RegExp('(?:^|\\n)\\s*'+n+'[：:]\\s*([^\\n]+)','m');
    const m=t.match(re); if(m) return m[1].trim();
  }
  return '';
}
function refreshForeshadowBank(){
  const mem=ensureLongMemory(), o=state.outline||{};
  const plans=Array.isArray(o.chapterPlans)?o.chapterPlans:[];
  const next=[];
  plans.forEach((p,i)=>{
    const f=extractPlanField(p,['埋设伏笔','伏笔','埋伏笔']);
    if(!f || /^(无|暂无|无。|没有)$/i.test(f.trim())) return;
    const later=(state.chapters||[]).slice(i+1).map(c=>String(c&&c.content||'')).join('\n');
    const key=f.replace(/[「」“”【】（）()]/g,'').split(/[，,；;。]/)[0].trim().slice(0,18);
    const recovered=key && later.includes(key);
    next.push({id:`${i+1}-${key}`, chapter:i+1, text:f.slice(0,180), status:recovered?'suspected-recovered':'open'});
  });
  mem.foreshadow=next.slice(-120);
  mem.lastAuditAt=Date.now();
  return mem.foreshadow;
}
function longNovelMemoryData(){
  const o=state.outline||{}, g=o.glossary||{}, idx=currentWrittenIndex();
  const dig=Array.isArray(o._chapterDigests)?o._chapterDigests:[];
  const fc=o._factCard||{};
  const plan=idx>=0 && Array.isArray(o.chapterPlans)?o.chapterPlans[idx]:null;
  const prev=idx>=0?state.chapters[idx]:null;
  const time=(fc.timeAnchors||[]).find(x=>x && x.ch===idx);
  const mem=ensureLongMemory();
  if(!mem.foreshadow.length && plansExist(o)) refreshForeshadowBank();
  return {o,g,idx,digest:idx>=0?(dig[idx]&&dig[idx].text||''):'',fc,plan,prev,time,foreshadow:mem.foreshadow};
}
function plansExist(o){ return !!(o && Array.isArray(o.chapterPlans) && o.chapterPlans.some(Boolean)); }
function longMemoryBrief(i){
  if(!isLong() || !state.outline) return '';
  const d=longNovelMemoryData();
  const lines=[];
  if(d.idx>=0){
    lines.push(`【小说当前状态账本｜截至第 ${d.idx+1} 章】`);
    if(d.prev && d.prev.title) lines.push(`- 最近完成章节：第 ${d.idx+1} 章《${String(d.prev.title).trim()}》`);
    if(d.fc.lastScene) lines.push(`- 最后定格场景：${String(d.fc.lastScene).slice(0,140)}`);
    if(d.time) lines.push(`- 最近时间锚：${String(d.time.time||d.time.to||d.time.from||'').slice(0,80)}`);
    if(d.digest) lines.push(`- 最近剧情事实：${String(d.digest).slice(0,360)}`);
  }
  const open=(d.foreshadow||[]).filter(x=>x.status==='open').slice(-8);
  if(open.length) lines.push(`【伏笔银行｜未确认回收】\n${open.map(x=>`- 第${x.chapter}章埋设：${x.text}`).join('\n')}`);
  if(d.plan){
    const causal=extractPlanField(d.plan,['事件因果施工','因果施工']);
    const conn=extractPlanField(d.plan,['连续性','承接']);
    if(conn) lines.push(`【当前章节承接锚】${conn.slice(0,220)}`);
    if(causal) lines.push(`【当前章节因果施工】${causal.slice(0,260)}`);
  }
  return lines.join('\n');
}
function longMemoryPromptBlock(i){
  const b=longMemoryBrief(i);
  if(!b) return '';
  return `\n\n${b}\n【长篇记忆执行令】以上内容是从已落地正文/教案/词典派生的记忆层，不是新剧情指令。不得用记忆层制造新事实；必须从既有状态继续，重大事件仍需通过教案与因果闭环抵达。`;
}
function causalityMapHtml(){
  const o=state.outline||{}; const plans=Array.isArray(o.chapterPlans)?o.chapterPlans:[]; const written=writtenChapterCount();
  const rows=[];
  plans.slice(0, Math.min(plans.length, written+4)).forEach((p,i)=>{
    const b=extractPlanField(p,['承接点','承接']); const a=extractPlanField(p,['逐拍推进','场景链与切换','场景链']); const z=extractPlanField(p,['收束设计','收束']);
    if(b||a||z) rows.push(`<div class="lm-causal-row"><span>第${i+1}章</span><div><b>${esc(b||'承接既有状态')}</b><span>→ ${esc(a||'推进本章教案事件')}</span><span>→ ${esc(z||'形成下一章接口')}</span></div></div>`);
  });
  return rows.length?rows.join(''):'<div class="muted">尚无足够章节教案可形成因果地图。</div>';
}
function relationshipTrajectoryHtml(){
  const g=(state.outline&&state.outline.glossary)||{}, rel=Array.isArray(g._relationshipTable)?g._relationshipTable:[];
  if(!rel.length) return '<div class="muted">词典尚无关系表；词典达人产出后这里会自动显示。</div>';
  return `<div class="lm-rel-grid">${rel.slice(0,24).map(x=>`<div class="lm-rel"><b>${esc(x.a||'?')}</b><span>↔ ${esc(x.relation||'关系')} ↔</span><b>${esc(x.b||'?')}</b>${x.note?`<small>${esc(x.note)}</small>`:''}</div>`).join('')}</div>`;
}
function seamAuditHtml(){
  const written=writtenChapterCount(); if(written<2) return '<div class="muted">至少完成 2 章后才能进行章间接缝检查。</div>';
  const rows=[]; const o=state.outline||{};
  for(let i=Math.max(1,written-5);i<written;i++){
    const prev=state.chapters[i-1], cur=state.chapters[i];
    const tail=String(prev&&prev.content||'').trim().slice(-120); const plan=Array.isArray(o.chapterPlans)?o.chapterPlans[i]:null;
    const conn=extractPlanField(plan,['承接点','承接','连续性']);
    const ok=!!tail && !!conn;
    rows.push(`<div class="lm-seam-row"><b>第${i}→第${i+1}章</b><span class="pill ${ok?'tag-ok':'tag-warn'}">${ok?'✓ 有物理接缝':'△ 需要检查'}</span><small>${esc(conn||'教案未提供明确承接点')}</small></div>`);
  }
  return rows.join('');
}
function longNovelHealthHtml(){
  const o=state.outline||{}, total=(o.chapters||[]).length||chapterCountVal()||0, written=writtenChapterCount();
  const plans=Array.isArray(o.chapterPlans)?o.chapterPlans:[];
  const noPlan=Math.max(0,total-plans.filter(Boolean).length), noDigest=Math.max(0,written-(Array.isArray(o._chapterDigests)?o._chapterDigests.filter(Boolean).length:0));
  const fo=refreshForeshadowBank(); const open=fo.filter(x=>x.status==='open').length;
  const scores={连续性:Math.max(55,100-Math.min(35,noDigest*4)),因果:Math.max(55,100-Math.min(35,noPlan*3)),伏笔:open?Math.max(60,96-Math.min(30,open*2)):96,记忆:written?Math.max(65,100-Math.min(30,noDigest*5)):60};
  return `<div class="lm-health-grid">${Object.entries(scores).map(([k,v])=>`<div class="lm-score"><b>${k}</b><strong>${v}</strong><span>/100</span></div>`).join('')}</div><div class="lm-health-notes"><span>已写 ${written}/${total||'?'} 章</span><span>缺教案 ${noPlan}</span><span>缺细摘要 ${noDigest}</span><span>未确认回收伏笔 ${open}</span></div>`;
}
function getDeckStepStatus(){
  const o = state.outline;
  const chs = (o && Array.isArray(o.chapters)) ? o.chapters : [];
  const total = chs.length || chapterCountVal() || 0;
  const written = writtenChapterCount();
  const groups = schoolStageGroups();
  const folded = isSchoolFolded();

  const s1_done = !!(state.chapterStyle && state.chapterStyle.tags && state.chapterStyle.tags.length);
  const s2_done = !!(state.polishAdopted || (state.idea && state.idea.trim()));
  const s3_done = !!(state.outlineConfirmed && o && chs.length > 0);
  const s4_done = !!(scDone('dictMaster') || state.dictmasterRan || (o && o.glossary && ((o.glossary.characters||[]).length > 0)));
  const s5_done = scDone('principal');
  const s6_done = folded ? scDone('principal') : (groups.length > 0 && groups.every((g,i)=>scDone('t'+i)));
  const s7_done = (total > 0 && written >= total);

  const steps = [
    { key:'style', name:'风格', done:s1_done, target:'[data-flow="1"]', desc: s1_done ? '已选定小说文风倾向' : '待设定小说文风' },
    { key:'idea',  name:'构想', done:s2_done, target:'[data-flow="2"]', desc: s2_done ? '核心故事构想已就绪' : '待输入核心构想' },
    { key:'outline',name:'大纲', done:s3_done, target: (o ? '[data-flow="2"]' : '#btnGenOutline'), desc: s3_done ? `已定稿 ${chs.length} 章分卷大纲` : '待生成全书大纲' },
    { key:'dict',  name:'词典', done:s4_done, target:'.card-theme-dictmaster', desc: s4_done ? '万物词典人物/地名已架构' : '待词典达人建立万物词典' },
    { key:'principal',name:'校长', done:s5_done, target:'.school-card', desc: s5_done ? '校长统筹守则与标题已定稿' : '待校长统筹全局' },
    { key:'teacher',name:'老师', done:s6_done, target:'.school-teachers', desc: s6_done ? (folded ? '单老师教案已出齐' : `${groups.length} 位老师分段教案就绪`) : '待老师备课分段教案' },
    { key:'chapter',name:'正文', done:s7_done, target:'.chapter-card', desc: written ? `正文已落地 ${written}/${total||'?'} 章` : '待生成第 1 章正文' }
  ];

  let foundActive = false;
  steps.forEach(st => {
    if(!st.done && !foundActive){
      st.active = true;
      foundActive = true;
    } else {
      st.active = false;
    }
  });
  return steps;
}

function openCreationProgressModal(){
  const o = state.outline;
  const chs = (o && Array.isArray(o.chapters)) ? o.chapters : [];
  const total = chs.length || chapterCountVal() || 0;
  const written = writtenChapterCount();
  const pct = total ? Math.round(written/total*100) : 0;
  const steps = getDeckStepStatus();

  let totalChars = 0;
  const chRows = [];
  for(let i=0; i<total; i++){
    const ch = chs[i] || {};
    const title = String(ch.title || (state.school && state.school.principal && state.school.principal.titles && state.school.principal.titles[i]) || `第 ${i+1} 章`).trim();
    const body = String(ch.body || ch.content || '').trim();
    const len = body.length;
    if(len > 0) totalChars += len;
    const hasPlan = Array.isArray(o.chapterPlans) && !!o.chapterPlans[i];
    chRows.push({
      idx: i + 1,
      title,
      len,
      done: len > 0,
      hasPlan
    });
  }

  const g = (o && o.glossary) || {};
  const charCount = (g.characters||[]).length;
  const placeCount = (g.places||[]).length;
  const propCount = (g.propernouns||[]).length;
  const ruleCount = (g.rules||[]).length;

  const fo = refreshForeshadowBank();
  const foOpen = fo.filter(x=>x.status==='open').length;
  const foDone = fo.filter(x=>x.status==='done'||x.status==='resolved').length;

  const bodyHtml = `
    <div class="cp-modal-view">
      <!-- 汇总大卡片 -->
      <div class="cp-summary-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">
        <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--dim)">章节落地率</div>
          <div style="font-size:20px;font-weight:700;color:var(--pri);margin-top:2px">${written} / ${total||'?'} <span style="font-size:12px;font-weight:400;color:var(--sub)">(${pct}%)</span></div>
          <div style="height:4px;background:var(--line);border-radius:2px;margin-top:6px;overflow:hidden">
            <div style="height:100%;background:var(--pri);width:${pct}%"></div>
          </div>
        </div>
        <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--dim)">正文总字数</div>
          <div style="font-size:20px;font-weight:700;color:var(--txt);margin-top:2px">${totalChars.toLocaleString()} <span style="font-size:12px;font-weight:400;color:var(--sub)">字</span></div>
          <div style="font-size:11px;color:var(--dim);margin-top:6px">${written ? `均章 ${Math.round(totalChars/written)} 字` : '首章待生成'}</div>
        </div>
        <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--dim)">万物词典资产</div>
          <div style="font-size:18px;font-weight:700;color:var(--txt);margin-top:2px">${charCount} 人物 · ${placeCount} 地名</div>
          <div style="font-size:11px;color:var(--dim);margin-top:6px">${propCount} 专名 · ${ruleCount} 规则</div>
        </div>
        <div style="background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--dim)">伏笔与因果</div>
          <div style="font-size:18px;font-weight:700;color:var(--txt);margin-top:2px">${foOpen} <span style="font-size:12px;font-weight:400;color:var(--sub)">待回收</span></div>
          <div style="font-size:11px;color:var(--dim);margin-top:6px">${foDone} 条已确认回收</div>
        </div>
      </div>

      <!-- 7 大创作工序全景健康体检 -->
      <div style="margin-bottom:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span>🎯 长篇创作工序全景状态</span>
          <span style="font-size:11px;color:var(--dim);font-weight:400">（点击工序可直接跳转到对应卡片）</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${steps.map(st=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;gap:8px">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="pill ${st.done ? 'tag-ok' : (st.active ? 'tag-warn' : '')}" style="font-size:11px;padding:2px 6px">
                  ${st.done ? '✓ 已就绪' : (st.active ? '⏳ 进行中' : '⚪ 待推进')}
                </span>
                <b style="font-size:13px">${esc(st.name)}</b>
                <span style="font-size:12px;color:var(--sub)">${esc(st.desc)}</span>
              </div>
              <button type="button" class="btn small ghost" data-modal-jump="${st.target}" style="padding:2px 8px;font-size:11px">定位</button>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 逐章落地进度明细表 -->
      ${chRows.length ? `
        <div>
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">📖 逐章落地明细表（共 ${chRows.length} 章）</div>
          <div style="max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:6px">
            <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
              <thead>
                <tr style="background:var(--panel2);border-bottom:1px solid var(--line);color:var(--dim)">
                  <th style="padding:6px 10px;width:60px">章号</th>
                  <th style="padding:6px 10px">标题</th>
                  <th style="padding:6px 10px;width:90px">正文字数</th>
                  <th style="padding:6px 10px;width:90px">状态</th>
                </tr>
              </thead>
              <tbody>
                ${chRows.map(r=>`
                  <tr style="border-bottom:1px solid var(--line)">
                    <td style="padding:6px 10px;font-weight:600">第 ${r.idx} 章</td>
                    <td style="padding:6px 10px">${esc(r.title)}</td>
                    <td style="padding:6px 10px;color:${r.done?'var(--pri)':'var(--dim)'}">${r.done ? `${r.len.toLocaleString()} 字` : '—'}</td>
                    <td style="padding:6px 10px">
                      <span class="pill ${r.done ? 'tag-ok' : (r.hasPlan ? 'tag-warn' : '')}" style="font-size:10px;padding:1px 5px">
                        ${r.done ? '✓ 正文就绪' : (r.hasPlan ? '教案已备' : '待推进')}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const actsHtml = `
    <button type="button" class="btn ghost small" data-modal-open-repo>🧠 展开长篇体检仓</button>
    <button type="button" class="btn primary small" data-modal-close>关闭</button>
  `;

  openNeModal('📊 长篇创作全景进度与健康体检', bodyHtml, actsHtml);

  // 绑定弹窗内事件
  const m = $('#neModal');
  if(m){
    m.querySelectorAll('[data-modal-jump]').forEach(b=>{
      b.onclick = ()=>{
        const target = document.querySelector(b.dataset.modalJump);
        closeNeModal();
        if(target){
          setTimeout(()=>{
            target.scrollIntoView({ behavior:'smooth', block:'center' });
            target.classList.add('gs-flash');
            setTimeout(()=> target.classList.remove('gs-flash'), 1600);
          }, 150);
        }
      };
    });
    const repoBtn = m.querySelector('[data-modal-open-repo]');
    if(repoBtn){
      repoBtn.onclick = ()=>{
        closeNeModal();
        const d = document.querySelector('.long-memory-repo details');
        if(d){
          d.open = true;
          ensureLongMemory().uiOpen = true;
          persist();
          setTimeout(()=> d.scrollIntoView({ behavior:'smooth', block:'start' }), 150);
        }
      };
    }
    const closeBtn = m.querySelector('[data-modal-close]');
    if(closeBtn) closeBtn.onclick = ()=> closeNeModal();
  }
}

function longNovelControlDeckHtml(){
  if(!isLong()) return '';
  const d=longNovelMemoryData(); const total=(state.outline&&state.outline.chapters||[]).length||chapterCountVal()||0, written=writtenChapterCount();
  const current=written?written:0; const pct=total?Math.round(written/total*100):0;
  const steps = getDeckStepStatus();
  const stepsHtml = steps.map(st=>{
    const cls = st.done ? 'done' : (st.active ? 'active' : '');
    return `<span class="${cls}" data-deck-jump="${st.target}" title="点击定位到「${st.name}」环节" style="cursor:pointer">${esc(st.name)}</span>`;
  }).join('<b>→</b>');

  return `<section class="novel-control-deck" data-novel-deck>
    <div class="ncd-head">
      <div>
        <span class="ncd-kicker">🎬 LONGFORM CONTROL DESK</span>
        <h2>长篇导演台</h2>
        <p>只显示“现在最重要的状态与动作”；详细资料收进下方资料仓。</p>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <button type="button" class="btn small ghost ncd-view-progress" data-ncd-progress title="点击打开长篇全景创作进度与健康体检">📊 创作进度查看</button>
        <div class="ncd-progress" data-ncd-progress style="cursor:pointer" title="点击查看创作全景进度">
          <b>${current}/${total||'?'}</b>
          <span>章节落地 · ${pct}%</span>
          <i><em style="width:${pct}%"></em></i>
        </div>
      </div>
    </div>
    <div class="ncd-steps">${stepsHtml}</div>
    <div class="ncd-grid">
      <div class="ncd-card"><small>当前小说状态</small><b>${written?`第 ${written} 章已落地`:'尚未落地正文'}</b><span>${esc(d.fc.lastScene||'等待第一章形成真实世界状态')}</span></div>
      <div class="ncd-card"><small>下一关键动作</small><b>${written<total?'继续生成下一章':'检查全书收束'}</b><span>${written<total?'正文将从上一章真实状态继续，不另起炉灶。':'全书已达到计划章节数，可进入体检与收束检查。'}</span></div>
      <div class="ncd-card" data-ncd-progress style="cursor:pointer"><small>长篇健康</small><b>${written?'记忆链已启用':'等待首章'}</b><span>状态账本 · 因果地图 · 伏笔银行 · 章间接缝</span></div>
    </div>
  </section>`;
}
function longNovelMemoryRepoHtml(){
  if(!isLong() || !state.outline) return '';
  return `<section class="flow-repo long-memory-repo" data-repo="novel-memory"><details class="repo-drawer" ${ensureLongMemory().uiOpen?'open':''}><summary><span class="repo-ic">🧠</span><b>长篇记忆与体检仓</b><span class="repo-note">状态、因果、伏笔、人物关系、章间接缝集中管理</span><span class="repo-open">展开检查 ▸</span></summary><div class="repo-body">
    <div class="lm-section"><div class="lm-title">🧭 小说状态账本</div><div class="lm-state"><div><b>当前章</b><span>${writtenChapterCount()?`第${writtenChapterCount()}章`:'—'}</span></div><div><b>最后定格</b><span>${esc((state.outline._factCard&&state.outline._factCard.lastScene)||'—')}</span></div><div><b>章节数</b><span>${(state.outline.chapters||[]).length||chapterCountVal()||'—'}</span></div></div></div>
    <div class="lm-section"><div class="lm-title">🕸️ 因果地图</div><div class="lm-causal">${causalityMapHtml()}</div></div>
    <div class="lm-section"><div class="lm-title">🏦 伏笔银行</div><div class="lm-foreshadow">${refreshForeshadowBank().slice(-12).reverse().map(x=>`<div><span class="pill ${x.status==='open'?'tag-warn':'tag-ok'}">${x.status==='open'?'待回收':'疑似回收'}</span><b>第${x.chapter}章</b><span>${esc(x.text)}</span></div>`).join('')||'<span class="muted">暂无可识别伏笔；教案中的“埋设伏笔”会自动进入这里。</span>'}</div></div>
    <div class="lm-section"><div class="lm-title">👥 人物关系状态</div>${relationshipTrajectoryHtml()}</div>
    <div class="lm-section"><div class="lm-title">🪡 章间接缝</div><div class="lm-seams">${seamAuditHtml()}</div></div>
    <div class="lm-section"><div class="lm-title">📊 小说体检</div>${longNovelHealthHtml()}</div>
  </div></details></section>`;
}
function bindLongNovelMemoryRepo(){
  const d=document.querySelector('.long-memory-repo details'); if(!d) return;
  d.addEventListener('toggle',()=>{ ensureLongMemory().uiOpen=d.open; persist(); });
}
function bindLongNovelControlDeck(){
  $$('[data-ncd-progress]').forEach(btn=>{
    btn.onclick = ()=> openCreationProgressModal();
  });
  $$('[data-deck-jump]').forEach(el=>{
    el.onclick = ()=>{
      const sel = el.dataset.deckJump;
      if(!sel) return;
      const target = document.querySelector(sel);
      if(target){
        target.scrollIntoView({ behavior:'smooth', block:'center' });
        target.classList.add('gs-flash');
        setTimeout(()=> target.classList.remove('gs-flash'), 1600);
      }
    };
  });
}

function viewStory(){
  if(!state.outline){
    const homeSub = isLong()
      ? `用几句话描述你的长篇构想（世界观、主角、核心冲突都行）。AI 会按你设定的章节数与全书拍子扩写成大纲，之后按「生成章节」逐步写完。`
      : '用几句话描述你的点子（世界观、主角、核心冲突都行）。AI 会扩写成完整故事大纲与章节。';
    const opt_card = `
        <div class="card card-theme-idea">
          <div class="card-head-bar">
            <div class="ch-left">
              <span class="ch-badge ch-badge-idea">💡</span>
              <h3 class="ch-title">用户构想与五向优化</h3>
              <span class="ch-subtag ch-subtag-idea">${(state.polishOptions&&state.polishOptions.length)?'✨ 构想已优化':'待优化'}</span>
            </div>
            <div class="ch-right">
              <label class="pol-multi" title="生成多方向构想供比选"><input type="checkbox" id="chkPolishMulti" checked> 多方案</label>
            </div>
          </div>
          <div class="idea-row">
            <textarea id="ideaInput" placeholder="描述你的故事点子（世界观、主角、核心冲突等）…">${esc(state.idea)}</textarea>
          </div>
          <div class="btn-row">
            <button id="btnPolishIdea" class="btn ghost ${polishIdle()?'first':''}">✨ 优化构想</button>
          </div>
          <div id="polishBox" class="pol-box" style="display:${state.polishCollapsed?'none':'block'}">
            <div class="pol-head"><b>✨ 方案比选</b>
              <span class="pol-tools">
                <button id="btnPolishDiscard" class="btn small ghost">✕ 收起</button>
              </span>
            </div>
            <div id="polishCards" class="pol-cards"></div>
          </div>
          ${ (state.polishCollapsed && Array.isArray(state.polishOptions) && state.polishOptions.length) ? `<div class="pol-keep pol-keep-collapsed"><span class="pol-keep-t">✓ 已采用：${esc(state.polishAdopted || state.polishOptions[0].name || '方案1')} · 优化方案已收起</span><span class="pol-keep-btns"><button type="button" class="btn small ghost" data-pol-keep-view>🔍 展开/更换方案</button></span></div>` : '' }
          ${ polishKeepBar() }
          <div class="btn-row">
            <button id="btnGenOutline" class="btn primary block" ${(!(Array.isArray(state.polishOptions) && state.polishOptions.length))?'disabled title="请先优化构想再生成大纲"':''}>${(!(Array.isArray(state.polishOptions) && state.polishOptions.length))?'📋 待优化构想后生成':(isLong()?'📚 生成大纲':'✨ 生成故事大纲')}</button>
          </div>
          <p id="outlineStatus" class="status"></p>
        </div>`;
    return CYBER_HOME_GRID + `${isLong()?longNovelControlDeckHtml():''}
    <div class="flow-wrap">
            <section class="flow-sec" data-flow="1">
        <div class="flow-sec-head"><span class="fs-no">1</span><span class="fs-name">写作风格</span><span class="fs-note">用户先定表达方式 · 全书共享 · 表达层最高权威</span></div>
        <div class="flow-style-lock-note" style="margin:0 0 10px;padding:9px 12px;border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);font-size:12px;line-height:1.7">
          🔒 <b>表达层最高权威</b>：这里确定「怎么写」。后续优化构想只能提供创意建议，不得偷偷改写你已经选定的写作风格。
        </div>
        ${ safeCard(()=>writeStyleCard()) }
      </section>
<section class="flow-sec flow-action-sec" data-flow="2">
  <div class="flow-sec-head"><span class="fs-no">2</span><span class="fs-name">创作基础</span><span class="fs-note">先确定章节数与全书宏观拍子，再交给优化构想</span></div>
  <div class="card card-theme-idea decision-base-card">
    <div class="card-head-bar">
      <div class="ch-left"><span class="ch-badge ch-badge-beat">🧭</span><h3 class="ch-title">故事基础设置</h3><span class="ch-subtag ch-subtag-beat">优化构想读取这里的选择</span></div>
      <div class="ch-right"><span class="muted" style="font-size:12px">先定骨架</span></div>
    </div>
    ${isLong() ? `
    <div class="tw-panel" style="margin-bottom:10px">
      <div class="poly-head"><span class="poly-ic">📐</span><b>全书章节数</b><span class="poly-rule">必填 · 1-200 整数</span></div>
      <div class="tw-row">
        <input type="number" id="chapterCountIn" class="tw-in cc-in" min="1" max="200" step="1" inputmode="numeric" placeholder="如 30" value="${chapterCountVal()||''}" />
        <span class="tw-unit">章</span>
        ${chapterCountVal()?`<span class="pill tag-ok">${chapterCountHint()}</span>`:''}
      </div>
    </div>
    ${bookBeatHtml()}
    ${openingStrategyHtml()}
    ` : ''}
    <h4 style="margin:18px 0 6px">叙事视角</h4>
    <div class="team-pick" id="teamPick">
      ${TEAM_OPTIONS.map(o=>`
      <label class="team-item ${o.id===currentTeamShape().id?'sel':''}" data-team="${o.id}" title="${esc(o.desc)}">
        <span class="team-ic">${o.id==='solo'?'👤':o.id==='dual'?'👫':o.id==='trio'?'🤝':o.id==='quad'?'👥':'🧑‍🤝‍🧑'}</span>
        <span class="team-txt"><b>${esc(o.label)}</b><i>${esc(o.desc)}</i></span>
        <input type="radio" name="teamShape" value="${o.id}" style="display:none" ${o.id===currentTeamShape().id?'checked':''}>
      </label>`).join('')}
    </div>
  </div>
</section>
<section class="flow-sec flow-action-sec" data-flow="3">
  <div class="flow-sec-head"><span class="fs-no">3</span><span class="fs-name">故事构想与优化</span><span class="fs-note">AI 只在已确定的表达与全书骨架上优化故事</span></div>
  ${bookBeatBriefHtml()}
  ${opt_card}
</section>
<section class="flow-sec" data-flow="4">
        <div class="flow-sec-head"><span class="fs-no">4</span><span class="fs-name">写作配方</span><span class="fs-note">把已锁定风格翻译成可执行规则 · 全书共享</span></div>
        ${ safeCard(()=>aiRecipeCard()) }
        
      </section>
<section class="flow-sec" data-flow="5">
        <div class="flow-sec-head"><span class="fs-no">5</span><span class="fs-name">全书节拍</span><span class="fs-note">按全书主线节奏划分剧情阶段（本地映射）</span></div>
        ${ safeCard(()=> isLong() ? beatStructureCardHtml() : '') }
      </section>
<section class="flow-sec flow-info-sec" data-flow="6">
        <div class="flow-sec-head"><span class="fs-no">6</span><span class="fs-name">词典达人</span><span class="fs-note">全局设定架构师 · 人物/法宝/地理/规则硬设定</span></div>
        ${ safeCard(()=>dictMasterBlockHtml()) }
      </section>
<section class="flow-sec flow-info-sec" data-flow="7">
        <div class="flow-sec-head"><span class="fs-no">7</span><span class="fs-name">词典充实</span><span class="fs-note">设定细化工坊 · 感官特征 · 场景禁忌 · 氛围龙套</span></div>
        ${ safeCard(()=>dictEnrichBlockHtml()) }
      </section>
<section class="flow-sec flow-action-sec" data-flow="8">
        <div class="flow-sec-head"><span class="fs-no">8</span><span class="fs-name">学校统筹</span><span class="fs-note">章节微拍 → 校长全局总控 → 老师分段备课</span></div>
        ${ safeCard(()=>microBeatBlock()) }
        ${ safeCard(()=>schoolZoneBlock()) }
      </section>
<section class="flow-sec flow-info-sec" data-flow="7.5">
  <div class="flow-sec-head"><span class="fs-no">📇</span><span class="fs-name">万物词典</span><span class="fs-note">全书共享事实数据库 · 正文的设定唯一基准</span></div>
  ${ glossaryCardHtml() }
</section>
${longNovelMemoryRepoHtml()}
<section class="flow-sec" data-flow="9">
        <div class="flow-sec-head"><span class="fs-no">9</span><span class="fs-name">正文作家 · 章节创作</span><span class="fs-note">专注文学变现 · 双注入连贯撰写</span></div>
        ${ isLong() ? `<div class="btn-row" style="margin-top:8px">
          <label class="long-jump"><span>跳到章节：</span>
          <select id="longJump"><option value="">— 选择章节阅读 —</option>${state.chapters.map((c,i)=>`<option value="${i}">第${i+1}章 ${esc(cleanChapterTitle(c.title))}</option>`).join('')}</select></label>
        </div>` : '' }
        ${ safeCard(()=>qualityReportCardHtml()) }
        <div class="ch-toolbar">
          <span class="ch-toolbar-t">📚 章节列表（共 ${state.chapters.length} 章，已生成 ${state.chapters.filter(c=>c.content && String(c.content).trim()).length} 章）</span>
        </div>
        <div id="chaptersWrap"></div>
        ${ safeCard(()=>fixQueueCardHtml()) }
        <div class="btn-row" style="margin-top:12px">
          ${ isLong() ? `<span class="multi-gen">
            <span class="multi-gen-main">
              <button id="btnGenMany" class="btn blue">⚡ 批量生成多章</button>
            </span>
            <span class="gen-stepper">
              <button type="button" class="gen-step" data-gen-dec title="减少章数">−</button>
              <output id="genCountOut" class="gen-count-out" aria-live="polite">${genBatchN}</output><span class="gen-unit">章</span>
              <button type="button" class="gen-step" data-gen-inc title="增加章数">＋</button>
            </span>
          </span>` : `<button id="btnGenAllChapters" class="btn primary">⚡ 一键生成全部章节</button><button id="btnReOutline" class="btn ghost">重生成大纲</button>` }
        </div>
        ${ isLong() ? `<div class="range-gen">
          <button id="btnRangeGen" class="btn blue">⚡ 区间生成</button>
          <label class="rg-label">从第
            <input id="rgStart" type="number" min="1" max="${state.chapters.length}" value="1" class="rg-input">
          章</label>
          <span class="muted" style="font-size:12px">到第</span>
          <label class="rg-label">
            <input id="rgEnd" type="number" min="1" max="${state.chapters.length}" value="2" class="rg-input">
          章</label>
          <span id="rgStatus" class="muted" style="font-size:11px"></span>
        </div>` : '' }
        <p id="chStatus" class="status"></p>
        <p id="bgTaskIndicator" class="status muted" style="display:none;font-size:12px;margin-top:2px"></p>
        ${ isLong() ? `<div class="long-progress"></div>` : '' }
        <div id="wcTotal" class="wc-total hidden"></div>
        <div class="cyber-pad hidden"></div>
      </section>
    </div>`;
  }
  const o = state.outline;
  let html = `
  ${longNovelControlDeckHtml()}
  <div class="flow-wrap">
        <section class="flow-sec" data-flow="1">
      <div class="flow-sec-head"><span class="fs-no">1</span><span class="fs-name">写作风格</span><span class="fs-note">用户先定表达方式 · 全书共享 · 表达层最高权威</span></div>
      <div class="flow-style-lock-note" style="margin:0 0 10px;padding:9px 12px;border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);font-size:12px;line-height:1.7">
        🔒 <b>表达层最高权威</b>：这里确定「怎么写」。后续优化构想只能提供创意建议，不得偷偷改写你已经选定的写作风格。
      </div>
      ${ safeCard(()=>writeStyleCard()) }
    </section>
<section class="flow-sec" data-flow="2">
      <div class="flow-sec-head"><span class="fs-no">2</span><span class="fs-name">故事构想与优化</span><span class="fs-note">先保留原始灵感，再由 AI 提供可选优化方案</span></div>
      ${bookBeatBriefHtml()}
      <div class="card card-theme-idea">
        <div class="card-head-bar">
          <div class="ch-left">
            <span class="ch-badge ch-badge-idea">✨</span>
            <h3 class="ch-title">候选方案比选</h3>
            <span class="ch-subtag ch-subtag-idea">${(state.polishOptions&&state.polishOptions.length)?`${state.polishOptions.length} 个方案可选`:'多向优化'}</span>
          </div>
          <div class="ch-right">
            ${dictmasterLocked()?'<span class="muted" style="font-size:12px">②方案已锁定</span>':''}
          </div>
        </div>
        <div id="polishCards2" class="pol-box" style="display:block"></div>
        ${ polishKeepBar() }   <!-- v1.0.205 阶段5.5 后悔药：生成大纲后仍可 查看历史优化版本 / 重新优化 / 重新选候选后点下方「生成大纲」重搬（词典达人产出前可反悔） -->
        <div class="btn-row" style="margin-top:8px">
          <button data-gen-outline class="btn primary block" ${dictmasterLocked()?'disabled title="词典达人已产出，②方案已锁定"':''}>📚 生成大纲（搬入书名 / 简介 / 节拍）${dictmasterLocked()?'（②已锁定）':''}</button>
        </div>
      </div>
    <div class="card card-theme-idea">
      <div class="card-head-bar">
        <div class="ch-left">
          <span class="ch-badge ch-badge-idea">📋</span>
          <h3 class="ch-title">故事大纲与书名</h3>
          <span class="ch-subtag ch-subtag-idea">《${esc(o.title||'未命名')}》</span>
        </div>
        <div class="ch-right">
          ${titleManagerHtml()}
        </div>
      </div>
      <div class="so-fold-head" id="soLoglineBox" data-so-toggle role="button" tabindex="0" title="展开/收起小说简介" style="display:flex">
        <span class="so-fold">${state.soCollapsed?'▸':'▾'}</span><b>📌 小说简介</b>
        <button type="button" class="btn small ghost" id="btnLoglineEdit" title="编辑小说简介" style="margin-left:auto;padding:1px 8px;font-size:12px">✎ 编辑</button>
      </div>
      <div class="so-logline" ${state.soCollapsed?'hidden':''}>${renderLoglineHtml(o.logline||'')||'（暂无简介，点✎编辑或重新生成大纲）'}</div>
    </div>
    </section>
<section class="flow-sec" data-flow="3">
      <div class="flow-sec-head"><span class="fs-no">3</span><span class="fs-name">写作配方</span><span class="fs-note">把已锁定风格翻译成可执行规则 · 全书共享</span></div>
      ${ aiRecipeCard() }
      
    </section>
<section class="flow-sec" data-flow="4">
      <div class="flow-sec-head"><span class="fs-no">4</span><span class="fs-name">全书节拍</span><span class="fs-note">按全书主线节奏划分剧情阶段（本地映射）</span></div>
      ${bookBeatBriefHtml()}
      ${ isLong() ? beatStructureCardHtml() : '' }
    </section>
<section class="flow-sec flow-info-sec" data-flow="5">
      <div class="flow-sec-head"><span class="fs-no">5</span><span class="fs-name">词典达人</span><span class="fs-note">全局设定架构师 · 人物/法宝/地理/规则硬设定</span></div>
      ${ dictMasterBlockHtml() }
    </section>
<section class="flow-sec flow-info-sec" data-flow="6">
      <div class="flow-sec-head"><span class="fs-no">6</span><span class="fs-name">词典充实</span><span class="fs-note">设定细化工坊 · 感官特征 · 场景禁忌 · 氛围龙套</span></div>
      ${ dictEnrichBlockHtml() }
    </section>
<section class="flow-sec flow-action-sec" data-flow="7">
      <div class="flow-sec-head"><span class="fs-no">7</span><span class="fs-name">学校统筹</span><span class="fs-note">章节微拍 → 校长全局总控 → 老师分段备课</span></div>
      ${ microBeatBlock() }
      ${ schoolZoneBlock() }
    </section>
<section class="flow-sec flow-info-sec" data-flow="7.5">
  <div class="flow-sec-head"><span class="fs-no">📇</span><span class="fs-name">万物词典</span><span class="fs-note">全书共享事实数据库 · 正文的设定唯一基准</span></div>
  ${ safeCard(()=>glossaryCardHtml()) }
</section>
${longNovelMemoryRepoHtml()}
<section class="flow-sec" data-flow="8">
      <div class="flow-sec-head"><span class="fs-no">8</span><span class="fs-name">正文作家 · 章节创作</span><span class="fs-note">专注文学变现 · 双注入连贯撰写</span></div>
        ${ isLong() ? `<div class="btn-row" style="margin-top:8px">
          <label class="long-jump"><span>跳到章节：</span>
          <select id="longJump"><option value="">— 选择章节阅读 —</option>${state.chapters.map((c,i)=>`<option value="${i}">第${i+1}章 ${esc(cleanChapterTitle(c.title))}</option>`).join('')}</select></label>
        </div>` : '' }
        ${ qualityReportCardHtml() }
        <div class="ch-toolbar">
          <span class="ch-toolbar-t">📚 章节列表（共 ${state.chapters.length} 章，已生成 ${state.chapters.filter(c=>c.content && String(c.content).trim()).length} 章）</span>
        </div>
        <div id="chaptersWrap"></div>
        ${ fixQueueCardHtml() }
        <div class="btn-row" style="margin-top:12px">
          ${ isLong() ? `<span class="multi-gen">
            <span class="multi-gen-main">
              <button id="btnGenMany" class="btn blue">⚡ 批量生成多章</button>
            </span>
            <span class="gen-stepper">
              <button type="button" class="gen-step" data-gen-dec title="减少章数">−</button>
              <output id="genCountOut" class="gen-count-out" aria-live="polite">${genBatchN}</output><span class="gen-unit">章</span>
              <button type="button" class="gen-step" data-gen-inc title="增加章数">＋</button>
            </span>
          </span>` : `<button id="btnGenAllChapters" class="btn primary">⚡ 一键生成全部章节</button><button id="btnReOutline" class="btn ghost">重生成大纲</button>` }
        </div>
        ${ isLong() ? `<div class="range-gen">
          <button id="btnRangeGen" class="btn blue">⚡ 区间生成</button>
          <label class="rg-label">从第
            <input id="rgStart" type="number" min="1" max="${state.chapters.length}" value="1" class="rg-input">
          章</label>
          <span class="muted" style="font-size:12px">到第</span>
          <label class="rg-label">
            <input id="rgEnd" type="number" min="1" max="${state.chapters.length}" value="2" class="rg-input">
          章</label>
          <span id="rgStatus" class="muted" style="font-size:11px"></span>
        </div>` : '' }
        <p id="chStatus" class="status"></p>
        <p id="bgTaskIndicator" class="status muted" style="display:none;font-size:12px;margin-top:2px"></p>
        ${ isLong() ? `<div class="long-progress"></div>` : '' }
        <div id="wcTotal" class="wc-total hidden"></div>
        <div class="cyber-pad hidden"></div>
    </section>
  </div>`;
  return html;
}


function beatStructureCardHtml(){
  const o = state.outline || {};
  let chs = Array.isArray(o.chapters) ? o.chapters : [];
  const bb = currentBookBeatCfg();
  const stageNames = beatStageNames();
  let totalCh = chs.length;
  if(!totalCh){
    const _cc = Math.floor(Number(chapterCountVal())||0);
    if(_cc >= 1 && _cc <= 200){ chs = Array.from({length:_cc}, ()=>({title:''})); totalCh = _cc; }
  }
  if(!totalCh || !stageNames.length){
    return `<div class="card bs-card card-theme-beat">
      <div class="bs-head card-head-bar" role="presentation">
        <div class="ch-left">
          <span class="ch-badge ch-badge-beat">🎬</span>
          <h3 class="ch-title">全书节拍与阶段映射</h3>
          <span class="ch-subtag ch-subtag-beat">${esc(bb.label)} · ${stageNames.length} 阶段</span>
        </div>
        <div class="ch-right">
          <span class="muted" style="font-size:12px">宏观节奏链</span>
        </div>
      </div>
      <div class="bs-body">
        <p class="muted" style="margin:0;font-size:12px">生成大纲后将按所选节拍自动划分各章阶段。</p>
      </div>
    </div>`;
  }
  const plan = bookStagePlan(totalCh);
  const beams = []; let cur = 0;
  plan.forEach((p, si)=>{
    const n = p.n;
    const slice = n ? chs.slice(cur, cur+n) : [];
    cur += n;
    beams.push(`
      <div class="bs-beam">
        <div class="bs-beam-top">
          <span class="bs-beam-idx">${si+1}</span>
          <span class="bs-beam-k">${esc(p.name)}</span>
          <span class="bs-beam-meta">${n ? `第 ${cur-n+1}—${cur} 章 · ${n} 章` : '本章阶段暂无对应章'}</span>
        </div>
        <div class="bs-beam-chs">${slice.map((c, j)=>{
          const ci = cur - n + j;
          return `<span class="bs-beam-ch">${ci+1}. ${esc(cleanChapterTitle(c&&c.title))}</span>`;
        }).join(' ')}</div>
      </div>`);
  });
  const fwSeq = plan.map(p=>p.name).join(' → ');
  const mergeNote = totalCh < stageNames.length
    ? `当前章节较少，已将「${esc(bb.label)}」的 ${stageNames.length} 个拍子按序合并为 ${plan.length} 个阶段（每阶段 1 章），确保结尾高潮/收束完整。`
    : '';
  const foldId = 'bsFold';
  const beambody = beams.map((b, i)=>{
    if(totalCh >= 100){
      const m = b.match(/第 (\d+)—(\d+) 章[\s·]+(\d+) 章/);
      if(m) return `<div class="bs-beam bs-beam-fold"><span class="bs-beam-idx">${i+1}</span><span class="bs-beam-k">${m[3] ? m[3]:''}</span><span class="bs-beam-meta">第 ${m[1]}—${m[2]} 章</span></div>`;
    }
    return b;
  }).join('');
  return `<div class="card bs-card card-theme-beat">
    <div class="bs-head card-head-bar" role="presentation" style="cursor:pointer" onclick="document.getElementById('${foldId}').hidden=!document.getElementById('${foldId}').hidden;this.querySelector('#bsFoldTri').textContent=document.getElementById('${foldId}').hidden?'▸':'▾'" title="点击折叠/展开全书节拍">
      <div class="ch-left">
        <span class="ch-badge ch-badge-beat">🎬</span>
        <h3 class="ch-title">全书节拍与阶段映射</h3>
        <span class="ch-subtag ch-subtag-beat">${esc(bb.label)} · ${plan.length} 段 · ${totalCh} 章</span>
      </div>
      <div class="ch-right">
        <span id="bsFoldTri" style="display:inline-block;width:1.2em;font-size:14px;color:var(--muted)">▾</span>
      </div>
    </div>
    <div id="${foldId}" class="bs-body">
      <div class="bs-fw"><span class="bs-fw-chip">${esc(bb.label)}</span><span class="bs-fw-seq">${fwSeq}</span></div>
      <div class="bs-beams">${beambody}</div>
      ${mergeNote ? `<p class="muted" style="margin:4px 0 0;font-size:11px;color:var(--accent)">${mergeNote}</p>` : ''}
    </div>
  </div>`;
}

function beatStageNames(){ const a=currentBookBeatCfg().ai; return (a && a.stages) || []; }
function beatStageDuties(){ const a=currentBookBeatCfg().ai; return (a && a.duty) || []; }

function factCardHtml(){
  const fc = (state.outline && state.outline._factCard) || { characters:{}, timeline:[], lastScene:'' };
  const chars = Object.entries(fc.characters || {}).map(([name, st])=>`
    <div class="fc-char-row">
      <input type="text" class="fc-name" data-fc-char-name="${esc(name)}" value="${esc(name)}" placeholder="人名">
      <input type="text" class="fc-state" data-fc-char-state="${esc(name)}" value="${esc(st.state||'')}" placeholder="当前状态">
      <input type="text" class="fc-loc" data-fc-char-loc="${esc(name)}" value="${esc(st.location||'')}" placeholder="所在地点">
      <input type="text" class="fc-emo" data-fc-char-emo="${esc(name)}" value="${esc(st.emotion||'')}" placeholder="情绪">
    </div>
  `).join('');
  const timeline = (fc.timeline || []).slice(-10).reverse().map(t=>`
    <div class="fc-tl-row">
      <span class="pill">第 ${t.ch+1} 章</span>
      <span>${esc(t.event||'')}</span>
    </div>
  `).join('');

  return `<div class="card fc-card${state.fcCollapsed?' fc-collapsed':''}">
    <div class="fc-head" data-fc-fold role="button" tabindex="0" title="展开/收起">
      <h3 style="margin:0">🧩 事实与一致性看板</h3>
      <span class="sc-fold-ico">${state.fcCollapsed?'▸':'▾'}</span>
    </div>
    <div class="fc-body" ${state.fcCollapsed?'hidden':''}>
      <div class="fc-sec">
        <div class="fc-sec-head">人物状态 <button type="button" class="btn small ghost" data-fc-char-add>＋ 添加</button></div>
        ${chars || '<span class="muted">暂无人物状态，可手动添加或在正文生成后自动提取</span>'}
      </div>
      <div class="fc-sec">
        <div class="fc-sec-head">最近时间线</div>
        ${timeline || '<span class="muted">暂无时间线</span>'}
      </div>
      <label class="fc-field"><span>最新场景</span><input type="text" id="fcLastScene" value="${esc(fc.lastScene||'')}" placeholder="最后一章结束时的场景/环境"></label>
      <p class="muted" style="font-size:11px">看板内容可由正文 AI 生成后自动更新，也可手动修正。</p>
    </div>
  </div>`;
}

function bindFactCard(){
  const head = $('[data-fc-fold]');
  if(head) head.onclick = ()=>{
    state.fcCollapsed = !state.fcCollapsed; persist();
    const body = $('.fc-body'); if(body) body.hidden = state.fcCollapsed;
    const ico = head.querySelector('.sc-fold-ico'); if(ico) ico.textContent = state.fcCollapsed?'▸':'▾';
  };
  const o = state.outline; if(!o) return;
  o._factCard = o._factCard || { characters:{}, timeline:[], lastScene:'' };
  const fc = o._factCard;

  const add = $('[data-fc-char-add]');
  if(add) add.onclick = ()=>{
    const name = prompt('人物名：'); if(!name) return;
    fc.characters[name] = { state:'', location:'', emotion:'' }; persist(); render();
  };
  $$('[data-fc-char-state],[data-fc-char-loc],[data-fc-char-emo]').forEach(inp=>{
    inp.onchange = ()=>{
      const name = inp.dataset.fcCharState || inp.dataset.fcCharLoc || inp.dataset.fcCharEmo;
      if(!fc.characters[name]) return;
      if(inp.dataset.fcCharState) fc.characters[name].state = inp.value.trim();
      if(inp.dataset.fcCharLoc) fc.characters[name].location = inp.value.trim();
      if(inp.dataset.fcCharEmo) fc.characters[name].emotion = inp.value.trim();
      persist();
    };
  });
  const ls = $('#fcLastScene');
  if(ls) ls.onchange = ()=>{ fc.lastScene = ls.value.trim(); persist(); };
}

function updateFactCardFromChapter(i, text){
  const o = state.outline; if(!o) return;
  const fc = o._factCard = o._factCard || { characters:{}, timeline:[], lastScene:'' };
  fc.timeline = fc.timeline || [];
  fc.timeline = fc.timeline.filter(x => x.ch !== i);
  fc.timeline.push({ ch:i, event:`第 ${i+1} 章正文` });
  if(fc.timeline.length > 50) fc.timeline = fc.timeline.slice(-50);
  const paras = String(text||'').split(/\n+/).map(s => s.trim()).filter(Boolean);
  if(paras.length) fc.lastScene = paras[paras.length-1].slice(0, 120);
  fc.timeAnchors = fc.timeAnchors || [];
  fc.timeAnchors = fc.timeAnchors.filter(x => x.ch !== i);
  persist();
}

function rollingSummaryCardHtml(){
  const o = state.outline; if(!o) return '';
  const sums = (o._rollingSummaries || []).slice().sort((a,b)=>{
    const [a1] = a.key.split('-').map(Number);
    const [b1] = b.key.split('-').map(Number);
    return a1 - b1;
  });
  const rows = sums.map(s=>`
    <div class="rs-row">
      <span class="pill">第 ${s.key} 章</span>
      <span class="rs-text">${esc(s.text)}</span>
    </div>
  `).join('');
  return `<div class="card rs-card${state.rsCollapsed?' rs-collapsed':''}">
    <div class="rs-head" data-rs-fold role="button" tabindex="0" title="展开/收起">
      <h3 style="margin:0">📜 滚动摘要</h3>
      <span class="sc-fold-ico">${state.rsCollapsed?'▸':'▾'}</span>
    </div>
    <div class="rs-body" ${state.rsCollapsed?'hidden':''}>
      ${rows || '<span class="muted">暂无滚动摘要，批量生成正文后会自动生成</span>'}
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn small primary" data-rs-gen ${sums.length?'':'disabled'}>🔄 补齐缺失摘要</button>
        <button type="button" class="btn small ghost" data-rs-clear>清空摘要</button>
      </div>
      <p class="muted" style="font-size:11px">每 5 章生成一次 300-400 字摘要；写新章时会注入最近 3 个区块（约 15 章）的摘要。</p>
    </div>
  </div>`;
}

function bindRollingSummaryCard(){
  const head = $('[data-rs-fold]');
  if(head) head.onclick = ()=>{
    state.rsCollapsed = !state.rsCollapsed; persist();
    const body = $('.rs-body'); if(body) body.hidden = state.rsCollapsed;
    const ico = head.querySelector('.sc-fold-ico'); if(ico) ico.textContent = state.rsCollapsed?'▸':'▾';
  };
  const gen = $('[data-rs-gen]');
  if(gen) gen.onclick = async ()=>{
    busy(gen, true, '生成中…');
    try{ await ensureChapterDigests(); await generateRollingSummaries(); render(); toast('滚动摘要已补齐'); }
    catch(e){ toast('摘要生成失败：'+e.message); }
    finally{ busy(gen, false); }
  };
  const clr = $('[data-rs-clear]');
  if(clr) clr.onclick = ()=>{
    if(!confirm('清空所有滚动摘要？正文生成时会重新生成。')) return;
    const o = state.outline; if(!o) return;
    o._rollingSummaries = []; persist(); render(); toast('已清空滚动摘要');
  };
}

function qualityReportCardHtml(){ return ''; }

function bindQualityReportCard(){}

function formatRelevantGlossaryHtml(rg){
  const lines = [];
  if(rg.characters && rg.characters.length) lines.push('<b>人物：</b>'+rg.characters.map(c=>esc(c.name)).join('、'));
  if(rg.places && rg.places.length) lines.push('<b>地点：</b>'+rg.places.map(p=>esc(p.name)).join('、'));
  if(rg.propernouns && rg.propernouns.length) lines.push('<b>专名：</b>'+rg.propernouns.map(p=>esc(p.name)).join('、'));
  if(!lines.length) return '';
  return `<div class="reader-rg"><span class="reader-rg-lab">📌 本章相关设定</span>${lines.join(' · ')}</div>`;
}

function fixQueueCardHtml(){
  const q = state._fixQueue || [];
  if(!q.length) return '';
  const rows = q.map((item, idx)=>{
    const isKind = !Number.isInteger(item.ch);
    return `<div class="fq-row">
      ${isKind
        ? `<span class="pill tag-warn">${esc(item.kind || 'AI')}</span><span>${esc(item.error || '')}</span>`
        : `<span class="pill tag-warn">第 ${item.ch+1} 章</span><span>${esc(item.code)}</span>`}
      <span class="muted">重试 ${item.attempts||0} 次</span>
      <button type="button" class="btn small ghost" data-fq-remove="${idx}">移除</button>
    </div>`;
  }).join('');
  return `<div class="card fq-card">
    <div class="fq-head"><h3 style="margin:0">🔧 修复队列（${q.length}）</h3></div>
    <div class="fq-body">${rows}</div>
  </div>`;
}

function bindFixQueueCard(){
  $$('[data-fq-remove]').forEach(btn=>{
    btn.onclick = ()=>{
      const idx = +btn.dataset.fqRemove;
      state._fixQueue.splice(idx,1); persist(); render();
    };
  });
}


function syncOrigIdeaCard(){
  const t = $('.orig-text'); if(!t) return;
  if(state.dictmasterRan){ t.value = String(state.originalIdeaSnapshot || state.idea || '').trim() || '（尚未生成万物词典）'; }
  else { t.value = String(state.idea || '').trim() || '（尚未生成万物词典）'; }
}

function origIdeaCard(){
  const o = state.outline;
  const show = state.dictmasterRan
    ? (String(state.originalIdeaSnapshot || '').trim() || String(state.idea || '').trim())
    : String(state.idea || '').trim();
  return `<div class="card orig-card">
    <div class="orig-head" role="button" tabindex="0" data-orig-toggle title="展开/收起">
      <span class="orig-t">📝 原始构想</span>
      <span class="orig-fold">▸</span>
      <button type="button" class="btn small ghost gs-tool" data-orig-copy title="复制构想原文">📋 复制</button>
    </div>
    <div class="orig-body" hidden>
      <textarea readonly class="orig-text" spellcheck="false">${esc(show || '（尚未生成万物词典）')}</textarea>
    </div>
  </div>`;
}

function bindOrigIdea(){
  const og = $('[data-orig-toggle]');
  if(og) og.onclick = (e)=>{
    if(e.target.closest('[data-orig-copy]')) return;
    syncOrigIdeaCard();
    const body = $('.orig-body'); if(!body) return;
    const on = !body.hidden;
    body.hidden = on;
    const fold = og.querySelector('.orig-fold');
    if(fold) fold.textContent = on ? '▸' : '▾';
  };
  const cpy = $('[data-orig-copy]');
  if(cpy) cpy.onclick = ()=>{
    const ta = $('.orig-text'); if(!ta) return;
    copyText(ta.value);
  };
}
function bindOutlineFold(){
  const h = $('[data-so-toggle]'); if(!h) return;
  h.onclick = ()=>{
    const body = $('.so-logline, .logline-ta'); if(!body) return;
    const on = !body.hidden;
    body.hidden = on;
    const f = h.querySelector('.so-fold'); if(f) f.textContent = on ? '▸' : '▾';
    if(state){ state.soCollapsed = on; if(typeof persist==='function') persist(); }
  };
}
function bindLoglineEdit(){
  const eb = $('#btnLoglineEdit'); if(!eb) return;
  eb.onclick = (e)=>{
    e.stopPropagation();
    let p = $('.so-logline');
    if(!p){
      if(state){ state.soCollapsed = false; if(typeof persist==='function') persist(); }
      const head = $('[data-so-toggle]');
      if(head){ const f = head.querySelector('.so-fold'); if(f) f.textContent = '▾'; }
      p = $('.so-logline');
    }
    if(!p) return;
    const ta = document.createElement('textarea');
    ta.className = 'logline-ta';
    ta.value = stripStructureFromIntro(String((state.outline||{}).logline||''));
    ta.rows = 4;
    ta.style.width = '100%';
    ta.style.marginTop = '6px';
    ta.spellcheck = false;
    ta.placeholder = '编辑小说简介（点击卡片其他位置或 Ctrl+Enter 保存，Esc 取消）';
    p.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const finish = (save)=>{
      if(done) return; done = true;
      const v = String(ta.value||'').trim();
      if(save && v){
        state.outline = state.outline || {};
        if(v !== state.outline.logline){ state.outline.logline = v; if(typeof persist==='function') persist(); toast('小说简介已更新'); }
      }
      if(typeof render==='function') render();
    };
    ta.onblur = ()=>finish(true);
    ta.onkeydown = (ev)=>{
      if(ev.key==='Escape'){ ev.preventDefault(); ta.onblur=null; finish(false); }
      else if(ev.key==='Enter' && (ev.ctrlKey||ev.metaKey)){ ev.preventDefault(); ta.onblur=null; finish(true); }
    };
  };
}
function bindAiRecipe(){
  const card = $('.ai-recipe-card'); if(!card) return;
  const gen = card.querySelector('[data-ai-recipe-gen]');
  if(gen) gen.onclick = ()=>{ aiRecipeGen(); };
  const clr = card.querySelector('[data-ai-recipe-clear]');
  if(clr) clr.onclick = ()=>{
    const ta = $('#aiReDesc'); if(ta) ta.value = '';
    aiRp = null;
    const out = card.querySelector('[data-ai-recipe-out]'); if(out) out.innerHTML = aiRecipeResultHtml();
  };
  const foldHead = card.querySelector('[data-ai-recipe-fold]');
  if(foldHead) foldHead.addEventListener('click', ()=>{
    const cfg = getCfg();
    card.classList.toggle('collapsed');
    const nowCollapsed = card.classList.contains('collapsed');
    cfg.aiRecipeCollapsed = nowCollapsed; saveCfg(cfg);
    const ico = foldHead.querySelector('.sc-fold-ico'); if(ico) ico.textContent = nowCollapsed?'▸':'▾';
  });
  const histBtn = card.querySelector('[data-ai-recipe-hist]');
  if(histBtn) histBtn.onclick = ()=>{ openAiHistPanel(); };
  card.addEventListener('click', (e)=>{
    const pick = e.target.closest('[data-ai-recipe-pick]');
    if(pick){ aiRecipeApply(+pick.dataset.aiRecipePick); return; }
    const save = e.target.closest('[data-ai-recipe-save]');
    if(save){ aiRecipeSave(+save.dataset.aiRecipeSave); return; }
    const ag = e.target.closest('[data-ai-recipe-addgap]');
    if(ag){ aiRecipeAddGap(ag.dataset.aiRecipeAddgap); return; }
    const aga = e.target.closest('[data-ai-recipe-addgapall]');
    if(aga){ aiRecipeAddGapAll(+aga.dataset.aiRecipeAddgapall); return; }
  });
}
function aiHistCandHtml(c, idx, ei){
  if(!c) return '';
  const pendAll = Array.isArray(c.gap) && c.gap.some(g => !((c.tags||[]).includes(g.id) || libHas(g.id)));
  return `<div class="ai-recipe-cand" style="margin-top:6px">
    <div class="ai-recipe-cand-head">
      <b>${esc(c.name||('候选'+(idx+1)))}</b>
      ${ recipeScBadge(c) }
      <span class="muted" style="font-size:11px">${esc(c.desc||'')}</span>
    </div>
    <div class="ai-recipe-tags">${ (c.tags||[]).map(id=>{ const s=writeStyleById(id); return `<span class="ai-recipe-tg">${esc(s?s.name:id)}</span>`; }).join('') }</div>
    <div class="ai-recipe-sec"><span class="ar-lab">为何这样选</span>${esc(wiseWhyText(c.why||''))}</div>
    <div class="ai-recipe-sec"><span class="ar-lab">适用场景</span>${esc(wiseWhyText(c.scenario||''))}</div>
    <div class="ai-recipe-gap">
      ${ Array.isArray(c.gap) && c.gap.length
        ? `<div class="ar-gaptitle">⚠️ 词条缺口（${c.gap.length} 项）</div>` + c.gap.map((g,gi)=>`
            <div class="ai-recipe-gapitem">
              <div class="ar-gaphead"><b>${esc((g&&g.name)||'')}</b><span class="muted" style="font-size:11px">${ (AI_CAT_LABEL[(g&&g.cat)||'']||((g&&g.cat)||'custom')) }</span></div>
              <div class="ar-gapwhy">${esc((g&&g.reasons)||'')}</div>
              ${gapFiveHtml(g)}
              <button type="button" class="btn small ghost" data-ah-addgap="${ei}__${idx}__${gi}" ${ (c.tags||[]).includes(g.id)|| libHas(g.id) ? 'disabled' : '' }>＋ 加入词库</button>
            </div>`).join('')
            + (c.gap.length>1 ? `<div style="margin-top:6px"><button type="button" class="btn small primary" data-ah-addgapall="${ei}__${idx}" ${pendAll?'':'disabled'} title="仅加入尚未入库的新词条；已入库的自动跳过">＋ 全部加入词库</button></div>` : '')
        : `<span class="ar-ok">✓ 现有词库即可覆盖，无需新词条</span>` }
    </div>
    <div style="margin-top:6px"><button type="button" class="btn small primary" data-ah-candpick="${idx}" title="恢复此候选并应用到写作风格">✔ 恢复为此候选</button></div>
  </div>`;
}
function openAiHistPanel(){
  const hist = getAiHist();
  const ov = document.createElement('div'); ov.id='aiHistPanel'; ov.className='gs-overlay';
  const entHtml = (e,hi)=>{
    const ei = hist.length-1-hi;   // 倒序序号（与展示一致）
    return `<div class="ws-lib-group ws-lib-fold" style="margin-top:6px">
      <div class="ws-lib-fold-t" data-ah-fold="${ei}" role="button" tabindex="0" title="展开/收起">
        <span>${e.src==='outline'?'📑':'📝'} ${esc(e.desc||'')} <span class="muted" style="font-size:10px">· ${new Date(e.ts).toLocaleString('zh-CN',{hour12:false})}</span></span>
        <span class="sc-fold-ico">▸</span>
      </div>
      <div class="ws-lib-fold-body" style="display:none">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 8px">
          <button type="button" class="btn small ghost" data-ah-apply="${ei}">✔ 重新采用首个</button>
          <button type="button" class="btn small ghost" data-ah-export="${ei}" title="导出该批配方为 JSON（自动附带其引用的自定义词条与 gap 新词条，导入方即可正常使用）">⬇ 导出</button>
          <button type="button" class="btn small ghost" data-ah-del="${ei}">删</button>
        </div>
        ${ (Array.isArray(e.list)&&e.list.length) ? e.list.map((c,i)=>aiHistCandHtml(c,i,ei)).join('<hr style="margin:6px 0;opacity:.2">') : '<p class="muted">无候选。</p>' }
      </div>
    </div>`;
  };
  const list = hist.slice().reverse();
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📖 AI 配方历史（${hist.length}）</b>
        <span style="display:flex;gap:6px">
          <button class="btn small ghost" data-ah-import title="导入配方包 JSON（先预览勾选，再确认导入；词条自动合并进词库）">⬆ 导入配方包</button>
          <button class="btn small ghost" data-ah-clear>清空</button>
          <button class="gs-x" data-ah-close>✕</button>
        </span></div>
      <div class="cv-body">
        ${ list.length ? list.map(entHtml).join('') : '<p class="muted">暂无历史。用「✨ 生成配方」生成后即自动保存于此，可随时回看。</p>' }
      </div>
      <input type="file" id="aiRecipeImportFile" accept=".json,application/json" style="display:none">
    </div>`;
  const close = ()=>{ const p=$('#aiHistPanel'); if(p) p.remove(); };
  const fi = ov.querySelector('#aiRecipeImportFile');
  if(fi) fi.onchange = e=>{ const file = e.target.files && e.target.files[0]; if(file) importRecipeBundle(file); e.target.value=''; };
  ov.addEventListener('click', (e)=>{
    const cl = e.target.closest('[data-ah-close]'); if(cl){ close(); return; }
    const imp = e.target.closest('[data-ah-import]');
    if(imp){ const f2=$('#aiRecipeImportFile'); if(f2) f2.click(); return; }
    const exp = e.target.closest('[data-ah-export]');
    if(exp){ exportRecipeBundle(hist[+exp.dataset.ahExport]); return; }
    const fold = e.target.closest('[data-ah-fold]');
    if(fold){ const body = fold.closest('.ws-lib-group').querySelector('.ws-lib-fold-body'); if(body){ const open = body.style.display!=='none'; body.style.display = open?'none':'block'; fold.querySelector('.sc-fold-ico').textContent = open?'▸':'▾'; } return; }
    const apply = e.target.closest('[data-ah-apply]');
    if(apply){ const ei=+apply.dataset.ahApply; const entry=hist[ei]; if(entry&&Array.isArray(entry.list)&&entry.list.length){ applyChosenCandidate(entry.list[0], {render:false}); refreshAiHistBadge(); close(); } return; }
    const candpick = e.target.closest('[data-ah-candpick]');
    if(candpick){ const ci=+candpick.dataset.ahCandpick; const grp=candpick.closest('.ws-lib-group'); const fold=grp&&grp.querySelector('[data-ah-fold]'); const ei=fold?+fold.dataset.ahFold:-1; const entry=hist[ei]; const c=(entry&&Array.isArray(entry.list))?entry.list[ci]:null; if(c){ applyChosenCandidate(c, {render:true}); refreshAiHistBadge(); close(); } return; }
    const ahAdd = e.target.closest('[data-ah-addgap]');
    if(ahAdd){ const p=(ahAdd.dataset.ahAddgap||'').split('__'); if(p.length===3){ const ei=+p[0], ci=+p[1], gi=+p[2]; aiHistAddGap(ei, ci, gi); refreshAiHistBadge(); } return; }
    const ahAddAll = e.target.closest('[data-ah-addgapall]');
    if(ahAddAll){ const p=(ahAddAll.dataset.ahAddgapall||'').split('__'); if(p.length===2){ aiHistAddGapAll(+p[0], +p[1]); refreshAiHistBadge(); } return; }
    const del = e.target.closest('[data-ah-del]');
    if(del){ const ei=+del.dataset.ahDel; const a=getAiHist(); if(a[ei]){ a.splice(ei,1); setAiHist(a); } refreshAiHistBadge(); const p=$('#aiHistPanel'); if(p) p.remove(); openAiHistPanel(); return; }
    const clr = e.target.closest('[data-ah-clear]');
    if(clr){ if(confirm('确认清空全部 AI 配方历史？')){ setAiHist([]); refreshAiHistBadge(); close(); } return; }
    if(e.target===ov) close();
  });
  document.body.appendChild(ov);
}
function closeAiHistPanel(){ const p=$('#aiHistPanel'); if(p) p.remove(); }
function buildRecipeBundle(cands, extraElIds){
  const cfg = getCfg();
  const added = (cfg.styleCustom && Array.isArray(cfg.styleCustom.added)) ? cfg.styleCustom.added : [];
  const addedById = {};
  added.forEach(x=>{ if(x&&x.id) addedById[String(x.id)]=x; });
  const bundled = []; const seen = new Set();
  const pushEl = (el)=>{ if(el && el.id && String(el.name||'').trim() && !seen.has(String(el.id))){ seen.add(String(el.id)); bundled.push(JSON.parse(JSON.stringify(el))); } };
  (Array.isArray(cands)?cands:[]).forEach(c=>{
    (Array.isArray(c && c.tags) ? c.tags : []).forEach(id=>{ if(addedById[String(id)]) pushEl(addedById[String(id)]); });   // 自定义词条打包
    (Array.isArray(c && c.gap) ? c.gap : []).forEach(g=> pushEl(g));                                        // gap 新词条五维齐全直接打包
  });
  if(extraElIds) added.forEach(x=>{ if(x && x.id && extraElIds.has(String(x.id))) pushEl(x); });            // 手动勾选词条（不被配方引用也能单独导出）
  return { ver:1, exportedAt:Date.now(), kind:'aiRecipeBundle', recipes: JSON.parse(JSON.stringify(Array.isArray(cands)?cands:[])), bundled };
}
function bundleStamp(){
  const ts = new Date(); const pad = n=>String(n).padStart(2,'0');
  return `${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
}
function downloadBundleFile(data, filename, doneMsg){
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
  if(doneMsg) toast(doneMsg);
}
function exportRecipeBundle(entry){
  const cands = Array.isArray(entry && entry.list) ? entry.list : [];
  if(!cands.length){ toast('该历史条目没有可导出的配方'); return; }
  const data = buildRecipeBundle(cands);
  const desc = String((entry&&entry.desc)||'配方').replace(/[\\/:*?"<>|]/g,'').slice(0,20) || '配方';
  downloadBundleFile(data, `配方_${desc}-${bundleStamp()}.json`, `已导出 ${cands.length} 个配方（附词条 ${data.bundled.length} 个）`);
}
function classifyImportBundle(data){
  const cfg = getCfg();
  const haveIds = new Set(((cfg.styleCustom && cfg.styleCustom.added)||[]).map(x=>x&&String(x.id)));
  const libIds = new Set(writeStyleLib().map(x=>x&&String(x.id)));
  const elStates = [];
  (Array.isArray(data.bundled)?data.bundled:[]).forEach(el=>{
    const id = String(el&&el.id||''); const nm = String(el&&el.name||'').trim();
    if(!id || !nm) return;
    elStates.push({ el, mode: libIds.has(id) ? 'skip' : (haveIds.has(id) ? 'repl' : 'new') });
  });
  const hist = getAiHist();
  const sigOf = c => JSON.stringify([String(c&&c.name||''), Array.isArray(c&&c.tags)?c.tags.map(String):[]]);
  const existSigs = new Set();
  hist.forEach(e=> (Array.isArray(e&&e.list)?e.list:[]).forEach(x=> existSigs.add(sigOf(x))));
  const candStates = [];
  (Array.isArray(data.recipes)?data.recipes:[]).forEach(c=>{
    if(!c || !String(c&&c.name||'').trim()) return;
    candStates.push({ c, dup: existSigs.has(sigOf(c)) });
  });
  return { candStates, elStates };
}
function importRecipeBundle(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    let data;
    try{ data = JSON.parse(reader.result); }catch(e){ toast('导入失败：文件不是合法 JSON'); return; }
    if(!data || typeof data!=='object' || data.kind!=='aiRecipeBundle' || !Array.isArray(data.recipes) || !Array.isArray(data.bundled) || (!data.recipes.length && !data.bundled.length)){
      toast('导入失败：不是合法的 AI 配方包'); return;
    }
    const st = classifyImportBundle(data);
    if(!st.candStates.length && !st.elStates.length){ toast('导入包内没有有效内容'); return; }
    showImportPreview(st);
  };
  reader.readAsText(file);
}
function showImportPreview(st){
  const ov = document.createElement('div'); ov.id='impPrevPanel'; ov.className='gs-overlay';
  const nNew = st.candStates.filter(x=>!x.dup).length, nDup = st.candStates.length - nNew;
  const elNew = st.elStates.filter(x=>x.mode==='new').length;
  const elRepl = st.elStates.filter(x=>x.mode==='repl').length;
  const elSkip = st.elStates.filter(x=>x.mode==='skip').length;
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📥 导入预览</b><button class="gs-x" data-ip-close title="取消导入">✕</button></div>
      <div class="cv-body">
        <p class="muted" style="margin:4px 0;font-size:12px">配方 ${st.candStates.length} 条（新 ${nNew} / 重复 ${nDup}）· 词条 ${st.elStates.length} 个（新 ${elNew} / 可覆盖 ${elRepl} / 内置跳过 ${elSkip}）</p>
        ${st.candStates.length ? `<div style="margin:8px 0 2px;display:flex;align-items:center;gap:10px"><b>配方</b>${nNew?`<label class="muted" style="font-size:12px;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" data-ip-all checked> 全选新条目</label>`:''}</div>` : ''}
        ${st.candStates.map((x,i)=> x.dup
          ? `<label class="muted" style="display:block;margin:2px 0" title="与已有配方重复（同名+同标签），无法重复导入">☐ ${esc(String(x.c.name||'').slice(0,30))} · 重复</label>`
          : `<label style="display:block;margin:2px 0"><input type="checkbox" data-ip-cand="${i}" checked> ${esc(String(x.c.name||'').slice(0,30))}${Array.isArray(x.c.tags)?` <span class="muted" style="font-size:11px">· 标签 ${x.c.tags.length} 个</span>`:''}</label>`
        ).join('')}
        ${st.elStates.length ? '<div style="margin:10px 0 2px"><b>随附词条</b></div>' : ''}
        ${st.elStates.map((x,i)=>{
          const nm = esc(String(x.el.name||'').slice(0,24));
          if(x.mode==='skip') return `<label class="muted" style="display:block;margin:2px 0" title="内置词条两端都有，无需导入">☒ ${nm} · 内置</label>`;
          if(x.mode==='repl') return `<label style="display:block;margin:2px 0"><input type="checkbox" data-ip-el="${i}"> ${nm} <span class="muted" style="font-size:11px">· 已有（勾选=以导入版覆盖）</span></label>`;
          return `<label style="display:block;margin:2px 0"><input type="checkbox" data-ip-el="${i}" checked> ${nm} <span class="muted" style="font-size:11px">· ${esc(String(x.el.group||'custom'))} · 新增</span></label>`;
        }).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(128,128,128,.2)">
        <span data-ip-sum class="muted" style="flex:1"></span>
        <button type="button" class="btn small" data-ip-go>✓ 导入所选</button>
        <button type="button" class="btn small ghost" data-ip-close>取消</button>
      </div>
    </div>`;
  const close = ()=>{ const p=$('#impPrevPanel'); if(p) p.remove(); };
  const refreshIpLocks = ()=>{
    const locked = new Set();
    ov.querySelectorAll('[data-ip-cand]:checked').forEach(cb=>{
      const x = st.candStates[+cb.dataset.ipCand];
      (Array.isArray(x&&x.c&&x.c.tags)?x.c.tags:[]).forEach(id=>locked.add(String(id)));
    });
    ov.querySelectorAll('[data-ip-el]').forEach(cb=>{
      const x = st.elStates[+cb.dataset.ipEl]; if(!x) return;
      const id = String(x.el&&x.el.id||'');
      if(locked.has(id)){ cb.checked = true; cb.disabled = true; }
      else { cb.disabled = false; if(cb.dataset.ipManual!=='1') cb.checked = (x.mode==='new'); }
    });
    const nc = ov.querySelectorAll('[data-ip-cand]:checked').length;
    const ne = ov.querySelectorAll('[data-ip-el]:checked').length;
    const sum = ov.querySelector('[data-ip-sum]'); if(sum) sum.textContent = `已选 配方 ${nc} · 词条 ${ne}`;
    const go = ov.querySelector('[data-ip-go]'); if(go) go.disabled = (nc+ne)===0;
  };
  refreshIpLocks();
  ov.addEventListener('change', e=>{
    const t = e.target;
    if(t.matches('[data-ip-all]')){
      ov.querySelectorAll('[data-ip-cand]').forEach(cb=>{ cb.checked = t.checked; });
      refreshIpLocks(); return;
    }
    if(t.matches('[data-ip-el]')){ t.dataset.ipManual = '1'; refreshIpLocks(); return; }
    if(t.matches('[data-ip-cand]')) refreshIpLocks();
  });
  ov.addEventListener('click', e=>{
    const cl = e.target.closest('[data-ip-close]'); if(cl){ close(); return; }
    const go = e.target.closest('[data-ip-go]');
    if(go){ applyBundleSelection(st, ov); return; }
    if(e.target===ov) close();
  });
  document.body.appendChild(ov);
}
function applyBundleSelection(st, ov){
  const cfg = getCfg(); cfg.styleCustom = cfg.styleCustom || { notes:{}, added:[], removed:[], comboRemoved:[] };
  const normEl = el=>({ id:String(el.id), group:['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'].includes(el.group)?el.group:'custom',
    name:String(el.name), note:String(el.note||''), demo:el.demo?String(el.demo):'', seal:(el.seal===undefined?0:el.seal), warning:el.warning?String(el.warning):'' });
  let elAdded=0, elRepl=0;
  ov.querySelectorAll('[data-ip-el]:checked').forEach(cb=>{
    const x = st.elStates[+cb.dataset.ipEl]; if(!x || !x.el) return;
    if(x.mode==='new'){ cfg.styleCustom.added.push(normEl(x.el)); elAdded++; }
    else if(x.mode==='repl'){
      const i = cfg.styleCustom.added.findIndex(y=>y && String(y.id)===String(x.el.id));
      if(i>=0){ cfg.styleCustom.added[i] = normEl(x.el); elRepl++; }
    }
  });
  const cands = [];
  ov.querySelectorAll('[data-ip-cand]:checked').forEach(cb=>{
    const x = st.candStates[+cb.dataset.ipCand]; if(x && x.c) cands.push(x.c);
  });
  if(cands.length) addAiHist({ id: aiHistEntryId(), ts: Date.now(), src:'desc', desc:'📥 导入所选配方', list: JSON.parse(JSON.stringify(cands)), applied:[] });
  saveCfg(cfg); refreshAiHistBadge();
  const p = $('#impPrevPanel'); if(p) p.remove();
  toast(`导入完成：配方 ${cands.length} · 新增词条 ${elAdded} · 覆盖词条 ${elRepl}`);
}
function refreshExSum(ov){
  const nc = ov.querySelectorAll('[data-ex-combo]:checked').length;
  const nm = ov.querySelectorAll('[data-ex-mycombo]:checked').length;
  const ne = ov.querySelectorAll('[data-ex-el]:checked').length;
  const sum = ov.querySelector('[data-ex-sum]'); if(sum) sum.textContent = `已选 组合配方 ${nc} · 我的配方 ${nm} · 词条 ${ne}`;
  const go = ov.querySelector('[data-ex-go]'); if(go) go.disabled = (nc+nm+ne)===0;
}
function exportStylePack(sel){
  const comboIds = new Set(sel.combos || []);
  const myIds = new Set(sel.myCombos || []);
  const elIds = new Set(sel.els || []);
  if(!(comboIds.size + myIds.size + elIds.size)){ toast('请先勾选要导出的内容'); return; }
  const combos = (WRITE_COMBOS||[]).filter(c=> c && comboIds.has(String(c.id))).map(c=> JSON.parse(JSON.stringify(c)));
  const myCombos = ((getCfg().styleCustom||{}).customCombos||[]).filter(c=> c && myIds.has(String(c.id))).map(c=> JSON.parse(JSON.stringify(c)));
  const entries = writeStyleLib().filter(s=> s && elIds.has(String(s.id))).map(s=> JSON.parse(JSON.stringify(s)));
  const data = { ver:2, kind:'wsStylePack', exportedAt:Date.now(), combos, myCombos, entries };
  downloadBundleFile(data, `写作风格_${bundleStamp()}.json`, `已导出 组合配方 ${combos.length} · 我的配方 ${myCombos.length} · 词条 ${entries.length}`);
}
function openExportCenter(){
  const sc = getCfg().styleCustom || {};
  const comboRemoved = Array.isArray(sc.comboRemoved) ? sc.comboRemoved : [];
  const builtinCombos = (WRITE_COMBOS||[]).filter(c=> c && c.id && !comboRemoved.includes(c.id));
  const myCombos = Array.isArray(sc.customCombos) ? sc.customCombos.filter(c=> c && c.id) : [];
  const GROUPS = ['语言质感','情绪与张力','节奏与网感','叙事技法','台词设计'];
  const lib = writeStyleLib().filter(s=> s && s.id);
  const row = (attr, id, name, tip) => `<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 12px 3px 0" title="${esc(tip||String(name))}"><input type="checkbox" ${attr}="${esc(String(id))}"> ${esc(String(name))}</label>`;
  const comboHtml = builtinCombos.map(c=> row('data-ex-combo', c.id, c.name, `${c.name||''}：${c.desc||''}`)).join('') || '<p class="muted">暂无。</p>';
  const myHtml = myCombos.length
    ? myCombos.map(c=> row('data-ex-mycombo', c.id, c.name, `${c.name||''}：${c.desc||''}`)).join('')
    : '<p class="muted">暂无我的配方。</p>';
  const byGroup = {};
  lib.forEach(x=>{ const g = GROUPS.includes(x.cat) ? x.cat : 'custom'; (byGroup[g]=byGroup[g]||[]).push(x); });
  const gKeys = GROUPS.filter(g=> byGroup[g] && byGroup[g].length); if(byGroup.custom && byGroup.custom.length) gKeys.push('custom');
  const elHtml = gKeys.map(g=>{
    const items = byGroup[g].map(x=> row('data-ex-el', x.id, x.name, `${x.name||''}：${String(x.note||'').slice(0,80)}`)).join('');
    return `<div style="margin:4px 0">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="勾选=全选该组词条">
        <input type="checkbox" data-ex-gall="${esc(g)}"> <b style="font-size:12px">${g==='custom'?'自定义':g}（${byGroup[g].length}）</b>
      </label>
      <div data-ex-group="${esc(g)}" style="display:flex;padding:2px 0 6px 22px;flex-wrap:wrap">${items}</div>
    </div>`;
  }).join('') || '<p class="muted">暂无词条。</p>';
  const ov = document.createElement('div'); ov.id='exCenterPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📦 选择导出 · 写作风格</b><button class="gs-x" data-ex-close title="关闭">✕</button></div>
      <div class="cv-body">
        <div style="margin:6px 0 2px"><b>🎬 组合配方</b> <span class="muted" style="font-size:12px">内置 ${builtinCombos.length} 个（勾段头框全选）</span></div>
        <div data-ex-group="__combo" style="display:flex;padding:2px 0 6px 22px;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;flex-basis:100%" title="勾选=全选组合配方">
            <input type="checkbox" data-ex-selall="__combo"> 全选（${builtinCombos.length}）
          </label>
          ${comboHtml}
        </div>
        <div style="margin:10px 0 2px"><b>🏷 我的配方</b> <span class="muted" style="font-size:12px">${myCombos.length} 个</span></div>
        <div data-ex-group="__my" style="display:flex;padding:2px 0 6px 22px;flex-wrap:wrap">
          ${myCombos.length?`<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:600;flex-basis:100%" title="勾选=全选我的配方"><input type="checkbox" data-ex-selall="__my"> 全选（${myCombos.length}）</label>`:''}
          ${myHtml}
        </div>
        <div style="margin:10px 0 2px"><b>📚 五大类词条</b> <span class="muted" style="font-size:12px">共 ${lib.length} 条（内置+自定义，含已改指令）</span></div>
        ${elHtml}
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(128,128,128,.2)">
        <span data-ex-sum class="muted" style="flex:1">已选 组合配方 0 · 我的配方 0 · 词条 0</span>
        <button type="button" class="btn small" data-ex-go disabled title="勾选后打包导出写作风格包（.json）">⬇ 导出所选</button>
        <button type="button" class="btn small ghost" data-ex-close>取消</button>
      </div>
    </div>`;
  const close = ()=>{ const p=$('#exCenterPanel'); if(p) p.remove(); };
  ov.addEventListener('change', e=>{
    const t = e.target;
    if(t.matches('[data-ex-selall]')){
      const scope = ov.querySelector(`[data-ex-group="${t.dataset.exSelall}"]`);
      if(scope) scope.querySelectorAll('[data-ex-combo],[data-ex-mycombo]').forEach(cb=>{ cb.checked = t.checked; });
      refreshExSum(ov); return;
    }
    if(t.matches('[data-ex-gall]')){
      const body = ov.querySelector(`[data-ex-group="${t.dataset.exGall}"]`);
      if(body) body.querySelectorAll('[data-ex-el]').forEach(cb=>{ cb.checked = t.checked; });
      refreshExSum(ov); return;
    }
    if(t.matches('[data-ex-combo], [data-ex-mycombo], [data-ex-el]')) refreshExSum(ov);
  });
  ov.addEventListener('click', e=>{
    const cl = e.target.closest('[data-ex-close]'); if(cl){ close(); return; }
    const go = e.target.closest('[data-ex-go]');
    if(go){
      exportStylePack({
        combos:   [...ov.querySelectorAll('[data-ex-combo]:checked')].map(cb=>cb.dataset.exCombo),
        myCombos: [...ov.querySelectorAll('[data-ex-mycombo]:checked')].map(cb=>cb.dataset.exMycombo),
        els:      [...ov.querySelectorAll('[data-ex-el]:checked')].map(cb=>cb.dataset.exEl)
      });
      close(); return;
    }
    if(e.target===ov) close();
  });
  document.body.appendChild(ov);
}
function refreshAiHistBadge(){
  const n = getAiHist().length;
  const card = $('.ai-recipe-card');
  if(card){ const b = card.querySelector('[data-ai-recipe-hist] .ai-hist-badge'); if(b) b.textContent = n||''; }
}
function setChapterTitle(i, title){
  const t = String(title||'').trim();
  const o = state.outline;
  if(o && Array.isArray(o.chapters) && o.chapters[i]){
    const oldT = (o.chapters[i].title||'').trim();
    if(oldT && oldT !== t && o.chapters[i].title !== undefined){
      if(!Array.isArray(o.chTitleHistory)) o.chTitleHistory = [];
      o.chTitleHistory.unshift({ i, title: oldT, ts: Date.now() });
      if(o.chTitleHistory.length > 50) o.chTitleHistory.splice(50);
    }
    o.chapters[i].title = t;
  }
  if(state.chapters && state.chapters[i]) { state.chapters[i].title = t; state.chapters[i]._titleByAI = false; state.chapters[i]._titleFinalized = false; }
  persist();
}
function chTitleHistory(){ const o=state.outline; return (o && Array.isArray(o.chTitleHistory)) ? o.chTitleHistory : []; }
function hasChTitleHistory(){ return chTitleHistory().length > 0; }

function chapterTitleListText(){
  const o = state.outline;
  const arr = (o && Array.isArray(o.chapters)) ? o.chapters : [];
  return arr.map((c,i)=>`第${i+1}章 ${cleanChapterTitle((c&&c.title)||'')}`.replace(/\s+$/,'')).filter(Boolean).join('\n');
}

function bindChapterTitles(){
  const ctFold = $('[data-ct-fold]');
  if(ctFold) ctFold.onclick = ()=>{
    state.ctCollapsed = !state.ctCollapsed; persist();
    const blk = ctFold.closest('.ct-block'); if(blk) blk.classList.toggle('ct-collapsed', state.ctCollapsed);
    const ico = ctFold.querySelector('.ct-fold-ico'); if(ico) ico.textContent = state.ctCollapsed?'▸':'▾';
  };
  const cp = $('[data-ct-copy]');
  if(cp) cp.onclick = ()=>{ copyText(chapterTitleListText()); };
  const ch = $('[data-ct-hist]');
  if(ch) ch.onclick = ()=> openChTitleHistoryPanel();
  const ctb = $('[data-ct-batch]');
  if(ctb) ctb.onclick = ()=> openChTitleBatchPanel();
  $$('[data-ct-edit]').forEach(btn=>{
    btn.onclick = ()=>{
      const i = +btn.dataset.ctEdit;
      const row = $('[data-ct-row="'+i+'"]'); if(!row) return;
      const span = row.querySelector('.ct-title'); if(!span) return;
      $$('.ct-edit-input').forEach(inp=> commitChapterTitle(inp));
      const inp = document.createElement('input');
      inp.className = 'ct-edit-input';
      inp.value = span.textContent;
      span.replaceWith(inp);
      inp.focus(); inp.select();
      inp.onkeydown = e=>{
        if(e.key==='Enter'){ e.preventDefault(); commitChapterTitle(inp); }
        else if(e.key==='Escape'){ commitChapterTitle(inp, true); }
      };
      inp.onblur = ()=> commitChapterTitle(inp);
    };
  });
}

let ctAdviceCand = null;   // {title,text}[] 候选，模块级；重渲会随标签重置
let ctAdviceFold = false;
let ctAdoptedIdx = -1;
function buildCtAdviceCtx(){
  const o = state.outline || {};
  return {
    小说书名: o.title || '',
    小说简介: o.logline || '',
    现有全部章节标题: (o.chapters||[]).map((c,i)=>`第${i+1}章 ${cleanChapterTitle(c&&c.title)}`).join('\n')
  };
}
function ctAiRefinePrompt(ctx, raw){
  const _raw = String(raw||'').trim();
  return { system:[
    '你是资深长篇小说的章标题策划师。用户在"重生成要求"框里可能写了一段补充要求（风格方向、悬念感、字数对仗、避免套路等），也可能留空、只想听你对全部章节标题的专业点评。',
    '请审读给出的【现有全部章节标题】【小说书名】【小说简介】，输出 1–3 条建议（至少 1 条、最多 3 条）；每条 = { title(一句话定位本条侧重), text(完整点评 + 可直接作为重生成要求下发给标题 AI 的可执行命令) }。',
    '【允许"无建议"】若现有标题整体已足够好，就只返回 1 条：{"title":"无建议","text":"现有标题整体稳定，暂不建议改动。"}——宁缺毋滥，不硬凑条数、不胡说。',
    '【点评要点】整套标题风格是否统一、有无重复/呆板/同质化标题、字数是否对仗、悬念与画面感、与书名/简介的契合度、整体节奏感。',
    '【有补充要求时】先满足用户要求（'+ (_raw? _raw.slice(0,120)+'…' : '（用户未给出方向）') +'）的角度，再在该方向之外综合点评；要求为空时直接审读全部标题点评。',
    '【可执行】text 用对标题 AI 说的命令式祈使句，明确范围与幅度，可行时用换行拆 2–3 个可独立启用的子要点；不臆造与书名/简介冲突的新名或专名。',
    '输出仅一个 JSON 数组（1–3 项），无任何讲解、无 markdown 代码块前后缀。每项结构：{ "title":"一句话说明本条侧重什么", "text":"完整点评+可执行命令" }'
    ].join('\n'),
    user: JSON.stringify({ 上下文: ctx, 用户原始要求: (_raw||'(无)') }, null, 1) };
}
async function ctAiRefineAdvice(){
  if(_aiOptBusy){ toast('AI 建议优化中，请稍候'); return; }
  if(genBusy()){ toast('已有生成任务进行中，请稍候'); return; }
  _aiOptBusy = true;
  const inp = $('#rtInput'); if(!inp){ _aiOptBusy = false; return; }
  const raw = inp.value.trim();   // 可空：无补充要求也能生成点评
  const out = $('[data-cth-ai-out]');
  if(out) out.innerHTML = `<p class="muted" style="margin:6px 0 0">⏳ AI 正审读现有全部章节标题并给出优化建议…</p>`;
  const btn = $('[data-cth-ai]'); if(btn){ btn.disabled = true; btn.classList.add('is-busy'); btn.textContent = '生成中…'; }
  try{
    const ctx = buildCtAdviceCtx();
    const {system, user} = ctAiRefinePrompt(ctx, raw);
    const spec = resolveActiveSpec();
    const res = unwrapAIResult(await callDeepSeek(system, user, {temperature: spec.titleTemp, topP:0.5, maxTokens:clampMaxTokens('json'), taskKey:'titleAdvice'}));
    const list = parseAiJsonList(res);
    const ls = Array.isArray(list) ? list.filter(x=> x && String(x.text||'').trim()) : [];
    if(!ls.length) throw new Error('AI 未返回有效建议，请重试');
    if(ls.length===1 && /无建议/.test(String(ls[0].title||'')+' '+String(ls[0].text||''))){
      ctAdviceCand = null; ctAdviceFold = false; ctAdoptedIdx = -1;
      if(out) out.innerHTML = `<p class="muted" style="margin:6px 0 0">💡 ${esc(String(ls[0].text||'现有标题整体稳定，暂不建议改动。').trim())}</p>`;
      _aiOptBusy = false;
      const fBtn = $('[data-cth-ai-unfold]'); if(fBtn) fBtn.style.display = 'none';
      if(btn){ btn.disabled = false; btn.textContent = '✨ 标题优化建议'; btn.classList.remove('is-busy'); }
      return;
    }
    ctAdviceCand = ls.slice(0,3);
    ctAdviceFold = false;
    ctAdoptedIdx = -1;
    addAdvHist('ct', { id: aiHistEntryId(), ts: Date.now(), desc: '标题优化建议', list: JSON.parse(JSON.stringify(ls.slice(0,3))) });
    refreshAdvHistBadge('ct');
  }catch(e){
    ctAdviceCand = null;
    if(out) out.innerHTML = `<p class="muted" style="color:var(--danger);margin:6px 0 0">⚠️ ${esc((e&&e.message)||'生成失败')}</p>`;
  }
  _aiOptBusy = false;
  if(out) out.innerHTML = ctAdviceResultHtml();
  if(btn){ btn.disabled = false; btn.textContent = '✨ 标题优化建议'; btn.classList.remove('is-busy'); }
  const foldBtn = $('[data-cth-ai-unfold]');
  if(foldBtn){
    foldBtn.style.display = (ctAdviceCand && ctAdviceCand.length) ? '' : 'none';
    foldBtn.textContent = ctAdviceFold ? '↗ 展开建议' : '↘ 收起建议';
  }
}
function ctAdviceResultHtml(){
  if(!Array.isArray(ctAdviceCand) || !ctAdviceCand.length) return '';
  if(ctAdviceFold) return '';
  return ctAdviceCand.map((a,ai)=>`
    <div class="advice-ai-cand${ctAdoptedIdx===ai?' adopted':''}" data-cth-ai-pick="${ai}">
      <div class="advice-ai-head">
        <span class="advice-ai-idx">${'①②③'[ai]||(ai+1)}</span>
        <b>${esc(a.title||('方案'+(ai+1)))}</b>
      </div>
      <p>${esc(a.text||'')}</p>
    </div>`).join('');
}
function updateFoldBtn(){
  const foldBtn = $('[data-cth-ai-unfold]');
  if(!foldBtn) return;
  foldBtn.style.display = (ctAdviceCand && ctAdviceCand.length) ? '' : 'none';
  foldBtn.textContent = ctAdviceFold ? '↗ 展开建议' : '↘ 收起建议';
}
function commitChapterTitle(inp, revert){
  if(!inp || inp.dataset.done) return;
  inp.dataset.done = '1';
  const row = inp.closest('[data-ct-row]');
  const i = row ? +row.dataset.ctRow : -1;
  const o = state.outline;
  const oldT = (o && o.chapters && o.chapters[i] && o.chapters[i].title) || ('第'+(i+1)+'章');
  const val = inp.value.trim();
  if(!revert && i>=0 && val) setChapterTitle(i, val);
  const span = document.createElement('span');
  span.className = 'ct-title';
  const finalT = (revert||!val) ? oldT : val;
  span.textContent = finalT;
  span.title = finalT;
  inp.replaceWith(span);
}

function setAllTitles(titles){
  const o = state.outline;
  const n = (o && Array.isArray(o.chapters)) ? o.chapters.length : 0;
  let cnt = 0;
  (titles||[]).forEach((t,i)=>{
    if(i<n && String(t||'').trim()){
      const tt0 = String(t).trim();
      const tt = cleanChapterTitle(tt0) || tt0;   // 入库前剥掉可能重复的"第N章"前缀，只存标题名
      if(o && o.chapters[i]) o.chapters[i].title = tt;
      if(state.chapters && state.chapters[i]) { state.chapters[i].title = tt; state.chapters[i]._titleByAI = false; }
      cnt++;
    }
  });
  persist();
  return cnt;
}

function openChTitleHistoryPanel(){
  closeChTitleHistoryPanel();
  const hist = chTitleHistory(); if(!hist.length){ toast('暂无曾用标题'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const o = state.outline;
  const rows = hist.map((h,idx)=>`
    <div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0"><div class="cv-time">第${h.i+1}章 · ${fmtTs(h.ts)}</div><div class="cv-t" style="font-size:12px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.title||'')}</div></div>
      <div class="cv-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button type="button" class="btn ghost cv-b" data-cth-restore="${idx}">↩ 恢复为此标题</button>
        <button type="button" class="btn ghost cv-b" data-cth-del="${idx}">🗑 删除</button>
      </div>
    </div>`).join('');
  const ov = document.createElement('div'); ov.id='cthPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🕘 章节标题 · 单历（${hist.length}/50）</b>
        <button class="gs-x" data-cth-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-div">记录手动修改单章标题的历史，支持一键恢复。</div>
        ${rows}
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-cth-close]').onclick = closeChTitleHistoryPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeChTitleHistoryPanel(); });
  ov.addEventListener('click', e=>{
    const rb = e.target.closest('[data-cth-restore]'); if(!rb) return;
    const h = hist[+rb.dataset.cthRestore]; if(!h) return;
    if(!window.confirm(`把第${h.i+1}章标题恢复为「${h.title}」？`)) return;
    setChapterTitle(h.i, h.title);
    closeChTitleHistoryPanel(); render();
    toast('已恢复该标题');
  });
  ov.addEventListener('click', e=>{
    const db = e.target.closest('[data-cth-del]'); if(!db) return;
    const idx = +db.dataset.cthDel;
    const o2 = state.outline;
    if(o2 && Array.isArray(o2.chTitleHistory)) o2.chTitleHistory.splice(idx,1);
    persist(); closeChTitleHistoryPanel(); render();
    toast('已删除该记录');
  });
}
function closeChTitleHistoryPanel(){ const p=$('#cthPanel'); if(p) p.remove(); }

function chTitleBatches(){ const o=state.outline; return (o && Array.isArray(o.chTitleBatches)) ? o.chTitleBatches : []; }
function snapshotTitleBatch(label){
  const o = state.outline; if(!o) return;
  const titles = (o.chapters||[]).map(c=> (c&&c.title)||'');
  if(!Array.isArray(o.chTitleBatches)) o.chTitleBatches = [];   // fixed: 先挂回 state.outline，persist 才存得住
  const bt = o.chTitleBatches;
  if(bt.length && JSON.stringify(bt[0].titles) === JSON.stringify(titles)) return;
  const d = new Date();
  const t = (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  bt.unshift({ ts: Date.now(), label: `${t} · ${label||'生成批次'}`, titles });
  if(bt.length > 50) bt.length = 50;
  persist();
}
function applyTitleBatch(idx){
  const bt = chTitleBatches(); const b = bt[idx]; if(!b) return;
  const n = (b.titles||[]).length;
  if(!confirm(`整批恢复「${idx+1}. ${b.label||'标题版本'}」（共 ${n} 章）？将覆盖当前全部章节标题。`)) return;
  snapshotTitleBatch('切换前');
  const titles = (Array.isArray(b.titles)?b.titles:[]).map(t=>String(t||'').trim()).filter(Boolean);
  setAllTitles(titles);
  snapshotTitleBatch('本次恢复结果');
  closeTitleBatchPreview(); closeChTitleBatchPanel();
  render();
  toast(`已整批应用该版本标题（${titles.length} 章）`);
}
function deleteTitleBatch(idx){
  const o = state.outline; if(!o) return;
  const bt = chTitleBatches(); if(!bt.length) return;
  bt.splice(idx,1);
  if(!bt.length) delete o.chTitleBatches; else o.chTitleBatches = bt;
  persist();
  closeTitleBatchPreview(); closeChTitleBatchPanel(); openChTitleBatchPanel();
  toast('已删除该版本');
}
function openChTitleBatchPanel(){
  closeChTitleBatchPanel();
  const bt = chTitleBatches();
  if(!bt.length){ toast('暂无批量版本，执行「重生成全部标题」后自动记录'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const rows = bt.map((b,idx)=>`
    <div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0">
        <div class="cv-time">${idx+1}. <b style="color:var(--accent2)">${esc((b.label||'').split(' · ')[0]||fmtTs(b.ts))}</b>${esc((b.label||'').split(' · ')[1]?' · '+b.label.split(' · ')[1]:'')} · ${(b.titles||[]).length} 章</div>
        <div class="cv-t" style="font-size:12px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((b.titles||[]).slice(0,2).join(' / '))||'（空）'}…</div>
      </div>
      <div class="cv-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button type="button" class="btn ghost cv-b" data-batch-view="${idx}">👁 预览</button>
        <button type="button" class="btn primary cv-b" data-batch-apply="${idx}">应用</button>
        <button type="button" class="btn ghost cv-b" data-batch-del="${idx}">🗑</button>
      </div>
    </div>`).join('');
  const ov = document.createElement('div'); ov.id='ctbPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🔁 章节标题 · 批量版本（${bt.length}/50）</b>
        <button class="gs-x" data-ctb-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-div">归档整批章节标题版本，支持预览与快速恢复。</div>
        ${rows}
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-ctb-close]').onclick = closeChTitleBatchPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeChTitleBatchPanel(); });
  ov.querySelectorAll('[data-batch-view]').forEach(b=> b.onclick = ()=> openTitleBatchPreview(+b.dataset.batchView));
  ov.querySelectorAll('[data-batch-apply]').forEach(b=> b.onclick = ()=> applyTitleBatch(+b.dataset.batchApply));
  ov.querySelectorAll('[data-batch-del]').forEach(b=> b.onclick = ()=> deleteTitleBatch(+b.dataset.batchDel));
}
function closeChTitleBatchPanel(){ const p=$('#ctbPanel'); if(p) p.remove(); }
function openTitleBatchPreview(idx){
  closeTitleBatchPreview();
  const bt = chTitleBatches(); const b = bt[idx]; if(!b) return;
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const list = (b.titles||[]).map((t,i)=>`<div class="cv-row"><div class="cv-t" style="font-size:12px">第${i+1}章　${esc(t||'')}</div></div>`).join('') || '<p class="muted">（空批）</p>';
  const ov = document.createElement('div'); ov.id='ctbPreview'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>👁 版本预览 · ${esc(b.label||'标题版本')}（${fmtTs(b.ts)} · ${(b.titles||[]).length} 章）</b>
        <button class="gs-x" data-ctbp-close>✕</button></div>
      <div class="cv-body"><div style="max-height:60vh;overflow:auto">${list}</div></div>
      <div class="modal-actions" style="padding:12px 16px;border-top:1px solid var(--line)">
        <button type="button" class="btn ghost cv-b" data-ctbp-close2>取消</button>
        <button type="button" class="btn primary cv-b" data-ctbp-apply>✔ 应用此版本</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-ctbp-close]').onclick = closeTitleBatchPreview;
  ov.querySelector('[data-ctbp-close2]').onclick = closeTitleBatchPreview;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeTitleBatchPreview(); });
  ov.querySelector('[data-ctbp-apply]').onclick = ()=> applyTitleBatch(idx);
}
function closeTitleBatchPreview(){ const p=$('#ctbPreview'); if(p) p.remove(); }

function titlesGenUser(opts){
  opts = opts || {};
  const o = state.outline || {};
  const parts = [];
  const cand = selectedPolishCandidate();
  const txt = String((cand && cand.text) || '').trim();
  parts.push(`【蓝本：②优化构想所选方案】${(cand && cand.name) ? ('方案『' + cand.name + '』') : '（所选方案）'}`);
  parts.push(`【所选方案完整原文（作为唯一蓝本，其中已有信息不可改动）】\n${txt || '（所选方案为空）'}`);
  const n = opts.n || ((o.chapters || []).length) || 0;
  if(n){
    parts.push(`请生成恰好 ${n} 个章节标题，每个标题一行、含章号前缀，形如：\n第1章 标题\n第2章 标题\n…\n第${n}章 标题\n行数必须严格等于 ${n}，每个标题名≤18字。只输出纯文本，不要 JSON、不要 markdown 代码块、不要解释。`);
  }
  return parts.join('\n\n');
}

function validateTitleOutput(j, expectedN){
  if(!j || !Array.isArray(j.titles)) return {ok:false, code:'NOT_ARRAY'};
  if(j.titles.length !== expectedN) return {ok:false, code:'COUNT_MISMATCH', details:`${j.titles.length} vs ${expectedN}`};
  const re = /^第\d+章\s+.{1,18}$/;
  const bad = j.titles.map((t,i)=> re.test(String(t||'').trim()) ? null : i).filter(i=>i!==null);
  if(bad.length) return {ok:false, code:'FORMAT_ERROR', details:bad};
  return {ok:true};
}
function buildTitleCandidates(cands, expectedN){
  const valid = cands.filter(c => c && c.ok && c.data && Array.isArray(c.data.titles));
  if(!valid.length) return [];
  const g = (state.outline && state.outline.glossary) || {};
  const names = new Set([
    ...(g.characters||[]).map(x=>String(x.name||'').trim()),
    ...(g.places||[]).map(x=>String(x.name||'').trim()),
    ...(g.propernouns||[]).map(x=>String(x.name||'').trim())
  ]);
  const re = /^第\d+章\s+.{1,18}$/;
  return valid.map(res => {
    const titles = res.data.titles.map(t => String(t||'').trim());
    const clean = titles.map(t => t.replace(/^第\d+章\s+/, ''));
    let s = 0; let dup = 0; let hits = 0;
    titles.forEach(t => { if(re.test(t)) s += 2; });
    for(let i=1;i<clean.length;i++) if(clean[i] === clean[i-1]) dup++;
    clean.forEach(t => { for(const n of names) if(n && t.includes(n)) hits++; });
    s -= dup * 5; s += hits;
    return { valid: titles.length===expectedN && titles.every(t=>re.test(t)), titles, dupRate: dup, glossRate: hits, score: s, raw: res.data };
  }).sort((a,b)=>b.score - a.score);
}
function applyTitleCandidate(cand, n, isRegen){
  const _tr = validateTitleOutput(cand.raw, n);
  if(!_tr.ok) throw new Error(`标题输出校验失败：${_tr.code} ${_tr.details||''}`);
  const titles = cand.titles.filter(Boolean);
  if(isRegen){
    snapshotTitleBatch('重生成前');
    const cnt = setAllTitles(titles);
    snapshotTitleBatch('本次重生成结果');
    const o = state.outline;
    if(Array.isArray(o.chapterPlans) && o.chapterPlans.some(Boolean)){
      toast(`已重生成 ${cnt} 个标题；节拍表可能与新标题不匹配，建议重生成规划师`);
    } else toast(`已重生成 ${cnt} 个章节标题`);
  } else {
    const o0 = state.outline; if(!o0) { toast('请先生成大纲'); return; }
    o0.chapters = titles.map(t=>({ title: t }));
    state.chapters = titles.map((t,i)=>({ title:t, content:'', strip:'', confirmed:false }));
    setAllTitles(titles);
    persist(); render();
    if(Array.isArray(o0.chapterPlans) && o0.chapterPlans.some(Boolean)){
      toast(`已生成 ${titles.length} 个章节标题；节拍表可能与新标题不匹配，建议重生成规划师`);
    } else toast(`已生成 ${titles.length} 个章节标题`);
  }
}

function pickBestTitles(cands, expectedN){
  const ui = buildTitleCandidates(cands, expectedN);
  if(!ui.length) return cands.find(c => c && !c.ok) || {ok:false, error:'所有标题候选均失败'};
  return { ok:true, data: ui[0].raw };
}


function renderBeatsTextHtml(txt){
  txt = cleanBeatDividerTrailer(txt);
  const secRe = /^(承接点|场景链与切换|场景链|逐拍推进|情绪弧|心情弧|情绪基调|必须实体|出场实体|埋设伏笔|收束设计|收束|承接|设定)[：:]/;
  const hasSec = String(txt||'').split('\n').some(ln=>secRe.test(ln.trim()));
  const lines = String(txt||'').split('\n');
  const body = [];
  let openList = false;
  lines.forEach(ln=>{
    const s = ln.trim();
    if(!s){ return; }
    if(secRe.test(s)){
      if(openList){ body.push('</div>'); openList = false; }
      body.push(`<div class="bs-t-sec">${esc(s)}</div>`);
      if(/逐拍推进|场景链|承接点/.test(s)){ body.push('<div class="bs-t-lines">'); openList = true; }
      return;
    }
    if(/^(\d+[\.、:：\)）]|[-•·]\s|[①-⑩])/.test(s)){
      if(!openList){ body.push('<div class="bs-t-lines">'); openList = true; }
      body.push(`<div class="bs-t-li">${esc(s)}</div>`);
      return;
    }
    if(openList){ body.push('</div>'); openList = false; }
    body.push(`<div class="bs-t-ln">${esc(s)}</div>`);
  });
  if(openList) body.push('</div>');
  if(!hasSec && !body.some(x=>x.startsWith('<div class="bs-t-sec">'))){
    return `<div class="bs-beats-text bs-beats-plain"><pre>${esc(txt||'')}</pre></div>`;
  }
  return `<div class="bs-beats-text">${body.join('')}</div>`;
}
function microBeatBlock(){
  const curBeat = BEAT_OPTIONS.find(b=>b.id===currentBeatId()) || {};
  return `<div class="card cp-card beat-card card-theme-microbeat">
    <div class="cp-head card-head-bar" style="cursor:default">
      <div class="ch-left">
        <span class="ch-badge ch-badge-microbeat">🥁</span>
        <h3 class="ch-title">章节微拍节奏</h3>
        <span class="ch-subtag ch-subtag-microbeat">${esc(curBeat.label || '微五拍')}</span>
      </div>
      <div class="ch-right">
        <span class="muted" style="font-size:12px">段落推进节拍</span>
      </div>
    </div>
    <div class="cp-body">
      <div class="cp-micropick">
        <div class="cp-micropick-title">选择章节推进节奏</div>
        <div class="cp-micropick-opts">
          ${BEAT_OPTIONS.map(b=>`
            <label class="cp-micropick-item ${b.id===currentBeatId()?'sel':''}" data-micropick="${b.id}" title="${esc(b.desc||'')}">
              <span class="cp-micropick-ic">${b.emoji||'🥁'}</span>
              <span class="cp-micropick-txt">
                <b>${esc(b.label)}</b>
                <i>${esc(b.desc||'')}</i>
              </span>
              <input type="radio" name="cpMicroPick" value="${b.id}" ${b.id===currentBeatId()?'checked':''} style="display:none">
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function schoolPipelineProgress(){
  const run = state._schoolRunning;
  const stepDefs = [
    { key:'dictMaster', icon:'📖 ', label:'词典达人', title:'词典达人：设定架构。点击单独重跑' },
    { key:'dictEnrich', icon:'🗂 ', label:'词典充实', title:'词典充实：细化与描写工坊。点击单独重跑' },
    { key:'principal',  icon:'👑 ', label:'校长',     title:'校长：全局写作守则与标题总表。点击单独重跑' },
    { key:'teacher',    icon:'🎓 ', label:'老师',     title:'老师：逐章编写六栏目教案。点击单独重跑' }
  ];
  const doneCount = stepDefs.filter(s => getSchoolStepStatus(s.key).isDone).length;
  const pct = Math.round((doneCount / 4) * 100);
  const topMsg = run ? `⚡ <b>一键开学进行中</b>（${run.stepIndex+1}/4 · ${esc(run.label)}）…` : '⏳ 设定就绪 → 学校开学（四步标准管线）';

  const buttonsHtml = stepDefs.map(s => schoolStepBtn(s.key, s.icon, s.label, s.title)).join('');

  return `<div class="sc-pipeline">
    <div class="sc-pipe-top"><span class="sc-pipe-t">${topMsg}</span><span class="sc-pipe-m">${doneCount}/4 步就绪 · ${pct}%</span></div>
    <div class="sc-pipe-bar"><span class="sc-pipe-in" style="width:${pct}%"></span></div>
    <div class="sc-pipe-steps">
      ${buttonsHtml}
    </div>
  </div>`;
}

function schoolZoneBlock(){
  const groups = schoolStageGroups();
  const folded = isSchoolFolded();
  const pTitles = (state.school && state.school.principal && Array.isArray(state.school.principal.titles)) ? state.school.principal.titles : [];
  const titlesApplied = isPrincipalTitlesApplied();
  const tBody = groups.length
    ? groups.map((g,i)=> schoolTeacherBtn(g,i)).join('')
    : `<div class="sc-teachers-ph">🎓 老师备课区：生成大纲后按节拍自动分配分段。</div>`;
  const stepKeys = ['dictMaster','dictEnrich','principal','teacher'];
  const doneSteps = stepKeys.filter(k => getSchoolStepStatus(k).isDone).length;
  const pct = Math.round(doneSteps / 4 * 100);
  const run = state._schoolRunning;
  return `<div class="card cp-card school-card card-theme-school">
    <div class="cp-head card-head-bar">
      <div class="ch-left">
        <span class="ch-badge ch-badge-school">🏛️</span>
        <h3 class="ch-title">编剧学院 · 统筹与教案</h3>
        <span class="ch-subtag ch-subtag-school">${doneSteps}/4 步就绪 · ${pct}%</span>
      </div>
      <div class="ch-right">
        ${pTitles.length ? `<button type="button" class="sc-plan-btn sc-plan-apply-t ${titlesApplied?'applied':''}" data-scp-apply-titles title="${titlesApplied ? '校长已自动选用拟定标题至全书章节；点击可再次全量覆盖同步' : '一键选用校长拟定标题至全书章节'}">${titlesApplied ? `✓ 校长标题已选用 (${pTitles.length}章)` : `✨ 选用拟定标题 (${pTitles.length}章)`}</button>` : ''}
        <button type="button" class="sc-plan-btn sc-plan-pr" data-scp-plan-pr title="查看写作守则与章节总表">📋 读校长成果</button>
      </div>
    </div>
    <div class="cp-body">
      <div class="school-zone">
        <div class="school-zone-head">
          <span>${folded ? '👑 校长（总控） → 🎓 老师（备课） → ✍️ 正文作家' : '👑 校长（总控） → 🎓 老师（分段教案） → ✍️ 正文作家'}</span>
          <em class="school-zone-tip">${groups.length ? (folded ? `全书共 ${groups[0].last} 章` : `${groups.length} 位老师分段`) : '待设定章节数'}</em>
        </div>
        ${schoolPipelineProgress()}
        <div class="school-steps">
          <div class="school-steps-main">
            <button type="button" class="sc-step sc-runall ${run?'running':''}" data-scp-all title="一键按序运行词典达人、词典充实、校长统筹与老师备课，标题自动定稿">${run ? `⚡ 一键开学中（${run.stepIndex+1}/${run.totalSteps} · ${esc(run.label)}）…` : '⚡ 一键开学（全链路备课）'}</button>
          </div>
        </div>
        <div class="school-teachers">
          ${tBody}
        </div>
      </div>
      <!-- 完成声音 + 音量：单个完成 / 全部完成 的音色在顶部 🎨 主题面板挑选，这里只留开关与音量 -->
      <div class="cp-sound-tool">
        <label class="cps-switch" title="某一步完成响「单个完成」音；学校一键全跑完响「全部完成」音">
          <input id="cpsSoundDone" type="checkbox">
          <span class="cps-wrap"><i>🔔</i><b>完成声音</b></span>
        </label>
        <label class="cps-vol" title="提醒音音量">
          <span>🔊</span>
          <input id="cpsSoundVol" type="range" min="0" max="100" step="5" value="80">
          <em id="cpsSoundVolLb" class="muted">80%</em>
        </label>
      </div>
    </div>
  </div>`;
}

function bindChapterPlanFold(){
  const head = $('[data-cp-fold]');
  if(!head) return;
  head.onclick = (e)=>{
    if(e.target.closest('[data-cp-all]') || e.target.closest('[data-cp-stage]') || e.target.closest('[data-cp-enrich]') || e.target.closest('[data-cp-raw]') || e.target.closest('.stop-btn')) return;
    state.cpCollapsed = !state.cpCollapsed;
    persist();
    const body = $('.cp-body'); if(body) body.hidden = state.cpCollapsed;
    const ico = head.querySelector('.cp-arrow'); if(ico) ico.textContent = state.cpCollapsed ? '▸' : '▾';
  };
}
function bindChapterPlan(){
  bindSchoolSteps();   // 学校模式：校长/老师/一键开学 按钮绑定
}

function bindBeatSheet(){
  const o = state.outline; if(!o) return;
  const _tmBd = document.querySelector('[data-cp-time-board]');
  if(_tmBd) _tmBd.onclick = ()=> openTimelineBoard();
  bindPlannerSoundTool();
}

function glossaryFieldCheck(){
  const g = (state.outline && state.outline.glossary) || {};
  const rows = [];
  (g.characters||[]).forEach(c=>{
    const missing = CHAR_FIELDS.filter(k=> c[k]==null || String(c[k]).trim()==='');
    const unknown = CHAR_FIELDS.filter(k=> String(c[k]||'').trim()==='未知');
    if(missing.length || unknown.length) rows.push({ name: String(c.name||'未命名').trim(), missing, unknown });
  });
  return rows;
}
function glossaryCheckCount(){ return glossaryFieldCheck().length; }
function parseAgeNum(v){
  if(v==null) return null;
  const s = String(v).replace(/[，。、；：,.；\s\/~\-]/g,'');
  const m = s.match(/([0-9一二三四五六七八九十百]+)/g);
  if(!m) return null;
  const n = m[m.length-1];
  const c = n.match(/^[0-9]+$/) ? parseInt(n,10) : /^[一二三四五六七八九十]{1,2}$/.test(n) ? (Array.from(n).reduce((a,ch)=>{const t={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10}[ch]; return a + (ch==='十'?(a?10:0):t);},0)||10) : null;
  return c;
}
function auditGlossaryPlausibility(){
  const g = (state.outline && state.outline.glossary) || {};
  const EXEMPT = /长生|修仙|修者|转世|穿越|永生|不朽|不老|活了几百|活了一百|千百岁|岁月如刀|修真|修仙界|活了\s*\d+\s*岁|永世|不死不灭|寿元/;
  const rows = [];
  (g.characters||[]).forEach(c=>{
    const name = String(c.name||'未命名').trim();
    const ageStr = String(c.age||'').trim();
    if(!ageStr) return;
    const n = parseAgeNum(ageStr);
    if(n==null) return;
    const txt = ['identity','hobby','relation','trait'].map(k=>String(c[k]||'')).join('，');
    if(EXEMPT.test(txt)) return;                       // 超自然豁免：不校验数值
    const yre = txt.match(/(?:已|在此|从小|在这|于此|待了)?\s*([0-9一二三四五六七八九十]+)\s*年(?:了|的|多|整)?/g) || [];
    yre.forEach(ym=>{
      const m = ym.match(/([0-9一二三四五六七八九十]+)/);
      const yrs = m ? parseAgeNum(m[1]) : null;
      if(yrs!=null && yrs>1 && n<yrs+2){
        rows.push({ name, reason:`设定提到「${ym.trim()}」，但年龄仅${ageStr}，疑似自相矛盾（软提示，可人工修正）` });
      }
    });
    if(/父|母|父亲|母亲|亲/.test(txt) && n<=8){ rows.push({ name, reason:`年龄${ageStr}却担"父亲/母亲"类亲老关系，疑似过早（软提示，可人工修正）` }); }
  });
  const seen = {}; const out = [];
  rows.forEach(r=>{ if(!seen[r.name]){ seen[r.name]=1; out.push(r); } });
  return out;
}
function plausibilityCount(){ return auditGlossaryPlausibility().length; }
function openGlossaryCheckPanel(){
  closeGlossaryCheckPanel();
  const rows = glossaryFieldCheck();
  const plaus = auditGlossaryPlausibility();
  const plausBody = plaus.length ? `<div class="cv-div" style="margin-top:8px">⚠️ 属性自洽软提示（${plaus.length}）：以下为低置信猜测，可能与修仙/转世/长生等设定冲突而误报，可人工修正或忽略，不影响流程。</div>` + plaus.map(r=>
    `<div class="cv-row"><div class="cv-meta" style="flex:1;min-width:0">
      <div class="cv-time">${esc(r.name)}</div>
      <div class="cv-t" style="font-size:12px;line-height:1.6"><span class="gs-unk">自洽：${esc(r.reason)}</span></div>
    </div></div>`
  ).join('') : '';
  const body = rows.length ? rows.map(r=>{
    const m = r.missing.map(k=>CHAR_FIELD_LABEL[k]).join('、');
    const u = r.unknown.map(k=>CHAR_FIELD_LABEL[k]).join('、');
    return `<div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0">
        <div class="cv-time">${esc(r.name)}</div>
        <div class="cv-t" style="font-size:12px;line-height:1.6">
          ${m?`<span class="gs-miss">缺失：${m}</span>`:''} ${u?`<span class="gs-unk">未知：${u}（建议补全）</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('') : '<p class="muted">✅ 全部人物字段齐全（身份/岁数/性别/外貌/爱好/关系/性格），无缺失、无未知。</p>';
  const ov = document.createElement('div'); ov.id='gsCheckPanel'; ov.className='gs-overlay';
  ov.innerHTML = `<div class="gs-modal">
    <div class="gs-modal-head"><b>🔍 词典人物字段检查（${rows.length}）</b><button class="gs-x" data-gsck-close>✕</button></div>
    <div class="cv-body">
      <div class="cv-div">人物关键设定将注入章节写作，建议补全缺失字段以保障一致性。</div>
      ${body}
      ${plausBody}
    </div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-gsck-close]').onclick = closeGlossaryCheckPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeGlossaryCheckPanel(); });
}
function closeGlossaryCheckPanel(){ const p=$('#gsCheckPanel'); if(p) p.remove(); }

function openGlossaryNewPanel(){
  closeGlossaryNewPanel();
  const o = state.outline; if(!o){ toast('尚无词典'); return; }
  const gl = o.glossary || {characters:[], places:[], propernouns:[]};
  const seen = Number(state._glossSeenTs) || 0;
  const kinds = [['characters','人物','char'],['places','地点','place'],['propernouns','专名','proper']];
  const flat = ()=> kinds.flatMap(([k,lab,type])=> (gl[k]||[]).map((x,i)=> ({x, k, lab, type, i})))
    .filter(r=> r.x && r.x._auto && (r.x._srcTs||0) > seen)
    .sort((a,b)=> (b.x._srcTs||0) - (a.x._srcTs||0));
  const rows = flat();
  const fmtTs = ts => new Date(ts||Date.now()).toLocaleString('zh-CN',{hour12:false});
  const srcLabel = x => x._srcCh ? `来自第 ${x._srcCh} 章` : (x._srcHow || '批量提取');
  const body = rows.length ? rows.slice(0,50).map((r,pos)=>`
    <div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0">
        <div class="cv-time">${esc(r.lab)} · ${esc(String(r.x.name||'').trim())}</div>
        <div class="cv-t" style="font-size:12px;line-height:1.6"><span class="gs-unk">${esc(srcLabel(r.x))} · ${fmtTs(r.x._srcTs)}</span></div>
      </div>
      <button type="button" class="btn ghost gs-tool" data-gsn-locate="${pos}" title="在词典中展开并高亮该条目">定位</button>
      <button type="button" class="btn ghost gs-tool" data-gsn-remove="${pos}" title="从词典移除该条目">移除</button>
    </div>`).join('') : '<p class="muted">✅ 暂无未读的自动入典新实体。</p>';
  const ov = document.createElement('div'); ov.id='gsNewPanel'; ov.className='gs-overlay';
  ov.innerHTML = `<div class="gs-modal">
    <div class="gs-modal-head"><b>🆕 最近自动入典（${rows.length}${rows.length>50?'，显示前 50 条':''}）</b><button class="gs-x" data-gsn-close>✕</button></div>
    <div class="cv-body">
      <div class="cv-div">展示新自动入典的实体条目与来源。</div>
      ${body}
    </div>
    <div style="padding:10px 14px;border-top:1px solid rgba(127,127,127,.25);display:flex;gap:8px;justify-content:flex-end">
      <button type="button" class="btn ghost" data-gsn-seen ${rows.length?'':'hidden'}>全部标为已读</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-gsn-close]').onclick = closeGlossaryNewPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeGlossaryNewPanel(); });
  $$('[data-gsn-locate]', ov).forEach(b=> b.onclick = ()=>{
    const r = flat()[+b.dataset.gsnLocate]; if(!r) return;
    closeGlossaryNewPanel();
    state.gsCatFold = state.gsCatFold || {};
    if(r.type==='char'){ state.gsCatFold.main = false; state.gsCatFold.support = false; }
    else state.gsCatFold[r.type] = false;
    persist(); renderGlossaryOnly();
    const box = $(`[data-gs-entry="${r.type}:${r.i}"]`);
    if(box){
      box.classList.add('open'); const ico = box.querySelector('.gs-fold-ico'); if(ico) ico.textContent='▾';
      box.scrollIntoView({behavior:'smooth', block:'center'});
      box.classList.add('gs-flash'); setTimeout(()=> box.classList.remove('gs-flash'), 1600);
    }
  });
  $$('[data-gsn-remove]', ov).forEach(b=> b.onclick = ()=>{
    const r = flat()[+b.dataset.gsnRemove]; if(!r) return;
    if(!confirm(`从词典移除「${String(r.x.name||'').trim()}」？（${srcLabel(r.x)}）`)) return;
    const arr = gl[r.k] || []; const gi = arr.indexOf(r.x); if(gi>=0) arr.splice(gi,1);
    persist(); renderGlossaryOnly(); closeGlossaryNewPanel(); openGlossaryNewPanel();   // 重开以刷新列表与角标
  });
  const seenBtn = ov.querySelector('[data-gsn-seen]');
  if(seenBtn) seenBtn.onclick = ()=>{ state._glossSeenTs = Date.now(); persist(); renderGlossaryOnly(); closeGlossaryNewPanel(); toast('已全部标为已读'); };
}
function closeGlossaryNewPanel(){ const p=$('#gsNewPanel'); if(p) p.remove(); }

function glossaryCardHtml(){
  const g = (state.outline && state.outline.glossary) || {characters:[], places:[], propernouns:[]};
  const gl = ()=>state.outline.glossary = state.outline.glossary || {characters:[],places:[],propernouns:[]};
  const empty = !(g.characters&&g.characters.length) && !(g.walkons&&g.walkons.length) && !(g.places&&g.places.length) && !(g.propernouns&&g.propernouns.length) && !(g.subplots&&g.subplots.length);
  const hasBody = state.chapters.some(c=>c && c.content);   // 是否有正文可做覆盖面统计（阶段4）
  const seen = Number(state._glossSeenTs) || 0;
  const newCount = [...(g.characters||[]), ...(g.places||[]), ...(g.propernouns||[])].filter(x=> x && x._auto && (x._srcTs||0) > seen).length;
  const tools = `<span class="gs-tools">
    <button type="button" class="btn ghost gs-tool" data-gs-history>🕘 历史更改</button>
    <button type="button" class="btn ghost gs-tool" data-gs-check ${glossaryCheckCount()+plausibilityCount()?'':'hidden'} title="人物 7 字段完整性 + 属性自洽软审计：缺失/未知标出，建议补全">🔍 字段检查${(glossaryCheckCount()+plausibilityCount())?`<b class="gs-check-badge" ${plausibilityCount()&&!glossaryCheckCount()?'style="background:#b8860b"':''}>${glossaryCheckCount()||plausibilityCount()}</b>`:''}</button>
    <button type="button" class="btn ghost gs-tool" data-gs-coverage ${hasBody?'':'hidden'}>📊 覆盖面</button>
    <button type="button" class="btn ghost gs-tool" data-gs-new ${newCount?'':'hidden'} title="查看最近自动入典的新实体（来源章节 + 实际入库时间）">🆕 新增${newCount?`<b class="gs-check-badge">${newCount}</b>`:''}</button>
    <button type="button" class="btn ghost gs-tool" data-gs-extract ${hasBody?'':'hidden'} title="从已生成正文提取词典未收录的新人物/地名/专名并入库">📥 提取新增</button>
    <button type="button" class="btn ghost gs-tool" data-gs-clean ${hasBody?'':'hidden'} title="清理在全部已生成正文中均未出现的条目（如重生成覆盖后失效的旧人物）">🧹 清理未使用</button>
    <button type="button" class="btn ghost gs-tool" data-gs-export>📤 导出 JSON</button>
    <button type="button" class="btn ghost gs-tool" data-gs-import>📥 导入 JSON</button>
    <label class="gs-autofill" title="每章生成后自动吸收副线进度；只有章节正文 AI 会新增/推进副线"><input type="checkbox" data-gs-subfill ${state.subAutoFill?'checked':''} /> 副线追踪</label>
    <button type="button" class="btn ghost gs-tool" data-gs-subboard ${(g.subplots&&g.subplots.length)?'':'hidden'} title="列出未收束且消失过久的副线，提示是否安排回归">🧵 副线看板</button>
    <input type="file" id="gsImportFile" accept=".json,application/json" hidden />
  </span>`;
  if(empty) return `<div class="card gs-card card-theme-glossary"><div class="gs-card-head card-head-bar"><div class="ch-left"><span class="ch-badge ch-badge-glossary">📇</span><h3 class="ch-title">设定表 · 万物词典总览</h3><span class="ch-subtag ch-subtag-glossary">待生成</span></div><div class="ch-right"><span class="muted" style="font-size:12px">一致性基准</span></div></div><div class="gs-card-body">${tools}<p class="sub">生成大纲后自动确立全书万物词典基准。</p></div></div>`;
  const fmt = (o, keys)=>{ const ks = (keys||[]).filter(k=>o[k]); return ks.map(k=>o[k]).join(' · '); };
  const entry = (o, type, i, nameKeys, detailKeys)=>{
    const name = o.name || '';
    const brief = fmt(o, nameKeys);
    const newTag = (o._auto && (o._srcTs||0) > (Number(state._glossSeenTs)||0)) ? `<span class="gs-newtag" title="自动入典：${o._srcCh?('来自第 '+o._srcCh+' 章'):esc(o._srcHow||'批量提取')} · ${new Date(o._srcTs||Date.now()).toLocaleString('zh-CN',{hour12:false})}">🆕${o._srcCh?('·第'+o._srcCh+'章'):''}</span>` : '';
    const flagTag = (type==='char' && o._nameFlag) ? `<span class="gs-nameflag" title="命名待核：${esc(o._nameFlag)}（仅提示不拦截；改名为合规姓名后自动消除）">⚠命名</span>` : '';
    const relField = (type==='char') ? `<label class="gs-f gs-rel-f"><span>${kLabel('relation')}<span class="muted" style="font-weight:400">（摘要·只读）</span></span><div class="gs-rel-ro"><span class="gs-rel-val">${String(o.relation||'').trim()?esc(String(o.relation).trim()):'<span class="muted">（无摘要）</span>'}</span><button type="button" class="btn ghost gs-tool gs-rel-btn" data-gs-rel-edit title="人物关系的逐条明细统一在「人物关系表」中维护（点击直接打开编辑，正文据此写作）">✏️ 去人物关系表编辑</button></div></label>` : '';
    const tierField = (type==='char') ? `<label class="gs-f"><span>类别</span><select data-gs-set="char" data-gs-idx="${i}" data-gs-key="tier" data-orig="${esc(charTierOf(o))}">
      <option value="main" ${charTierOf(o)==='main'?'selected':''}>主要人物</option>
      <option value="support" ${charTierOf(o)==='support'?'selected':''}>次要配角</option>
    </select></label>` : '';
    const detail = tierField + relField + detailKeys.filter(k=>k!=='relation').map(k=>({k, v:o[k]})).filter(x=>x.v).map(x=>`<label class="gs-f"><span>${kLabel(x.k)}</span><input type="text" data-gs-set="${type}" data-gs-idx="${i}" data-gs-key="${x.k}" data-orig="${esc(x.v)}" value="${esc(x.v)}" /></label>`).join('');
    return `<div class="gs-entry" data-gs-entry="${type}:${i}">
      <div class="gs-head" role="button" tabindex="0" data-gs-toggle="${type}:${i}">
        <span class="gs-fold-ico">▸</span>
        <input type="text" class="gs-name" data-gs-name="${type}:${i}" data-orig="${esc(name)}" value="${esc(name)}" placeholder="名称" />
        <span class="gs-brief">${esc(brief||'（无简介，点击展开编辑）')}</span>
        ${newTag}
        ${flagTag}
      </div>
      <div class="gs-detail">
        ${detail}
      </div>
    </div>`;
  };
  const kLabel = k => ({name:'名称', identity:'身份', age:'岁数', gender:'性别', appearance:'外貌', hobby:'爱好', mannerism:'小动作/口头禅', catchphrase:'口头禅', relation:'关系', trait:'性格', type:'类型', note:'说明', question:'核心问题', pivot:'蝴蝶效应'}[k]||k);
  const charEntries = (g.characters||[]);
  const walkonEntries = (g.walkons||[]).map((w,i)=>entry(w,'walkon',i,['note'],['note'])).join('');
  const charTierOf = c => (c && c.tier==='support') ? 'support' : 'main';   // 旧存档无 tier → 视作主要人物
  const grpCharEntries = tierKey => charEntries.map((c,i)=> (charTierOf(c)===tierKey)
    ? entry(c,'char',i,['identity','gender','age'],['name','identity','age','gender','appearance','hobby','catchphrase','relation','trait'])
    : '').join('');
  const grpCharCount = tierKey => charEntries.filter(c=>charTierOf(c)===tierKey).length;
  const mainChars = grpCharEntries('main');      // 主要人物
  const supportChars = grpCharEntries('support'); // 次要配角
  const places = (g.places||[]).map((p,i)=>entry(p,'place',i,['type','note'],['name','type','note'])).join('');
  const props = (g.propernouns||[]).map((p,i)=>entry(p,'proper',i,['note'],['name','note'])).join('');
  const subStatusOpt = (cur) => SUB_STATUSES.map(s=>`<option value="${s}" ${s===cur?'selected':''}>${s}</option>`).join('');
  const subsHtml = (g.subplots||[]).map((s,i)=>{
    const name = String(s.name||'').trim();
    const st = SUB_STATUSES.includes(s.status) ? s.status : '进行中';
    const arcF = (s.arc&&s.arc.from)||'';
    const arcT = (s.arc&&s.arc.to)||'';
    const ts = (Array.isArray(s.log)?s.log:[]).map(x=>`第${x.ch}章${x.note?`（${x.note.trim()}）`:''}`).join(' → ');
    return `<div class="gs-entry" data-gs-entry="sub:${i}">
      <div class="gs-head" role="button" tabindex="0" data-gs-toggle="sub:${i}">
        <span class="gs-fold-ico">▸</span>
        <input type="text" class="gs-name" data-gs-name="sub:${i}" data-orig="${esc(name)}" value="${esc(name)}" placeholder="副线名" />
        <span class="gs-brief">${esc([st, String(s.question||'').trim(), arcF+('→'+arcT||'')].filter(Boolean).join(' · ')||'（点击展开编辑）')}</span>
      </div>
      <div class="gs-detail">
        <label class="gs-f"><span>状态</span><select data-gs-set="sub" data-gs-idx="${i}" data-gs-key="status" data-orig="${esc(st)}">${subStatusOpt(st)}</select></label>
        <label class="gs-f"><span>核心问题</span><input type="text" data-gs-set="sub" data-gs-idx="${i}" data-gs-key="question" data-orig="${esc(String(s.question||'').trim())}" value="${esc(String(s.question||'').trim())}" placeholder="本副线提出的核心问题（必须回答）" /></label>
        <label class="gs-f"><span>起点状态</span><input type="text" data-gs-set="sub" data-gs-idx="${i}" data-gs-key="arcfrom" data-orig="${esc(arcF)}" value="${esc(arcF)}" placeholder="A 状态" /></label>
        <label class="gs-f"><span>当前状态</span><input type="text" data-gs-set="sub" data-gs-idx="${i}" data-gs-key="arcto" data-orig="${esc(arcT)}" value="${esc(arcT)}" placeholder="B 状态" /></label>
        <label class="gs-f"><span>蝴蝶效应</span><input type="text" data-gs-set="sub" data-gs-idx="${i}" data-gs-key="pivot" data-orig="${esc(String(s.pivot||'').trim())}" value="${esc(String(s.pivot||'').trim())}" placeholder="有才填：此副线变化如何影响主线（绝不硬造）" /></label>
        <div class="gs-f"><span>进度（只读）</span><div class="gs-sub-progress">${esc(ts||'（暂无进度）')}</div></div>
        <button type="button" class="btn ghost gs-tool" data-gs-subpop="${i}" title="删除最后一条进度（供纠偏，不会改历史）">↩ 回退一步</button>
      </div>
    </div>`;
  }).join('');
  const collapsed = !!state.gsCollapsed;
  const total = (g.characters||[]).length + (g.walkons||[]).length + (g.places||[]).length + (g.propernouns||[]).length + (g.subplots||[]).length;
  const vRel=validAssoc(g._relationshipTable,'a','b').length;
  const vPC=validAssoc(g._placeContacts,'from','to').length;
  const vPRC=validAssoc(g._properContacts,'from','to').length;
  const vWR=(g._worldRules||[]).filter(x=>x&&String(x.rule||'').trim()).length;
  const histN = Array.isArray(g._relTableHistory) ? g._relTableHistory.length : 0;
  const viewGrid = `<div class="gs-viewgrid">
    <span class="gs-tools gvt-hist-pos"><button type="button" class="btn ghost gs-tool" data-gvth-badge title="人物关系表 / 地名关联表 / 专名关联表 / 世界观规则 的编辑历史（最多 6 次，可查看并一键还原）">🕘 4表历史${histN?`<b class="gs-check-badge">${histN}/6</b>`:''}</button></span>
    <div class="gvt-grid-inner">
    <button type="button" class="btn ghost gs-tool" data-gs-view="rel" title="查看/编辑人物关系表">👥 人物关系表（${vRel}）</button>
    <button type="button" class="btn ghost gs-tool" data-gs-view="pc" title="查看/编辑地名关联表">🗺️ 地名关联表（${vPC}）</button>
    <button type="button" class="btn ghost gs-tool" data-gs-view="prc" title="查看/编辑专名关联表">📌 专名关联表（${vPRC}）</button>
    <button type="button" class="btn ghost gs-tool" data-gs-view="wr" title="查看/编辑世界观规则">⚙️ 世界观规则（${vWR}）</button>
    </div>
  </div>`;
  return `<div class="card gs-card card-theme-glossary${collapsed?' gs-collapsed':''}">
    <div class="gs-card-head card-head-bar" role="button" tabindex="0" data-gs-card-toggle style="cursor:pointer">
      <div class="ch-left">
        <span class="ch-badge ch-badge-glossary">📇</span>
        <h3 class="ch-title">设定表 · 万物词典总览</h3>
        <span class="ch-subtag ch-subtag-glossary">${total} 条已收录</span>
      </div>
      <div class="ch-right">
        <span class="gs-card-arrow" style="font-size:14px;color:var(--muted)">${collapsed?'▸':'▾'}</span>
      </div>
    </div>
    <div class="gs-card-body"${collapsed?' style="display:none"':''}>
    ${tools}
    ${viewGrid}
    <p class="sub">有改则改</p>
    <div class="gs-panel" id="gsHistory" hidden><div class="gs-panel-title">🕘 历史更改</div><div id="gsHistoryList"></div></div>
    ${([
        ['main',   '👤 主要人物', mainChars,    grpCharCount('main')],
        ['support','🤝 次要配角', supportChars, grpCharCount('support')],
        ['walkon', '🚶 路人龙套', walkonEntries,(g.walkons||[]).length],
        ['place',  '🗺️ 地点',     places,       (g.places||[]).length],
        ['proper', '📌 专名',     props,        (g.propernouns||[]).length],
        ['sub',    '🧵 副线',     subsHtml,     (g.subplots||[]).length],
      ]).map(([t,lab,body,cnt])=>{
      const fold = !!(state.gsCatFold && state.gsCatFold[t]);
      return `<div class="gs-group${fold?' gs-folded':''}" data-gs-type="${t}" data-gs-catfold>
        <div class="gs-title" role="button" tabindex="0" title="展开/收起">${lab}（${cnt}）<span class="gs-cat-ico">${fold?'▸':'▾'}</span></div>
        ${body||'<span class="muted">（无）</span>'}
      </div>`;
    }).join('')}
    ${glossaryDupNoteHtml()}
    <p class="muted" style="margin:6px 0 0">修改后自动保存生效。</p>
    </div>
  </div>`;
}
function bindGlossary(){
  if(!state.outline || !state.outline.glossary) return;
  const g = state.outline.glossary;
  const getArr = t => t==='char'?(g.characters||[]):t==='walkon'?(g.walkons||[]):t==='place'?(g.places||[]):(t==='proper'?(g.propernouns||[]):(g.subplots||[]));
  const gsHead = $('[data-gs-card-toggle]');
  if(gsHead){
    const toggleCard = ()=>{
      state.gsCollapsed = !state.gsCollapsed;
      persist();
      const card = gsHead.closest('.gs-card');
      const body = card && card.querySelector('.gs-card-body');
      if(body){ body.style.display = state.gsCollapsed ? 'none' : ''; }
      const arrow = gsHead.querySelector('.gs-card-arrow');
      if(arrow) arrow.textContent = state.gsCollapsed ? '▸' : '▾';
      if(state.gsCollapsed){ // 收缩整卡时把所有词条一并折叠（展开整卡时词条保持折叠态，由用户逐个点击展开）
        card && $$('.gs-entry', card).forEach(en=>{ en.classList.remove('open'); const h=en.querySelector('.gs-fold-ico'); if(h) h.textContent='▸'; });
      }
    };
    gsHead.onclick = (e)=>{ if(e.target.closest('.gs-tools')) return; toggleCard(); };
    gsHead.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); if(e.target.closest('.gs-tools')) return; toggleCard(); } };
  }
  $$('[data-gs-toggle]').forEach(h=>{
    const toggle = ()=>{ const box=h.closest('.gs-entry'); const on=box.classList.toggle('open'); h.querySelector('.gs-fold-ico').textContent = on?'▾':'▸'; };
    h.onclick = (e)=>{
      if(e.target.closest('input.gs-name')) return;   // 编辑名字时不折叠
      toggle();
    };
    h.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } };
  });
  $$('[data-gs-catfold]').forEach(grp=>{
    const t = grp.dataset.gsType;
    const toggleCat = ()=>{
      state.gsCatFold = state.gsCatFold || {};
      state.gsCatFold[t] = !state.gsCatFold[t];
      persist();
      grp.classList.toggle('gs-folded', state.gsCatFold[t]);
      const ico = grp.querySelector('.gs-cat-ico'); if(ico) ico.textContent = state.gsCatFold[t]?'▸':'▾';
    };
    const tt = grp.querySelector('.gs-title');
    if(tt){
      tt.onclick = (e)=>{ e.stopPropagation(); toggleCat(); };
      tt.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleCat(); } };
    }
  });
  $$('[data-gs-name],[data-gs-set]').forEach(inp=>{
    inp.onchange = ()=>{
      const [type, idx] = inp.dataset.gsSet ? [inp.dataset.gsSet, +inp.dataset.gsIdx]
        : inp.dataset.gsName.split(':').map((v,k)=> k===0?v:(+v));
      const arr = getArr(type);
      if(!arr[idx]) return;
      const oldVal = inp.dataset.orig;
      const newVal = inp.value;
      if(newVal === oldVal) return;            // 无实质变化：不记录、不弹窗
      const isName = inp.hasAttribute('data-gs-name');
      const key = isName ? 'name' : inp.dataset.gsKey;
      gsPushUndo();                            // 记录改动前的整本词典（任意模式，供常驻撤销）
      if(type==='sub' && (key==='arcfrom'||key==='arcto')){
        const arcK = key==='arcfrom' ? 'from' : 'to';
        if(!arr[idx].arc) arr[idx].arc = {from:'', to:''};
        arr[idx].arc[arcK] = newVal;
      } else {
        arr[idx][key] = newVal;                  // 再写回 state（保持现状可编辑即存）
        if(isName && type==='char'){
          delete arr[idx]._nameFlag;
          const _on = String(oldVal||'').trim(), _nn = String(newVal||'').trim();
          if(_nn){
            arr[idx]._userName = true;
            if(_on && _on !== _nn){
              if(!Array.isArray(arr[idx]._alias)) arr[idx]._alias = [];
              if(!arr[idx]._alias.includes(_on)) arr[idx]._alias.push(_on);
              syncNameEverywhere(_on, _nn);
            }
          }
        }
      }
      persist();                               // 改动即保存（防误操作丢数据）
      if(type==='char' && key==='tier'){ renderGlossaryOnly(); return; }
      glossaryHistoryPush(`修改 ${isName?'名称':'字段'}「${type}·${idx}」`); // 追加·历史更改记录
      inp.dataset.orig = newVal;               // 该输入框的 basline 更新
      if(isLong() && type!=='sub'){
        openGlossaryPanel({type, idx, isName, key, oldVal, newVal});
      }
    };
  });
  $$('[data-gs-coverage]').forEach(b=> b.onclick = openCoveragePanel);
  $$('[data-gs-check]').forEach(b=> b.onclick = openGlossaryCheckPanel);
  $$('[data-gs-new]').forEach(b=> b.onclick = openGlossaryNewPanel);
  $$('[data-gs-extract]').forEach(b=> b.onclick = ()=>{ manualExtractGlossary(); });
  $$('[data-gs-clean]').forEach(b=> b.onclick = openCleanPanel);
  $$('[data-gs-subfill]').forEach(b=> b.onchange = ()=>{
    state.subAutoFill = b.checked; persist();
    toast(state.subAutoFill ? '副线追踪已开启（每章生成后自动吸收副线进度）' : '副线追踪已关闭（不再自动吸收副线）');
  });
  $$('[data-gs-subpop]').forEach(b=> b.onclick = ()=>{
    const i = +b.dataset.gsSubpop; if(!Number.isFinite(i)) return;
    const sub = (g.subplots||[])[i]; if(!sub || !Array.isArray(sub.log) || !sub.log.length){ toast('该副线暂无进度可回退'); return; }
    gsPushUndo();
    sub.log.pop();
    sub._lastCh = sub.log.length ? Math.max(...sub.log.map(x=>x.ch||0)) : 0;
    persist();
    if(typeof render === 'function') render();
    toast('已回退该副线最后一条进度');
  });
  $$('[data-gs-subboard]').forEach(b=> b.onclick = openSubplotBoard);
  $$('[data-gs-export]').forEach(b=> b.onclick = exportGlossaryJson);
  $$('[data-gs-import]').forEach(b=> b.onclick = ()=> { const f=$('#gsImportFile'); if(f) f.click(); });
  const imp = $('#gsImportFile'); if(imp) imp.onchange = e=>{ const file = e.target.files && e.target.files[0]; if(file) importGlossaryJson(file); e.target.value=''; };
  $$('[data-gs-history]').forEach(b=> b.onclick = ()=>{
    const panel = $('#gsHistory');
    if(!panel) return;
    const show = panel.hidden;
    if(show) renderGlossaryHistory();
    panel.hidden = !show;
    $$('.gs-panel').forEach(p=>{ if(p.id!=='gsHistory') p.hidden = true; }); // 与内容互斥显示
    if(show) b.classList.add('gs-tool-on'); else b.classList.remove('gs-tool-on');
  });
  $$('[data-gs-view]').forEach(b=> b.onclick = ()=> openGlossaryTableView(b.dataset.gsView));
  $$('[data-gs-rel-edit]').forEach(b=> b.onclick = ()=> openGlossaryTableView('rel'));
  $$('[data-gvth-badge]').forEach(b=> b.onclick = openRelTablesHistoryPanel);
  }
function fmtWR(x){
  if(!x || typeof x !== 'object') return '';
  const c=String(x.cat||'').trim(), s=String(x.scope||'').trim(), r=String(x.rule||'').trim();
  const head = `${c?`[${c}]`:''}${s?`·${s}`:''}`.trim();
  return `${head}${head&&r?' ':''}${r}`.trim();
}
function validAssoc(list, ka, kb){
  if(!Array.isArray(list)) return [];
  return list.filter(x=>{
    if(!x || typeof x !== 'object') return false;
    const a=String(x[ka]||'').trim(), b=String(x[kb]||'').trim();
    return !!a && !!b && a!==b;
  });
}
const GVT_CFG = {
  rel: { name:'👥 人物关系表', key:'_relationshipTable', empty:'暂无人物关系记录', fields:[
    {k:'a',  ph:'人物A'}, {k:'relation', ph:'关系'}, {k:'b', ph:'人物B'}, {k:'note', ph:'备注(可选)'} ],
    row:x=>`<div class="dm-rel"><b>${esc(x.a||'')}</b> ←${esc(x.relation||'？')}→ <b>${esc(x.b||'')}</b>${x.note?` <span class="muted">· ${esc(x.note)}</span>`:''}</div>` },
  pc: { name:'🗺️ 地名关联表', key:'_placeContacts', empty:'暂无地名关联记录', fields:[
    {k:'from', ph:'地名A'}, {k:'to', ph:'地名B'}, {k:'relation', ph:'关联'}, {k:'note', ph:'备注(可选)'} ],
    row:x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}${x.note?('：'+esc(x.note)):''}</span></div>` },
  prc: { name:'📌 专名关联表', key:'_properContacts', empty:'暂无专名关联记录', fields:[
    {k:'from', ph:'专名A'}, {k:'to', ph:'专名B'}, {k:'relation', ph:'关联'}, {k:'note', ph:'备注(可选)'} ],
    row:x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}${x.note?('：'+esc(x.note)):''}</span></div>` },
  wr: { name:'⚙️ 世界观规则', key:'_worldRules', empty:'暂无世界观规则（需词典达人生成）', fields:[
    {k:'cat', ph:'类别'}, {k:'scope', ph:'适用范围(可选)'}, {k:'rule', ph:'规则内容'} ],
    row:x=>{ const sc=String(x.scope||'').trim(); return `<div class="dm-wr"><b>${esc(x.cat||'')}${sc?` · ${esc(sc)}`:''}</b><div>${esc(x.rule||'')}</div></div>`; } }
};
function openGlossaryTableView(type){
  const o = state.outline; const g = (o && o.glossary) || {};
  const c = GVT_CFG[type]; if(!c) return;
  const list = Array.isArray(g[c.key]) ? g[c.key].map(x=>({...x})) : [];
  const keyA = type==='rel' ? 'a' : 'from', keyB = type==='rel' ? 'b' : 'to';
  const before = JSON.stringify(g[c.key]||[]);
  const ov = document.createElement('div'); ov.className='gs-overlay';
  const fieldInputs = (x, idx) => c.fields.map(f=>{
    const v = x ? (x[f.k]||'') : '';
    return `<input class="gvt-in" data-gvt-f="${f.k}" data-gvt-i="${idx}" placeholder="${f.ph}" value="${esc(v)}" />`;
  }).join('');
  const renderRows = (rows)=>{
    if(!rows.length) return `<span class="muted">${c.empty}</span>`;
    return rows.map((x,i)=>{
      const key = type==='wr' ? (x.rule||'') : (String(x[keyA]||'') + '↔' + String(x[keyB]||''));
      return `<div class="gvt-row" data-gvt-idx="${i}">
        <div class="gvt-fields">${fieldInputs(x, i)}</div>
        <span class="gvt-prev">${c.row(x)}</span>
        <div class="gvt-ops">
          <button type="button" class="btn ghost gs-tool gvt-del" data-gvt-del="${i}" title="移除该行">🗑</button>
        </div>
      </div>`;
    }).join('');
  };
  const writeBack = ()=>{
    const rows = [];
    ov.querySelectorAll('.gvt-row').forEach(el=>{
      const nr = {}; let any = false;
      el.querySelectorAll('[data-gvt-f]').forEach(inp=>{
        const v = inp.value.trim();
        if(v){ nr[inp.dataset.gvtF] = v; any = true; }
        else nr[inp.dataset.gvtF] = '';
      });
      if(any){
        if(type==='wr'){ if(!String(nr.rule||'').trim()) return; }
        else { if(!String(nr[keyA]||'').trim() || !String(nr[keyB]||'').trim()) return; }
        rows.push(nr);
      }
    });
    const old = JSON.stringify(g[c.key]||[]);
    g[c.key] = rows;
    const changed = old !== JSON.stringify(rows);
    if(changed){ pushRelTablesHistory(type); persist(); }
    return changed;
  };
  const addRow = ()=>{
    const rowsEl = ov.querySelector('.gvt-rows');
    const nr = {}; c.fields.forEach(f=> nr[f.k]='');
    const el = document.createElement('div'); el.className='gvt-row'; el.dataset.gvtIdx='-1';
    el.innerHTML = `<div class="gvt-fields">${fieldInputs(nr, -1)}</div><div class="gvt-prev muted">（新行，填好后点「保存」或按需继续增删）</div><div class="gvt-ops"><button type="button" class="btn ghost gs-tool gvt-del" data-gvt-del="-1" title="丢弃该行">🗑</button></div>`;
    rowsEl.appendChild(el);
  };
  const rowsEl = `<div class="gvt-rows">${renderRows(list)}</div>`;
  ov.innerHTML = `<div class="gs-modal gs-view-modal gvt-modal">
    <div class="gs-modal-head"><b>${c.name}（<span class="gvt-count">${list.length}</span> 条 · 可编辑）</b><button class="gs-x" data-gvt-close>✕</button></div>
    <div class="cv-body" style="max-height:60vh;overflow:auto">
      <p class="muted" style="margin:0 0 8px">直接编辑即可；保存后自动写回万物词典，重新生成正文章节时即套用新值。</p>
      ${rowsEl}
      <button type="button" class="btn ghost gs-tool gvt-add">＋ 新增一行</button>
    </div>
    <div class="gs-actions"><button type="button" class="btn gvt-save">💾 保存</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = ()=> ov.remove();
  ov.querySelector('[data-gvt-close]').onclick = close;
  ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
  ov.querySelector('.gvt-add').onclick = addRow;
  ov.querySelector('.gvt-save').onclick = ()=>{ writeBack(); const n = (g[c.key]||[]).length; ov.querySelector('.gvt-count').textContent = n; toast(`${c.name}已保存（${n} 条）——重新生成章节即生效`); };
  ov.addEventListener('click', e=>{
    const del = e.target.closest('.gvt-del');
    if(del){ const n=del.dataset.gvtDel; if(n==='-1'){ del.closest('.gvt-row').remove(); return; } const row=del.closest('.gvt-row'); if(row) row.remove(); }
  });
}
function pushRelTablesHistory(srcType){
  const g = state.outline && state.outline.glossary; if(!g) return;
  g._relTableHistory = Array.isArray(g._relTableHistory) ? g._relTableHistory : [];
  const snap = {
    ts: Date.now(), from: srcType,
    rel: (g._relationshipTable||[]).map(x=>({...x})),
    pc:  (g._placeContacts||[]).map(x=>({...x})),
    prc: (g._properContacts||[]).map(x=>({...x})),
    wr:  (g._worldRules||[]).map(x=>({...x}))
  };
  const last = g._relTableHistory[0];
  if(last && JSON.stringify({r:last.rel,p:last.pc,q:last.prc,w:last.wr}) === JSON.stringify({r:snap.rel,p:snap.pc,q:snap.prc,w:snap.wr})) return;
  g._relTableHistory.unshift(snap);
  if(g._relTableHistory.length > 6) g._relTableHistory.length = 6;
  persist();
}
function openRelTablesHistoryPanel(){
  const g = state.outline && state.outline.glossary; if(!g) return;
  const hist = Array.isArray(g._relTableHistory) ? g._relTableHistory : [];
  if(!hist.length){ toast('暂无4表编辑历史'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const fmtRel = arr=>(arr||[]).map(x=>`<div class="dm-rel"><b>${esc(x.a||'')}</b> ←${esc(x.relation||'？')}→ <b>${esc(x.b||'')}</b>${x.note?` <span class="muted">· ${esc(x.note)}</span>`:''}</div>`).join('')||'<span class="muted">（无）</span>';
  const render = (h)=>{
    const wr=(h.wr||[]).map(x=>`<div class="dm-wr"><b>${esc(x.cat||'')}</b><div>${esc(x.rule||'')}</div></div>`).join('')||'<span class="muted">（无）</span>';
    const pc=(h.pc||[]).map(x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}${x.note?('：'+esc(x.note)):''}</span></div>`).join('')||'<span class="muted">（无）</span>';
    const prc=(h.prc||[]).map(x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}${x.note?('：'+esc(x.note)):''}</span></div>`).join('')||'<span class="muted">（无）</span>';
    const srcName = h.from==='rel'?'人物关系表':h.from==='pc'?'地名关联表':h.from==='prc'?'专名关联表':(h.from==='wr'?'世界观规则':'手动编辑');
    return `<div class="dm-prev-meta">${fmtTs(h.ts)} · ${esc(srcName)} · 关系表 ${(h.rel||[]).length} · 地名 ${(h.pc||[]).length} · 专名 ${(h.prc||[]).length} · 规则 ${(h.wr||[]).length} 条</div>
      <div class="dm-tables">
        <details class="dm-fold"><summary>👥 人物关系表（${(h.rel||[]).length}）</summary><div class="dm-rel-table">${fmtRel(h.rel)}</div></details>
        <details class="dm-fold"><summary>🗺️ 地名关联表（${(h.pc||[]).length}）</summary><div class="dm-rel-table">${pc}</div></details>
        <details class="dm-fold"><summary>📌 专名关联表（${(h.prc||[]).length}）</summary><div class="dm-rel-table">${prc}</div></details>
        <details class="dm-fold"><summary>⚙️ 世界观规则（${(h.wr||[]).length}）</summary><div class="dm-rel-table">${wr}</div></details>
      </div>
      <button type="button" class="btn gvt-restore" data-gvt-restore="${hist.indexOf(h)}">↩️ 一键还原到此版本</button>`;
  };
  const ov = document.createElement('div'); ov.className='gs-overlay';
  const idx0 = 0;
  ov.innerHTML = `<div class="gs-modal gs-view-modal gvt-hist-modal">
    <div class="gs-modal-head"><b>🕘 4表历史（${hist.length}/6）</b><button class="gs-x" data-gvth-close>✕</button></div>
    <div class="cv-body" style="max-height:62vh;overflow:auto"><div id="gvthBody" style="display:flex;flex-direction:column;gap:14px">${hist.map((h,i)=>`<div class="gvt-hist-item" data-gvt-item="${i}">${render(h)}</div>`).join('')}</div></div>
    <div class="muted" style="padding:8px 14px">点「还原」会把所选版本的 4 表整体覆盖到当前词典（含重新生成章节时立即生效）。</div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-gvth-close]').onclick = ()=> ov.remove();
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  ov.addEventListener('click', e=>{
    const r = e.target.closest('[data-gvt-restore]');
    if(!r) return;
    const i = +r.dataset.gvtRestore; const h = hist[i]; if(!h) return;
    g._relationshipTable = (h.rel||[]).map(x=>({...x}));
    g._placeContacts   = (h.pc||[]).map(x=>({...x}));
    g._properContacts  = (h.prc||[]).map(x=>({...x}));
    g._worldRules      = (h.wr||[]).map(x=>({...x}));
    persist(); ov.remove(); toast('已还原 4 表到该历史版本，重新生成章节即生效');
  });
}

let gsUndoStack = [];
const GS_UNDO_MAX = 10;
function gsPushUndo(){
  const g = state.outline && state.outline.glossary;
  if(g) gsUndoStack.push(JSON.stringify(g));
  if(gsUndoStack.length > GS_UNDO_MAX) gsUndoStack.shift();
}
function glossaryHistoryPush(desc){
  const g = state.outline && state.outline.glossary;
  if(!g) return;
  const h = Array.isArray(g._history) ? g._history : (g._history = []);
  h.push({ ts: Date.now(), desc: desc || '修改词典', snapshot: JSON.stringify({characters:g.characters||[], places:g.places||[], propernouns:g.propernouns||[], subplots:g.subplots||[]}) });
  if(h.length > 30) h.splice(0, h.length - 30);
  persist();
}
function renderGlossaryHistory(){
  const list = $('#gsHistoryList');
  if(!list) return;
  const g = state.outline && state.outline.glossary;
  const h = Array.isArray(g && g._history) ? g._history : [];
  if(!h.length){ list.innerHTML = '<p class="muted">暂无历史更改记录。修改词典后会自动记录。</p>'; return; }
  list.innerHTML = h.slice().reverse().map((r,i)=>{
    const idx = h.length - 1 - i;               // 正序索引
    const d = new Date(r.ts);
    const pad = n => n<10?('0'+n):n;
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    return `<div class="gs-hist-row" data-gs-hist="${idx}">
      <span class="gs-hist-ts">回退到第 ${h.length-idx} 次 · ${t}</span>
      <span class="gs-hist-desc">${esc(r.desc||'')}</span>
      <span class="gs-hist-actions">
        <button type="button" class="btn ghost gs-tool" data-gs-hist-view="${idx}">查看</button>
        <button type="button" class="btn ghost gs-tool" data-gs-hist-restore="${idx}">还原</button>
      </span>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-gs-hist-view]').forEach(b=>{
    b.onclick = ()=>{ try{ applyGlossaryHistorySnapshot(+b.dataset.gsHistView); }catch(e){} };
  });
  list.querySelectorAll('[data-gs-hist-restore]').forEach(b=>{
    b.onclick = ()=>{ applyGlossaryHistorySnapshot(+b.dataset.gsHistRestore); glossaryHistoryPush('还原到历史版本'); };
  });
}
function applyGlossaryHistorySnapshot(idx){
  const g = state.outline && state.outline.glossary;
  const h = Array.isArray(g && g._history) ? g._history : [];
  const r = h[idx]; if(!r) return;
  let snap; try{ snap = JSON.parse(r.snapshot); }catch(e){ return; }
  if(!snap) return;
  g.characters = snap.characters || [];
  g.places = snap.places || [];
  g.propernouns = snap.propernouns || [];
  g.subplots = snap.subplots || [];
  persist();
  const panel = $('#gsHistory'); if(panel) panel.hidden = true;
  if(typeof renderGlossaryOnly === 'function') renderGlossaryOnly(); else render();
  toast('已应用所选历史版本');
}
function exportGlossaryJson(){
  const src = state.pendingGlossary || (state.outline && state.outline.glossary);
  if(!src || (!sourceHasGlossary(src))){ toast('当前没有可导出的词典'); return; }
  const title = (state.outline && state.outline.title) || (state.idea ? state.idea.trim().slice(0,12) : 'story');
  const meta = { _meta:{ title, source:'storyfactory', version:'2.0', exportedAt: new Date().toISOString(), adherence: state.glossAdherence } };
  download(`词典_${title}.json`, JSON.stringify({ ...meta, ...src }, null, 2));
  toast('已导出词典 JSON（含元数据头）');
}
function sourceHasGlossary(g){
  return g && ((g.characters&&g.characters.length)||(g.places&&g.places.length)||(g.propernouns&&g.propernouns.length)||(g.subplots&&g.subplots.length));
}
function glossaryMerge(imported, modelOut, adherence, allowFill){
  const cat = ['characters','places','propernouns'];
  const res = { glossary:{characters:[],places:[],propernouns:[],subplots:[]}, kept:0, added:0, rec:0 };
  const a = (typeof adherence==='number') ? adherence : 100;
  cat.forEach(k=>{
    const imp = (imported&&imported[k])||[];
    const mdl = (modelOut&&modelOut[k])||[];
    const impBy = {};
    imp.forEach(it=>{ const nm=String(it.name||'').trim(); if(nm) impBy[nm]=it; });
    const has = it=>String(it.name||'').trim();
    const tagFlag = it => {
      if(k !== 'characters' || !it) return it;
      if(it._userName){ delete it._nameFlag; return it; }
      const nv = nmNameRuleViolation(String(it.name||'').trim());
      if(nv) it._nameFlag = nv; else delete it._nameFlag;
      return it;
    };
    const out = res.glossary[k];
    if(a < 30){                                       // 几乎放弃：完全采用模型输出
      mdl.forEach(it=>{ if(has(it)){ out.push(tagFlag(it)); res.added++; } });
      return;
    }
    if(a < 50){                                       // 灵感来源：模型为主，仅补同名导入详情
      mdl.forEach(it=>{
        const nm = has(it); if(!nm) return;
        if(impBy[nm]){ out.push(tagFlag(impBy[nm])); res.kept++; }   // 同名以导入版为准（名+详情）
        else { out.push(tagFlag(it)); res.added++; }
      });
      return;
    }
    imp.forEach(it=>{ if(has(it)){ out.push(tagFlag(it)); res.kept++; } });   // a>=50：导入词典为主体
    mdl.forEach(it=>{
      const nm = has(it); if(!nm) return;
      if(impBy[nm]) return;                                          // 重名：一律保留导入版，丢弃模型版（词典保持唯一）
      if(allowFill || a<80){ out.push(tagFlag(it)); res.added++; }            // 新名：a<80 自动补，a>=80 需「允许补充」才补
    });
  });
  return res;
}
function loadGlib(){
  try{ gglib = JSON.parse(localStorage.getItem(KEY_GLIB)) || []; }catch(e){ gglib = []; }
}
function saveGlib(){ try{ localStorage.setItem(KEY_GLIB, JSON.stringify(gglib)); }catch(e){} }
function glibUse(id){
  const it = gglib.find(x=> x.id === id); if(!it) return;
  state.pendingGlossary = it.g;
  persist(); render();
  closeGlibPanel();
  toast(`已选用词典「${it.name}」挂载到本作，可调遵从度后生成大纲`);
}
function glibSave(){
  const src = state.pendingGlossary || (state.outline && state.outline.glossary);
  if(!src || !sourceHasGlossary(src)){ toast('当前没有可入库的词典'); return; }
  const name = prompt('给这套词典起个名字（如：仙侠传·世界观）', (state.outline&&state.outline.title) || '无题词典');
  if(name === null) return;
  const t = name.trim() || ('词典'+(gglib.length+1));
  if(gglib.some(x=> x.name === t)){ if(!confirm('词典库已有同名「'+t+'」，仍要覆盖保存吗？')) return; gglib = gglib.filter(x=> x.name !== t); }
  gglib.push({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name:t, savedAt: Date.now(), g: JSON.parse(JSON.stringify(src)) });
  saveGlib(); openGlibPanel();
  toast('已存入词典库：'+t);
}
function glibDel(id){ gglib = gglib.filter(x=> x.id !== id); saveGlib(); openGlibPanel(); }
function closeGlibPanel(){ const p=$('#glibPanel'); if(p) p.remove(); }
function openGlibPanel(){
  closeGlibPanel();
  const ov = document.createElement('div'); ov.id='glibPanel'; ov.className='gs-overlay';
  const itemsHtml = gglib.length ? gglib.map(x=>{
    const n = x.g; const cn=(n.characters||[]).length, pn=(n.places||[]).length, rn=(n.propernouns||[]).length;
    return `<div class="cv-row">
      <b>${esc(x.name)}</b>
      <span class="cv-cnt">👤${cn} · 📍${pn} · 🔤${rn}</span>
      <span class="cv-actions">
        <button class="cv-b btn" data-glib-use="${x.id}">选用</button>
        <button class="cv-b btn" data-glib-del="${x.id}">删除</button>
      </span>
    </div>`;
  }).join('') : '<p class="muted" style="margin:8px 0">还没有保存过词典。先打开一个新长篇并导入/生成词典，点「存入词典库」即可在此汇集多套世界观。</p>';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🗂️ 词典库</b><button class="gs-x" data-glib-close>✕</button></div>
      <div class="gs-body">
        <p class="muted" style="margin:0 0 8px">跨作品汇集可复用词典。点「选用」即挂载到当前新篇的辅轨槽位，之后设置遵从度、生成大纲即可带入。</p>
        ${itemsHtml}
      </div>
      <div class="gs-actions" style="grid-template-columns:1fr 1fr">
        <button class="btn" data-glib-close>关闭</button>
        <button class="btn primary" data-glib-save>＋ 存入当前词典</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-glib-close]').forEach(b=> b.onclick = closeGlibPanel);
  ov.querySelector('[data-glib-save]').onclick = glibSave;
  ov.querySelectorAll('[data-glib-use]').forEach(b=> b.onclick = ()=> glibUse(b.dataset.glibUse));
  ov.querySelectorAll('[data-glib-del]').forEach(b=> b.onclick = ()=>{ if(confirm('从库中删除该词典？不影响已生成作品。')) glibDel(b.dataset.glibDel); });
  ov.addEventListener('click', e=>{ if(e.target===ov) closeGlibPanel(); });
}
function exportWorkGlossaryJSON(id){
  const p = lib.items.find(i=> i.id === id);
  const g = p && p.outline && p.outline.glossary;
  if(!p || !g || !sourceHasGlossary(g)){ toast('该作品暂无可用词典'); return; }
  const meta = { _meta:{ title:p.title||'复用词典', source:'storyfactory', version:'2.0', exportedAt:new Date().toISOString() } };
  download(`词典_${(p.title||'story').slice(0,12)}.json`, JSON.stringify({ ...meta, ...g }, null, 2));
  toast('已导出该作词典 JSON');
}
function normalizeGlossaryJSON(j){
  const src = (j && j._meta) ? j : j;
  const ok = src && typeof src==='object'
    && (Array.isArray(src.characters) || Array.isArray(src.places) || Array.isArray(src.propernouns));
  if(!ok) return null;
  const subs = (Array.isArray(src.subplots)?src.subplots:[]).map(s=>{
    const name = String(s&&s.name||'').trim(); if(!name) return null;
    const st = SUB_STATUSES.includes(s.status) ? s.status : '进行中';
    const log = (Array.isArray(s.log)?s.log:[]).filter(x=>x && Number.isFinite(x.ch)).map(x=>({ch:x.ch, note:String(x.note||'').trim()}));
    return { name, status: st,
      question: String(s.question||'').trim(),
      arc: { from: String((s.arc&&s.arc.from)||'').trim(), to: String((s.arc&&s.arc.to)||'').trim() },
      pivot: String(s.pivot||'').trim(),
      log,
      _lastCh: log.length ? Math.max(...log.map(x=>x.ch)) : 0,
      _auto: !!s._auto };
  }).filter(Boolean);
  return { characters: Array.isArray(src.characters)?src.characters:[], places: Array.isArray(src.places)?src.places:[], propernouns: Array.isArray(src.propernouns)?src.propernouns:[], subplots: subs };
}
function importGlossaryJson(file, target){
  const r = new FileReader();
  r.onload = ()=>{
    try{
      const j = JSON.parse(r.result);
      const g = normalizeGlossaryJSON(j);
      if(!g) throw 0;
      if(!state.outline){ toast('请先生成大纲后再导入词典'); return; }
      if(!state.outline.glossary) state.outline.glossary = {characters:[], places:[], propernouns:[]};
      const cur = state.outline.glossary;
      const CATS = [['characters','人物'],['places','地点'],['propernouns','专名']];
      let hasDup = false;
      CATS.forEach(([k])=>{
        const names = new Set((cur[k]||[]).map(x=>String(x&&x.name||'').trim()).filter(Boolean));
        (g[k]||[]).forEach(it=>{ const nm=String(it&&it.name||'').trim(); if(nm && names.has(nm)) hasDup = true; });
      });
      const overwrite = hasDup && confirm('导入内容与当前词典存在同名条目。\n【确定】同名以导入版覆盖\n【取消】同名保留当前版（只添加我没有的新词条）');
      glossaryHistoryPush('导入词典（合并）前');
      let added=0, kept=0, repl=0;
      const mergeCat = (key)=>{
        const arr = Array.isArray(cur[key]) ? cur[key] : (cur[key] = []);
        const names = new Set(arr.map(x=>String(x&&x.name||'').trim()).filter(Boolean));
        (g[key]||[]).forEach(it=>{
          const nm = String(it&&it.name||'').trim(); if(!nm) return;
          if(names.has(nm)){
            if(overwrite){ const i = arr.findIndex(x=>String(x&&x.name||'').trim()===nm); if(i>=0){ arr[i] = it; repl++; } }
            else kept++;
          } else { arr.push(it); names.add(nm); added++; }
        });
      };
      CATS.forEach(([k])=> mergeCat(k));
      if(Array.isArray(g.subplots) && g.subplots.length) mergeCat('subplots');   // 副线同逻辑（按 name）
      persist(); render();
      toast(`词典已合并导入：新增 ${added} · 同名保留 ${kept} · 同名覆盖 ${repl}`);
    }catch(e){ toast('导入失败：JSON 至少需含 characters/places/propernouns 之一（数组）'); }
  };
  r.readAsText(file);
}

function glossaryAliases(){
  const o = state.outline; const map = new Map();
  if(o && o.glossary) ['characters','places','propernouns'].forEach(k => (o.glossary[k]||[]).forEach(it => {
    const cur = String(it && it.name || '').trim();
    (Array.isArray(it && it._alias) ? it._alias : []).forEach(a => {
      const al = String(a||'').trim();
      if(al && cur && al !== cur && !map.has(al)) map.set(al, cur);
    });
  }));
  return map;
}
function syncNameEverywhere(oldName, newName){
  const o = state.outline; if(!o || !oldName || !newName || oldName === newName) return 0;
  let n = 0;
  const rep = s => { if(s === oldName){ n++; return newName; } return s; };
  if(Array.isArray(o.chapterPlans)) o.chapterPlans.forEach(p => {
    if(!p) return;
    if(Array.isArray(p.requiredEntities)) p.requiredEntities = p.requiredEntities.map(rep);
  });
  if(o.navBeacon && typeof o.navBeacon.protagonist === 'string'){
    const pr = o.navBeacon.protagonist;
    if(pr === oldName){ o.navBeacon.protagonist = newName; n++; }
    else if(pr.indexOf(oldName) === 0 && /^[，,：:（(]/.test(pr.slice(oldName.length))){ o.navBeacon.protagonist = newName + pr.slice(oldName.length); n++; }
  }
  if(o._factCard && o._factCard.characters && o._factCard.characters[oldName] !== undefined){
    o._factCard.characters[newName] = o._factCard.characters[oldName];
    delete o._factCard.characters[oldName];
  }
  return n;
}

function scanGlossaryImpact({type, idx, oldVal, newVal, isName}){
  const g = state.outline.glossary;
  const getArr = t => t==='char'?(g.characters||[]):t==='place'?(g.places||[]):(g.propernouns||[]);
  const arr = getArr(type);
  const entityName = arr[idx] ? arr[idx].name : oldVal;
  const terms = new Set();
  if(isName && oldVal) terms.add(oldVal);      // 改名：扫旧名，找旧章节正文
  else if(entityName) terms.add(entityName);   // 改详情：扫该实体名是否被正文引用
  const hits = state.chapters.map((c,i)=>{
    if(!c || !c.content) return null;
    let n = 0, occurs = 0;
    for(const t of terms){ if(t){ const re = new RegExp(escRe(t), 'g'); const m = String(c.content).match(re); if(m){ n += m.length; occurs++; } } }
    return occurs>0 ? {i, n, title: c.title||('第'+(i+1)+'章')} : null;
  }).filter(Boolean);
  const refs = [];
  const refNames = isName ? [oldVal, newVal] : [entityName];
  ['char','place','proper'].forEach(t=>{
    getArr(t).forEach((it, ii)=>{
      if(t===type && ii===idx) return;
      const tsv = Object.values(it).join(' ');
      for(const rn of refNames){ if(rn && tsv.includes(rn)){ refs.push({t, ii, name: it.name||''}); break; } }
    });
  });
  return {hits, refs, word: isName ? oldVal : entityName};
}
function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function openGlossaryPanel(info){
  closeGlossaryPanel();
  if(!state.outline || !state.outline.glossary) return;
  const g = state.outline.glossary;
  const getArr = t => t==='char'?(g.characters||[]):t==='place'?(g.places||[]):(g.propernouns||[]);
  const arr = getArr(info.type);
  const itemName = arr[info.idx] ? arr[info.idx].name : '该条目';
  const scan = scanGlossaryImpact(info);
  const hits = scan.hits || [];

  const labels = {name:'名称', identity:'身份', age:'岁数', gender:'性别', appearance:'外貌', hobby:'爱好', mannerism:'小动作/口头禅', catchphrase:'口头禅', relation:'关系', trait:'性格', type:'类型', note:'说明'};
  const kind = info.isName ? `「${info.oldVal||''}」→「${info.newVal||''}」`
    : `「${itemName}」的「${labels[info.key]||info.key||'详情'}」已修改（正文引用该条目 ${scan.word?('出现自 「'+scan.word+'」'):''}）`;
  const hitHtml = hits.length ? hits.map(h=>`
    <label class="gs-hit"><input type="checkbox" class="gs-hit-cb" data-ch="${h.i}" checked />
      <span>第${h.i+1}章 · ${esc(h.title||'')}</span><i>正文出现 ${h.n} 次</i></label>`).join('')
    : `<p class="gs-nohit">✓ 旧名在已生成正文中未出现，无需重塑任何章节。该改动仅对后续新生成章节生效。</p>`;
  const refHtml = scan.refs.length ? `<div class="gs-refs">⚠️ 词典内其它条目仍引用旧名（建议一并核对）：${scan.refs.map(r=>{
    const lab = r.t==='char'?'人物':r.t==='place'?'地点':'专名';
    return `<span class="pill">${lab}「${esc(r.name||'')}」</span>`;
  }).join('')}</div>` : '';

  const names = {char:'人物',place:'地点',proper:'专名'};
  const ov = document.createElement('div');
  ov.id = 'gsPanel';
  ov.className = 'gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📇 词典改动 · 影响范围</b>
        <button class="gs-x" data-gs-close>✕</button></div>
      <p class="gs-modal-sub">检测到你改动了 ${names[info.type]||''}：${kind}</p>
      <div class="gs-body">
        <p class="gs-q"><b>① 会影响的已生成章节（默认全选，可取消个别）：</b></p>
        ${hitHtml}
        ${refHtml}
      </div>
      <div class="gs-actions">
        <button class="btn ghost" data-gs-undo>↩ 回退本次改动</button>
        <button class="btn ghost" data-gs-future>仅对新章生效</button>
        <button class="btn primary" data-gs-regen ${hits.length?'':'disabled'}>⚡ 批量重生成所选章节（${hits.length}）</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-gs-close]').onclick = closeGlossaryPanel;
  ov.querySelector('[data-gs-future]').onclick = ()=>{
    gsUndoStack.pop();   // 已生效，丢弃快照
    closeGlossaryPanel();
    toast('已保存，仅对后续新章生效');
  };
  ov.querySelector('[data-gs-undo]').onclick = ()=>{
    const snap = gsUndoStack.pop();
    if(snap){ try{ state.outline.glossary = JSON.parse(snap); persist(); }catch(e){} }
    closeGlossaryPanel(); renderGlossaryOnly(); toast('已恢复改动前词典');
  };
  const regenBtn = ov.querySelector('[data-gs-regen]');
  if(regenBtn) regenBtn.onclick = ()=>{
    const sel = $$('.gs-hit-cb:checked', ov).map(b=>+b.dataset.ch);
    gsUndoStack.pop();   // 用户已确认批量重生成，丢弃快照（重生成后为新一致性）
    closeGlossaryPanel();
    regenSelectedChapters(sel);
  };
  ov.addEventListener('click', e=>{ if(e.target===ov) closeGlossaryPanel(); });
}
function renderGlossaryOnly(){
  const host = $('#view');
  if(host){ host.innerHTML = viewStory(); bindView(); window.scrollTo({top:100, behavior:'smooth'}); }
}

async function regenSelectedChapters(list){
  if(!list || !list.length) return;
  const panel = document.createElement('div');
  panel.id = 'gsPanel'; panel.className = 'gs-overlay';
  panel.innerHTML = `<div class="gs-modal"><div class="gs-modal-head"><b>⚡ 正在按新词典重生成 ${list.length} 章…</b></div>
    <p class="gs-progress muted">请保持页面打开，逐章推进，不会打断你浏览已生成章节。</p></div>`;
  document.body.appendChild(panel);
  state.generating = true;
  try{
    for(const i of list){
      chState[i]='generating'; patchChapter(i);
      const pg = panel.querySelector('.gs-progress');
      if(pg) pg.textContent = `正在重写第 ${i+1} 章…`;
      try{
        const user = buildChapterUser(i, {regenerating:true});
        const txt = await writeOneChapterContent(i, user);      // 关闭流式，单章连贯
        snapshotChapterVersion(i);
        state.chapters[i].content = txt;
        chState[i]='done'; persist(); patchChapter(i);
      }catch(e){ chState[i]='error'; persist(); patchChapter(i); }
    }
    closeGlossaryPanel();
    renderChapters();
    toast('所选章节已按新词典重生成完成');
  }finally{ state.generating = false; }
}
function closeGlossaryPanel(){ const p=$('#gsPanel'); if(p) p.remove(); }

function ensureChapterHistory(i){
  const c = state.chapters[i]; if(!c) return c;
  if(!Array.isArray(c.history)) c.history = [];
  return c;
}
function snapshotChapterVersion(i){
  const c = ensureChapterHistory(i); if(!c) return;
  const cur = c.content;
  if(cur && String(cur).trim()) c.history.push({ content: cur, ts: Date.now() });
  if(c.history.length > 50) c.history.splice(0, c.history.length - 50); // 上限50防膨胀
}
function chVersions(i){ const c=ensureChapterHistory(i); return c? c.history : []; }
function hasChVersions(i){ return chVersions(i).length > 0; }

function hasEditHistory(i){ const c=state.chapters[i]; return !!(c && Array.isArray(c.editHistory) && c.editHistory.length); }
function undoChapterEdit(i){
  const c = state.chapters[i];
  if(!c || !Array.isArray(c.editHistory) || !c.editHistory.length){ toast('没有可撤销的编辑'); return; }
  c.content = c.editHistory.pop();
  persist(); renderChapters(); updateWcTotal();
  toast('已撤销一次编辑');
}

function openChapterVersionPanel(i){
  closeChapterVersionPanel();
  const c = ensureChapterHistory(i); if(!c) return;
  const title = c.title || ('第'+(i+1)+'章');
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const cur = String(c.content||'');
  const hist = c.history;
  const rows = hist.map((v,origIdx)=>`
    <div class="cv-row">
      <div class="cv-meta"><span class="cv-time">${fmtTs(v.ts)}</span><span class="cv-wc">${(v.content||'').length} 字</span></div>
      <div class="cv-actions">
        <button type="button" class="btn ghost cv-b" data-cv-prev="${origIdx}">预览</button>
        <button type="button" class="btn ghost cv-b" data-cv-restore="${origIdx}">↩ 恢复</button>
      </div>
    </div>`).join('');
  const ov = document.createElement('div'); ov.id='cvPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>📚 版本历史 · 第${i+1}章「${esc(cleanChapterTitle(title))}」</b>
        <button class="gs-x" data-cv-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-row cur"><div class="cv-meta"><span class="cv-time">当前版本</span><span class="cv-wc">${cur.length} 字</span></div></div>
        ${hist.length? `<div class="cv-div">历史版本（点「恢复」回到该版；恢复前会先把当前正文存为新的历史版本）</div>${rows}`
        : '<p class="muted cv-empty">暂无历史版本。当章节被重生成时，旧正文会自动存档在这里，供你随时回退。</p>'}
        <div class="cv-preview hidden" id="cvPreview">
          <div class="cv-prev-head"><b id="cvPrevTitle">版本预览</b><button class="gs-x" data-cv-prev-close>✕</button></div>
          <div class="cv-pre" id="cvReader"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-cv-close]').onclick = closeChapterVersionPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeChapterVersionPanel(); });
  ov.addEventListener('click', e=>{
    const p = e.target.closest('[data-cv-prev]'); if(!p) return;
    const v = hist[+p.dataset.cvPrev]; if(!v) return;
    const pr=$('#cvPreview'), rd=$('#cvReader'), pt=$('#cvPrevTitle');
    if(pr && rd){ pt.textContent = '预览 · 历史版本（'+fmtTs(v.ts)+'）'; rd.textContent = v.content||'（空）'; pr.classList.remove('hidden'); }
  });
  ov.querySelector('[data-cv-prev-close]').onclick = ()=>{ const pr=$('#cvPreview'); if(pr) pr.classList.add('hidden'); };
  ov.addEventListener('click', e=>{
    const rb = e.target.closest('[data-cv-restore]'); if(!rb) return;
    const v = hist[+rb.dataset.cvRestore]; if(!v) return;
    if(!window.confirm('恢复该历史版本将覆盖当前正文。\n\n（当前正文会自动保存为一条新的历史版本，不会被删除。）\n确定恢复吗？')) return;
    snapshotChapterVersion(i);                  // 先把当前正文存历史
    c.content = v.content;                      // 用历史版覆盖当前
    c.history.splice(+rb.dataset.cvRestore, 1);
    persist(); closeChapterVersionPanel(); renderChapters();
    toast('已恢复历史版本');
  });
}
function closeChapterVersionPanel(){ const p=$('#cvPanel'); if(p) p.remove(); }

let chPage = 0;
const CH_PAGE_SIZE = 10;
function chCardHtml(c, i){
  const hasC = !!(c.content && c.content.trim());
  const planGi = chapterOfPlan(i);
  const planBtn = planGi >= 0 ? `<button class="btn ghost" data-plan-ch="${i}" data-plan-gi="${planGi}" title="查看本章教案（老师${planGi+1}）">📖 教案</button>` : '';
  return `<div class="card ch-card" data-ch-card="${i}" style="background:var(--panel);border:1px solid var(--line)">
        <div class="ch-head" data-fold="${i}" role="button" tabindex="0" aria-expanded="true">
          <span class="ch-fold-ico">▾</span>
          <h3 style="margin:0;flex:1;word-break:break-word;line-height:1.35" title="第${i+1}章 · ${esc(cleanChapterTitle(c.title))}">第${i+1}章 · ${esc(cleanChapterTitle(c.title))}${c._titleByAI?'<i class="tbd-title-tag" style="font-style:normal;font-size:11px;font-weight:400;opacity:.55;margin-left:6px" title="本章标题已由章节正文 AI 定稿">正文定稿</i>':(!state.plannerFinalized?'<i class="tbd-title-tag" style="font-style:normal;font-size:11px;font-weight:400;opacity:.55;margin-left:6px" title="标题尚未由全书规划师定稿，当前沿用第二步参考稿">参考稿</i>':'')}</h3>
          ${wcBadge(c.content, `data-wc-ch="${i}"`)}
        </div>
        <div class="ch-meta ch-status-wrap" data-ch-status="${i}">${chapterBadgesHtml(i)}</div>
        <div class="ch-body">
          <textarea data-ch="${i}" class="${hasC?'':'ch-ta-empty'}" style="margin-top:8px" ${hasC?'':'placeholder="暂无正文：点击「🔄 重生成」生成，或直接在此输入"'}>${esc(c.content)}</textarea>
          <div class="btn-row">
            <button class="btn ghost" data-regen="${i}" ${state.generating?'disabled':''}>🔄 重生成</button>
            ${planBtn}
            <button class="btn ghost" data-read="${i}">📖 阅读</button>
            <button class="btn ghost" data-ch-sum="${i}" title="生成本章速读梗概（本章正文压缩至约 1/3，省时阅读）" ${hasC?'':'disabled'}>🏮 本章梗概</button>
            ${hasChVersions(i)?`<button class="btn ghost" data-ver="${i}">📚 版本(${chVersions(i).length})</button>`:''}
            ${hasEditHistory(i)?`<button class="btn ghost" data-undo="${i}" title="撤销最近一次手动编辑">↩ 撤销编辑</button>`:''}
          </div>
        </div>
      </div>`;
}
function renderChapters(){
  const wrap = $('#chaptersWrap'); if(!wrap) return;
  const total = state.chapters.length;
  if(isLong()){
    if(!total){
      if(state.outline && Array.isArray(state.outline.chapters) && state.outline.chapters.length && syncChaptersFromOutline()){
        persist();
        return renderChapters();
      }
      const wantN = chapterCountVal();
      if(wantN > 0){
        state.chapters = Array.from({length: wantN}, (_,k)=>({
          num: k+1,
          title: (state.outline && state.outline.chapters && state.outline.chapters[k] && state.outline.chapters[k].title) || `第${k+1}章`,
          content: '',
          confirmed: true,
          beat: (state.outline && state.outline.chapters && state.outline.chapters[k] && state.outline.chapters[k].beat) || ''
        }));
        persist();
        return renderChapters();
      }
      wrap.innerHTML = `<div class="ch-pager"><span class="muted">共 0 章：先在第②步生成大纲。</span></div>`;
      return;
    }
    const maxPage = Math.max(0, Math.ceil(total / CH_PAGE_SIZE) - 1);
    if(chPage > maxPage) chPage = maxPage;
    const from = chPage * CH_PAGE_SIZE;
    const slice = state.chapters.slice(from, from + CH_PAGE_SIZE);
    const html = slice.map((c,offset)=> chCardHtml(c, from + offset)).join('');
    const pageCount = Math.max(1, Math.ceil(total / CH_PAGE_SIZE));
    const pages = Array.from({length:pageCount},(_,p)=>p)
      .map(p=>`<button type="button" class="ch-page${p===chPage?' active':''}" data-page="${p}">${p+1}</button>`).join('');
    wrap.innerHTML = `<div class="ch-pager"><span class="muted">第 ${from+1}–${from+slice.length} 章 / 共 ${total} 章</span>${pages}</div>
      ${html}
      <div class="ch-pager">${pages}</div>`;
  } else {
    wrap.innerHTML = state.chapters.map((c,i)=>`
      <div class="card ch-card" data-ch-card="${i}" style="background:var(--panel);border:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
         <div style="display:flex;align-items:center;gap:8px;min-width:0">
  <h3 style="margin:0;word-break:break-word;line-height:1.35" title="第${i+1}章 · ${esc(cleanChapterTitle(c.title))}">第${i+1}章 · ${esc(cleanChapterTitle(c.title))}</h3>
  <button class="btn ghost" data-ver="${i}" style="padding:2px 6px;font-size:11px;flex-shrink:0" title="版本历史">📚 ${chVersions(i).length}</button>
  ${wcBadge(c.content, `data-wc-ch="${i}"`)}
</div>
<span class="pill ${c.confirmed?'tag-ok':'tag-warn'}">${c.confirmed?'✓ 已确认':'待确认'}</span>
        </div>
        <textarea data-ch="${i}" style="margin-top:8px">${esc(c.content)}</textarea>
        <div class="btn-row">
          <button class="btn ghost" data-regen="${i}">🔄 重生成</button>
          <button class="btn ghost" data-read="${i}">📖 阅读</button>
          <button class="btn ghost" data-ch-sum="${i}" title="生成本章速读梗概（本章正文压缩至约 1/3，省时阅读）" ${c.content&&String(c.content).trim()?'':'disabled'}>🏮 本章梗概</button>
        
          ${hasEditHistory(i)?`<button class="btn ghost" data-undo="${i}" title="撤销最近一次手动编辑">↩ 撤销编辑</button>`:''}
          <button class="btn ghost" data-toggle="${i}">${c.confirmed?'↺ 取消确认':'✓ 标记已确认'}</button>
        </div>
      </div>`).join('');
  }
}

let readerCur = -1;
function renderToc(current){
  const list = $('#tocList'); if(!list) return;
  const total = state.chapters.length;
  const cn = $('#tocCount'); if(cn) cn.textContent = total;
  list.innerHTML = state.chapters.map((c,i)=>{
    const active = i === current ? ' active' : '';
    const done = c.content && c.content.trim() ? ' done' : '';
    return `<button type="button" class="toc-item${active}${done}" data-toc="${i}"><span class="toc-idx">${i+1}</span><span class="toc-t">${esc(cleanChapterTitle(c.title)||('第'+(i+1)+'章'))}</span></button>`;
  }).join('');
}
function toCnNum(n){
  const cn=['零','一','二','三','四','五','六','七','八','九'];
  if(n < 10) return cn[n];
  if(n < 20) return '十' + (n%10 ? cn[n%10] : '');
  if(n < 100){ const t=Math.floor(n/10), u=n%10; return cn[t]+'十'+(u?cn[u]:''); }
  if(n < 1000){ const h=Math.floor(n/100), r=n%100; return cn[h]+'百'+(r? (r<10?'零'+cn[r] : toCnNum(r)) : ''); }
  return String(n);
}
function cleanChapterTitle(title){
  if(!title) return '';
  let t = String(title).trim();
  t = t.replace(/^(第\s*[0-9一二三四五六七八九十百千两0-9]+\s*章|[一二三四五六七八九十百千]+章)(\s*[·、：:．.，,，\-–—]\s*|\s*)/,'');
  return t.trim();
}
function openReader(i){
  const c = state.chapters[i]; if(!c) return;
  const ov = $('#readerOverlay'); if(!ov) return;
  $('#readerTitle').textContent = `第${toCnNum(i+1)}章 · ${cleanChapterTitle(c.title)}`;
  const _readerClean = splitChapterCastout(c.content||'');
  if(_readerClean.body !== String(c.content||'').trim() || (_readerClean.castOut && _readerClean.castOut !== String(c.castOut||''))){
    c.content = _readerClean.body;
    if(_readerClean.castOut) c.castOut = _readerClean.castOut;
    persist();
  }
  const paras = String(_readerClean.body||'').split(/\n+/).map(p=>p.trim()).filter(Boolean);
  let fallback = `<p class="muted">（本章尚未生成正文）</p>`;
  const csum = (state.chapters[i] && state.chapters[i].strip) ? String(state.chapters[i].strip).trim() : '';
  if(csum) fallback = `<p class="muted">🗂 本章梗概：${esc(csum)}</p>
    <p class="muted" style="margin-top:6px">生成正文后将在此展示全文。可用下方「重生成」或「一键批量生成」补写。</p>`;
  $('#readerBody').innerHTML = paras.length ? paras.map(p=>`<p>${esc(p)}</p>`).join('') : fallback;
  renderToc(i);
  readerCur = i;
  randomizeReaderGradient();
  ov.classList.remove('hidden');
  document.body.classList.add('reader-lock'); // 锁定背景滚动
  const body0 = $('#readerBody');
  if(body0) body0.scrollTop = 0;
  updateReaderProgress();
  try{
    const rp = JSON.parse(localStorage.getItem(nsKey('rp_') + (lib.curId||'x') + '_' + i) || 'null');
    if(rp && rp.top){
      requestAnimationFrame(()=>{ const b=$('#readerBody'); if(b) b.scrollTop = rp.top; updateReaderProgress(); });
    }
  }catch(e){}
}
function bindReaderScrollSave(){
  const b = $('#readerBody'); if(!b || b.dataset.rpBound) return;
  b.dataset.rpBound = '1';
  let _t = null;
  b.addEventListener('scroll', ()=>{
    if(_t) return;
    _t = setTimeout(()=>{
      _t = null;
      try{
        localStorage.setItem(nsKey('rp_') + (lib.curId||'x') + '_' + readerCur, JSON.stringify({ top: b.scrollTop }));
      }catch(e){}
      updateReaderProgress();
    }, 400);
  }, {passive:true});
}
function updateReaderProgress(){
  const b = $('#readerBody'), fill = $('#readerProgressFill'), tip = $('#readerPctTip');
  if(!b || !fill) return;
  const max = b.scrollHeight - b.clientHeight;
  const p = max>0 ? Math.min(100, Math.max(0, Math.round(b.scrollTop/max*100))) : 0;
  fill.style.width = p+'%';
  if(tip){
    const paras = b.querySelectorAll('p').length;
    tip.innerHTML = `第 <b>${p}%</b> · 全文 <b>${paras}</b> 段`;
  }
}
function randomizeReaderGradient(){
  const fill = $('#readerProgressFill'); if(!fill) return;
  const h1 = Math.floor(Math.random()*360);
  const h2 = (h1 + 40 + Math.floor(Math.random()*140)) % 360;   // 色相差 40°~180°
  fill.style.setProperty('background', `linear-gradient(90deg, hsl(${h1} 78% 62%), hsl(${h2} 78% 62%))`, 'important');
}
function closeReader(){
  const ov = $('#readerOverlay'); if(!ov) return;
  ov.classList.add('hidden');
  if(ov.dataset.exportReader === '1'){
    delete ov.dataset.exportReader;
    const tocBtn = $('#readerTocBtn'); if(tocBtn) tocBtn.style.display = '';
    const synBtn = $('#readerSynBtn'); if(synBtn) synBtn.style.display = '';
  }
  const toc = $('#readerToc'); if(toc) toc.classList.add('hidden');
  document.body.classList.remove('reader-lock');
}
function bindReader(){
  const ov = $('#readerOverlay'); if(!ov) return;
  bindReaderScrollSave();
  $$('[data-reader-close]', ov).forEach(el=> el.onclick = (e)=>{
    if(e.target.closest('.reader-panel') && !e.target.closest('.reader-close')) return;
    closeReader();
  });
  const tocBtn = $('#readerTocBtn'); const toc = $('#readerToc');
  if(tocBtn && toc){
    tocBtn.onclick = (e)=>{ e.stopPropagation(); const show = toc.classList.toggle('hidden'); tocBtn.classList.toggle('on', !show); };
  }
  const tocClose = $('#tocClose');
  if(tocClose && toc) tocClose.onclick = (e)=>{ e.stopPropagation(); toc.classList.add('hidden'); if(tocBtn) tocBtn.classList.remove('on'); };
  const panel = ov.querySelector('.reader-panel');
  if(panel && toc && tocBtn){
    panel.addEventListener('click', (e)=>{
      if(toc.classList.contains('hidden')) return;      // 目录已收起，无需处理
      if(e.target.closest('#readerToc')) return;        // 点目录内部不收起
      if(e.target.closest('#readerTocBtn')) return;     // 点目录开关不收起（交由自身 toggle）
      toc.classList.add('hidden');
      tocBtn.classList.remove('on');
    });
  }
  const list = $('#tocList');
  if(list && toc) list.onclick = (e)=>{
    const item = e.target.closest('[data-toc]'); if(!item) return;
    openReader(+item.dataset.toc);
  };
  const synBtn = $('#readerSynBtn'), synPop = $('#readerSynPop'), synCard = $('#readerSynCard');
  if(synBtn && synPop && synCard){
    synBtn.onclick = (e)=>{
      e.stopPropagation();
      const o = state.outline || {};
      const ch = (Array.isArray(state.chapters) && state.chapters[readerCur]) ? state.chapters[readerCur] : null;
      const strip = ch && String(ch.strip||'').trim();
      const plans = Array.isArray(o.chapterPlans) ? o.chapterPlans : [];
      const plan = plans[readerCur];
      const btTxt = (plan && typeof plan.beatsText === 'string' && plan.beatsText.trim()) ? plan.beatsText.trim() : '';
      const SEC_NAMES = ['承接点','承接','场景链与切换','场景链','逐拍推进','情绪弧','心情弧','情绪基调','必须使用实体','必须实体','出场实体','埋设伏笔','收束设计','收束','设定'];
      const secOf = (name, alias)=>{
        const lines = btTxt.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        const re = new RegExp('^(?:'+(alias?name+'|'+alias:name)+')[：:\\s]*(.*)$');
        for(let i=0;i<lines.length;i++){
          const m = lines[i].match(re);
          if(!m) continue;
          const buf = [(m[1]||'').trim()].filter(Boolean);
          for(let j=i+1;j<lines.length;j++){
            if(SEC_NAMES.some(n=>new RegExp('^(?:'+n+')[：:\\s]').test(lines[j]))) break;   // 下一小节标题即止
            buf.push(lines[j]);
          }
          const v = buf.join('；').replace(/\s+/g,' ').trim();
          if(v) return v.slice(0, 200);
        }
        return null;
      };
      let title, body;
      const _lesson = teacherChapterPlan ? teacherChapterPlan(readerCur) : null;
      if(_lesson && String(_lesson).trim()){
        title = `第${toCnNum(readerCur+1)}章 · 本章教案`;
        body = `<div class="syn-body"><div style="font-size:12px;color:var(--muted);margin-bottom:6px">🎓 老师教案（本章正文的唯一权威内容体）· 原始稿：</div><pre class="sc-plan-raw">${esc(_lesson)}</pre></div>`;
      } else if(btTxt){
        const cj = secOf('承接点','承接'); const ss = secOf('收束设计','收束');
        const _te = _timelineEssenceOf((Array.isArray(o.chapterPlans)?o.chapterPlans[readerCur]:null));
        title = `第${toCnNum(readerCur+1)}章 · 本章概览`;
        body = `<div class="syn-body rb-overview">
          ${_te?`<div class="rb-ov-sec"><b class="rb-ov-lb">⏱ 时间线要点（将注入全书时间线）</b><div>${esc(_te)}</div></div>`:''}
          ${cj||ss?`<div class="rb-ov-sec"><b class="rb-ov-lb">承接点</b><div>${cj?esc(cj):'<span class="muted">（本章编排未单列承接点）</span>'}</div></div>
          ${ss?`<div class="rb-ov-sec"><b class="rb-ov-lb">收束设计</b><div>${esc(ss)}</div></div>`:''}`:`<div class="rb-ov-sec"><b class="rb-ov-lb">本章编排</b><div>${esc(clipText(btTxt, 180))}</div></div>`}
        </div>`;
      } else if(strip){
        title = `第${toCnNum(readerCur+1)}章 · 本章梗概`;
        body = `<div class="syn-body">${esc(strip)}</div>`;
      } else {
        title = `第${toCnNum(readerCur+1)}章 · 节拍表`;
        body = `<div class="syn-body muted">本章暂无节拍表：请先在「全书规划师」生成①节拍表。</div>`;
      }
      synCard.innerHTML = `<h4>${title}</h4>${body}`;
      synPop.classList.remove('hidden');
    };
    synPop.onclick = (e)=>{ if(e.target === synPop) synPop.classList.add('hidden'); };  // 点遮罩关闭
  }
}
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    const sp = $('#readerSynPop');
    if(sp && !sp.classList.contains('hidden')){ sp.classList.add('hidden'); return; }
    closeReader();
    const h = $('#histPanel'); if(h && !h.classList.contains('hidden')) closeHistPanel();
    const t = $('#themePanel'); if(t && !t.classList.contains('hidden')) closeThemePanel();
  }
});

function updateChapterWc(i, text){
  const el = $('[data-wc-ch="'+i+'"]');
  if(!el) return;
  const w = countWords(text);
  el.innerHTML = wcInner(w);
  el.title = `中文 ${w.cjk} 字 · 英文 ${w.en} 词`;
}
function updateWcTotal(){
  const el = $('#wcTotal'); if(!el) return;
  const chapters = state.chapters.filter(c=> c.content && c.content.trim());
  if(!chapters.length){ el.classList.add('hidden'); el.innerHTML=''; return; }
  let total=0, cjk=0, en=0;
  chapters.forEach(c=>{ const w = countWords(c.content); total+=w.total; cjk+=w.cjk; en+=w.en; });
  const fmt = n=> n.toLocaleString('en-US');
  el.classList.remove('hidden');
  el.innerHTML = `<span class="inner">📚 小说内容总字数 <b>${fmt(total)}</b> <span class="brk">（中 ${fmt(cjk)} · 英 ${en}）</span></span>`;
}

function renderLongProgress(){
  const el = $('.long-progress'); if(!el) return;
  const done = state.chapters.filter(c=> c.content && c.content.trim()).length;
  const total = state.chapters.length;
  let chars = 0; state.chapters.forEach(c=> chars += countWords(c.content).total);
  const cap = total ? `全书 ${total} 章` : (chapterCountVal() ? `全书 ${chapterCountVal()} 章` : '');
  el.innerHTML = `<span class="pill">写作进度：${done}/${total} 章</span> <span class="pill">已写约 ${chars.toLocaleString('en-US')} 字${cap ? ' · '+cap : ''}</span>`;
}

function viewCharacters(){
  if(!readyForAssets()){
    return `<div class="center-empty">请先在「故事」里生成大纲并生成章节。<br>角色提示词需要基于完整故事生成。</div>`;
  }
  if(!state.characters.length){
    return `<div class="card">
      <h3>🧑 角色定妆提示词包</h3>
      <p class="sub">基于故事大纲提取主要角色，并生成即梦影视前期视觉提示词。</p>
      <button id="btnGenChars" class="btn primary block">✨ 生成角色定妆提示词</button>
      <p id="charStatus" class="status"></p>
    </div>`;
  }
  const ids = [...new Set(state.characters.map(c=>(c.profile&&c.profile.身份)||c.role||'').filter(Boolean))];
  const identOptions = ids.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  return `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3>🧑 角色定妆提示词包（${state.characters.length}）</h3>
        <span class="btn-row" style="margin:0">
          ${hasAssetHist('characters')?`<button id="btnCharHist" class="btn ghost">🕘 历史(${assetHistCount('characters')})</button>`:''}
          <button id="btnGenChars" class="btn ghost">🔄 重生成</button>
        </span>
      </div>
      <div class="char-toolbar">
        <input id="charSearch" class="char-search" placeholder="🔍 搜索角色姓名 / 身份…" value="${esc(charFilters.q)}">
        <select id="charJump" class="char-jump" placeholder="选择角色快速定位"></select>
        <select id="charIdent" multiple placeholder="身份筛选（可多选）">${identOptions}</select>
        <div class="char-filters">
          <select id="charGender">
            <option value="" ${charFilters.gender===''?'selected':''}>性别：全部</option>
            <option value="男" ${charFilters.gender==='男'?'selected':''}>男</option>
            <option value="女" ${charFilters.gender==='女'?'selected':''}>女</option>
            <option value="其他" ${charFilters.gender==='其他'?'selected':''}>其他</option>
          </select>
          <div class="cf-age">
            <input type="number" id="ageMin" class="age-input" placeholder="年龄≥" min="0" max="200" value="${esc(charFilters.ageMin)}">
            <span class="age-sep">~</span>
            <input type="number" id="ageMax" class="age-input" placeholder="年龄≤" min="0" max="200" value="${esc(charFilters.ageMax)}">
          </div>
        </div>
        <div class="char-count" id="charCount"></div>
      </div>
    </div>
    <div id="charList">${charFiltered().map(idx=>charCard(state.characters[idx], idx)).join('')}</div>` + fallbackRaw('characters');
}

function charCard(c, idx){
  const pf = c.profile||{};
  const kv = Object.entries(pf).map(([k,v])=>`<div class="kv"><span class="k">${esc(k)}</span><input type="text" class="char-edit" data-char-kv="${idx}" data-key="${esc(k)}" data-orig="${esc(v)}" value="${esc(v)}" /></div>`).join('');
  const order = ['定妆图','三视图','表情','服饰细节','道具','配色','材质'];
  const pr = c.prompts||{};
  const cards = order.map(k=>pr[k]==null?'':`
    <div class="subcard">
      <div class="lbl">${esc(k)}<button class="copy" data-copy="${esc(pr[k])}">复制</button></div>
      <textarea class="char-edit" data-char-prompt="${idx}" data-key="${esc(k)}" data-orig="${esc(pr[k])}" rows="3">${esc(pr[k])}</textarea>
    </div>`).join('');
  const allText = Object.values(pf).join(' ') + ' ' + Object.values(pr).join(' ');
  return `<div class="card" id="char-${idx}">
    <h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${esc(c.name||'未命名')} <span class="pill">${esc(c.role||'')}</span> ${wcBadge(allText)}</h3>
    <div class="subcard">${kv}</div>
    ${cards}
    <p class="muted" style="margin:4px 0 0;font-size:11px">字段可直接编辑，失焦即存（不触发 AI）。</p>
  </div>`;
}
function bindCharEdit(){
  $$('[data-char-kv],[data-char-prompt]').forEach(inp=>{
    inp.onchange = ()=>{
      const idx = inp.hasAttribute('data-char-kv') ? +inp.dataset.charKv : +inp.dataset.charPrompt;
      const c = state.characters[idx]; if(!c) return;
      const k = inp.dataset.key;
      const v = inp.value;
      if(v === inp.dataset.orig) return;
      if(inp.hasAttribute('data-char-kv')){
        if(!c.profile) c.profile = {};
        c.profile[k] = v;
      } else {
        if(!c.prompts) c.prompts = {};
        c.prompts[k] = v;
      }
      inp.dataset.orig = v;
      persist();
      toast('角色卡已保存');
    };
  });
}

function charFiltered(){
  const {q, idents, gender, ageMin, ageMax} = charFilters;
  const min = ageMin===''||ageMin==null ? null : +ageMin;
  const max = ageMax===''||ageMax==null ? null : +ageMax;
  const out = [];
  state.characters.forEach((c,i)=>{
    const pf = c.profile||{};
    if(q){
      const hay = ((c.name||'')+' '+(c.role||'')+' '+(pf.身份||'')).toLowerCase();
      if(!hay.includes(q.toLowerCase())) return;
    }
    if(idents && idents.length){
      const id = pf.身份||c.role||'';
      if(!idents.some(v=> id.includes(v) || v.includes(id))) return;
    }
    if(gender){
      const g = pf.性别||'';
      if(gender==='其他'){ if(g==='男'||g==='女') return; }
      else if(g!==gender && !g.includes(gender)) return;
    }
    if(min!=null || max!=null){
      const age = parseAge(pf.年龄);
      if(age==null) return; // 未知年龄在有区间约束时默认不显示
      if(min!=null && age<min) return;
      if(max!=null && age>max) return;
    }
    out.push(i);
  });
  return out;
}
function applyCharFilters(){
  const wrap = $('#charList'); if(!wrap) return;
  const idxs = charFiltered();
  wrap.innerHTML = idxs.length
    ? idxs.map(i=>charCard(state.characters[i], i)).join('')
    : `<div class="center-empty">没有符合条件的角色，试试放宽筛选条件。</div>`;
  const cnt = $('#charCount');
  if(cnt) cnt.textContent = `显示 ${idxs.length} / ${state.characters.length} 个角色`;
  bindCopyBtns();
  bindCharEdit();
}
function bindCopyBtns(){ $$('[data-copy]').forEach(b=> b.onclick = ()=> copyText(b.getAttribute('data-copy')) ); }

function initCharFilter(){
  if(!window.TomSelect) return;
  const wrap = $('#charList'); if(!wrap) return;
  const jumpSel = $('#charJump');
  if(jumpSel){
    jumpSel.innerHTML = `<option value="">⬇️ 选择角色快速定位…</option>` + state.characters.map((c,i)=>`<option value="${i}">${esc(c.name||'未命名')}${c.role?(' · '+esc(c.role)):''}</option>`).join('');
    try{
      charTS.push(new TomSelect(jumpSel, {
        plugins:['dropdown_input'],
        placeholder:'⬇️ 选择角色快速定位…',
        allowEmptyOption:true,
        onChange: v=>{
          if(v==='' || v==null) return;
          const card = $('#char-'+v);
          if(card){ card.scrollIntoView({behavior:'smooth', block:'center'}); card.classList.add('flash'); setTimeout(()=>card.classList.remove('flash'), 1600); }
        }
      }));
      try{ jumpSel.tomselect.setValue('', true); }catch(e){}
    }catch(e){}
  }
  const identSel = $('#charIdent');
  if(identSel){
    try{
      const ts = new TomSelect(identSel, {
        plugins:['dropdown_input','clear_button'],
        placeholder:'身份筛选（可多选）',
        allowEmptyOption:false,
        onChange: v=>{ charFilters.idents = v||[]; applyCharFilters(); }
      });
      charTS.push(ts);
      if(charFilters.idents.length) ts.setValue(charFilters.idents, true);
    }catch(e){}
  }
}

function coverCardHtml(){
  const modeLab = state.coverWithTitle ? '含汉字书名' : '纯画面·无文字';
  const modeHint = state.coverWithTitle
    ? '封面将包含书名汉字的书法大字作为主体文字。'
    : '封面为纯画面，预留书名留白，仅作底图，文字后期排版。';
  const seg = state.coverWithTitle
    ? `<div class="cover-modes"><button type="button" class="cm-on">🏷️ 含汉字书名</button><button type="button" class="cm-off" data-cv="clean">🖼️ 纯画面</button></div>`
    : `<div class="cover-modes"><button type="button" class="cm-off" data-cv="title">🏷️ 含汉字书名</button><button type="button" class="cm-on">🖼️ 纯画面</button></div>`;
  return `
    <div class="card cover-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">📕 小说封面提示词</h3>
        <span class="btn-row" style="margin:0">
          ${hasAssetHist('cover')?`<button type="button" class="btn ghost" data-cover-hist>🕘 历史(${assetHistCount('cover')})</button>`:''}
          <span class="pill" id="coverModeLab">${modeLab}</span>
        </span>
      </div>
      ${seg}
      <p class="sub">${modeHint}</p>
      ${state.coverPrompt ? `
        <div class="subcard"><div class="lbl">封面提示词<button class="copy" data-copy="${esc(state.coverPrompt)}">复制</button></div><div class="prompt-text">${esc(state.coverPrompt)}</div></div>
        <label class="field" style="margin-top:8px"><span>✎ 编辑封面提示词（失焦即存，不触发 AI）</span>
          <textarea class="cover-edit" data-cover-edit>${esc(state.coverPrompt)}</textarea></label>
        <div class="btn-row" style="margin-top:8px"><button id="btnGenCover" class="btn ghost">🔄 重生成封面提示词</button></div>
      ` : `
        <div class="btn-row"><button id="btnGenCover" class="btn primary block">🖼️ 生成封面提示词</button></div>
        <p id="coverStatus" class="status"></p>
      `}
    </div>`;
}
function viewScenes(){
  if(!readyForAssets()) return `<div class="center-empty">请先在「故事」里生成大纲并生成章节。</div>`;
  if(isLong()) return coverCardHtml();
  const coverCard = coverCardHtml();
  if(!state.scenes.length){
    return coverCard + `<div class="card">
      <h3>🏞️ 场景提示词</h3>
      <p class="sub">提取关键场景并生成即梦出图提示词（含环境、光影与构图）。</p>
      <button id="btnGenScenes" class="btn primary block">✨ 生成场景提示词</button>
      <p id="sceneStatus" class="status"></p>
    </div>`;
  }
  return coverCard + `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center">
      <h3>🏞️ 场景提示词（${state.scenes.length}）</h3>
      <span class="btn-row" style="margin:0">
        ${hasAssetHist('scenes')?`<button id="btnSceneHist" class="btn ghost">🕘 历史(${assetHistCount('scenes')})</button>`:''}
        <button id="btnGenScenes" class="btn ghost">🔄 重生成</button>
      </span></div></div>` +
    state.scenes.map((s,si)=>`
    <div class="card">
      <h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="text" class="scene-edit-name" data-scene-name="${si}" value="${esc(s.name||'')}" placeholder="场景名" style="flex:0 0 auto;min-width:120px;max-width:220px" />
        <span class="pill tag-env">🌿 纯环境·无人物</span> ${wcBadge((s.description||'')+' '+(s.prompt||''))}</h3>
      <p class="sub">作用：<input type="text" class="scene-edit-role" data-scene-role="${si}" value="${esc(s.作用||'')}" style="flex:1;min-width:160px" /></p>
      <div class="subcard"><div class="lbl">场景设定</div><textarea class="scene-edit-desc" data-scene-desc="${si}" rows="2">${esc(s.description||'')}</textarea></div>
      <div class="subcard"><div class="lbl">即梦出图提示词<button class="copy" data-copy="${esc(s.prompt||'')}">复制</button></div><textarea class="scene-edit-prompt" data-scene-prompt="${si}" rows="3">${esc(s.prompt||'')}</textarea></div>
      <p class="muted" style="margin:4px 0 0;font-size:11px">字段可直接编辑，失焦即存（不触发 AI）。</p>
    </div>`).join('') + fallbackRaw('scenes');
}

function viewStoryboard(){
  if(!readyForAssets()) return `<div class="center-empty">请先在「故事」里生成大纲并生成章节。</div>`;
  if(!state.storyboard.length){
    return `<div class="card">
      <h3>🎞️ 分镜文字</h3>
      <p class="sub">按章节拆解导演级影视分镜与即梦出图提示词。</p>
      <button id="btnGenBoard" class="btn primary block">✨ 生成分镜文字（逐章）</button>
      <p id="boardStatus" class="status"></p>
    </div>`;
  }
  const groups = {};
  state.storyboard.forEach((s,i)=>{ const k = s.章节 || '未分组'; (groups[k]=groups[k]||[]).push(i); });
  const keys = Object.keys(groups).sort((a,b)=>{
    const na=+a, nb=+b;
    return (!isNaN(na)&&!isNaN(nb)) ? na-nb : String(a).localeCompare(String(b),'zh');
  });
  const rows = keys.map(k=>{
    const idxs = groups[k];
    const sec = idxs.reduce((sum,i)=> sum + (Number(state.storyboard[i].时长)||0), 0);
    const ci = (!isNaN(+k)&&state.boardConcepts&&state.boardConcepts[+k-1]) ? state.boardConcepts[+k-1] : null;
    return `<div class="board-ch">
      <div class="board-ch-head">
        <div class="board-ch-title">🎬 第${esc(k)}章</div>
        <div class="board-ch-stat" id="chStat-${esc(k)}">共 ${idxs.length} 镜 · 总时长 ${sec}s</div>
      </div>
      ${ci && (ci.视觉概念||ci.母题) ? `<div class="board-concept"><b>视觉概念：</b>${esc(ci.视觉概念||'')}${ci.母题?('<br><b>母题：</b>'+esc(ci.母题)):''}</div>`:''}
      ${idxs.map(i=>shotHtml(i)).join('')}
    </div>`;
  }).join('');
  const totalSec = state.storyboard.reduce((sum,s)=> sum + (Number(s.时长)||0), 0);
  return `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <h3>🎞️ 分镜（${state.storyboard.length} 镜）</h3>
      <span class="btn-row" style="margin:0">
        ${hasAssetHist('storyboard')?`<button id="btnBoardHist" class="btn ghost">🕘 历史(${assetHistCount('storyboard')})</button>`:''}
        <button id="btnGenBoard" class="btn ghost">🔄 重生成</button>
      </span>
    </div>${rows}
    <div class="card board-total">⏱ 全局：<b id="boardTotal">共 ${state.storyboard.length} 镜 · 总时长 ${totalSec}s</b><span class="muted">（每镜时长可点击数字直接修改，统计实时联动）</span></div>`
    + fallbackRaw('storyboard');
}
function shotHtml(i){
  const s = state.storyboard[i];
  const ed = (key, tag='input', rows=2)=> tag==='textarea'
    ? `<textarea class="shot-edit" data-shot="${i}" data-key="${esc(key)}" rows="${rows}">${esc(s[key]||'')}</textarea>`
    : `<input type="text" class="shot-edit" data-shot="${i}" data-key="${esc(key)}" value="${esc(s[key]||'')}" />`;
  return `<div class="shot">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="no">镜 ${esc(s.镜号)}</span>
      <span class="dur">⏱ <input type="number" class="dur-input" data-dur="${i}" value="${esc(s.时长??3)}" min="0.5" max="30" step="0.5"> 秒</span>
      ${wcBadge((s.画面描述||'')+' '+(s.出图提示词||''))}
    </div>
    <div class="meta">
      ${['景别','角度','运镜','光线','转场'].map(k=> s[k]?`<span class="pill">${esc(s[k])}</span>`:'').join('')}
    </div>
    ${s.主体!==undefined && s.主体!=='' ? `<div class="prompt-text" style="margin-top:6px"><b>主体：</b>${ed('主体')}</div>`:''}
    ${s.构图!==undefined && s.构图!=='' ? `<div class="prompt-text" style="margin-top:4px"><b>构图：</b>${ed('构图')}</div>`:''}
    <div class="prompt-text" style="margin-top:6px">${ed('画面描述','textarea',2)}</div>
    ${ s.对白 ? `<div class="sub" style="margin-top:6px">💬 ${ed('对白')}</div>`:'' }
    <div class="subcard" style="margin-top:8px"><div class="lbl">出图提示词<button class="copy" data-copy="${esc(s.出图提示词||'')}">复制</button></div>${ed('出图提示词','textarea',3)}</div>
    ${ s.连续性 ? `<div class="muted" style="margin-top:6px">🔗 连续性：${ed('连续性')}</div>`:'' }
    ${ s.剪辑动机 ? `<div class="muted" style="margin-top:4px">🎯 剪辑动机：${ed('剪辑动机')}</div>`:'' }
    <p class="muted" style="margin:4px 0 0;font-size:11px">字段可直接编辑，失焦即存（不触发 AI）。</p>
  </div>`;
}
function bindShotEdit(){
  $$('[data-shot]').forEach(inp=>{
    inp.onchange = ()=>{
      const s = state.storyboard[+inp.dataset.shot]; if(!s) return;
      s[inp.dataset.key] = inp.value;
      persist();
      toast('分镜已保存');
    };
  });
}
function updateBoardTiming(){
  const groups = {};
  state.storyboard.forEach((s,i)=>{ const k=s.章节||'未分组'; (groups[k]=groups[k]||[]).push(i); });
  Object.keys(groups).forEach(k=>{
    const sec = groups[k].reduce((sum,i)=> sum + (Number(state.storyboard[i].时长)||0), 0);
    const el = $('#chStat-'+k); if(el) el.textContent = `共 ${groups[k].length} 镜 · 总时长 ${sec}s`;
  });
  const totalSec = state.storyboard.reduce((sum,s)=> sum + (Number(s.时长)||0), 0);
  const el = $('#boardTotal'); if(el) el.textContent = `共 ${state.storyboard.length} 镜 · 总时长 ${totalSec}s`;
}

function fallbackRaw(key){
  const raw = state.raw[key];
  if(!raw) return '';
  return `<div class="card"><p class="muted">以下为模型原始返回（解析 JSON 失败时保留）：</p>
    <textarea style="min-height:120px">${esc(raw)}</textarea></div>`;
}

function readyForAssets(){
  return state.outlineConfirmed && state.chapters.some(c=>c.content && c.content.trim());
}


function viewExport(){
  if(isLong()) return longExportView();
  if(!state.outline) return `<div class="center-empty">尚无可导出的内容。请先生成并确认故事大纲。</div>`;
  const md = buildMarkdown();
  return `<div class="card">
    <h3>📦 导出资产包</h3>
    <p class="sub">汇总全书故事、角色、场景与分镜资产，支持一键复制或导出。</p>
    <div class="btn-row">
      <button id="btnCopyAll" class="btn primary">📋 复制全部</button>
    </div>
  </div>
  <div class="card"><textarea id="exportArea" style="min-height:300px">${esc(md)}</textarea></div>`;
}

function longExportView(){
  if(!state.outline) return `<div class="center-empty">尚无可导出的内容。请先生成故事大纲。</div>`;
  const written = state.chapters.filter(c=> c.content && String(c.content).trim()).length;
  state.expSel = state.expSel.filter(i=> state.chapters[i] && state.chapters[i].content && String(state.chapters[i].content).trim());
  const title = state.outline?.title || '未命名长篇小说';
  const md = buildLongMarkdown();
  const CH_PER_GROUP = 10, EXP_GROUP_THRESHOLD = 20;
  const useGroup = state.chapters.length > EXP_GROUP_THRESHOLD;
  if(useGroup && state.expOpenGroups.length === 0){
    const selSet = new Set(state.expSel);
    const ng = Math.ceil(state.chapters.length / CH_PER_GROUP);
    state.expOpenGroups = [];
    for(let g=0; g<ng; g++){
      let has=false;
      for(let i=g*CH_PER_GROUP; i<Math.min(state.chapters.length,(g+1)*CH_PER_GROUP); i++){ if(selSet.has(i)){ has=true; break; } }
      if(has) state.expOpenGroups.push(g);
    }
  }
  const expGroupHTML = ()=>{
    const label = (c,i,ok)=> `<label class="exp-ch ${ok?'':'disabled'}"><input type="checkbox" data-expch="${i}" ${state.expSel.includes(i)?'checked':''} ${ok?'':'disabled'}><span class="exp-ch-no">第${i+1}章</span><span class="exp-ch-title">${esc(c.title||'')}</span><span class="wc">${ok? wcInner(countWords(c.content)) : '未写'}</span></label>`;
    if(!useGroup) return state.chapters.map((c,i)=> label(c,i,!!(c.content&&String(c.content).trim()))).join('');
    const n = state.chapters.length, ng = Math.ceil(n/CH_PER_GROUP);
    let out='';
    for(let g=0; g<ng; g++){
      const s=g*CH_PER_GROUP, e=Math.min(n,(g+1)*CH_PER_GROUP), open=state.expOpenGroups.includes(g);
      let items='';
      for(let i=s;i<e;i++){ const c=state.chapters[i]; items += label(c,i,!!(c.content&&String(c.content).trim())); }
      const selCnt = state.expSel.filter(i=> i>=s && i<e).length;
      out += `<div class="exp-group ${open?'open':''}" data-expgroup="${g}"><div class="exp-group-t" role="button" data-expgroup-t="${g}"><span class="exp-group-ttl">第${s+1}—${e}章</span>${selCnt?`<span class="muted exp-group-sum">已选${selCnt}</span>`:''}<span class="sc-fold-ico">${open?'▾':'▸'}</span></div><div class="exp-group-body">${items}</div></div>`;
    }
    return out;
  };
  return `
    <div class="card">
      <h3>📦 导出资产包 · ${esc(title)}</h3>
      <p class="sub">汇总故事大纲与章节目录，支持一键复制或导出。</p>
      <div class="btn-row">
      <button id="lnCopyAll" class="btn primary">📋 复制全部</button>
<button id="lnExportReader" class="btn ghost">📖 阅读</button>
    </div>
    </div>
    <div class="card"><textarea id="lnExportArea" style="min-height:300px" readonly>${esc(md)}</textarea></div>
    <div class="card">
      <h3>📦 导出成书（选章节 + 三种格式）</h3>
      <p class="sub">选择需要导出的章节与文件格式（TXT / EPUB / DOCX）。</p>
      <div class="btn-row">
        <button id="expSelAll" class="btn ghost">☑️ 全选已写</button>
        <button id="expSelNone" class="btn ghost">⬜ 清空</button>
        <span class="muted" id="expCount">已选 ${state.expSel.length} / 已写 ${written} 章（共 ${state.chapters.length} 章）</span>
      </div>
      <div class="exp-ch-list" data-exp-ch-list>
        ${expGroupHTML()}
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button id="expTxt" class="btn">📄 导出 TXT</button>
        <button id="expEpub" class="btn">📚 导出 EPUB</button>
        <button id="expDocx" class="btn">📝 导出 DOCX</button>
      </div>
      <p id="exportStatus" class="status"></p>
    </div>`;
}

function openExportReader(){
  const ta = $('#lnExportArea');
  if(!ta || !ta.value.trim()){ toast('暂无导出内容'); return; }
  const ov = $('#readerOverlay'); if(!ov) return;
  $('#readerTitle').textContent = `📖 全文阅读 · ${esc(state.outline?.title||'未命名')}`;
  const lines = ta.value.split('\n').map(l=>l.trim());
  let html = '';
  for(const l of lines){
    if(!l) continue;
    if(/^#{1,3}\s/.test(l)) html += `<h3>${esc(l.replace(/^#+\s*/,''))}</h3>`;
    else if(/^第\d+[章节]/.test(l) || /^第[一二三四五六七八九十百千]+[章节]/.test(l)) html += `<h3>${esc(l)}</h3>`;
    else html += `<p>${esc(l)}</p>`;
  }
  $('#readerBody').innerHTML = html || '<p class="muted">（暂无内容）</p>';
  const tocBtn = $('#readerTocBtn'); if(tocBtn) tocBtn.style.display = 'none';
  const synBtn = $('#readerSynBtn'); if(synBtn) synBtn.style.display = 'none';
  const body0 = $('#readerBody');
  if(body0) body0.scrollTop = 0;
  updateReaderProgress();
  randomizeReaderGradient();
  ov.dataset.exportReader = '1';   // 标记为导出阅读模式
  ov.classList.remove('hidden');
  document.body.classList.add('reader-lock');
}

function buildLongMarkdown(){
  const o = state.outline;
  let md = `# ${o?.title||'未命名长篇小说'}\n\n`;
  md += `## 一、故事大纲\n**小说简介**：${o?.logline||''}\n\n`;
  (o?.chapters||[]).forEach((c,i)=>{
    md += `${i+1}. **${cleanChapterTitle(c.title)||''}**\n`;
  });
  return md;
}
function activeChapters(){
  let idx = state.expSel.filter(i=> state.chapters[i] && state.chapters[i].content && String(state.chapters[i].content).trim()).sort((a,b)=>a-b);
  if(!idx.length) idx = state.chapters.map((c,i)=> (c.content && String(c.content).trim())?i:null).filter(x=>x!==null);
  return idx;
}
function syncExpChecks(){
  $$('#view [data-expch]').forEach(cb=> cb.checked = state.expSel.includes(+cb.dataset.expch));
  const cnt = $('#expCount'); if(cnt) cnt.textContent = `已选 ${state.expSel.length} / 已写 ${state.chapters.filter(c=>c.content&&String(c.content).trim()).length} 章（共 ${state.chapters.length} 章）`;
}
function downloadBlob(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
}
function expText(){
  const idx = activeChapters(); if(!idx.length){ toast('没有可导出的已写章节'); return; }
  const title = state.outline?.title || '未命名长篇小说';
  let t = `${title}\n${'='.repeat(24)}\n`;
  if(state.outline?.logline) t += `\n${state.outline.logline}\n\n`;
  idx.forEach(i=>{ const c=state.chapters[i]; t += `\n第${i+1}章 ${cleanChapterTitle(c.title)||''}\n\n${String(c.content||'').trim()}\n`; });
  download(`${title}_长篇.txt`, t);
  toast(`已导出 ${idx.length} 章 TXT`);
}
function expEpub(){
  const idx = activeChapters(); if(!idx.length){ toast('没有可导出的已写章节'); return; }
  if(typeof JSZip === 'undefined'){ toast('找不到 JSZip 库'); return; }
  const title = state.outline?.title || '未命名长篇小说';
  const author = '使用者';
  const uid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('uuid-'+Date.now()+'-'+Math.random().toString(16).slice(2));
  const modDate = new Date().toISOString();
  const base = 'OEBPS';
  const chapterFiles = idx.map(i=>{
    const c = state.chapters[i];
    const paras = String(c.content||'').split(/\n+/).map(p=>p.trim()).filter(Boolean)
      .map(p=> `<p>${esc(p)}</p>`).join('\n');
    const h1 = `第${i+1}章 ${esc(cleanChapterTitle(c.title)||'')}`;
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>\n`+
      `<!DOCTYPE html>\n`+
      `<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n  <title>${freeText(h1)}</title>\n  <link rel="stylesheet" type="text/css" href="styles.css"/>\n</head>\n<body>\n  <h1>${h1}</h1>\n${paras}\n</body>\n</html>`;
    return { id:'ch'+(i+1), file:`text/ch${i+1}.xhtml`, title:h1, xhtml };
  });
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {compression:'STORE'});
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n  <rootfiles>\n    <rootfile full-path="${base}/content.opf" media-type="application/oebps-package+xml"/>\n  </rootfiles>\n</container>`);
  const manifest = chapterFiles.map(f=>`    <item id="${f.id}" href="${f.file}" media-type="application/xhtml+xml"/>`).join('\n');
  const spine = chapterFiles.map(f=>`    <itemref idref="${f.id}"/>`).join('\n');
  zip.file(`${base}/content.opf`, `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="uid">urn:uuid:${uid}</dc:identifier>\n    <dc:title>${freeText(title)}</dc:title>\n    <dc:language>zh-CN</dc:language>\n    <dc:creator>${freeText(author)}</dc:creator>\n    <meta property="dcterms:modified">${modDate}</meta>\n  </metadata>\n  <manifest>\n    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n    <item id="css" href="styles.css" media-type="text/css"/>\n${manifest}\n  </manifest>\n  <spine>\n${spine}\n  </spine>\n</package>`);
  const navLis = chapterFiles.map(f=>`    <li><a href="${f.file}">${freeText(f.title)}</a></li>`).join('\n');
  zip.file(`${base}/nav.xhtml`, `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n<head>\n  <meta charset="utf-8"/>\n  <title>${freeText(title)}</title>\n</head>\n<body>\n  <nav epub:type="toc" id="toc">\n    <h1>目录</h1>\n    <ol>\n${navLis}\n    </ol>\n  </nav>\n</body>\n</html>`);
  const ncxPts = chapterFiles.map((f,i)=>`    <navPoint id="${f.id}" playOrder="${i+1}"><navLabel><text>${freeText(f.title)}</text></navLabel><content src="${f.file}"/></navPoint>`).join('\n');
  zip.file(`${base}/toc.ncx`, `<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n  <head><meta name="dtb:uid" content="urn:uuid:${uid}"/></head>\n  <docTitle><text>${freeText(title)}</text></docTitle>\n  <navMap>\n${ncxPts}\n  </navMap>\n</ncx>`);
  zip.file(`${base}/styles.css`, `body{font-family:serif,"PingFang SC","Source Han Serif SC",serif;line-height:1.9;margin:2em;color:#222}\nh1{font-size:1.4em;text-align:center;margin-bottom:1.6em;color:#333}\np{text-indent:2em;margin:0.5em 0}`);
  chapterFiles.forEach(f=> zip.file(`${base}/${f.file}`, f.xhtml));
  const st = $('#exportStatus'); if(st) st.textContent = '正在打包 EPUB…';
  zip.generateAsync({type:'blob', mimeType:'application/epub+zip'}).then(blob=>{
    downloadBlob(`${title}_长篇.epub`, blob);
    if(st) st.textContent = '';
    toast(`已导出 EPUB（${idx.length} 章）`);
  }).catch(()=>{ if(st) st.textContent='打包失败'; toast('EPUB 打包失败'); });
}
function expDocx(){
  const idx = activeChapters(); if(!idx.length){ toast('没有可导出的已写章节'); return; }
  if(typeof JSZip === 'undefined'){ toast('找不到 JSZip 库'); return; }
  const title = state.outline?.title || '未命名长篇小说';
  const xmlEsc = t=> String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const paras = [];
  paras.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r></w:p>`);
  if(state.outline?.logline) paras.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEsc(state.outline.logline)}</w:t></w:r></w:p>`);
  idx.forEach(i=>{
    const c = state.chapters[i];
    paras.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">第${i+1}章 ${xmlEsc(cleanChapterTitle(c.title)||'')}</w:t></w:r></w:p>`);
    String(c.content||'').split(/\n+/).map(p=>p.trim()).filter(Boolean)
      .forEach(p=> paras.push(`<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`));
  });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n</Relationships>`);
  const body = paras.join('\n');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  const st = $('#exportStatus'); if(st) st.textContent = '正在打包 DOCX…';
  zip.generateAsync({type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}).then(blob=>{
    downloadBlob(`${title}_长篇.docx`, blob);
    if(st) st.textContent = '';
    toast(`已导出 DOCX（${idx.length} 章）`);
  }).catch(()=>{ if(st) st.textContent='打包失败'; toast('DOCX 打包失败'); });
}
function freeText(t){ return String(t??'').replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function buildMarkdown(){
  const o = state.outline;
  let md = `# 影视前期资产包 · ${o?.title||'未命名'}\n\n> 由「影视前期提示词生成器」生成 · 出图请在即梦用提示词生成\n\n`;
  md += `## 一、故事大纲\n**小说简介**：${o?.logline||''}\n\n`;
  (o?.chapters||[]).forEach((c,i)=>{
    md += `${i+1}. **${cleanChapterTitle(c.title)||''}**\n`;
  });
  if(state.characters.length){
    md += `\n## 三、角色定妆提示词包\n`;
    state.characters.forEach(c=>{
      md += `\n### ${c.name}（${c.role||''}）\n`;
      const pf=c.profile||{}; Object.entries(pf).forEach(([k,v])=> md+=`- **${k}**：${v}\n`);
      const pr=c.prompts||{}; const order=['定妆图','三视图','表情','服饰细节','道具','配色','材质'];
      order.forEach(k=>{ if(pr[k]!=null) md+=`\n**${k}提示词**：\n${pr[k]}\n`; });
    });
  }
  if(state.scenes.length){
    md += `\n## 四、场景提示词（纯环境 · 无人物，供视频 AI 空镜/环境参考）\n`;
    state.scenes.forEach(s=> md += `\n### ${s.name}（${s.作用||''}）\n- 设定：${s.description||''}\n- 即梦提示词（无人物）：${s.prompt||''}\n`);
  }
  if(state.storyboard.length){
    md += `\n## 五、分镜表（按章节，含时长）\n`;
    const groups = {};
    state.storyboard.forEach(s=>{ const k=s.章节||'未分组'; (groups[k]=groups[k]||[]).push(s); });
    const keys = Object.keys(groups).sort((a,b)=>{ const na=+a,nb=+b; return (!isNaN(na)&&!isNaN(nb))?na-nb:String(a).localeCompare(String(b),'zh'); });
    keys.forEach(k=>{
      const list = groups[k];
      const sec = list.reduce((a,s)=> a+(Number(s.时长)||0),0);
      md += `\n### 第${k}章（${list.length} 镜 · 总时长 ${sec}s）\n`;
      list.forEach(s=>{
        md += `\n**镜${s.镜号}**（${s.时长??3}s）｜ ${s.景别||''} ｜ ${s.角度||''} ｜ ${s.运镜||''} ｜ ${s.光线||''}\n`;
        if(s.主体) md += `- 主体：${s.主体}\n`;
        if(s.构图) md += `- 构图：${s.构图}\n`;
        md += `- 画面：${s.画面描述||''}\n`;
        if(s.对白) md += `- 对白：${s.对白}\n`;
        if(s.转场) md += `- 转场：${s.转场}\n`;
        md += `- 出图提示词：${s.出图提示词||''}\n`;
        if(s.连续性) md += `- 连续性：${s.连续性}\n`;
        if(s.剪辑动机) md += `- 剪辑动机：${s.剪辑动机}\n`;
      });
    });
  }
  return md;
}

function bindView(){
  bindCopyBtns();
  bindCharEdit();
  bindShotEdit();

  $$('.cyber-home-grid [data-step]').forEach(b=> b.onclick = ()=>{ if(!guardSwitchStep()) return; currentStep = +b.dataset.step; render(); window.scrollTo(0,0); });

  const idea = $('#ideaInput'); if(idea){
    idea.oninput = ()=>{ state.idea = idea.value; syncOrigIdeaCard(); };
    const _go0 = $('#btnGenOutline'); if(_go0) _go0.onclick = ()=> genOutline();
    const tsTg = $('#teamPick'); if(tsTg){
      tsTg.querySelectorAll('[data-team]').forEach(lb=>{
        lb.onclick = (e)=>{ e.preventDefault(); if(state.teamShape === lb.dataset.team) return; state.teamShape = lb.dataset.team; persist(); render(); toast(`叙事主体已切换为「${currentTeamShape().label}」`); };
      });
    }
  }
  bindPolishIdea();
  const _goB = $('#btnGenOutline'); if(_goB) _goB.onclick = ()=> genOutline();
  const _p2 = $('#polishCards2'); if(_p2) renderPolishCards(_p2);
  $$('[data-gen-outline]').forEach(b=> b.onclick = ()=> genOutline());
  bindDictMaster();
  bindDictEnrich();
  bindLongNovelMemoryRepo();
  bindLongNovelControlDeck();
  $$('[data-rec-fold]').forEach(h=> h.onclick = ()=>{
    const key = h.dataset.recFold;
    state.recipeSet = state.recipeSet || {};
    if(!state.recipeSet.recFold) state.recipeSet.recFold = {};
    state.recipeSet.recFold[key] = !state.recipeSet.recFold[key];
    const body = h.parentNode && h.parentNode.querySelector('.recipe-fold-b');
    if(body) body.hidden = !state.recipeSet.recFold[key];
    const ico = h.querySelector('.rec-fold-ico'); if(ico) ico.textContent = state.recipeSet.recFold[key]?'▾':'▸';
    h.setAttribute('aria-expanded', String(state.recipeSet.recFold[key]));
    persist();
  });
  function bindChapterCountInput(el){
    if(!el) return;
    el.addEventListener('keydown', e=>{ if(e.key==='Enter') el.blur(); });
    el.addEventListener('change', ()=>{
      const v = Math.floor(Number(el.value));
      if(Number.isInteger(v) && v>=1 && v<=200){
        const _o = state.outline;
        const _hasTitle = _o && Array.isArray(_o.chapters) && _o.chapters.some(c=>c && String(c.title||'').trim());
        if(_hasTitle && _o.chapters.length !== v){
          const oldLen = _o.chapters.length;
          const msg = oldLen > v
            ? `全书章节数将由 ${oldLen} 章减少为 ${v} 章：前 ${v} 章已有标题与正文将完整保留，末尾 ${oldLen - v} 章将被裁减。确定继续？`
            : `全书章节数将由 ${oldLen} 章增加为 ${v} 章：原有 ${oldLen} 章标题与正文将完整保留，后续 ${v - oldLen} 章将新增为空白待命。确定继续？`;
          if(!confirm(msg)){
            el.value = state.chapterCount || oldLen;
            return;
          }
          if(v < oldLen){
            _o.chapters = _o.chapters.slice(0, v);
            if(Array.isArray(state.chapters)) state.chapters = state.chapters.slice(0, v);
            if(Array.isArray(_o.chapterPlans)) _o.chapterPlans = _o.chapterPlans.slice(0, v);
          } else {
            while(_o.chapters.length < v){
              _o.chapters.push({ title: '', summary: '' });
            }
            if(!Array.isArray(state.chapters)) state.chapters = [];
            while(state.chapters.length < v){
              state.chapters.push({ title: '', content: '' });
            }
          }
          state.chapterCount = v;
          toast(`全书章节数已平滑调整为 ${v} 章，既有内容已保留`);
        }
        else if(_o && Array.isArray(_o.chapters) && _o.chapters.length>0 && _o.chapters.length !== v){
          const _hasPlans = Array.isArray(_o.chapterPlans) && _o.chapterPlans.some(Boolean);
          if(_hasPlans && !confirm(`规划师已生成过本章锚点/节拍表。章节数改为 ${v} 将按新数量重建章节占位（旧正文将清空重建）。继续？`)){ render(); return; }
          if(_hasPlans){ _o.chapterPlans = new Array(v).fill(null); }
          _o.chapters = Array.from({length:v}, ()=>({title:'', summary:''}));
          state.chapterCount = v;
        } else {
          state.chapterCount = v;
        }
      }
      else { state.chapterCount = null; toast('章节数需为 1-200 的整数'); }
      persist(); render();
    });
  }
  bindChapterCountInput($('#chapterCountIn'));
   bindChapterCountInput($('#totalWordsIn'));
   $$('input[name="bookBeat"]').forEach(r=>{
     r.onchange = ()=>{ state.bookBeat = +r.value; persist(); render(); };
   });
   $$('input[name="openingStrategy"]').forEach(r=>{
     r.onchange = ()=>{ state.openingStrategy = openingStrategyDef(r.value) ? r.value : 'auto'; persist(); render(); };
   });
   bindGlossary();
  bindOrigIdea();
  bindOutlineFold();
  bindLoglineEdit();
  bindAiRecipe();
  bindChapterPlan();
  bindChapterPlanFold();
  bindChapterTitles();// v10.14 章节标题编辑 + 复制绑定
  bindWriteStyle();
  const btnCO = $('#btnConfirmOutline'); if(btnCO) btnCO.onclick = ()=>{ syncChaptersFromOutline(); state.outlineConfirmed=true; persist(); render(); };
  const btnRO = $('#btnReOutline'); if(btnRO) btnRO.onclick = ()=>{ state.outline=null; state.outlineConfirmed=false; state.chapters=[]; persist(); render(); };
  const btnGAShort = $('#btnGenAllChapters'); if(btnGAShort) btnGAShort.onclick = ()=> genManyChapters(state.chapters.length, true);
  bindGenBatchControls();
  bindRangeGen();

  if(isLong()){
    bindBeatSheet();
    bindFactCard();
    bindRollingSummaryCard();
    bindQualityReportCard();
    bindFixQueueCard();
  }

  const tmCur = $('#tmCur'); if(tmCur) tmCur.onclick = ()=>{
    const newName = prompt('修改书名：', currentTitle());
    if(newName == null) return; // 取消
    renameTitle(newName);
  };
  const histPanel_ = $('#tmHist');
  const triBtn = $('#btnTmTri');
  if(triBtn) triBtn.onclick = (e)=>{
    e.stopPropagation();
    const on = triBtn.classList.toggle('on');
    if(histPanel_) histPanel_.classList.toggle('hidden', !on);
  };
  if(histPanel_) histPanel_.onclick = (e)=> e.stopPropagation();
  $$('#tmHist [data-hist-restore]').forEach(b=> b.onclick = (e)=>{
    e.stopPropagation();
    if(!confirm(`将书名恢复为「${b.dataset.histRestore}」？（当前名会记入曾用名）`)) return;
    renameTitle(b.dataset.histRestore);
    histPanel_.classList.add('hidden');
    const tri = $('#btnTmTri'); if(tri) tri.classList.remove('on');
  });
  $$('#tmHist [data-hist-del]').forEach(b=> b.onclick = (e)=>{
    e.stopPropagation();
    if(!confirm('删除该条曾用名记录？')) return;
    state.titleHistory.splice(+b.dataset.histDel, 1);
    persist(); render();
    toast('已删除该记录');
  });
  document.addEventListener('click', (e)=>{
    const pan = $('#tmHist');
    if(pan && !pan.classList.contains('hidden') && !e.target.closest('.title-manager')){
      pan.classList.add('hidden');
      const b = $('#btnTmTri'); if(b) b.classList.remove('on');
    }
  });
  const longJump = $('#longJump'); if(longJump) longJump.onchange = ()=>{ const i=+longJump.value; if(longJump.value!=='') openReader(i); longJump.value=''; }; 
  if(isLong()) renderLongProgress();

  if(currentStep===2){
    const s = $('#charSearch'); if(s){
      s.oninput = ()=>{ charFilters.q = s.value; applyCharFilters(); };
    }
    const g = $('#charGender'); if(g){
      g.onchange = ()=>{ charFilters.gender = g.value; applyCharFilters(); };
    }
    const aMin = $('#ageMin'), aMax = $('#ageMax');
    if(aMin) aMin.oninput = ()=>{ charFilters.ageMin = aMin.value; applyCharFilters(); };
    if(aMax) aMax.oninput = ()=>{ charFilters.ageMax = aMax.value; applyCharFilters(); };
    initCharFilter();
  }
  const btnGC = $('#btnGenChars'); if(btnGC) btnGC.onclick = genCharacters;
  const btnCH = $('#btnCharHist'); if(btnCH) btnCH.onclick = ()=> openAssetHistPanel('characters');
  const btnGS = $('#btnGenScenes'); if(btnGS) btnGS.onclick = genScenes;
  const btnCV = $('#btnGenCover'); if(btnCV) btnCV.onclick = genCover;
  const btnCVH = $('[data-cover-hist]'); if(btnCVH) btnCVH.onclick = ()=> openAssetHistPanel('cover');
  $$('[data-cover-edit]').forEach(ta=>{
    ta.onchange = ()=>{ state.coverPrompt = ta.value; persist(); toast('封面提示词已保存'); };
  });
  $$('[data-cv]').forEach(b=> b.onclick = ()=>{
    const v = b.dataset.cv === 'title';
    if(state.coverWithTitle === v) return;
    state.coverWithTitle = v;
    state.coverPrompt = ''; // 切换模式后旧提示词不再适用，清空待重生成
    persist(); render();
  });
  const btnGB = $('#btnGenBoard'); if(btnGB) btnGB.onclick = genStoryboard;
  const btnBH = $('#btnBoardHist'); if(btnBH) btnBH.onclick = ()=> openAssetHistPanel('storyboard');
  const btnSH = $('#btnSceneHist'); if(btnSH) btnSH.onclick = ()=> openAssetHistPanel('scenes');
  $$('[data-scene-name]').forEach(inp=> inp.onchange = ()=>{ const s=state.scenes[+inp.dataset.sceneName]; if(s){ s.name=inp.value; persist(); } });
  $$('[data-scene-role]').forEach(inp=> inp.onchange = ()=>{ const s=state.scenes[+inp.dataset.sceneRole]; if(s){ s.作用=inp.value; persist(); } });
  $$('[data-scene-desc]').forEach(ta=> ta.onchange = ()=>{ const s=state.scenes[+ta.dataset.sceneDesc]; if(s){ s.description=ta.value; persist(); } });
  $$('[data-scene-prompt]').forEach(ta=> ta.onchange = ()=>{ const s=state.scenes[+ta.dataset.scenePrompt]; if(s){ s.prompt=ta.value; persist(); toast('场景提示词已保存'); } });
  const btnCA = $('#btnCopyAll'); if(btnCA) btnCA.onclick = ()=> copyText(buildMarkdown());
 
  if(isLong()){
    const lnCA = $('#lnCopyAll'); if(lnCA) lnCA.onclick = ()=> copyText(buildLongMarkdown());
const lnER = $('#lnExportReader'); if(lnER) lnER.onclick = openExportReader;
    $$('#view [data-expch]').forEach(cb=> cb.onchange = ()=>{
      const i = +cb.dataset.expch;
      if(cb.checked){ if(!state.expSel.includes(i)) state.expSel.push(i); } else state.expSel = state.expSel.filter(x=>x!==i);
      persist();
      syncExpChecks();
    });
    const selAll = $('#expSelAll'); if(selAll) selAll.onclick = ()=>{ state.expSel = state.chapters.map((c,i)=> (c.content && String(c.content).trim())?i:null).filter(x=>x!==null); persist(); syncExpChecks(); };
    const selNone = $('#expSelNone'); if(selNone) selNone.onclick = ()=>{ state.expSel=[]; persist(); syncExpChecks(); };
    $$('#view [data-expgroup-t]').forEach(t=> t.onclick = ()=>{
      const g = +t.dataset.expgroupT;
      const grp = t.closest('[data-expgroup]');
      const adding = !grp.classList.contains('open');
      grp.classList.toggle('open', adding);
      const ico = t.querySelector('.sc-fold-ico'); if(ico) ico.textContent = adding ? '▾' : '▸';
      if(adding){ if(!state.expOpenGroups.includes(g)) state.expOpenGroups.push(g); }
      else state.expOpenGroups = state.expOpenGroups.filter(x=>x!==g);
      persist();
    });
    const bt = $('#expTxt'); if(bt) bt.onclick = expText;
    const be = $('#expEpub'); if(be) be.onclick = expEpub;
    const bd = $('#expDocx'); if(bd) bd.onclick = expDocx;
  }

  renderChapters();
  const chaptersDelegate = (e)=>{
    const t = e.target.closest('[data-regen],[data-toggle],[data-read],[data-fold],[data-page],[data-ver],[data-undo],[data-ch-sum],[data-ne-resume-ch],[data-ne-partial-adopt],[data-plan-ch]');
    if(!t) return;
    if(t.hasAttribute('data-plan-ch')){ openSchoolPlanReader(+t.dataset.planGi, +t.dataset.planCh + 1); }
    else if(t.hasAttribute('data-ver')){ openChapterVersionPanel(+t.dataset.ver); }
    else if(t.hasAttribute('data-undo')){ undoChapterEdit(+t.dataset.undo); }
    else if(t.hasAttribute('data-regen')){ openChapterRegenPanel(+t.dataset.regen); }
    else if(t.hasAttribute('data-ch-sum')){ openChapterSummaryPanel(+t.dataset.chSum); }
    else if(t.hasAttribute('data-toggle')){ const i=+t.dataset.toggle; state.chapters[i].confirmed=!state.chapters[i].confirmed; persist(); render(); }
    else if(t.hasAttribute('data-read')){ openReader(+t.dataset.read); }
    else if(t.hasAttribute('data-ne-resume-ch')){ const i=+t.dataset.neResumeCh; continueAndFinalizeChapter(i, '继续生成'); }
    else if(t.hasAttribute('data-ne-partial-adopt')){ adoptChapterPartial(+t.dataset.nePartialAdopt); }
    else if(t.hasAttribute('data-fold')){ const i=+t.dataset.fold; const body=t.closest('.ch-card').querySelector('.ch-body'); const ico=t.querySelector('.ch-fold-ico'); const on = body.classList.toggle('folded'); t.setAttribute('aria-expanded', String(!on)); if(ico) ico.textContent = on?'▸':'▾'; }
    else if(t.hasAttribute('data-page')){ chPage = +t.dataset.page; renderChapters(); }
  };
  const cw = $('#chaptersWrap');
  if(cw && !cw.dataset.delegated){
    cw.dataset.delegated = '1';           // 只绑定一次，跨次 render 复用
    cw.addEventListener('click', chaptersDelegate);
    cw.addEventListener('input', (e)=>{
      const ta = e.target.closest('textarea[data-ch]'); if(!ta) return;
      const i = +ta.dataset.ch; state.chapters[i].content = ta.value;
      persist(); updateChapterWc(i, ta.value); updateWcTotal();
    });
    cw.addEventListener('focusin', (e)=>{
      const ta = e.target.closest('textarea[data-ch]'); if(!ta) return;
      const c = state.chapters[+ta.dataset.ch];
      ta._orig = c ? (c.content||'') : '';
    });
    cw.addEventListener('change', (e)=>{
      const ta = e.target.closest('textarea[data-ch]'); if(!ta) return;
      const i = +ta.dataset.ch; const c = state.chapters[i]; if(!c) return;
      const old = (ta._orig !== undefined) ? ta._orig : (c.content||'');
      if(ta.value !== old && String(ta.value||'') !== String(old||'')){
        if(!Array.isArray(c.editHistory)) c.editHistory = [];
        c.editHistory.push(old);
        if(c.editHistory.length > 10) c.editHistory.splice(0, c.editHistory.length - 10);   // 上限10
        persist(); renderChapters(); updateWcTotal();
        toast('已记录编辑快照，可用「↩ 撤销编辑」回退');
      }
    });
  }
  $$('[data-dur]').forEach(inp=> inp.oninput = ()=>{
    const i = +inp.dataset.dur;
    const v = parseFloat(inp.value);
    state.storyboard[i].时长 = isNaN(v)||v<=0 ? 0.5 : Math.min(30, v);
    persist(); updateBoardTiming();
  });
  bindReader();
}

function applyOutlineObject(o, opts){
  opts = opts || {};
  const oldChapters = (state.outline && state.outline.chapters) || [];
  const newN = state.chapterCount || oldChapters.length;
  if(newN && oldChapters.length === newN){
    o.chapters = oldChapters;
  } else {
    o.chapters = [];
  }
  const prevGloss = (state.outline && state.outline.glossary && sourceHasGlossary(state.outline.glossary)) ? state.outline.glossary : null;
  state.outline = o;
  normalizeOutline(state.outline);
  state.outlineConfirmed = false;
  if(prevGloss) o.glossary = prevGloss;
  else if(!o.glossary) o.glossary = {characters:[], places:[], propernouns:[]};
  if(state.pendingV45){
    applyV45ToOutline(o, state.pendingV45);
    state.pendingV45 = null;
  }
  if(!o.navBeacon){
    if(String(state.idea||'').trim()){
      const _idea = String(state.idea||'').trim();
      const _grab = (re)=>{ const _m = _idea.match(re); return (_m && _m[1]) ? _m[1].trim() : ''; };
      const _genre = _grab(/(?:题材|类型)[：:]\s*([^\n，。；;,]{1,20})/);
      const _prot  = _grab(/(?:主角|主人公|男主|女主)[：:]\s*([^\n，。；;,]{1,20})/);
      const _conf  = _grab(/(?:核心冲突|冲突|看点)[：:]\s*([^\n。；;]{2,40})/) || _idea.slice(0, 40);
      o.navBeacon = { genre:_genre, protagonist:_prot, coreConflict:_conf, tone:'' };
    }
  }
  if(!o.userIdea) o.userIdea = state.idea;
  if(!Array.isArray(o.chapterPlans)) o.chapterPlans = [];
  if(o.chapters.length){
    const _prev = (Array.isArray(state.chapters) && state.chapters.length === o.chapters.length) ? state.chapters : null;
    state.chapters = o.chapters.map((c,ci)=>{
      const p = _prev && _prev[ci];
      return {
        title: c.title,
        content: p ? String(p.content||'') : '',
        strip: p ? String(p.strip||'') : '',
        confirmed: p ? !!p.confirmed : false,
        _titleByAI: p ? !!p._titleByAI : false
      };
    });
  }
}

function syncChaptersFromOutline(){
  const o = state.outline;
  if(!o || !Array.isArray(o.chapters) || !o.chapters.length) return false;
  const cur = Array.isArray(state.chapters) ? state.chapters : [];
  if(cur.length === o.chapters.length) return false;   // 已对齐，无需同步
  if(cur.some(c=> c && c.content && String(c.content).trim())) return false;   // 有正文的错位项目不动
  state.chapters = o.chapters.map(c=>({
    title: String((c && c.title) || ''),
    content:'', strip:'', confirmed:false, _titleByAI:false
  }));
  return true;
}

function chapterContentStat(){
  const n = (state.chapters||[]).filter(c=> c && c.content && String(c.content).trim()).length;
  const curN = (state.outline && Array.isArray(state.outline.chapters) && state.outline.chapters.length) ? state.outline.chapters.length : (state.chapters||[]).length;
  return { hasContent: n>0, contentN: n, curN };
}
function confirmOutlineContentGuard(){
  const s = chapterContentStat();
  if(!s.hasContent) return true;
  const newN = chapterCountVal();
  if(s.curN && newN && s.curN !== newN){
    return window.confirm(`当前已写正文 ${s.contentN} 章（共 ${s.curN} 章），本次预设章数为 ${newN} 章。章数不同，新大纲生效后正文将无法按章节对应保留。继续生成？`);
  }
  return true;
}


const genOutline = async function(){
  const btn = $('#btnGenOutline') || $('[data-gen-outline]');
  const st = $('#outlineStatus');
  if(st){ st.className='status'; st.textContent=''; }
  if(!canRunAI('outline')){ toast('请先完成上游步骤：优化构想'); if(btn) busy(btn,false); return; }
  const noOpt = !(Array.isArray(state.polishOptions) && state.polishOptions.length);
  if(noOpt){ toast('请先点「✨ 优化构想」生成方案，再点「生成大纲」搬入书名 / 简介 / 节拍'); if(btn) busy(btn,false); return; }
  const cand = selectedPolishCandidate();
  if(!cand){ toast('先选择一个优化方案（在②优化构想中点击某张候选卡「✔ 采用此方案」）'); if(btn) busy(btn,false); return; }
  if(dictmasterLocked()){ toast('词典达人已产出万物词典，②方案已锁定，不可再换选重搬'); if(btn) busy(btn,false); return; }
  if(!confirmOutlineContentGuard()){ if(btn) busy(btn,false); return; }
  markAIRunning('outline');
  if(btn) busy(btn,true,'搬运大纲中…');
  try{
    const o = buildOutlineFromPolishCandidate(cand);
    applyOutlineObject(o, { silent: true });
    state.outlineConfirmed = true;
    state.polishCollapsed = true;
    markAIDone('outline');   // 成功后标记完成
    persist(); render();
    toast('已生成大纲：书名 / 小说简介 / 全书节拍已搬入，直接进入正文写作（书名仅用户可改）');
  }catch(e){
    if(e.name==='AbortError'){ if(st){ st.className='status'; st.textContent='已停止生成'; } }
    else {
      if(st){ st.className='status err'; st.textContent = e.message; }
      addToFixQueue({kind:'outline', error:e.message});
      toast('大纲生成失败：'+e.message);
    }
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='outline');
    hideStopBtn(); if(btn) busy(btn,false);
  }
};

function selectedPolishCandidate(){
  const opts = Array.isArray(state.polishOptions) ? state.polishOptions : [];
  if(!opts.length) return null;
  const ad = state.polishAdopted;
  if(ad){ const hit = opts.find(o=> o && o.name === ad); if(hit) return hit; }
  return opts[0];   // 无显式选中时回退第一候选（视为已选）
}
function dictmasterLocked(){
  if(!state.dictmasterRan) return false;
  const g = (state.outline && state.outline.glossary) || null;
  if(!g) return false;
  return (g.characters && g.characters.length) || (g.places && g.places.length) || (g.propernouns && g.propernouns.length) ? true : false;
}
function extractCandidateBookName(txt){
  const s = String(txt||'');
  const kv = s.match(/(?:^|\n)\s*(?:书名|小说名|标题|名称)\s*[:：]\s*([^\n]{1,30})/);
  if(kv && kv[1]) return kv[1].trim().replace(/[】\]\)]/g,'');
  const bk = s.match(/[《<]([^《》<>]{1,30})[》>]/);
  if(bk && bk[1]) return bk[1].trim().replace(/[】\]\)]/g,'');
  return '';
}
function stripStructureFromIntro(txt){
  const s = String(txt||'');
  if(!s) return s;
  const lines = s.split('\n');
  const out = [];
  let skip = false;
  const fieldHead = /^\s*(?:书名|小说名|标题|题材|主角|核心冲突|世界观|对手|动机|风格|落地方式|目标|核心词|推荐理由|简介|评分|一句话|定位|优势|亮点)\s*[:：]/;
  const dropLine = /^\s*(?:书名|小说名|标题|推荐理由)\s*[:：]/;   // 单行命名字段：直接剔除
  for(const ln of lines){
    if(!skip && /^\s*结构(?:\s*（[^）]*）)?\s*[:：]/.test(ln)){ skip = true; continue; }
    if(skip){
      if(fieldHead.test(ln)){ skip = false; out.push(ln); }
      continue;
    }
    if(dropLine.test(ln)) continue;
    out.push(ln);
  }
  return out.join('\n').replace(/\n{2,}/g, '\n').trim() || s.trim();
}
function renderLoglineHtml(txt){
  const s = stripStructureFromIntro(txt);
  const ls = String(s||'').trim().split('\n');
  if(!ls.length || !(ls[0]||'').trim()) return '';
  const labelSet = new Set(['书名','小说名','标题','题材','主角','核心缺陷','钩点','核心冲突','风格','目标','核心词','世界观','对手','动机','特点','亮点','定位','基调','金手指','展开','结局','综上','核心看点','设定','走向','看点','卖点','矛盾','成长','悬念','反转']);
  const re = /^([^\s：:（(]{1,10})\s*[:：]\s*(.*)$/;
  const presetHue = {题材:165,主角:218,核心冲突:12,风格:278,目标:128,核心词:332,世界观:188,对手:30,动机:306,特点:46,亮点:52,定位:232,基调:200,金手指:284,展开:358,结局:160,核心看点:20,设定:110,走向:60,看点:327,卖点:301,矛盾:345,成长:95,悬念:244,反转:14};
  function labelHue(name){ if(presetHue[name]!=null) return presetHue[name]; let h=0; for(const c of name) h=(h*31+c.codePointAt(0))%360; return h; }
  return ls.map(ln=>{
    const m = ln.match(re);
    if(m && labelSet.has(m[1].trim())){
      const nm = m[1].trim();
      return `<div class="so-line"><span class="so-lb" style="--h:${labelHue(nm)}">${esc(nm)}</span><span class="so-txt">${esc(m[2])}</span></div>`;
    }
    return `<div class="so-line so-plain">${esc(ln)}</div>`;
  }).join('');
}
function buildOutlineFromPolishCandidate(cand){
  const txt = String((cand && cand.text) || '').trim();
  const o = state.outline || {};
  const curTitle = (o && o.title) || '';
  const title = extractCandidateBookName(txt) || curTitle || '';
  const prevGloss = (o && o.glossary && sourceHasGlossary(o.glossary)) ? o.glossary : null;
  const build = {
    title,
    logline: stripStructureFromIntro(txt) || (o && o.logline) || '',
    userIdea: String(state.idea || '').trim(),
    tone: (o && o.tone) || ''
  };
  if(prevGloss) build.glossary = prevGloss;
  else build.glossary = { characters:[], places:[], propernouns:[], subplots:[] };
  return build;
}

const DICTMASTER_SYS = `你是一位资深长篇「词典达人」（全局设定架构师）。你将拿到 ②优化构想所选方案的完整原文（含 书名 + 九要素：题材/主角/核心冲突/世界观/对手/动机/风格/结构/核心词）作为唯一蓝本，把它深化并架构为一份可直接支撑全书写作的高质量「万物设定词典」。

【职责边界 / 硬性约束】
1. 【蓝本基准】：蓝本（②所选方案）里已出现的人物/地名/专名，必须全部收录且**绝对不可改动**：名称逐字原样、设定只能按蓝本深化，不许改角色身份/立场/核心矛盾、不许删主角。
2. 【严格负向排除（防泛化污染）】：
   - **严禁收录无意义的通用日常泛词**（例如：“街道”、“大门”、“长剑”、“木桌”、“客栈”、“傍晚”、“茶水”等普通名词，绝不能当成专名或地名写入词典）。
   - 专名（propernouns）只收录具有**专属性、辨识度、不可替代性**的核心设定，如：独门功法/神通、核心法宝/神器/特殊道具、独门阵法、特定组织/门派规约等；
   - 地名（places）只收录故事发生的核心地标、特殊秘境、城池、宗门驻地、特定险地等，禁止录入通用场所泛指。
3. 【设定四大核心类别】：
   ① 核心人物与重要配角（characters）：姓名、身份定位、年龄、性别、外貌特征、爱好癖好、口头禅、关系摘要、性格特征（9维必填满）；
   ② 核心法宝/道具/秘籍/物品（propernouns）：名称、品阶/来源、功能特效、使用代价/限制（在 note 中注明）；
   ③ 独特地理/宗门/势力（places）：名称、类型、势力归属/地理位置、关键地标/氛围（在 note 中注明）；
   ④ 世界观运转规则系统（worldRules）：规则类别、适用对象/范围、具体运转规则、违反后果/代价。
4. 【关联表精确性】：
   - relationshipTable（人物关系表）：只写 人物↔人物 之间的血缘/身份/恩怨/利益纠葛；
   - placeContacts（地名关联表）：只写 地名↔地名 之间的相邻/隶属/交通通路/势力划分；
   - properContacts（专名关联表）：只写 专名↔专名 之间的克制/配套/渊源/等级序列；
   - 严禁留空端名、严禁将实体的属性/功能/子项当作另一端凑数，宁缺毋滥。

【输出格式】严格只输出如下 JSON（不要解释、不要 markdown 代码块）：
{"characters":[{"name":"","identity":"","age":"","gender":"","appearance":"","hobby":"","relation":"","trait":"","catchphrase":"口头禅"}],"relationshipTable":[{"a":"名字","b":"名字","relation":"关系","note":"一句话"}],"places":[{"name":"","type":"","note":""}],"placeContacts":[{"from":"地名","to":"地名","relation":"联系","note":""}],"propernouns":[{"name":"","note":""}],"properContacts":[{"from":"专名","to":"专名","relation":"联系","note":""}],"worldRules":[{"cat":"规则类别","scope":"适用对象/范围","rule":"具体规则（写清运作法则与违反后果/代价）"}],"summary":"一句话词典架构亮点"}
【要点】
- characters 每位必须给满 9 维且非空（age/gender 无明确值填"未知"；relation 简明扼要≤20字；catchphrase 填反复挂在嘴边的口头语）。
- places 必须含 type（类型）+ note（说明）。
- propernouns 必须含 note（功能与限制）。
- worldRules 必须含 cat（类别）+ scope（范围）+ rule（规则与代价），规则必须贴合题材社会性质，杜绝口号，可执行可校验。`;
function buildDictMasterUser(ctx){
  const cand = ctx && ctx.candidate;
  const txt = String((cand && cand.text) || '').trim();
  const parts = [];
  parts.push(`【蓝本：②优化构想所选方案】${(cand && cand.name) ? ('方案『' + cand.name + '』') : '（所选方案）'}`);
  parts.push(('【所选方案完整原文（作为唯一蓝本，其中已有角色/地名/专名不可改动）】\n' + txt) || '（所选方案为空）');
  return parts.join('\n\n');
}
function validateDictMasterOutput(j){
  if(!j || typeof j !== 'object') return '返回不是对象';
  if(!Array.isArray(j.characters) || !j.characters.length) return '人物卡 characters 为空（应至少 1 位）';
  for(const c of j.characters){
    if(!c || !String(c.name||'').trim()) return '存在人物缺少 name';
    const dims = {identity:c.identity, appearance:c.appearance, hobby:c.hobby, relation:c.relation, trait:c.trait, catchphrase:c.catchphrase};
    for(const [kk,vv] of Object.entries(dims)){ if(!String(vv||'').trim()) return `人物「${String(c.name).trim()||'?'}」缺字段 ${kk}（9 维须填满）`; }
    if(!String(c.age||'').trim()) return `人物「${String(c.name).trim()||'?'}」缺字段 age（可写未知）`;
    if(!String(c.gender||'').trim()) return `人物「${String(c.name).trim()||'?'}」缺字段 gender（可写未知）`;
    if(String(c.relation||'').trim().length > 40) return `人物「${String(c.name).trim()||'?'}」relation 超过 40 字，疑似把多组关系堆进摘要：只写 ≤20字 的一句话（如「主角的青梅」），多组关系的逐条明细放 relationshipTable`;
  }
  if(!Array.isArray(j.relationshipTable)) return '缺少 relationshipTable 数组';
  const places = Array.isArray(j.places)?j.places:[];
  const props = Array.isArray(j.propernouns)?j.propernouns:[];
  if(!places.length && !props.length) return '缺少 places 或 propernouns';
  for(const p of places){ if(p && (!String(p.name||'').trim()||!String(p.type||'').trim()||!String(p.note||'').trim())) return `地名「${String(p&&p.name||'').trim()||'?'}」信息不全（需 type+note）`; }
  for(const p of props){ if(p && (!String(p.name||'').trim()||!String(p.note||'').trim())) return `专名「${String(p&&p.name||'').trim()||'?'}」缺 note`; }
  const wr = Array.isArray(j.worldRules)?j.worldRules:[];
  if(!wr.length) return '缺少 worldRules（世界观规则，应 ≥1 条）';
  for(const r of wr){ if(r && (!String(r.cat||'').trim()||!String(r.rule||'').trim())) return `世界观规则「${String(r&&r.cat||'').trim()||'?'}」缺失 cat 或 rule`; }
  for(const [key,aa,bb,lab] of [['relationshipTable','a','b','人物关系表'],['placeContacts','from','to','地名关联表'],['properContacts','from','to','专名关联表']]){
    const arr = Array.isArray(j[key]) ? j[key] : [];
    for(const e of arr){
      if(!e || typeof e !== 'object') continue;
      const A=String(e[aa]||'').trim(), B=String(e[bb]||'').trim();
      const hasRest = String(e.relation||'').trim() || String(e.note||'').trim();
      if(hasRest && (!A || !B)) return `${lab}存在端名不全的条目（${lab}每条必须两端都填真实名称，禁止把功能/属性/子项当作另一端凑数）`;
      if(A && B && A===B) return `${lab}「${A}」两端相同（自身对自身无意义）`;
    }
  }
  return '';
}
async function genDictMaster(btn){
  const o = state.outline;
  const st = $('#dictmasterStatus');
  if(st){ st.className='status'; st.textContent=''; }
  if(!canRunAI('dictmaster')){ toast('请先完成上游：②优化构想并选中一个方案'); return false; }
  if(!selectedPolishCandidate()){ toast('先选择一个优化方案'); return false; }
  state.originalIdeaSnapshot = String(state.idea || '').trim() || state.originalIdeaSnapshot;
  markAIRunning('dictmaster');
  if(btn) busy(btn,true,'生成万物词典中…');
  if(btn && btn.parentNode) showStopBtn(btn.parentNode);
  try{
    const spec = resolveActiveSpec('dictmaster');
    const temp = (spec && spec.dictmasterTemp != null) ? spec.dictmasterTemp : 0.4;
    const txt = await callAIGuarded('dictmaster', {}, {temperature: temp, maxTokens: 16384, signal: _abortCtl?.signal});
    const j = extractJsonObject(txt);
    if(!j){ throw new Error('AI 未返回可用的词典 JSON'); }
    const v = validateDictMasterOutput(j);
    if(v) throw new Error('词典校验失败：'+v);
    o.glossary = o.glossary || { characters:[], places:[], propernouns:[], subplots:[] };
    const snapKeys = { characters:['name','identity','age','gender','appearance','hobby','relation','trait','catchphrase'], places:['name','type','note'], propernouns:['name','note'] };
    const entryJson = (x,k)=>{ const o2={}; (snapKeys[k]||[]).forEach(f=> o2[f]=String((x && x[f])!=null ? x[f] : '').trim()); try{ return JSON.stringify(o2); }catch(e){ return ''; } };
    ['characters','places','propernouns'].forEach(k=>{
      const kept=[];
      (o.glossary[k]||[]).forEach(x=>{
        if(x && x._dictmaster){
          if(x._srcSnapshot && entryJson(x,k) !== x._srcSnapshot){
            delete x._dictmaster; delete x._srcSnapshot;
          } else {
            return;
          }
        }
        kept.push(x);
      });
      o.glossary[k]=kept;
    });
    const push = (list,k,mapper)=>{
      const existing = new Set((o.glossary[k]||[]).map(x=>x && String(x.name||'').trim()).filter(Boolean));
      (list||[]).forEach(it=>{
        const nm=String((it && it.name)||'').trim(); if(!nm) return;
        if(existing.has(nm)) return;   // 同名让位
        o.glossary[k]=o.glossary[k]||[];
        const e = (mapper?mapper(it):{ name:nm, note:String(it.note||'').trim() });
        e._dictmaster=true; e._srcSnapshot=entryJson(e,k);
        o.glossary[k].push(e); existing.add(nm);
      });
    };
    push(j.characters, 'characters', c=>({ name:String(c.name||'').trim(), identity:String(c.identity||'').trim(), age:String(c.age||'').trim(), gender:String(c.gender||'').trim(), appearance:String(c.appearance||'').trim(), hobby:String(c.hobby||'').trim(), relation:String(c.relation||'').trim(), trait:String(c.trait||'').trim(), catchphrase:String(c.catchphrase||'').trim() }));
    push(j.places, 'places', p=>({ name:String(p.name||'').trim(), type:String(p.type||'').trim(), note:String(p.note||'').trim() }));
    push(j.propernouns, 'propernouns', p=>({ name:String(p.name||'').trim(), note:String(p.note||'').trim() }));
    o.glossary._relationshipTable = (j.relationshipTable||[]).map(x=>({ a:String(x.a||'').trim(), b:String(x.b||'').trim(), relation:String(x.relation||'').trim(), note:String(x.note||'').trim() }));
    o.glossary._placeContacts = (j.placeContacts||[]).map(x=>({ from:String(x.from||'').trim(), to:String(x.to||'').trim(), relation:String(x.relation||'').trim(), note:String(x.note||'').trim() }));
    o.glossary._properContacts = (j.properContacts||[]).map(x=>({ from:String(x.from||'').trim(), to:String(x.to||'').trim(), relation:String(x.relation||'').trim(), note:String(x.note||'').trim() }));
    o.glossary._worldRules = (j.worldRules||[]).map(x=>({ cat:String(x.cat||'').trim(), scope:String(x.scope||'').trim(), rule:String(x.rule||'').trim() }));
    const result = { ts: Date.now(), book: (o.title)||'', summary:String(j.summary||'').trim(), nChar:(j.characters||[]).length, nPlace:(j.places||[]).length, nProp:(j.propernouns||[]).length, nRel:(j.relationshipTable||[]).length, nPC:(j.placeContacts||[]).length, nPRC:(j.properContacts||[]).length, nWR:(j.worldRules||[]).length, characters:j.characters||[], rel:j.relationshipTable||[], places:j.places||[], pc:j.placeContacts||[], props:j.propernouns||[], prc:j.properContacts||[], wr:j.worldRules||[] };
    state.dictmasterLatest = result;
    state.dictmasterHistory = Array.isArray(state.dictmasterHistory) ? state.dictmasterHistory : [];
    state.dictmasterHistory.unshift(result);
    if(state.dictmasterHistory.length > 6) state.dictmasterHistory = state.dictmasterHistory.slice(0, 6);   // 第 7 次最旧被挤出
    state.dictmasterRan = true;
    persist(); render();
    markAIDone('dictmaster');
    toast(`万物词典已生成：人物 ${result.nChar} 位 · 地名 ${result.nPlace} · 专名 ${result.nProp} · 关系表 ${result.nRel} 条 · 世界观规则 ${result.nWR} 条（已并入万物词典）`);
    return true;
  }catch(e){
    if(e.name !== 'AbortError') addToFixQueue({kind:'dictmaster', error:e.message});
    toast(e.name==='AbortError' ? '已停止生成万物词典' : '万物词典生成失败：'+e.message);
    if(st){ st.className='status err'; st.textContent = e.message; }
    return false;
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='dictmaster');
    hideStopBtn(); if(btn) busy(btn,false);
  }
}
function dictMasterBlockHtml(){
  const g = (state.outline && state.outline.glossary) || null;
  const hasOut = !!state.dictmasterLatest && g && ((g.characters&&g.characters.length)||(g.places&&g.places.length)||(g.propernouns&&g.propernouns.length));
  const locked = dictmasterLocked();
  const histN = Array.isArray(state.dictmasterHistory) ? state.dictmasterHistory.length : 0;
  const status = `<p id="dictmasterStatus" class="status" style="margin:8px 0 0"></p>`;
  if(hasOut){
    const r = state.dictmasterLatest || {};
    const relArr = validAssoc(g._relationshipTable,'a','b');
    const pcArr  = validAssoc(g._placeContacts,'from','to');
    const prcArr = validAssoc(g._properContacts,'from','to');
    const wrArr  = ((g&&g._worldRules)||[]).filter(x=>x&&String(x.rule||'').trim());
    const relRows = relArr.slice(0,8).map(x=>`<div class="dm-rel"><b>${esc(x.a||'')}</b> ←${esc(x.relation||'')}→ <b>${esc(x.b||'')}</b>${x.note?` <span class="muted">· ${esc(x.note)}</span>`:''}</div>`).join('');
    const contactRow = x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}${x.note?('：'+esc(x.note)):''}</span></div>`;
    const pcRows = pcArr.map(contactRow).join('');
    const prcRows = prcArr.map(contactRow).join('');
    const wrRows = wrArr.map(x=>`<div class="dm-wr"><b>${esc(x.cat||'')}${String(x.scope||'').trim()?` · ${esc(String(x.scope).trim())}`:''}</b><div>${esc(x.rule||'')}</div></div>`).join('');
  const hue = s=>{ let h=0; for(const ch of String(s||'')) h=(h*31+ch.codePointAt(0))%360; return h; };
  const _labels = { identity:'身份', age:'岁数', gender:'性别', appearance:'外貌', hobby:'爱好', catchphrase:'口头禅', relation:'关系', trait:'性格', type:'类型', note:'说明' };
  const detailLines = (o, keys)=> keys.map(k=> (o && String(o[k]||'').trim())
    ? `<div class="dmt-line"><b>${esc(_labels[k]||k)}</b><span>${esc(String(o[k]).trim())}</span></div>` : '').join('');
  const chip = nm=>`<b class="de-chip" style="--h:${hue(nm)}">${esc(nm)}</b>`;
  const charRow = c=>`<details class="dmt-entry"><summary>${chip(c.name)}<span class="muted dmt-brief">${esc([c.identity,c.gender,c.age].filter(Boolean).join(' · ')||'（无简介）')}</span></summary><div class="dmt-body">${detailLines(c,['identity','age','gender','appearance','hobby','catchphrase','relation','trait'])||'<span class="muted">（无字段）</span>'}</div></details>`;
  const placeRow = p=>`<details class="dmt-entry"><summary>${chip(p.name)}<span class="muted dmt-brief">${esc([p.type,p.note].filter(Boolean).join(' · ')||'')}</span></summary><div class="dmt-body">${detailLines(p,['type','note'])||''}</div></details>`;
  const propRow  = p=>`<details class="dmt-entry"><summary>${chip(p.name)}<span class="muted dmt-brief">${esc(String(p.note||'').trim()||'')}</span></summary><div class="dmt-body">${detailLines(p,['note'])||''}</div></details>`;
  const charMain = (g.characters||[]).filter(c=>c && c.tier!=='support');
  const charSup  = (g.characters||[]).filter(c=>c && c.tier==='support');
  const dmtGroup = (lab, rows)=> rows.length ? `<details class="dmt-group"><summary>${lab}（${rows.length}）</summary><div class="dmt-list">${rows}</div></details>` : '';
  const allRows = dmtGroup('👤 主要人物', charMain.map(charRow))
    + dmtGroup('🤝 次要配角', charSup.map(charRow))
    + dmtGroup('🗺️ 地名', (g.places||[]).map(placeRow))
    + dmtGroup('📌 专名', (g.propernouns||[]).map(propRow));
    return `<div class="card dm-card card-theme-dict">
      <div class="dm-head card-head-bar">
        <div class="ch-left">
          <span class="ch-badge ch-badge-dict">📚</span>
          <h3 class="ch-title">词典达人 · 专有名词与设定库</h3>
          <span class="ch-subtag ch-subtag-dict">人物 ${(g.characters||[]).length} · 地名 ${(g.places||[]).length} · 专名 ${(g.propernouns||[]).length}</span>
        </div>
        <div class="ch-right">
          ${histN?`<button id="btnDictMasterHist" class="btn small ghost">🕘 历史(${histN}/6)</button>`:''}
        </div>
      </div>
      <div class="dm-toolbar">
        <span class="muted dm-strip">关系表 ${relArr.length} · 地名关联 ${pcArr.length} · 专名关联 ${prcArr.length} · 世界观规则 ${wrArr.length}</span>
      </div>
      <div class="dmt-tabs">
        <button type="button" class="dmt-tab on" data-dmt-tab="rel">👥 人物关系表（${relArr.length}）</button>
        <button type="button" class="dmt-tab" data-dmt-tab="wr">⚙️ 世界观规则（${wrArr.length}）</button>
        <button type="button" class="dmt-tab" data-dmt-tab="pc">🗺️ 地名关联表（${pcArr.length}）</button>
        <button type="button" class="dmt-tab" data-dmt-tab="prc">📌 专名关联表（${prcArr.length}）</button>
      </div>
      <div class="dmt-panels">
        <!-- v1.0.317 词典达人不再展示「人物类别」全貌（与词典充实雷同）：默认开在人物关系表 -->
        <div class="dmt-panel on" data-dmt-panel="rel"><div class="dm-rel-table">${relRows||'<span class="muted">（无）</span>'}</div></div>
        <div class="dmt-panel" data-dmt-panel="wr"><div class="dm-rel-table">${wrRows||'<span class="muted">（无）</span>'}</div></div>
        <div class="dmt-panel" data-dmt-panel="pc"><div class="dm-rel-table">${pcRows||'<span class="muted">（无）</span>'}</div></div>
        <div class="dmt-panel" data-dmt-panel="prc"><div class="dm-rel-table">${prcRows||'<span class="muted">（无）</span>'}</div></div>
      </div>
      ${status}
    </div>`;
  }
  return `<div class="card dm-card card-theme-dict">
    <div class="dm-head card-head-bar">
      <div class="ch-left">
        <span class="ch-badge ch-badge-dict">📚</span>
        <h3 class="ch-title">词典达人 · 专有名词与设定库</h3>
        <span class="ch-subtag ch-subtag-dict">待生成</span>
      </div>
      <div class="ch-right">
        <span class="muted" style="font-size:12px">全局设定架构</span>
      </div>
    </div>
    ${locked?`<div class="dm-locked" style="margin:6px 0;color:#2e9e5b;font-size:12px">设定已锁定，可在「编剧学院」中一键迭代。</div>`:''}
    <div class="btn-row"><p class="muted" style="margin:8px 0 0;font-size:12px">尚未生成万物词典，开学后自动构建设定库。</p></div>
    ${status}
  </div>`;
}
function openDictMasterHistoryPanel(){
  const hist = Array.isArray(state.dictmasterHistory) ? state.dictmasterHistory : [];
  if(!hist.length){ toast('暂无历史版本'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const ov = document.createElement('div'); ov.id='dmpPanel'; ov.className='gs-overlay';
  const tabs = hist.map((h,i)=>`<button class="dm-tab" data-dm-tab="${i}" title="第 ${hist.length-i} 次">#${hist.length-i}</button>`).join('');
  const idx = hist.length-1;   // 最新在 tabs 最右
  const renderBody = (i)=>{
    const h = hist[i]; if(!h) return '';
    const rel=(h.rel||[]).map(x=>`<div class="dm-rel"><b>${esc(x.a||'')}</b> ←${esc(x.relation||'')}→ <b>${esc(x.b||'')}</b>${x.note?` <span class="muted">· ${esc(x.note)}</span>`:''}</div>`).join('')||'<span class="muted">（无）</span>';
    const pc=(h.pc||[]).map(x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}</span></div>`).join('')||'<span class="muted">（无）</span>';
    const prc=(h.prc||[]).map(x=>`<div class="dm-rel">${esc(x.from||'')} ↔ ${esc(x.to||'')} <span class="muted">· ${esc(x.relation||'')}</span></div>`).join('')||'<span class="muted">（无）</span>';
    const wr=(h.wr||[]).map(x=>`<div class="dm-wr"><b>${esc(x.cat||'')}</b><div>${esc(x.rule||'')}</div></div>`).join('')||'<span class="muted">（无）</span>';
    return `<div class="dm-prev-meta">${fmtTs(h.ts)} · ${h.book?('《'+esc(h.book)+'》'):''} 人物 ${h.nChar||0} · 地名 ${h.nPlace||0} · 专名 ${h.nProp||0} · 关系表 ${h.nRel||0} 条 · 世界观规则 ${h.nWR||0} 条</div>
      <div class="dm-prev-chars"><b>人物卡（${h.nChar||0}）</b><span class="muted">${(h.characters||[]).map(c=>esc(c&&c.name||'')).join('、')}</span></div>
      <div class="dm-tables">
        <details class="dm-fold"><summary>世界观规则</summary><div class="dm-rel-table">${wr}</div></details>
        <details class="dm-fold"><summary>人物关系表</summary><div class="dm-rel-table">${rel}</div></details>
        <details class="dm-fold"><summary>地名关联表</summary><div class="dm-rel-table">${pc}</div></details>
        <details class="dm-fold"><summary>专名关联表</summary><div class="dm-rel-table">${prc}</div></details>
      </div>`;
  };
  ov.innerHTML = `<div class="gs-modal dm-hist-modal">
    <div class="gs-modal-head"><b>🕘 词典达人 · 万物词典历史（${hist.length}/6）</b><button class="gs-x" data-dmh-close>✕</button></div>
    <div class="dm-tabs">${tabs}</div>
    <div class="cv-body"><div id="dmhBody" style="max-height:62vh;overflow:auto">${renderBody(idx)}</div></div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-dmh-close]').onclick = ()=> ov.remove();
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
  ov.querySelectorAll('[data-dm-tab]').forEach(t=>{
    t.onclick = ()=>{ ov.querySelectorAll('[data-dm-tab]').forEach(x=>x.classList.remove('on')); t.classList.add('on'); const b=$('#dmhBody'); if(b) b.innerHTML = renderBody(+t.dataset.dmTab); };
  });
  ov.querySelector('[data-dm-tab="'+idx+'"]').classList.add('on');
}
function bindDictMaster(){
  const hb = $('#btnDictMasterHist'); if(hb) hb.onclick = ()=> openDictMasterHistoryPanel();
  $$('.dmt-tab').forEach(t=>{
    if(t._dmt) return; t._dmt = 1;
    t.onclick = ()=>{
      const tab = t.dataset.dmtTab;
      $$('.dmt-tab').forEach(x=>x.classList.toggle('on', x===t));
      $$('.dmt-panel').forEach(p=>p.classList.toggle('on', p.dataset.dmtPanel===tab));
    };
  });
  const sb = $('[data-dmt-search]');
  if(sb && !sb._dmt){ sb._dmt = 1; sb.oninput = ()=>{
    const q = String(sb.value||'').trim().toLowerCase();
    const scope = sb.closest('.dmt-panels') && sb.closest('.dmt-panel').querySelector('[data-dmt-scope]');
    if(!scope) return;
    scope.querySelectorAll('.dmt-group').forEach(grp=>{
      let shown = 0;
      grp.querySelectorAll('.dmt-entry').forEach(en=>{
        const hit = !q || (en.textContent || '').toLowerCase().indexOf(q) >= 0;
        en.style.display = hit ? '' : 'none';
        if(hit) shown++;
      });
      grp.style.display = shown ? '' : 'none';
      const sum = grp.querySelector('summary'); if(sum) sum.textContent = sum.dataset.base;
    });
  };}
  const scope = document.querySelector('[data-dmt-scope]');
  if(scope) scope.querySelectorAll('.dmt-group summary').forEach(s=>{ s.dataset.base = s.textContent; });
}

function cleanEntityName(raw){
  if(!raw) return ['', ''];
  let s = String(raw).trim();
  s = s.replace(/^[*_\`'\"「」【】]+|[*_\`'\"「」【】]+$/g, '').trim();
  s = s.replace(/^[【\[\(（]?(主要人物|次要配角|重要角色|配角|地名|专名|路人|龙套|闲人)[】\]\)）]?[：:·\s|｜│┆丨]+/g, '').trim();
  s = s.replace(/^[0-9]+[.\-、]\s*/, '').trim();

  let extra = '';
  const m_paren = s.match(/[(（\[【](.*?)[)）\]】]/);
  if(m_paren){
    extra = String(m_paren[1]||'').trim();
    s = (s.slice(0, m_paren.index) + s.slice(m_paren.index + m_paren[0].length)).trim();
  }
  const m_dash = s.match(/[\s:：\-—]+(.+)$/);
  if(m_dash && s.slice(0, m_dash.index).trim().length >= 1){
    if(!extra) extra = String(m_dash[1]||'').trim();
    s = s.slice(0, m_dash.index).trim();
  }
  s = s.replace(/^[·•\s]+|[·•\s]+$/g, '').trim();
  s = s.replace(/^名称[：:]\s*/, '').trim();
  return [s, extra];
}

const DICT_ENRICH_SYS = `你是一位资深长篇「词典充实师」（设定细化与描写工坊专家）。你将拿到 ③万物词典（现有人/地/专名，只读参照，不得改动、不得重复新增同名）与章节大纲/时间线/节拍清单。
你的任务：**在现有词典的硬核骨架之上，为正文写作主动补充更细腻生动的 感官描写特征、场景使用禁忌、正文特色标签 以及 鲜活生动的氛围龙套**——让正文作家在动笔时有取之不尽的具象抓手，彻底避免正文干瘪、抽象与同质化。

【四大产出分档与标准】
1. 主要人物增补（0~2位）：仅当主线确实缺少重量级枢纽人物时补充。必须提供：身份定位、外貌感官特征（视觉/声音/体貌标签）、性格要点、口癖习惯、核心动机。
2. 次要配角增补（3~8位）：主线涉及的亲友、同门、副手、耳目、宿敌手下。提供：身份、关系、鲜明外貌/气场、性格要点、正文描写标签。
3. 关键地名/专名增补：主线必定经过但尚未入典的特定场景、关键法宝丹药、特产风物。提供：类型、感官氛围特征（光线/气味/声音）、使用禁忌/限制、正文描写词。
4. 路人/龙套/生活气闲人（多多益善，建议≥全书章数的1/3）：只说一两句话、只露一面的市井闲人（更夫、茶博士、摊贩、哨兵、马夫等）。提供：身份、登场场景、一句典型口头台词或动作习惯、正文点缀标签。登场地点与时节必须严格吻合【小说简介】与【万物词典】，严禁自造虚空地名。

【职责边界 / 硬性约束】
1. 绝对依附已有大纲与世界观，严禁脱离主线过度发散，禁止脑补与世界观相悖的异类设定。
2. 现有词典已有的人/地/专名不得改动，不得重复新增同名。
3. 专名与地名严禁收录“马车/街道/普通长剑”等日常泛词，必须具有故事专属性。
4. 【极其重要·名称格式约束】：名字字段仅填写纯粹的人名/地名/专名（如"林月如"、"锁妖塔"、"七星剑"），绝对不要在名称中夹带括号或简介说明文字（如切勿写成"林月如（林家堡千金）"或"主要人物·林月如"），所有身份、关系、外貌等介绍必须严格写在后续的各个字段中。

【输出格式】严格只输出如下纯文本（不要 JSON、不要解释、不要 markdown 代码块）：
【新增主要人物】
主要人物｜名｜身份：…；关系：…；外貌：…；性格：…；口头禅：…；描写标签：…
【新增次要配角】
次要配角｜名｜身份：…；关系：…；外貌：…；性格：…；口头禅：…；描写标签：…
【新增地名】
地名｜名｜类型：…；氛围特征：…；说明：…；描写标签：…
【新增专名】
专名｜名｜类型：…；功能特效：…；使用禁忌：…；说明：…；描写标签：…
【新增路人/龙套】
路人｜名｜身份：…；登场：…；台词：…；描写标签：…
每条一行，用 '｜'（中文竖线）分隔。`;
function buildDictEnrichUser(){
  const o = state.outline || {};
  const parts = [];
  const head = [];
  if(o.title) head.push(`【小说标题】${o.title}`);
  if(o.logline && String(o.logline).trim()) head.push(`【小说简介】${stripStructureFromIntro(o.logline)}`);
  if(head.length) parts.push(head.join('\n'));
  const titles = (o.chapters||[]).map((c,i)=>`第${i+1}章 ${cleanChapterTitle((c&&c.title)||'')}`).join('\n');
  if(String(titles).trim()) parts.push(`【章节标题】\n${titles}`);
  const tl = globalTimelineBlock(); if(tl) parts.push(tl);   // 含全局时间线 + 各章节拍要点（承接点/情境）
  const entBlock = (o.chapterPlans||[]).map((p,i)=> (p && typeof p.tlEntities==='string' && String(p.tlEntities).trim()) ? `第${i+1}章：${String(p.tlEntities).trim()}` : null).filter(Boolean).join('\n');
  if(String(entBlock).trim()) parts.push(`【节拍表实体清单（各章同源附带的全量新实体，只读参照；只根据这里补词典还没有的新名）】\n${entBlock}`);
  const _tb = teamShapeBrief(); if(_tb) parts.push(_tb);
  const g = (o && o.glossary) || {};
  const vis = [];
  (g.characters||[]).forEach(c=>{
    const [cName] = cleanEntityName(c&&c.name);
    if(!cName) return;
    const tierTxt = (c&&c.tier==='support') ? '次要配角' : '主要人物';
    vis.push(`- 【${tierTxt}】名称：${cName} | 身份：${String(c.identity||'').trim()} | 关系：${String(c.relation||'').trim()}`);
  });
  (g.walkons||[]).forEach(w=>{
    const [wName] = cleanEntityName(w&&w.name);
    if(!wName) return;
    vis.push(`- 【路人龙套】名称：${wName} | 说明：${String(w.note||'').trim()}`);
  });
  (g.places||[]).forEach(p=>{
    const [pName] = cleanEntityName(p&&p.name);
    if(!pName) return;
    vis.push(`- 【地名】名称：${pName} | 类型：${String(p.type||'').trim()} | 说明：${String(p.note||'').trim()}`);
  });
  (g.propernouns||[]).forEach(x=>{
    const [xName] = cleanEntityName(x&&x.name);
    if(!xName) return;
    vis.push(`- 【专名】名称：${xName} | 说明：${String(x.note||'').trim()}`);
  });
  parts.push(`【万物词典（现有人/地/专名，只读参照：不得改动、不得重复新增同名）】\n${vis.join('\n')||'（无）'}`);
  return parts.join('\n\n');
}
function parseDictEnrichText(txt){
  const res = { characters:[], places:[], propernouns:[], walkons:[] };
  if(!txt) return res;
  
  let cleaned = String(txt).trim()
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 1. JSON Fallback
  if(cleaned.startsWith('{') || cleaned.startsWith('[')){
    try {
      const j = JSON.parse(cleaned);
      const addChar = c => {
        if(c && c.name){
          const [cleanName, extraNote] = cleanEntityName(c.name);
          if(!cleanName) return;
          res.characters.push(completeCharFields({
            name: cleanName,
            tier: (c.tier === 'main' || c.tier === '主要人物' || c.tier === '主要') ? 'main' : 'support',
            identity: c.identity || c.身份 || extraNote || '',
            age: c.age || c.年龄 || '',
            gender: c.gender || c.性别 || '',
            appearance: c.appearance || c.外貌 || '',
            hobby: c.hobby || c.爱好 || '',
            relation: c.relation || c.关系 || '',
            trait: c.trait || c.性格 || '',
            catchphrase: c.catchphrase || c.口头禅 || ''
          }));
        }
      };
      (j.characters || j.人物 || []).forEach(addChar);
      (j.places || j.地名 || []).forEach(p => {
        if(p && p.name){
          const [cleanName, extraNote] = cleanEntityName(p.name);
          if(cleanName) res.places.push({ name: cleanName, type: p.type || p.类型 || '地名', note: (extraNote ? extraNote + '；' : '') + (p.note || p.说明 || '') });
        }
      });
      (j.propernouns || j.专名 || []).forEach(x => {
        if(x && x.name){
          const [cleanName, extraNote] = cleanEntityName(x.name);
          if(cleanName) res.propernouns.push({ name: cleanName, note: (extraNote ? extraNote + '；' : '') + (x.note || x.说明 || '') });
        }
      });
      (j.walkons || j.路人 || j.龙套 || []).forEach(w => {
        if(w && w.name){
          const [cleanName, extraNote] = cleanEntityName(w.name);
          if(cleanName) res.walkons.push({ name: cleanName, note: (extraNote ? extraNote + '；' : '') + (w.note || w.说明 || ''), _auto:true, tier:'walkon' });
        }
      });
      if(res.characters.length || res.places.length || res.propernouns.length || res.walkons.length) return res;
    } catch(e){}
  }

  // 2. Line-by-line flexible parser
  const parsePairs = detail => {
    const m = {};
    const segs = String(detail||'').split(/[；;，,\n|｜]/);
    for(const seg of segs){
      const s = String(seg||'').trim();
      if(!s) continue;
      const kv = s.match(/^[ \t*#-]*([\u4e00-\u9fa5A-Za-z0-9/_\-\—]{1,16})[：:]\s*(.+)$/);
      if(!kv || !kv[1] || !String(kv[2]||'').trim()) continue;
      m[kv[1].trim()] = kv[2].trim();
    }
    return m;
  };

  const lines = cleaned.split('\n');
  for(const raw of lines){
    let ln = String(raw||'').trim();
    if(!ln) continue;
    // Strip markdown prefixes like #, -, *, 1., >
    ln = ln.replace(/^[ \t]*[#*>\d.\-—•]+[ \t.]*/, '').trim();
    if(!ln) continue;
    if(ln.startsWith('【') && ln.endsWith('】') && /新增|分类|类别|人物|地名|专名|路人|设定/.test(ln)) continue;

    let cat = '';
    const m_cat_prefix = ln.match(/^[【\[\(（]?(主要人物|次要配角|重要角色|配角|地名|专名|路人|龙套|闲人)[】\]\)）]?[：:·\s|｜│┆丨]+(.*)$/);
    let rest = ln;
    if(m_cat_prefix){
      cat = m_cat_prefix[1];
      rest = m_cat_prefix[2].trim();
    }

    let seg = rest.split(/[｜|│┆丨]/).map(s=>String(s||'').trim()).filter(Boolean);
    if(!cat){
      if(seg.length && /^(主要人物|次要配角|重要角色|配角|地名|专名|路人|龙套|闲人)$/.test(seg[0])){
        cat = seg[0];
        seg = seg.slice(1);
      } else {
        cat = '次要配角';
      }
    }

    if(!seg.length) continue;

    let rawName = seg[0];
    let detail = '';

    if(seg.length >= 2){
      const [cleanN, extraN] = cleanEntityName(rawName);
      rawName = cleanN;
      detail = seg.slice(1).join('；');
      if(extraN) detail = (extraN + '；' + detail).replace(/^；+|；+$/g, '');
    } else {
      const m_attr = rest.match(/[\s\-—]+(身份|关系|外貌|性格|口头禅|口癖|描写标签|类型|说明|氛围|氛围特征|功能|功能特效|使用禁忌|备注|登场|台词)[：:]/);
      if(m_attr && m_attr.index != null){
        const namePart = rest.slice(0, m_attr.index).trim();
        const detailPart = rest.slice(m_attr.index).trim().replace(/^[\s\-—]+/, '');
        const [cleanN, extraN] = cleanEntityName(namePart);
        rawName = cleanN;
        detail = detailPart;
        if(extraN) detail = (extraN + '；' + detail).replace(/^；+|；+$/g, '');
      } else {
        const [cleanN, extraN] = cleanEntityName(rawName);
        rawName = cleanN;
        detail = extraN;
      }
    }

    const [name, extraFromClean] = cleanEntityName(rawName);
    if(!name) continue;
    if(extraFromClean && !detail.includes(extraFromClean)){
      detail = (extraFromClean + '；' + detail).replace(/^；+|；+$/g, '');
    }

    if(/路人|龙套|闲人/.test(cat)){
      res.walkons.push({ name, note: detail, _auto:true, tier:'walkon' });
      continue;
    }
    if(/人物|角色|主角|配角/.test(cat)){
      const tier = /主要人物|主角|重要角色/.test(cat) ? 'main' : 'support';
      const m = parsePairs(detail);
      const appParts = [
        m['外貌'] || m['外貌特征'] || m['外貌感官特征'] || m['感官特征'] || m['长相'] || '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ? `[标签:${m['描写标签'] || m['正文描写标签'] || m['标签']}]` : ''
      ].filter(Boolean);
      const app = appParts.join(' ').trim();
      res.characters.push(completeCharFields({
        name,
        tier,
        identity: m['身份'] || m['身份定位'] || m['简介'] || m['定位'] || (Object.keys(m).length === 0 ? detail : ''),
        age:      m['岁数'] || m['年龄'] || m['岁'] || '',
        gender:   m['性别'] || '',
        appearance: app || m['外貌'] || '',
        hobby:    m['爱好'] || '',
        relation: m['关系'] || m['人际关系'] || '',
        trait:    m['性格'] || m['性格要点'] || m['性格特征'] || m['核心动机'] || '',
        catchphrase: m['口头禅'] || m['口癖'] || m['台词'] || m['习惯'] || ''
      }));
      continue;
    }
    if(/地名|地点|地方|场景/.test(cat)){
      const m = parsePairs(detail);
      const noteParts = [
        m['说明'] || m['备注'] || (Object.keys(m).length === 0 ? detail : ''),
        (m['氛围特征'] || m['感官氛围特征'] || m['氛围']) ? `氛围:${m['氛围特征'] || m['感官氛围特征'] || m['氛围']}` : '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ? `标签:${m['描写标签'] || m['正文描写标签'] || m['标签']}` : ''
      ].filter(Boolean);
      res.places.push({ name, type: m['类型'] || m['类别'] || '地名', note: noteParts.join('；') });
      continue;
    }
    if(/专名|术语|名词|物件|势力|组织|功法|宝器|道具|法宝/.test(cat)){
      const m = parsePairs(detail);
      const noteParts = [
        m['说明'] || m['备注'] || (Object.keys(m).length === 0 ? detail : ''),
        (m['功能特效'] || m['功能'] || m['特效']) ? `功能:${m['功能特效'] || m['功能'] || m['特效']}` : '',
        (m['使用禁忌'] || m['使用禁忌/限制'] || m['禁忌'] || m['限制']) ? `禁忌:${m['使用禁忌'] || m['使用禁忌/限制'] || m['禁忌'] || m['限制']}` : '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ? `标签:${m['描写标签'] || m['正文描写标签'] || m['标签']}` : ''
      ].filter(Boolean);
      res.propernouns.push({ name, note: noteParts.join('；') });
      continue;
    }
  }

  // 3. Ultra-resilient fallback if strict line matching produced 0 entries
  if(!(res.characters.length || res.places.length || res.propernouns.length || res.walkons.length)){
    for(const raw of lines){
      let ln = String(raw||'').trim();
      if(!ln || (ln.startsWith('【') && ln.endsWith('】'))) continue;
      ln = ln.replace(/^[ \t]*[#*>\d.\-—•]+[ \t.]*/, '').trim();
      const m = ln.match(/^([^\s：:（(—\-]{1,16})[\s：:（(—\-]+(.*)$/);
      if(m){
        const [nClean, nExtra] = cleanEntityName(m[1]);
        if(nClean && nClean.length >= 2 && !/^(小说|章节|大纲|简介|标题|节拍|时间线)$/.test(nClean)){
          res.characters.push(completeCharFields({
            name: nClean,
            tier: 'support',
            identity: (nExtra ? nExtra + '；' : '') + m[2].trim()
          }));
        }
      }
    }
  }

  return res;
}
function mergeDictEnrich(res){
  const o = state.outline; if(!o) return {c:0,w:0,p:0,k:0,total:0};
  if(!o.glossary) o.glossary = { characters:[], places:[], propernouns:[] };
  if(!Array.isArray(o.glossary.walkons)) o.glossary.walkons = [];
  const g = o.glossary;
  const n = { c:0, w:0, p:0, k:0, main:0, support:0 };
  const findExisting = (list, targetName) => {
    const cleanT = cleanEntityName(targetName)[0];
    return (list||[]).find(x => {
      const cleanX = cleanEntityName(x && x.name)[0];
      return cleanX && cleanX === cleanT;
    });
  };

  (res.characters||[]).forEach(it=>{
    const [nm, extra] = cleanEntityName(it.name);
    if(!nm) return;
    it.name = nm;
    if(extra && !it.identity) it.identity = extra;
    const existing = findExisting(g.characters, nm);
    if(existing){
      // Enrich missing fields in existing character
      ['identity','age','gender','appearance','hobby','relation','trait','catchphrase'].forEach(f=>{
        if(!existing[f] && it[f]) existing[f] = it[f];
      });
      existing._enrich = true;
      existing._srcTs = Date.now();
      return;
    }
    if(it.tier!=='main'&&it.tier!=='support') it.tier='support';
    it._enrich=true; it._srcHow='词典充实'; it._srcTs=Date.now();
    g.characters.push(it);
    n.c++;
    if(it.tier==='main') n.main++; else n.support++;
  });

  (res.places||[]).forEach(it=>{
    const [nm, extra] = cleanEntityName(it.name);
    if(!nm) return;
    it.name = nm;
    if(extra && !it.note) it.note = extra;
    const existing = findExisting(g.places, nm);
    if(existing){
      if(!existing.type && it.type) existing.type = it.type;
      if(!existing.note && it.note) existing.note = it.note;
      existing._enrich = true; existing._srcTs = Date.now();
      return;
    }
    it._enrich=true; it._srcTs=Date.now();
    g.places.push(it);
    n.p++;
  });

  (res.propernouns||[]).forEach(it=>{
    const [nm, extra] = cleanEntityName(it.name);
    if(!nm) return;
    it.name = nm;
    if(extra && !it.note) it.note = extra;
    const existing = findExisting(g.propernouns, nm);
    if(existing){
      if(!existing.note && it.note) existing.note = it.note;
      existing._enrich = true; existing._srcTs = Date.now();
      return;
    }
    it._enrich=true; it._srcTs=Date.now();
    g.propernouns.push(it);
    n.k++;
  });

  (res.walkons||[]).forEach(it=>{
    const [nm, extra] = cleanEntityName(it.name);
    if(!nm) return;
    it.name = nm;
    if(extra && !it.note) it.note = extra;
    const existing = findExisting(g.walkons, nm);
    if(existing){
      if(!existing.note && it.note) existing.note = it.note;
      existing._enrich = true; existing._srcTs = Date.now();
      return;
    }
    it._enrich=true; it._srcTs=Date.now();
    g.walkons.push(it);
    n.w++;
  });

  n.total = n.c + n.w + n.p + n.k;
  return n;
}

const DICT_HARVEST_SYS = `你是一位长篇小说的「正文收编师」。正文创作结束后，系统会把「反复出现/有戏份、但尚未录入词典」的新实体候选名单及其在正文中的出现片段交给你。你的职责是判定哪些应正式收编进「万物词典」，哪些只是已有角色的别名、哪些只是一次性路人。
【判定流程】
1. 对每个候选先做【别名吸附】：它是否只是已有词典人物的 缩略 / 字号 / 绰号 / 异写？
   - 是 → 不新增、不改名，该候选直接跳过，并在结果末尾附一行【已吸附】说明它是哪个已有名的别名。
2. 确属全新角色，且「反复出现或有戏份、值得被词典收编」：按词典充实的格式输出其设定，收编进对应类别（人物/地名/专名/路人）。
3. 只是一次性路人/出场单薄没戏份：不输出（不入典）。
【硬性约束】
· 万物词典已收录的名一律不得重复新增同名，不得改动既有词条。
· 判定必须基于给出的正文片段证据，禁止臆造设定；身份/关系等要点要能与片段对得上。
【输出格式】每行一个实体，用「类别｜名称｜字段：值；字段：值」格式、末尾加分号。类别只用 人物/地名/专名/路人；人物最好给 身份/关系 等可入典要点（正文片段里有的才写，没有则不编）。若本批决定不入任何实体，只输出一行【收编】无新增候选。`;
function _parsedCastList(text){
  const res = [];
  String(text||'').split(/[；;]/).forEach(seg=>{
    const parts = String(seg).split(/[｜|]/).map(s=>String(s||'').trim()).filter(Boolean);
    if(parts.length >= 2) res.push({ cat: parts[0], name: parts[1] });
  });
  return res;
}
function harvestCandidates(){
  const o = state.outline; if(!o) return { candidates: [], byChap: {} };
  const g = o.glossary || {};
  const resolved = new Set();
  (g.characters||[]).forEach(x=>resolved.add(String(x&&x.name||'').trim()));
  (g.places||[]).forEach(x=>resolved.add(String(x&&x.name||'').trim()));
  (g.propernouns||[]).forEach(x=>resolved.add(String(x&&x.name||'').trim()));
  const walkonSet = new Set((g.walkons||[]).map(x=>String(x&&x.name||'').trim()).filter(Boolean));
  const agg = new Map(); // name -> {cats, chans}
  (o.chapters||[]).forEach((ch,ci)=>{
    if(!ch || typeof ch.castOut !== 'string' || !String(ch.castOut).trim()) return;
    _parsedCastList(ch.castOut).forEach(it=>{
      if(!it.name || resolved.has(it.name)) return;
      if(!agg.has(it.name)) agg.set(it.name,{ cats:new Set(), chans:new Set() });
      const r = agg.get(it.name); r.chans.add(ci); if(it.cat) r.cats.add(it.cat);
    });
  });
  const candidates = [];
  agg.forEach((rec,name)=>{
    const chans = [...rec.chans].sort((a,b)=>a-b);
    if(chans.length >= 2) candidates.push({ name, cat:[...rec.cats][0]||'人物', chapters:chans, isUpgrade:walkonSet.has(name) });
  });
  agg.forEach((rec,name)=>{
    if(rec.chans.size !== 1) return;
    const ci = rec.chans.values().next().value;
    const body = (o.chapters[ci] && o.chapters[ci].content) || '';
    if(String(body).split(name).length - 1 >= 5 && !candidates.some(c=>c.name===name))
      candidates.push({ name, cat:[...rec.cats][0]||'人物', chapters:[ci], isUpgrade:walkonSet.has(name) });
  });
  candidates.sort((a,b)=>(b.chapters.length - a.chapters.length));
  return { candidates: candidates.slice(0, 20), byChap:{} };
}
function _evidWindow(body, name){
  const src = String(body||''); const idx = src.indexOf(name);
  if(idx < 0) return '';
  const s = Math.max(0, idx-60), e = Math.min(src.length, idx + String(name).length + 60);
  return '…'+src.slice(s,e).replace(/\s+/g,' ').trim()+'…';
}
function buildDictHarvestUser(){
  const o = state.outline; if(!o) return '';
  const { candidates } = harvestCandidates();
  const parts = [];
  if(candidates.length){
    const rows = candidates.map(c=>{
      const chs = c.chapters.slice(0,3).map(ci=>{
        const w = _evidWindow((o.chapters[ci]&&o.chapters[ci].content)||'', c.name);
        return `第${ci+1}章${w?`：${w}`:''}`;
      }).join('；');
      return `· ${c.cat}｜${c.name}｜ 出场 ${c.chapters.length} 章${c.isUpgrade?'（词典已有同名路人，拟升级为主/配角）':''} —— ${chs}`;
    });
    parts.push(`【正文收编候选（跨章≥2 或单章高频出现的新实体，各条附出现片段作判证；请据此收编/别名吸附/剔除一次性路人）】\n${rows.join('\n')}`);
  } else {
    parts.push('【正文收编候选】当前没有达到收编阈值（跨章≥2 或单章高频）的新实体候选。');
  }
  const g = o.glossary || {};
  const vis = [];
  (g.characters||[]).forEach(x=>vis.push(`人物·${String(x&&x.name||'').trim()}${String(x&&x.identity||'').trim()?`（${x.identity.trim()}）`:''}`));
  (g.places||[]).forEach(x=>vis.push(`地名·${String(x&&x.name||'').trim()}`));
  (g.propernouns||[]).forEach(x=>vis.push(`专名·${String(x&&x.name||'').trim()}`));
  (g.walkons||[]).forEach(x=>vis.push(`路人·${String(x&&x.name||'').trim()}`));
  parts.push(`【万物词典（现有，只读参照：不得改动、不得重复新增同名；用于分辨候选是否为已有名的缩略/字号/绰号）】\n${vis.join('\n')||'（无）'}`);
  return parts.join('\n\n');
}
function dictHarvestGate(opts){
  opts = opts || {};
  if(!isLong() || !state.outline || !state.outlineConfirmed){ if(!(opts&&opts.silent)) toast('请先完成 ②生成大纲，再收编正文实体'); return false; }
  if(!(opts && opts.force) && genBusy()){ if(!(opts&&opts.silent)) toast('已有生成任务进行中，请稍候'); return false; }
  if(!harvestCandidates().candidates.length){ if(!(opts&&opts.silent)) toast('暂无达到阈值（跨章≥2 或单章高频）的新实体需要收编'); return false; }
  return true;
}
async function genDictHarvest(btn, opts){
  opts = opts || {};
  const st = $('#dictEnrichStatus'); if(st){ st.className='status'; st.textContent=''; }
  if(!dictHarvestGate(opts)) return false;
  markAIRunning('dictEnrich');
  if(btn) busy(btn,true,'收编中…','de-busy');
  const stopParent = (btn && btn.closest('.de-card')) || (btn && btn.parentNode);
  if(stopParent) showStopBtn(stopParent);
  const stream = $('#dictEnrichStream');
  if(stream){ stream.style.display='block'; stream.textContent='正在扫描正文反复出现实体并收编进词典…'; }
  try{
    const spec = resolveActiveSpec('dictEnrich');
    const temp = (spec && spec.dictEnrichTemp != null) ? spec.dictEnrichTemp : 0.4;
    const user = buildDictHarvestUser();
    const onStream = delta => { if(stream){ stream.textContent += String(delta||''); stream.scrollTop = stream.scrollHeight; } };
    const res = await callAIWithContract(
      callDeepSeek(DICT_HARVEST_SYS, user, { temperature: temp, topP: 0.6, maxTokens: clampMaxTokens('dictEnrich'), onStream, signal:_abortCtl?.signal, taskKey:'dictHarvest' }),
      { needJson:false, taskName:'正文收编' }
    );
    if(!res.ok) throw new Error(res.error || '生成失败');
    const txt = String(res.text || '').trim();
    if(!txt) throw new Error('未返回收编内容');
    const parsed = parseDictEnrichText(txt);
    const n = mergeDictHarvest(parsed);
    state.outline._dictHarvestText = txt;
    persist(); render(); markAIDone('dictEnrich');
    if(stream) stream.style.display='none';
    toast(`正文收编完成：主要人物 ${n.main||0} · 次要配角 ${n.support||0} · 路人 ${n.w} · 地名 ${n.p} · 专名 ${n.k} 已入词典${n.up?`，${n.up} 个路人升级为主/配角`:''}`);
    return true;
  }catch(e){
    if(e && e.name !== 'AbortError') addToFixQueue({ kind:'dictEnrich', error:'正文收编：'+(e&&e.message) });
    if(!(e && e.name === 'AbortError')) toast('正文收编失败：'+(e&&e.message));
    if(st){ st.className='status err'; st.textContent=(e&&e.message)||'失败'; }
    return false;
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='dictEnrich');
    hideStopBtn(); if(btn) busy(btn,false); if(stream) stream.style.display='none';
  }
}
function mergeDictHarvest(res){
  const o = state.outline; if(!o) return { c:0, w:0, p:0, k:0, up:0, main:0, support:0, total:0 };
  if(!o.glossary) o.glossary = { characters:[], places:[], propernouns:[] };
  if(!Array.isArray(o.glossary.walkons)) o.glossary.walkons = [];
  const g = o.glossary;
  const n = { c:0, w:0, p:0, k:0, up:0, main:0, support:0 };
  const have = list => new Set((list||[]).map(x=>String(x&&x.name||'').trim()).filter(Boolean));
  const hi = have(g.characters), hp = have(g.places), hk = have(g.propernouns), hw = have(g.walkons);
  const mark = it => { it._enrich=true; it._srcHow='正文收编'; it._srcTs=Date.now(); };
  (res.characters||[]).forEach(it=>{
    const nm = String(it && it.name || '').trim(); if(!nm || hi.has(nm)) return;
    mark(it); if(it.tier!=='main'&&it.tier!=='support') it.tier='support';
    if(hw.has(nm)){ g.walkons = g.walkons.filter(w=>String(w&&w.name||'').trim()!==nm); hw.delete(nm); n.up++; }
    g.characters.push(it); hi.add(nm); n.c++; if(it.tier==='main') n.main++; else n.support++;
  });
  (res.walkons||[]).forEach(it=>{
    const nm = String(it && it.name || '').trim(); if(!nm || hw.has(nm) || hi.has(nm) || hp.has(nm) || hk.has(nm)) return;
    mark(it); g.walkons.push(it); hw.add(nm); n.w++;
  });
  (res.places||[]).forEach(it=>{
    const nm = String(it && it.name || '').trim(); if(!nm || hp.has(nm) || hi.has(nm)) return;
    mark(it); g.places.push(it); hp.add(nm); n.p++;
  });
  (res.propernouns||[]).forEach(it=>{
    const nm = String(it && it.name || '').trim(); if(!nm || hk.has(nm)) return;
    mark(it); g.propernouns.push(it); hk.add(nm); n.k++;
  });
  n.total = n.c + n.w + n.p + n.k;
  return n;
}
function dictEnrichGate(opts){
  opts = opts || {};
  if(!isLong() || !state.outline){ if(!(opts&&opts.silent)) toast('请先完成 ②生成大纲，再充实词典'); return false; }
  if(state.outline && !state.outlineConfirmed){ state.outlineConfirmed = true; }
  if(!(opts && opts.force) && genBusy()){ if(!(opts&&opts.silent)) toast('已有生成任务进行中，请稍候'); return false; }
  return true;
}
async function genDictEnrich(btn, opts){
  opts = opts || {};
  const st = $('#dictEnrichStatus'); if(st){ st.className='status'; st.textContent=''; }
  if(!dictEnrichGate(opts)) return false;
  markAIRunning('dictEnrich');
  if(btn) busy(btn,true,'充满词典中…', 'de-busy');
  const stopParent = (btn && btn.closest('.de-card')) || (btn && btn.parentNode);
  if(stopParent) showStopBtn(stopParent);
  const stream = $('#dictEnrichStream');
  if(stream){ stream.style.display='block'; stream.textContent='正在生成词典充实内容…'; }
  try{
    const spec = resolveActiveSpec('dictEnrich');
    const temp = (spec && spec.dictEnrichTemp != null) ? spec.dictEnrichTemp : 0.4;
    const user = buildDictEnrichUser();
    const onStream = delta => { if(stream){ stream.textContent += String(delta||''); stream.scrollTop = stream.scrollHeight; } };
    const res = await callAIWithContract(
      callDeepSeek(DICT_ENRICH_SYS, user, { temperature: temp, topP: 0.6, maxTokens: clampMaxTokens('dictEnrich'), onStream, signal:_abortCtl?.signal, taskKey:'dictEnrich' }),
      { needJson:false, taskName:'词典充实' }
    );
    if(!res.ok) throw new Error(res.error || '生成失败');
    const txt = String(res.text || '').trim();
    if(!txt) throw new Error('未返回词典充实内容');
    const parsed = parseDictEnrichText(txt);
    if(!(parsed.characters.length || parsed.walkons.length || parsed.places.length || parsed.propernouns.length)) throw new Error('未识别到有效条目（人物/路人/地名/专名），请重试');
    const n = mergeDictEnrich(parsed);
    state.outline._dictEnrichText = txt;   // 仅存档（导入/导出时仍保留原文兜底），UI 不再直接渲染
    state.outline._dictEnrichSummary = buildDictEnrichSummary(parsed);
    state.dictEnrichCounts = { c:n.c, w:n.w, p:n.p, k:n.k, main:n.main||0, support:n.support||0, ts:Date.now() };
    persist(); render(); markAIDone('dictEnrich');
    if(stream) stream.style.display='none';
    toast(`词典已充实：主要人物 ${n.main||0} · 次要配角 ${n.support||0} · 路人 ${n.w||0} · 地名 ${n.p} · 专名 ${n.k}（已并入万物词典，正文可直接选用）`);
    return true;
  }catch(e){
    if(e && e.name !== 'AbortError') addToFixQueue({ kind:'dictEnrich', error:'词典充实：'+(e&&e.message) });
    if(!(e && e.name === 'AbortError')) toast('词典充实失败：'+(e&&e.message));
    if(st){ st.className='status err'; st.textContent=(e&&e.message)||'失败'; }
    return false;
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='dictEnrich');
    hideStopBtn(); if(btn) busy(btn,false); if(stream) stream.style.display='none';
  }
}
function buildDictEnrichSummary(parsed){
  const pk = x => String((x&&x.name)||'').trim();
  const brief = x => String((x&&x.identity)||(x&&x.relation)||'').trim();
  const wbrief = x => String((x&&x.note)||'').trim();
  return {
    main:    (parsed.characters||[]).filter(c=>c&&c.tier==='main').map(c=>({ name:pk(c), brief:brief(c) })),
    support: (parsed.characters||[]).filter(c=>c&&c.tier==='support').map(c=>({ name:pk(c), brief:brief(c) })),
    walkons: (parsed.walkons||[]).map(w=>({ name:pk(w), brief:wbrief(w) })),
    nPlaces: (parsed.places||[]).length,
    nProps:  (parsed.propernouns||[]).length,
  };
}
function dictEnrichBlockHtml(){
  const o = (state.outline) || {};
  const t = String(o._dictEnrichText || '').trim();
  const sum = o._dictEnrichSummary || null;
  const cnt = state.dictEnrichCounts || null;
  const status = `<p id="dictEnrichStatus" class="status" style="margin:8px 0 0"></p>`;
  const stream = `<pre id="dictEnrichStream" class="cp-stream-preview" style="display:none;white-space:pre-wrap"></pre>`;
  const deCollapsed = !!state.deCollapsed;
  const c = cnt || {};
  const countTxt = t ? [
    c.main>0 ? `主要人物 ${c.main}` : (sum&&sum.main&&sum.main.length ? `主要人物 ${sum.main.length}` : null),
    c.support>0 ? `次要配角 ${c.support}` : (sum&&sum.support&&sum.support.length ? `次要配角 ${sum.support.length}` : null),
    c.w>0 ? `路人 ${c.w}` : (sum&&sum.walkons&&sum.walkons.length ? `路人 ${sum.walkons.length}` : null),
    sum&&sum.nPlaces ? `地名 ${sum.nPlaces}` : (c.p>0 ? `地名 ${c.p}` : null),
    sum&&sum.nProps ? `专名 ${sum.nProps}` : (c.k>0 ? `专名 ${c.k}` : null),
  ].filter(Boolean).join(' · ') : '';
  const foldBtn = `<span class="de-carrow">${deCollapsed?'▸':'▾'}</span>`;
  const g = (o && o.glossary) || {};
  const hue = s=>{ let h=0; for(const ch of String(s||'')) h=(h*31+ch.codePointAt(0))%360; return h; };
  const liveBrief = c => {
    if(!c) return '';
    const parts = [];
    const id = String(c.identity || '').trim();
    if(id && id !== '未知' && id !== '无') parts.push(id);
    const rel = String(c.relation || '').trim();
    if(rel && rel !== '未知' && rel !== '无') parts.push(`关系:${rel}`);
    const tr = String(c.trait || '').trim();
    if(tr && tr !== '未知' && tr !== '无') parts.push(`特征:${tr}`);
    const app = String(c.appearance || '').trim();
    if(app && app !== '未知' && app !== '无') parts.push(app);
    const note = String(c.note || c.desc || '').trim();
    if(note && note !== '未知' && note !== '无') parts.push(note);
    if(!parts.length){
      const more = [c.gender, c.age, c.hobby].map(v=>String(v||'').trim()).filter(v=>v && v!=='未知' && v!=='无');
      if(more.length) parts.push(more.join(' '));
    }
    return parts.join(' · ');
  };
  const liveMain = (g.characters||[]).map((c,i)=>({ ...c, name:String(c&&c.name||'').trim(), brief:liveBrief(c), gsType:'char', gsIdx:i })).filter(c=>c.name && (g.characters[c.gsIdx].tier!=='support'));
  const liveSupport = (g.characters||[]).map((c,i)=>({ ...c, name:String(c&&c.name||'').trim(), brief:liveBrief(c), gsType:'char', gsIdx:i })).filter(c=>c.name && g.characters[c.gsIdx].tier==='support');
  const liveWalkons = (g.walkons||[]).map((w,i)=>{
    const wb = String(w&&w.note||w&&w.identity||'').trim();
    return { ...w, name:String(w&&w.name||'').trim(), brief:(wb && wb!=='未知' && wb!=='无') ? wb : '过场路人', gsType:'walkon', gsIdx:i };
  }).filter(w=>w.name);
  const deCat = (lab, arr, mode)=>{
    const n = (arr && arr.length) ? arr.length : 0;
    const nNew = (arr||[]).filter(x=>x&&x._enrich).length;
    const isCloud = (mode==='cloud');
    const cls = 'de-grid';
    const body = (arr&&arr.length) ? arr.map(it=>{
      const nm = String(it&&it.name||'').trim(); if(!nm) return '';
      const brief = String(it.brief || liveBrief(it) || '').trim() || '（暂无详细简介）';
      const isNew = !!(it && it._enrich);
      const goto = it.gsType ? `data-de-goto="${it.gsType}:${it.gsIdx}"` : '';
      return `<div class="de-item${isNew?' new':''}">
        <button type="button" class="de-chip" style="--h:${hue(nm)}" ${goto} title="点击定位万物词典中的「${esc(nm)}」">${isNew?'✦ ':''}${esc(nm)}</button>
        <span class="de-brief-desc dm-rel-txt" title="${esc(nm+'：'+brief)}">${esc(brief)}</span>
      </div>`;
    }).join('') : '<span class="muted">（暂无）</span>';
    const tag = nNew>0 ? `<b class="de-newb" title="本板块从 词典充实/正文收编 新增并入的条目">+${nNew} 新</b>` : '';
    return `<details class="dm-fold" open><summary>${lab}（${n}）${tag}</summary><div class="${cls}">${body}</div></details>`;
  };
  return `<div class="card dm-card de-card card-theme-enrich">
    <div class="dm-head de-head card-head-bar" role="button" tabindex="0" data-de-toggle title="展开/收起">
      <div class="ch-left">
        <span class="ch-badge ch-badge-enrich">🗂</span>
        <h3 class="ch-title">词典充实 · 设定细化工坊</h3>
        <span class="ch-subtag ch-subtag-enrich">${countTxt?`已并入：${countTxt}`:'感官特征 · 场景禁忌 · 氛围龙套'}</span>
      </div>
      <div class="ch-right">
        ${foldBtn}
      </div>
    </div>
    <div class="de-body"${deCollapsed?' style="display:none"':''}>
      <!-- v1.0.29x：词典充实入口收归「规划师④词典充实」，本卡不再放点击按钮，仅供展示生成内容 -->
      ${stream}
      ${status}
      ${t ? `<div class="dm-tables" style="margin-top:10px">
        ${deCat('👤 主要人物', liveMain, 'grid')}
        ${deCat('🤝 次要配角', liveSupport, 'grid')}
        ${deCat('🚶 路人龙套', liveWalkons, 'grid')}
      </div>` : `<p class="muted" style="margin-top:4px">尚未充实词典。</p>`}
    </div>
  </div>`;
}
function bindDictEnrich(){
  const eb = $('#btnGenDictEnrich'); if(eb) eb.onclick = ()=> genDictEnrich(eb);
  const hb = $('#btnHarvestCast'); if(hb) hb.onclick = ()=> genDictHarvest(hb);
  $$('[data-de-goto]').forEach(b=> b.onclick = e=>{
    e.preventDefault(); e.stopPropagation();
    const [type, idx] = String(b.dataset.deGoto||'').split(':');
    if(!type || !Number.isInteger(+idx)) return;
    state.gsCatFold = state.gsCatFold || {};
    if(type==='char'){ state.gsCatFold.main=false; state.gsCatFold.support=false; } else state.gsCatFold[type]=false;
    persist(); renderGlossaryOnly();
    const box = $(`[data-gs-entry="${type}:${+idx}"]`);
    if(box){ box.classList.add('open'); const ico=box.querySelector('.gs-fold-ico'); if(ico) ico.textContent='▾'; box.scrollIntoView({behavior:'smooth',block:'center'}); box.classList.add('gs-flash'); setTimeout(()=>box.classList.remove('gs-flash'),1600); }
  });
  const dh = $('[data-de-toggle]');
  if(dh){
    const toggleDe = ()=>{
      state.deCollapsed = !state.deCollapsed;
      persist();
      const body = dh.closest('.de-card') && dh.closest('.de-card').querySelector('.de-body');
      if(body) body.style.display = state.deCollapsed ? 'none' : '';
      const arr = dh.querySelector('.de-carrow'); if(arr) arr.textContent = state.deCollapsed ? '▸' : '▾';
    };
    dh.onclick = ()=> toggleDe();
    dh.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleDe(); } };
  }
}

function closeChapterSummaryPanel(){ const p=document.getElementById('chSumPanel'); if(p) p.remove(); }

function densityCheck(body, summary, o, i){
  const g = (o && o.glossary) || {};
  const seed = [];
  (g.characters||[]).forEach(x=>{ if(x&&x.name) seed.push({n:''+x.name,t:'人物'}); });
  (g.places||[]).forEach(x=>{ if(x&&x.name) seed.push({n:''+x.name,t:'地名'}); });
  (g.propernouns||[]).forEach(x=>{ if(x&&x.name) seed.push({n:''+x.name,t:'专名'}); });
  const miss = [], seen = new Set();
  seed.forEach(it=>{
    const nm = it.n.trim(); if(!nm || seen.has(nm)) return; seen.add(nm);
    if(body.indexOf(nm)>=0 && summary.indexOf(nm)<0) miss.push(it);
  });
  return miss;
}

function renderChapterSummaryBody(i, miss){
  const c = state.chapters[i]; if(!c) return;
  const has = c.strip && String(c.strip).trim();
  const box = document.getElementById('chSumBody'); if(!box) return;
  const missHtml = (Array.isArray(miss) && miss.length)
    ? `<p class="strip-warn">⚠️ 密度自检：本段未覆盖「${miss.slice(0,4).map(m=>m.t+'：'+m.n).join('、')}」${miss.length>4?` 等 ${miss.length} 项`:''}，建议<b>重新生成</b>；若持续报警，可将「本章梗概」温度下调到 0.7–0.9 提升忠实度。</p>` : '';
  box.innerHTML = has
    ? `<article class="strip-read"><h3>🏮 速读 · 本章梗概</h3>${esc(String(c.strip).trim())}</article>
       ${missHtml}
       <p class="hint" style="margin:6px 0 0">已生成（把本章正文压缩到约 1/3 的省时读物，只读它也能抓住本章精华不丢信息）。速读偏低保真，可下调「本章梗概」温度至 0.7–0.9 提升忠实度。</p>`
    : `<article class="strip-read"><h3>🏮 速读 · 本章梗概</h3>
        <p class="muted" style="text-indent:0">暂无本章梗概。它是把<b>本章正文压缩到约 1/3</b>的省时读物：没耐心读完全文时，读它即可抓住本章精华、不丢失关键信息。基于本章真实正文生成（&lt;900 字的极短章不作压缩，直接呈现全文）。</p></article>`;
  const g = document.getElementById('chSumGen'); if(g) g.innerHTML = has ? '🔄 重新生成本章梗概' : '✨ 生成本章梗概';
  const c2 = document.getElementById('chSumCopy'); if(c2) c2.style.display = has ? '' : 'none';
}

async function chSumGenerate(i, genBtn){
  const c = state.chapters[i]; if(!c) return;
  const o = state.outline || {};
  const body = String(c.content||'').trim();
  if(!body){ toast('本章尚无正文，请先生成正文再生成本章梗概'); return; }
  const L = body.length;
  if(L < 900){
    c.strip = body;
    if(o.chapters && o.chapters[i]) o.chapters[i].strip = body;
    persist();
    renderChapterSummaryBody(i);
    toast('本章为极短章，已直接采用全文作速读梗概');
    return;
  }
  if(genBtn){ genBtn.disabled = true; busy(genBtn,true,'生成中…'); }
  const title = c.title || ((o.chapters&&o.chapters[i]&&o.chapters[i].title)) || ('第'+(i+1)+'章');
  const target = (L<=1200) ? Math.max(200, Math.round(L/3)) : Math.round(L/3);
  const lo = Math.round(target*0.9), hi = Math.round(target*1.1);
  const sys = getSystemPrompt('strip', { targetZhs: target });
  const user = buildAIPrompt('strip', { idx: i, targetZhs: target });
  try{
    const txt = unwrapAIResult(await callDeepSeek(sys, user, {temperature: resolveActiveSpec().stripTemp, topP: 0.5, signal: _abortCtl?.signal, maxTokens: clampMaxTokens('strip'), taskKey:'strip'}));
    let strip = String(txt||'').trim();
    if(!strip){ toast('未生成到本章梗概'); return; }
    strip = strip.replace(/^```[\s\S]*?\n/, '').replace(/\n```\s*$/,'').trim();   // 去 markdown 代码块围栏
    const _slm = strip.match(/<!--\s*STRIP_LEN:\s*(\d+)\s*-->/);
    const _stripRep = validateStripLen(strip, target);
    if(!_stripRep.ok){
      const _auto = _slm ? +_slm[1] : null;
      console.warn('[梗概] 字数未达标（不阻断）：', _stripRep.len, '目标', target, '区间', _stripRep.lo, '-', _stripRep.hi, _auto!==null ? `（AI 自报 ${_auto}）` : '');
      toast(`⚠️ 梗概 ${_auto!==null?_auto:_stripRep.len} 字，目标区间 ${_stripRep.lo}—${_stripRep.hi} 字`);
    }
    c.strip = strip;
    if(o.chapters && o.chapters[i]) o.chapters[i].strip = strip;
    persist();
    const miss = densityCheck(body, strip, o, i);   // 密度自检
    renderChapterSummaryBody(i, miss);
    if(miss.length){ toast(`⚠️ 密度自检：本段未覆盖 ${miss.slice(0,3).map(m=>m.t+'「'+m.n+'」').join('、')}${miss.length>3?' 等':''}，建议重生成或下调本章梗概温度至 0.7–0.9`); }
    else { toast('本章梗概已生成'); }
  }catch(e){
    if(e.name==='AbortError'){ toast('已停止生成本章梗概'); }
    else { toast('生成本章梗概失败：'+e.message); }
  }finally{
    if(genBtn){ genBtn.disabled = false; busy(genBtn,false); }
  }
}

function openChapterSummaryPanel(i){
  closeChapterSummaryPanel();
  const c = state.chapters[i]; if(!c) return;
  const title = cleanChapterTitle(c.title || ('第'+(i+1)+'章'));
  const has = !!(c.content && String(c.content).trim());
  const ov = document.createElement('div'); ov.id='chSumPanel'; ov.className='gs-overlay';
  ov.innerHTML = `<div class="gs-modal" style="max-width:780px">
    <div class="gs-modal-head"><b>🏮 速读 · 本章梗概 · 第${i+1}章「${esc(title)}」</b>
      <span style="display:flex;gap:6px">
        <button type="button" class="btn small ghost" id="chSumCopy" title="复制本章梗概文本">📋 复制</button>
        <button type="button" class="gs-x" data-chsum-close>✕</button>
      </span></div>
    <div class="cv-body">
      <div id="chSumBody"></div>
      <div class="advice-ai-row" style="margin-top:12px">
        <button type="button" class="ct-rtgen" id="chSumGen" ${has?'':'disabled'}>✨ 生成本章梗概</button>
      </div>
    </div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-chsum-close]').onclick = closeChapterSummaryPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeChapterSummaryPanel(); });
  ov.querySelector('#chSumGen').onclick = ()=> chSumGenerate(i, ov.querySelector('#chSumGen'));
  ov.querySelector('#chSumCopy').onclick = ()=>{ const s=(c.strip||'').trim(); if(s) copyText(s); };
  renderChapterSummaryBody(i);
}

function adherenceHint(a){
  if(a>=100) return '铁律：人名/地名/专名必须逐字沿用，禁止改拼写，仅按新大纲补新角色。';
  if(a>=80)  return '基准：尽量沿用，允许个别因新情节小幅调整。';
  if(a>=60)  return '主要参照：核心角色沿用，地名/专名可按新剧情调整。';
  if(a>=30)  return '灵感来源：可大改人名地名，仅保留题材与语感。';
  return '几乎放弃：仅作背景语感参考，允许完全重新构建设定。';
}
const SEG_MARK_LINE = /^\s*[（(]\s*节拍\s*\d*\s*[：:、.,，．－—-]?\s*[^（）()\r\n]{0,34}?[）)]\s*$/;
const SEG_MARK_HEAD = /^\s*[（(]\s*节拍\s*\d*\s*[：:、.,，．－—-]?\s*[^（）()\r\n]{0,34}?[）)]\s*/;
function stripSegmentMarkers(txt){
  if(!txt) return txt;
  const s = String(txt);
  const lines = s.split(/\r?\n/);
  const out = [];
  let changed = false;
  for(const raw of lines){
    if(SEG_MARK_LINE.test(raw)){ changed = true; continue; }                          // 独立小标行 → 整行删除
    if(SEG_MARK_HEAD.test(raw)){ out.push(raw.replace(SEG_MARK_HEAD,'')); changed = true; continue; }  // 行首内联小标 → 仅去前缀
    out.push(raw);
  }
  if(!changed) return s;
  return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
function splitChapterOutput(txt){
  return { content: stripSegmentMarkers(txt), strip: '' };
}
async function writeOneChapterContent(i, user, onPhase, onStream, styleOverride, signal){
  const mt = chapterMaxTokens();
  onPhase = onPhase || (()=>{});
  onPhase('撰写本章正文…');
  const resumePartial = (state._chapterPartial && state._chapterPartial[i]) || '';
  let txt = '';
  if(resumePartial.length >= 200){
    txt = await continueTruncatedChapter(i, '', resumePartial);
    delete state._chapterPartial[i];
    persist();
  } else {
    let partial = (state._chapterPartial && state._chapterPartial[i]) || '';
    const _onStream = (delta)=>{ partial += delta; state._chapterPartial[i] = partial; if(onStream) onStream(delta); };
    try{
      txt = unwrapAIResult(await callDeepSeek(longChapterSys(styleOverride), user, {maxTokens: mt, onStream: _onStream, temperature: dynamicChapterParams(i).temperature, topP: dynamicChapterParams(i).topP, signal: signal || _abortCtl?.signal, taskKey:'chapter'}));
      delete state._chapterPartial[i];
      persist();
    }catch(e){
      state._chapterPartial[i] = partial;
      persist();
      throw e;
    }
  }
  const sp = splitChapterOutput(txt);
  let content = String(sp.content).replace(/<!--\s*LEN:[\s\S]*?-->/g, '').trim();
  const _cs = splitChapterCastout(content);
  content = _cs.body;
  if(state.chapters && state.chapters[i]){ state.chapters[i].castOut = _cs.castOut; }
  const _o = state.outline;
  if(_o && Array.isArray(_o.chapters) && _o.chapters[i]){ _o.chapters[i].castOut = _cs.castOut; }
  return content;
}
function splitChapterCastout(prose){
  const lines = String(prose||'').split(/\r?\n/);
  const headerRe = /^[ \t]*【\s*本章出场人物\s*】\s*[:：]?\s*([\s\S]*)$/;
  const rawEntityRe = /^[ \t]*(?:(?:人物|地名|专名)[｜|][^\n]{0,160}[｜|]\s*[;；]?\s*)+$/;
  let castOut = '', bodyLines = lines.slice();
  while(bodyLines.length){
    const ln = bodyLines[bodyLines.length-1];
    const m = ln.match(headerRe);
    if(m){ const t=String(m[1]||'').trim(); if(t) castOut=t; bodyLines.pop(); while(bodyLines.length && !String(bodyLines[bodyLines.length-1]).trim()) bodyLines.pop(); continue; }
    if(rawEntityRe.test(ln)){ const t=String(ln).trim(); castOut = castOut ? `${t}；${castOut}` : t; bodyLines.pop(); while(bodyLines.length && !String(bodyLines[bodyLines.length-1]).trim()) bodyLines.pop(); continue; }
    break;
  }
  return { body: bodyLines.join('\n').replace(/\s+$/, '').trim(), castOut };
}
const USER_PRIO_BILL = '\n\n【优先级契约（按维度裁决，禁止把不同维度混成一个选择题）】\n1. 表达层最高权威：用户已选写作风格。它决定怎么写（叙事、对白、语言质感、节奏表现、情绪表达、幽默/悬疑/治愈等表现机制），不得被优化构想或正文模型重新改写。\n2. 剧情层最高权威：本章老师教案。它决定写什么（事件、顺序、转折、出场、时间、承接与收束）；写作风格不得删改教案事件。\n3. 全书一致性权威：万物词典 + 上一章已落地事实 + 校长/老师已裁决的连续性规则。\n4. 人工干预只能在不破坏以上三层的前提下补充；若人工干预与用户风格冲突，保留用户风格；若与老师教案冲突，不得擅改教案核心事件。\n5. 优化构想只是创意建议：仅当校长已判断其与用户风格兼容时才执行；不得在正文阶段自行把优化构想升级成新的风格权威。\n设定词典中有台词/有戏份/反复出现的重要人地专名一致性为不可逾越红线；仅作氛围的临时路人/小地名/小专名（见正文【临时闲人】段）不属红线，可现场点缀、不入词典；上一章全文（如有）为承接类事实的最高权威，任何要求不得使其另起炉灶。';
let _dictRedlineOver = false;
function budgetChapterContext(parts, maxChars){
  const total = () => parts.join('\n\n').length;
  if(total() <= maxChars) return parts;
  const idx = (label) => parts.findIndex(s => s.startsWith(label));
  const l4 = idx('【L4 前文滚动摘要】');
  if(l4 >= 0){
    const head = '【L4 前文滚动摘要】\n';
    const body = parts[l4].slice(head.length).trim();
    parts[l4] = head + body.slice(0, 200) + (body.length > 200 ? '…' : '');
  }
  if(total() <= maxChars) return parts;
  const ref = idx('【小说简介】');
  if(ref >= 0){
    parts[ref] = parts[ref].slice(0, 260) + (parts[ref].length > 260 ? '…' : '');
  }
  if(total() <= maxChars) return parts;
  const bridge = idx('【衔接事实】');
  if(bridge >= 0){
    const head = '【衔接事实】';
    const body = parts[bridge].slice(head.length).trim();
    parts[bridge] = head + body.slice(0, 160) + (body.length > 160 ? '…' : '');
  }
  if(total() <= maxChars) return parts;
  const l1 = idx('【L1 本章节拍');
  if(l1 >= 0){
    const lines = parts[l1].split('\n');
    parts[l1] = lines.map((line, i) => {
      if(i <= 2) return line;   // 标题行与编排开头两句保留完整
      if(line.startsWith(' ')) return line;
      return line.slice(0, Math.min(line.length, 120)) + (line.length > 120 ? '…' : '');
    }).join('\n');
  }
  if(total() > maxChars){ _dictRedlineOver = true; return parts; }
  return parts;
}

function chapterTailExcerpt(i, maxChars=420){
  const prev = i > 0 && state.chapters[i-1] ? String(state.chapters[i-1].content||'') : '';
  const t = (prev||'').trim();
  if(!t) return '';
  if(t.length <= maxChars) return t;
  const paras = t.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const out = []; let acc = 0;
  for(let k=paras.length-1; k>=0 && acc < maxChars; k--){ out.unshift(paras[k]); acc += paras[k].length + 2; }
  let s = out.join('\n\n');
  if(s.length > maxChars){
    const head = out[0];
    const seq = head.match(/[^。！？…]*[。！？…][”"」』]?/g) || [];
    const kept = []; let a2 = 0;
    for(let j=seq.length-1; j>=0 && a2 < maxChars; j--){ kept.unshift(seq[j]); a2 += seq[j].length; }
    if(kept.length){ out[0] = kept.join(''); s = out.join('\n\n'); }
    else s = head.slice(0, maxChars);
  }
  return s;
}
function principalStyleExecutionExcerpt(){
  const pr = (state.school && state.school.principal) || {};
  if(pr.raw){
    const raw = String(pr.raw);
    const a = raw.indexOf('## 风格融合总纲');
    const b = raw.indexOf('## 可执行纪律', a >= 0 ? a : 0);
    if(a >= 0){
      const end = b > a ? b : Math.min(raw.length, a + 9000);
      const sec = raw.slice(a, end).trim();
      if(sec) return sec;
    }
  }
  return '（校长尚未产出新版风格施工层；请严格继承用户当前已选写作风格，不自行引入优化构想风格。）';
}
function principalRulesExcerpt(){
  const pr = (state.school && state.school.principal) || {};
  if(pr.raw){
    const sec = extractSection(pr.raw, '全校写作守则', '各组组级框架') || extractSection(pr.raw, '全校写作守则', '全书章节标题总表') || extractSection(pr.raw, '全校写作守则', '逐章教案');
    if(sec) return sec.trim();
  }
  return scStyleBrief();
}

function buildDynamicProtagonistLedger(i){
  if(i <= 0) return '';
  const o = state.outline || {};
  const digests = Array.isArray(o._chapterDigests) ? o._chapterDigests : [];
  const prevDigest = digests[i-1] && digests[i-1].text ? digests[i-1].text : '';
  const prevChapter = state.chapters && state.chapters[i-1] ? state.chapters[i-1] : null;
  const prevTitle = prevChapter && prevChapter.title ? `第 ${i} 章《${prevChapter.title}》` : `第 ${i} 章`;
  const protagonist = (o.navBeacon && o.navBeacon.protagonist) ? String(o.navBeacon.protagonist).split(/[，,：:（(]/)[0].trim() : '主角';

  const lines = [];
  lines.push(`【动态主角状态与悬念账本（承自 ${prevTitle} 完结时的物理基准）】`);
  lines.push(`- 核心角色锚点：${protagonist}`);
  if(prevDigest){
    lines.push(`- 上一章剧情与状态结算：${prevDigest}`);
  }
  lines.push(`- 物理与心理定格硬性纪律：上一章正文最末段落定格的具体地点、主角身受之伤势/生理状态、当前正在交涉的核心人物与最后一句话、持有的重要道具/线索，属于不可擅改的既成事实。本章第一段须在此物理基准上推进，严禁发生伤势突愈、道具凭空消失或死人复活等逻辑断层！`);
  return lines.join('\n');
}

function principalCausalityExcerpt(){
  const pr = (state.school && state.school.principal) || {};
  if(pr.raw){
    const raw = String(pr.raw);
    const heads = ['## 因果闭环总纲','## 可执行纪律'];
    const a = raw.indexOf(heads[0]);
    if(a >= 0){
      const b = raw.indexOf(heads[1], a + heads[0].length);
      const end = b > a ? b : Math.min(raw.length, a + 9000);
      const sec = raw.slice(a, end).trim();
      if(sec) return sec;
    }
  }
  return '（校长尚未产出新版因果闭环层；正文仍必须执行事件可达性硬规则：重大事件不得凭空发生，必须有前置条件、触发依据、人物行动路径与结果来源。）';
}

function buildChapterUser(i, opt={}){
  const o = state.outline || {};
  const chap = (state.chapters && state.chapters[i]) || {};
  const curN = i + 1;
  const parts = [];
  const _opening = openingStrategyBrief(); if(_opening) parts.push(_opening);
  if(i===0){ const _openingTask = principalOpeningTaskExcerpt() || openingStrategyExecutionCard(0); if(_openingTask) parts.push(_openingTask); }
  const _lesson = teacherChapterPlan(i);
  const _closed = !!_lesson;   // 有本章教案 → 开启三层递进闭环上下文箱

  if(_closed){
    
    const hasT = String(chap.title||'').trim();
    parts.push(`【长篇小说与章节定位】
书名：${o.title || '（未定书名）'}
定位：第 ${curN} 章${hasT ? `《${chap.title}》` : ''}`);

    const pRules = principalRulesExcerpt();
    if(pRules){
      parts.push(`【第一层 · 宏观层（不变 · 校长写作守则与文风人设纪律）】
${pRules}
【守则红线】严格遵守全书统一文风、人物说话口吻与人设底线，严禁行文中人设漂移或出现现代违和口语。`);
    }
    const pStyle = principalStyleExecutionExcerpt();
    if(pStyle){
      parts.push(`【第一层附录 · 已裁决风格施工层（只决定怎么写，不决定写什么）】
${pStyle}
执行原则：这是校长已经完成的风格冲突裁决结果。你不得在正文阶段重新选择‘轻松/悬疑/治愈/冷峻’等风格组合；只需按本章教案把既定风格落到具体场景、对白、叙事、节奏与情绪。`);
    const pCausal = principalCausalityExcerpt();
    parts.push(`【第一层附录 · 因果闭环锁（决定事件能否这样发生）】
${pCausal}
执行原则：本层不改变老师教案规定的核心剧情，但会审查事件发生资格。教案中的结果必须通过已建立的前置状态、线索/信息来源、人物行动、能力/资源与场景触发自然抵达；若教案本身存在因果缺口，正文不得凭空发明关键理由，应优先采用教案允许的铺垫空间补足最小必要中间步骤。`);
    }

    parts.push(`【第二层 · 中观层（静态指导 · 单源真理超级教案）】
说明：这是任课老师为你备下的本章唯一创作航海图（已深度内嵌章节微拍节奏、时间落点与严谨出场名单）。本章剧情推进、骨架环节、情绪弧度、出场人物 100% 以本教案为单一真理（Single Source of Truth），严格按指引逐拍写透写足，严禁自行越权脑补或擅改主线。
——— 本章超级教案开始 ———
${_lesson}
——— 本章超级教案结束 ———`);
    parts.push(`【正文执行锁】风格冲突已在校长层解决、场景化施工已在老师层解决；正文阶段禁止再次进行风格方案选择。你只需把‘本章风格施工指令’稳定落实到教案规定的事件中：同一事件可以换不同文学写法，但不得改变事件本身、不得新增一套风格体系。`);

    const microParts = [];
    if(i > 0){
      const _tail = chapterTailExcerpt(i, 480);
      if(_tail){
        microParts.push(`◆ 上一章末尾 · 物理接力（本章开笔物理现实起点）
这是上一章正文最末真实自然断点文字。本章第一段必须与它"伤口对缝"：
① 物理起点接力：第一段直接从本段收尾处的景象 / 动作 / 未说完的对话 / 人物处境 / 即时情绪自然续写；
② 真实物理基准：段中人物当前处所、悬而未决的对话与最后动作定格，以此文字为准，禁止另起炉灶；
③ 平滑过桥：若本段物理时空与上方教案「剧情时间落点」或骨架第①拍存在跨度，在首段用 1~2 句自然过渡句平滑过桥，随即全面切入教案骨架！
——— 上一章末尾原文 ———
${_tail}
——— 上一章末尾结束 ———`);
      }
      const ledger = buildDynamicProtagonistLedger(i);
      if(ledger) microParts.push(ledger);

      const rolling = buildRollingSummary(i);
      if(rolling) microParts.push(`◆ 前文滚动剧情记忆（防长篇记忆损耗）\n${rolling}`);

      parts.push(`【第三层 · 微观层（动态滚入 · 物理事实与动态状态战报包）】\n${microParts.join('\n\n')}`);
    } else {
      parts.push(`【第三层 · 微观层（首章开篇物理基准）】
本章为全书第 1 章（首章开篇）：无上一章正文。必须优先执行【第一章开篇任务卡】，并让教案骨架第①拍与该卡一致；首段从实际事件/人物现场起笔，迅速建立核心人物、类型信号、可见问题与继续阅读的下一问。禁止用大段背景说明替代开篇策略。`);
    }

    const isLast = (i + 1) >= (o.chapters||[]).length;
    let boundary = hasT
      ? `【本章边界】本章内容须紧扣本章标题与教案展开、不得偏离；已发生的剧情不重复叙述。到达这些要求的路径、细节与文学笔法由你自由发挥。`
      : `【本章边界】本章内容须紧扣教案推进骨架展开、不得偏离；已发生的剧情不重复叙述。到达这些要求的路径、细节与文学笔法由你自由发挥。`;
    if(isLast){
      boundary += `\n【全书收束】本章为全书最后一章：请收束全书主线，交代主要人物归宿与冲突的最终解决，给出确定结局，不留开放式烂尾。`;
    } else {
      const nextC = (o.chapters && o.chapters[i+1]) || null;
      const nt = (nextC && String(nextC.title||'').trim()) || '';
      boundary += `\n【下一章边界】下一章为第 ${i+2} 章${nt?`《${nt}》`:''}。本章严禁提前展开或剧透下一章内容。`;
    }
    parts.push(boundary);

  } else {
    parts.push(`【小说简介】书名：${o.title||''}\n${o.logline||''}`);
    const plan = (Array.isArray(o.chapterPlans) && o.chapterPlans[i]) || null;
    if(plan && String(plan.beatsText||'').trim()){
      const _l1txt = cleanBeatDividerTrailer(plan.beatsText);
      if(_l1txt) parts.push(`【本章节拍编排】\n${_l1txt}\n`);
    }
    if(i > 0){
      const _tail = chapterTailExcerpt(i);
      if(_tail) parts.push(`【上一章末尾】\n${_tail}`);
      const ledger = buildDynamicProtagonistLedger(i);
      if(ledger) parts.push(ledger);
      const rolling = buildRollingSummary(i);
      if(rolling) parts.push(`【前文滚动摘要】\n${rolling}`);
    }
    const hasT = String(chap.title||'').trim();
    parts.push(`【本章任务】第 ${curN} 章${hasT ? `《${chap.title}》` : ''}`);
  }

  parts.push(`【事件可达性硬门】写每个重大事件前，内部快速核对：前置状态是否已成立？触发线索是否存在？人物为什么会采取这一步？信息/道具/能力从哪里来？地点与时间是否可达？本事件是否会让前后因果断裂？若任一关键项缺失，不得用“突然/恰好/偶然”直接补过去。`);
  parts.push(USER_PRIO_BILL);
  if(opt.advice) parts.push(`【人工干预要求（用户指定 · 第二优先）】\n${opt.advice}`);

  const _lb = chapterLenBounds() || {floor:2700, lo:3000, hi:3600};
  const _lo = (_lb.lo>0?Math.round(+_lb.lo):3000), _hi = (_lb.hi>0?Math.round(+_lb.hi):3600);
  const _cap = Math.max(_hi, Math.round(_hi*1.15));
  parts.push(`【篇幅契约 · 覆盖各段事件、整体连续成篇、达标即收束】全章正文字数必须 ≥ ${_lb.floor.toLocaleString()} 字（目标 ${_lo.toLocaleString()}—${_hi.toLocaleString()} 字，硬顶 ${_cap.toLocaleString()} 字，超过即判超长）。
【成篇写法】
1. 骨架里每一段事件都必须写到、不得遗漏，但它们不是互不相干的独立小节，而是本章内按因果连续推进的故事小节：写正文时由上个环节的剧情自然引到下个环节，相邻环节之间必须有自然的衔接与过渡（剧情因果驱动、情绪递进、动作延续，或时间/空间切换的过渡句），只要叙事连续，相邻环节允许融合在同一场景内连续推进，不必每拍单起一段。禁止硬跳切、禁止把某段事件单独拎出来自写自满。
2. 以目标约 ${_lo.toLocaleString()} 字为全章落点，让情节从本章开笔承接点持续推进到章末钩子/收束；正文直接以小说段落呈现，不写任何节拍小标、不做逐拍分段的拼装痕迹。
3. 达标即自然收束：未达 ${_lb.floor.toLocaleString()} 字前不得输出"收束/尾声/结尾/本章完"式结语；一旦全章达到 ${_hi.toLocaleString()} 字左右（上限 ${_cap.toLocaleString()} 字），应立即自然收束本章并交付，不要为了"再多写点"继续追加内容。`);

  _dictRedlineOver = false;
  const _b = budgetChapterContext(parts, 24000);
  if(_dictRedlineOver){ setTimeout(()=>toast('当前上下文超出建议预算，若频繁出现请提高输出上限。'), 0); }
  return _b.join('\n\n');
}

function fullGlossaryChapterBlock(i){
  const o = state.outline;
  const g = (o && o.glossary) || {};
  const chars = Array.isArray(g.characters) ? g.characters : [];
  const places = Array.isArray(g.places) ? g.places : [];
  const props = Array.isArray(g.propernouns) ? g.propernouns : [];
  if(!chars.length && !places.length && !props.length) return '';
  const protagonist = (o && o.navBeacon && o.navBeacon.protagonist) ? String(o.navBeacon.protagonist).split(/[，,：:（(]/)[0].trim() : '';
  const appearing = new Set();
  (relevantGlossaryForChapter(i).characters||[]).forEach(c=>{ const n=String(c&&c.name||'').trim(); if(n) appearing.add(n); });
  if(protagonist) appearing.add(protagonist);
  const lines = [];
  const charLines = chars.map(c=>{
    const n = String(c&&c.name||'').trim(); if(!n) return '';
    if(appearing.has(n)){
      return `\n· ${fmtCharFullFields(c).join('，')}`;
    }
    return `\n· ${n}（${(c&&c.identity)||'人物'}）`;
  }).filter(Boolean);
  if(charLines.length) lines.push(`人物（全量名单；●=主角/本章出场·给全部7字段）：${charLines.join('')}`);
  const placeLines = places.map(p=>{ const n=String(p&&p.name||'').trim(); if(!n) return ''; return `\n· ${n}（${(p&&p.type)||''}）${p&&p.note?`：${p.note}`:''}`; }).filter(Boolean);
  if(placeLines.length) lines.push(`地名（全量）：${placeLines.join('')}`);
  const propLines = props.map(p=>{ const n=String(p&&p.name||'').trim(); if(!n) return ''; return `\n· ${n}${p&&p.note?`：${p.note}`:''}`; }).filter(Boolean);
  if(propLines.length) lines.push(`专名（全量）：${propLines.join('')}`);
  if(Array.isArray(g._worldRules) && g._worldRules.length){
    lines.push(`世界观规则（全量·正文须遵守不违背）：${g._worldRules.map(fmtWR).join('；')}`);
  }
  const wkOnes = (g.walkons||[]).filter(w=>String(w&&w.name||'').trim()).map(w=>`${String(w.name).trim()}${String(w&&w.note||'').trim()?`（${String(w.note).trim()}）`:''}`).join('、');
  if(wkOnes) lines.push(`路人龙套（词典充实闲人，可选用登场：只一句台词/一个镜头即可，无需九维）：${wkOnes}`);
  lines.push(`【临时闲人·小地名·小专名（允许现场点缀，不入词典）】当场景自然地需要店小二、摊贩、车夫、茶客、围观者、更夫、报信者这类只出现这一次、只说一两句或只露一眼的过场闲人，或某个只此一现、日后不再提起的小地名/小专名时，可现场信手自拟一个名字，写一句便止、点到即收：只作氛围点缀，不写主持戏份、不给任何设定交代、更不得写入万物词典。硬约束：①仅限真实"过场/一次性泛称"——凡有台词作用、会再登场、或要推动情节的人地专名，一律回到本词典取用，严禁自立核心名绕开词典；②不得与本词典或上方【路人龙套】已有人名/地名/专名重名；③非机械化——这是剧情的自然点缀，不是每章必须完成的任务，切忌刻意凑数、生硬点名或反复秀存在感，多数章节甚至无需新增。`);
  return '请全程遵循本设定词典（有台词/有戏份或反复出现的人地专名一律取用本词典、保持一致，禁止自造核心名；仅作氛围的临时路人/小地名/小专名允许现场点缀一次、不入词典，见上【临时闲人】段，非机械化凑数；人物关系/性格/地域往来/专名用法与世界规则与此保持统一）：\n' + lines.join('\n');
}

function rollCallGlossary(i){
  const o = state.outline;
  const g = (o && o.glossary) || {};
  const chars = Array.isArray(g.characters) ? g.characters : [];
  const places = Array.isArray(g.places) ? g.places : [];
  const props = Array.isArray(g.propernouns) ? g.propernouns : [];
  if(!chars.length && !places.length && !props.length) return '';
  const lesson = teacherChapterPlan(i);
  const names = new Set();
  let named = false;
  const re = /本章出场名单[：:][^\n]*/;
  if(lesson && re.test(lesson)){
    const seg = lesson.match(re)[0].replace(/^本章出场名单[：:]/, '').trim();
    const namedArr = seg.replace(/[，,、；;。]+/g, '|').split('|').map(s=>s.trim()).filter(s=>s && s.length <= 8);
    if(namedArr.length){
      named = true;
      namedArr.forEach(n=>{
        names.add(n);
        const aliasMap = (typeof glossaryAliases==='function') ? glossaryAliases() : new Map();
        if(aliasMap && aliasMap.size){ aliasMap.forEach((cur, al)=>{ if(String(al)===n) names.add(cur); }); }
      });
    }
  }
  if(o.navBeacon && o.navBeacon.protagonist){
    const name = String(o.navBeacon.protagonist).split(/[，,：:（(]/)[0].trim();
    if(name) names.add(name);
  }
  const matched = new Set();
  chars.forEach(c=>{ const n=String(c&&c.name||'').trim(); if(!n) return; if(names.has(n) || [...names].some(x=>n.includes(x)||x.includes(n))) matched.add(n); });
  if(!named && matched.size===0 && o.navBeacon && o.navBeacon.protagonist){
    const pn = String(o.navBeacon.protagonist).split(/[，,：:（(]/)[0].trim();
    if(pn) matched.add(pn);
  }
  const lines = [];
  if(matched.size || places.length || props.length){
    const charLines = chars.map(c=>{
      const n = String(c&&c.name||'').trim(); if(!n) return '';
      if(matched.has(n)) return `\n· ${fmtCharFullFields(c).join('，')}`;
      return '';
    }).filter(Boolean);
    if(charLines.length) lines.push(`人物（只读本章出场名单档案卡，名单外角色不供给）：${charLines.join('')}`);
    lines.push(`【本章出场名单（老师点名·正文唯一可用人物范围）】${named ? [...names].join('、') : '（教案未点名，以主角为准）'}`);
  }
  if(lines.length){
    return '【闭卷·点名制设定（唯一人物/设定来源，只读）：本章只为「本章出场名单」内的人地专名供给档案卡；名单外任何人/地/专名一律不可写、不可提、不可依靠参照。人物/地名/专名的一致性以此为准，但剧情走向、时间、承接一律以教案为准，设定不决定剧情。】\n' + lines.join('\n');
  }
  return '';
}

function relevantGlossaryForChapter(i){
  const o = state.outline;
  if(!o) return {characters:[], places:[], propernouns:[]};
  if(o._relGlossCache && o._relGlossCache[i] && !o._relGlossCache[i]._stale) return o._relGlossCache[i];
  const g = o.glossary || {};
  const plan = (Array.isArray(o.chapterPlans) && o.chapterPlans[i]) || {};
  const prev = i > 0 ? state.chapters[i-1] : null;
  const keywords = new Set();
  (plan.requiredEntities||[]).forEach(e => keywords.add(String(e).trim()));
  const _aliasMap = glossaryAliases();
  if(_aliasMap.size) _aliasMap.forEach((cur, al) => { if(keywords.has(al)) keywords.add(cur); });
  if(o.navBeacon && o.navBeacon.protagonist){
    const name = String(o.navBeacon.protagonist).split(/[，,：:（(]/)[0].trim();
    if(name) keywords.add(name);
  }
  if(prev && prev.content){
    const fc = o._factCard || {};
    const appeared = fc.characters || {};
    Object.keys(appeared).forEach(name => { if(appeared[name] > 0) keywords.add(name); });
    const tail = String(prev.content).slice(-3000);
    (g.characters||[]).forEach(c => {
      const nm = String(c.name||'').trim();
      if(nm && new RegExp(escapeRegExp(nm)).test(tail)) keywords.add(nm);
    });
  }
  if(!keywords.size){
    const empty = {characters:[], places:[], propernouns:[]};
    o._relGlossCache = o._relGlossCache || {}; o._relGlossCache[i] = empty;
    return empty;
  }
  const kwArr = Array.from(keywords).filter(Boolean).sort((a,b)=>b.length-a.length);
  const kwRe = kwArr.length ? new RegExp(kwArr.map(escapeRegExp).join('|'), 'g') : null;
  const match = (arr) => {
    if(!kwRe) return [];
    return (arr||[]).filter(it => {
      const nm = String(it.name||'').trim();
      if(!nm) return false;
      kwRe.lastIndex = 0;
      if(kwRe.test(nm)) return true;
      const hay = [(it._alias||[]).join(' '), it.identity, it.relation, it.note, it.appearance, it.type].join(' ');
      kwRe.lastIndex = 0;
      return kwRe.test(hay);
    });
  };
  const res = {
    characters: match(g.characters),
    places: match(g.places),
    propernouns: match(g.propernouns)
  };
  o._relGlossCache = o._relGlossCache || {};
  o._relGlossCache[i] = res;
  return res;
}
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function fogWorldInject(i){
  const o = state.outline; if(!o) return '';
  const g = o.glossary || {};
  const seg = [];
  const rg = relevantGlossaryForChapter(i);
  const mk = k => new Set((rg[k]||[]).map(x=>String(x&&x.name||'').trim()).filter(Boolean));
  const chars = mk('characters'), pls = mk('places'), prps = mk('propernouns');
  const rel = (g._relationshipTable||[]).filter(x=> x && (chars.has(x.a)||chars.has(x.b)));
  const pc  = (g._placeContacts||[]).filter(x=> x && (pls.has(x.from)||pls.has(x.to)));
  const prc = (g._properContacts||[]).filter(x=> x && (prps.has(x.from)||prps.has(x.to)));
  let any = false;
  if(rel.length){ seg.push(`【人物关系表·迷雾】（仅本章已出场人物直接相关的关系，正文据此写、未揭示的不得提前写）\n${rel.map(x=>`${x.a} ←${x.relation||'？'}→ ${x.b}${x.note?`（${x.note}）`:''}`).join('\n')}`); any = true; }
  if(pc.length){ seg.push(`【地名关联表·迷雾】（仅本章已出场地点直接相关的关联）\n${pc.map(x=>`${x.from} ↔ ${x.to}${x.relation?`（${x.relation}）`:''}${x.note?`：${x.note}`:''}`).join('\n')}`); any = true; }
  if(prc.length){ seg.push(`【专名关联表·迷雾】（仅本章已出场专名直接相关的关联）\n${prc.map(x=>`${x.from} ↔ ${x.to}${x.relation?`（${x.relation}）`:''}${x.note?`：${x.note}`:''}`).join('\n')}`); any = true; }
  if(any){
    const fogNote = `\n（注：上述关系/关联为「迷雾」版，只列出与本章已出场实体直接相关的部分；未在本章出现或尚未揭示的关系，正文一律不得提前书写、留待后续章节自然展开，以免提前剧透。）`;
    return `${seg.join('\n')}${fogNote}`;
  }
  return '';
}

function fmtCharFullFields(c){
  const segs = [String(c.name||'')];
  if(c.identity && c.identity !== '未知') segs.push('身份:'+c.identity);
  if(c.age && c.age !== '未知') segs.push(String(c.age).replace(/岁$/,'')+'岁');
  if(c.gender && c.gender !== '未知') segs.push(c.gender);
  if(c.appearance && c.appearance !== '未知') segs.push('外貌:'+c.appearance);
  if(c.trait && c.trait !== '未知') segs.push('性格:'+c.trait);
  if(c.hobby && c.hobby !== '未知') segs.push('爱好:'+c.hobby);
  if(c.catchphrase && c.catchphrase !== '未知' && c.catchphrase !== '无') segs.push('口头禅:'+c.catchphrase);
  if(c.relation && c.relation !== '未知') segs.push('关系:'+c.relation);
  return segs;
}
function formatRelevantGlossary(rg){
  const lines = [];
  if(rg.characters && rg.characters.length){
    lines.push('人物：'+rg.characters.map(c=>'（'+fmtCharFullFields(c).join('，')+'）').join(''));
  }
  if(rg.places && rg.places.length) lines.push('地点：'+rg.places.map(p=>`${p.name}${p.note?'（'+p.note+'）':''}`).join('、'));
  if(rg.propernouns && rg.propernouns.length) lines.push('专名：'+rg.propernouns.map(p=>`${p.name}${p.note?'（'+p.note+'）':''}`).join('、'));
  return lines.join('\n');
}


function longestCommonPrefix(a, b){
  let i = 0;
  while(i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  return a.slice(0, i);
}

const ROLLING_SUMMARY_SYS = `你是长篇小说滚动摘要助手。请把以下连续若干章的剧情压缩成一份 300-400 字的摘要，保留：主线推进、关键人物状态变化、情绪转折。不要细节描写，不要环境铺陈。`;

function buildRollingSummary(i){
  if(i <= 0) return '';
  const o = state.outline; if(!o) return '';
  const digests = Array.isArray(o._chapterDigests) ? o._chapterDigests : [];
  const blocks  = Array.isArray(o._rollingSummaries) ? o._rollingSummaries : [];
  const near = [];
  for(let k = i-2; k >= Math.max(0, i-6); k--){
    if(digests[k] && digests[k].text) near.unshift(`第 ${k+1} 章：${digests[k].text}`);
  }
  const mid = [];
  for(let k = i-7; k >= Math.max(0, i-11); k--){
    if(digests[k] && digests[k].text) mid.unshift(`第 ${k+1} 章：${String(digests[k].text).slice(0, 120)}`);
  }
  const far = blocks.filter(s=>{
    const [a,b] = String(s.key||'').split('-').map(Number);
    return Number.isFinite(b) && b < i - 11 && b >= i - 31;
  }).map(s => `第 ${s.key} 章：${s.text}`).join('\n');
  return [
    far ? `【远期摘要（第 1 章起更早章节，5 章块）】\n${far}` : '',
    mid.length ? `【中程记忆 · 十章窗远五章（第 ${Math.max(1, i-10)}~${i-6} 章，简纪要）】\n${mid.join('\n')}` : '',
    near.length ? `【近期记忆 · 五章窗近五章（第 ${Math.max(1, i-5)}~${i-1} 章，细纪要 = 承接重点）】\n${near.join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
}

function invalidateChapterMemory(i){
  const o = state.outline; if(!o) return;
  if(o._rollingSummaries){
    o._rollingSummaries = o._rollingSummaries.filter(s => {
      const [a,b] = String(s.key||'').split('-').map(Number);
      return !(a <= i+1 && b >= i+1);
    });
  }
  if(state._chapterPartial) delete state._chapterPartial[i];
  if(Array.isArray(o._chapterDigests)) delete o._chapterDigests[i];
  if(o._relGlossCache){
    Object.keys(o._relGlossCache).forEach(k => { if(+k >= i) o._relGlossCache[k]._stale = true; });
  }
  persist();
}

const CHAPTER_DIGEST_SYS = `你是长篇小说剧情摘要助手。把这一章压缩成 200-300 字的剧情纪要：本章发生的事件、人物状态变化、新出现的人/物/设定、章节末尾形成的新状态。只记事实，不写景不抒情。不要猜测正文没有出现的事实。`;
async function ensureChapterDigests(onlyIdx){
  const o = state.outline; if(!o) return;
  if(!Array.isArray(o._chapterDigests)) o._chapterDigests = [];
  const written = state.chapters.map((c,i)=> (c && c.content && String(c.content).trim()) ? i : -1).filter(i=>i>=0);
  for(const idx of written){
    if(onlyIdx !== undefined && onlyIdx !== null && idx !== onlyIdx) continue;
    if(o._chapterDigests[idx] && o._chapterDigests[idx].text) continue;
    try{
      const res = await callDeepSeek(CHAPTER_DIGEST_SYS, `第 ${idx+1} 章正文：\n` + String(state.chapters[idx].content||'').slice(0,6000),
        {maxTokens: clampMaxTokens('summary'), temperature: resolveActiveSpec().rollingTemp, topP: 0.5, taskKey:'rolling'});
      o._chapterDigests[idx] = { ts: Date.now(), text: String(res.text||'').trim().slice(0,400) };
      persist();
    }catch(e){ return; }   // 一次失败即退出，下次触发再续
  }
}

async function generateRollingSummaries(){
  ensureChapterDigests().catch(()=>{});
  const o = state.outline;
  if(!o) return;
  if(!o._rollingSummaries) o._rollingSummaries = [];
  const written = state.chapters.map((c,i) => (c && c.content && String(c.content).trim()) ? i : -1).filter(i => i >= 0);
  if(!written.length) return;
  const max = Math.max(...written) + 1;
  for(let end=5; end<=max; end+=5){
    const start = end - 4;
    const key = `${start}-${end}`;
    if(o._rollingSummaries.some(s => s.key === key)) continue;
    const bodies = state.chapters.slice(start-1, end).map(c => c.content).join('\n\n');
    try{
      const res = await callDeepSeek(ROLLING_SUMMARY_SYS, bodies, {maxTokens: clampMaxTokens('summary'), temperature: resolveActiveSpec().rollingTemp, topP: 0.5, taskKey:'rolling'});
      o._rollingSummaries.push({key, text: String(res.text||'').trim().slice(0,500)});
      persist();
    }catch(e){ /* 静默失败 */ }
  }
}
const chState = {};

function adoptChapterPartial(i){
  const p = String((state._chapterPartial||{})[i]||'').trim();
  if(!p){ toast('本章暂无已缓存文本'); return; }
  snapshotChapterVersion(i);
  state.chapters[i].content = p;
  delete state._chapterPartial[i];
  chState[i] = 'done';
  persist(); patchChapter(i);
  toast(`第 ${i+1} 章已采用已生成部分（${countWords(p).total.toLocaleString()} 字）`);
}

function chapterBadgesHtml(i){
  const c = state.chapters[i] || {};
  const hasC = !!(c.content && String(c.content).trim());
  const partial = state._chapterPartial && state._chapterPartial[i];
  const partialW = partial ? countWords(String(partial).trim()).total : 0;
  const parts = [];
  if(chState[i]==='error'){
    parts.push(`<span class="pill tag-warn" data-ch-state>⚠️ 生成失败</span>`);
  } else if(hasC){
    parts.push(`<span class="pill tag-ok" data-ch-state>✓ 已确认</span>`);
  } else {
    parts.push(`<span class="pill tag-warn" data-ch-state>未生成</span>`);
  }
  if(partialW>=50 && chState[i]!=='generating'){
    parts.push(`<button class="btn small primary" data-ne-resume-ch="${i}" title="利用已缓存的 ${partialW.toLocaleString()} 字继续生成">▶️ 继续生成</button>`);
    parts.push(`<button class="btn small ghost" data-ne-partial-adopt="${i}" title="直接把已缓存的 ${partialW.toLocaleString()} 字作为本章正文（不再续写）">⬇ 采用已生成部分</button>`);
  }
  return parts.join('');
}

function patchChapter(i){
  const card = document.querySelector('.ch-card[data-ch-card="'+i+'"]');
  if(!card) return;               // 该章不在当前页渲染范围，跳过 DOM（数据已落库，翻页即见）
  const wc = card.querySelector('[data-wc-ch="'+i+'"]');
  if(wc) wc.innerHTML = wcBadge(state.chapters[i].content, `data-wc-ch="${i}"`);
  const statusWrap = card.querySelector('.ch-status-wrap[data-ch-status="'+i+'"]');
  if(statusWrap) statusWrap.innerHTML = chapterBadgesHtml(i);
  const hasC = !!(state.chapters[i].content && state.chapters[i].content.trim());
  const body = card.querySelector('.ch-body');
  const ta = card.querySelector('textarea[data-ch="'+i+'"]');
  if(ta && !ta.matches(':focus')) ta.value = state.chapters[i].content;
  if(body && body.classList.contains('folded') && hasC){ body.classList.remove('folded'); }
  const ico = card.querySelector('.ch-fold-ico'); if(ico) ico.textContent = (body && body.classList.contains('folded')) ? '▸' : '▾';
  const re = card.querySelector('[data-regen="'+i+'"]');
  if(re){ re.disabled = !!state.generating; }
  const sum = card.querySelector('[data-ch-sum="'+i+'"]');
  if(sum){ sum.disabled = !hasC; }
  const ver = card.querySelector('[data-ver="'+i+'"]');
  if(ver){ ver.textContent = '📚 版本('+chVersions(i).length+')'; }
  const undo = card.querySelector('[data-undo="'+i+'"]');
  if(undo){ undo.style.display = hasEditHistory(i) ? '' : 'none'; }
  if(isLong() && state.chapters[i]){
    const h3 = card.querySelector('.ch-head h3');
    if(h3){
      const c = state.chapters[i];
      const titleTxt = `第${i+1}章 · ${esc(cleanChapterTitle(c.title))}`;
      h3.title = titleTxt;
      let badgeHtml = '';
      if(c._titleByAI){
        badgeHtml = '<i class="tbd-title-tag" style="font-style:normal;font-size:11px;font-weight:400;opacity:.55;margin-left:6px" title="本章标题已由章节正文 AI 定稿">正文定稿</i>';
      } else if(!state.plannerFinalized){
        badgeHtml = '<i class="tbd-title-tag" style="font-style:normal;font-size:11px;font-weight:400;opacity:.55;margin-left:6px" title="标题尚未由全书规划师定稿，当前沿用第二步参考稿">参考稿</i>';
      }
      h3.innerHTML = titleTxt + badgeHtml;
    }
  }
}

function openChapterRegenPanel(i){
  closeChapterRegenPanel();
  const c = state.chapters[i];
  const title = c && c.title ? c.title : ('第'+(i+1)+'章');
  const hist = Array.isArray(c && c.regenHistory) ? c.regenHistory : [];
  const pushRegen = (mode, advice)=>{
    const h = Array.isArray(state.chapters[i].regenHistory) ? state.chapters[i].regenHistory : (state.chapters[i].regenHistory = []);
    h.push({ ts: Date.now(), mode, advice: String(advice||'') });
    if(h.length > 10) h.splice(0, h.length - 10);
    persist();
  };
  const pad = n => n<10?('0'+n):n;
  const histHtml = hist.length ? `
    <div class="rp-hist">
      <div class="rp-hist-title">📜 历史干预（点击回填到上方输入框）</div>
      ${hist.slice().sort((a,b)=>b.ts-a.ts).map(r=>{
        const d = new Date(r.ts);
        const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        const txt = r.advice || '（直接重生成，无干预）';
        return `<div class="rp-hist-item" data-rp-fill="${esc(txt)}" title="${esc(txt)}">
          <span class="rp-hist-ts">${t}</span>
          <span class="rp-hist-txt">${esc(txt)}</span>
        </div>`;
      }).join('')}
    </div>` : '';
  const rpOv = { on:false, tags:[] };
  const rpCmpB = { tags:[] };
  let rpOvApplied = null;     // 覆盖块「应用」确认快照 {on,tags}；null=未确认（未点应用则重生成不生效）
  let rpCmpBApplied = null;   // 对比块「应用」确认快照 {tags}；null=未确认（未点应用则 B 稿不生效）
  const ov = document.createElement('div');
  ov.id = 'regenPanel'; ov.className = 'gs-overlay';
  ov.setAttribute('data-cs', wsColorSchemeId());
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🔄 重生成 · 第${i+1}章「${esc(cleanChapterTitle(title))}」</b>
        <button class="gs-x" data-rp-close>✕</button></div>
      <div class="gs-actions rp-top-actions">
        <button class="btn" data-rp-plain>直接重生成（无干预）</button>
        <button class="btn primary" data-rp-with>💡 带我的建议重生成</button>
      </div>
      <div class="gs-body">
        <textarea id="rpAdvice" class="rp-advice" placeholder="可选：写具体要求（如压缩到1500字、女主性格外放、增加与上章衔接…）；留空则直接点评本章正文"></textarea>
        <div class="advice-ai-row">
          <button type="button" class="btn small ghost" data-advice-ai="${i}">✨ 正文优化建议</button>
          <button type="button" class="ai-upload-btn ai-hist-btn" data-advadv-hist="${i}" title="章节内容 AI 建议历史：回看已生成过的建议（随项目保存）">📖<span class="ai-hist-badge">${Array.isArray(state.contentAdviceHist)?state.contentAdviceHist.length:''}</span></button>
          <span class="muted" style="font-size:11px">AI 审读本章全文、上一章全文、下一章标题与万物词典给 1–3 条点评建议；点击即回填，可再手改</span>
        </div>
        <div data-advice-ai-out></div>
        ${histHtml}
        <div class="rp-style">
          <div class="rp-style-head" data-rpov-fold role="button" tabindex="0">
            <span>🎨 本章风格覆盖 <span class="rp-style-arrow">▸</span></span>
            <span class="muted" style="font-size:11px;font-weight:400">默认跟随全书 · 一次性不保存</span>
          </div>
          <div class="rp-style-body hidden">
           <div class="rp-ov-toggle" data-rpov-toggle>
  <span class="rp-ov-opt active" data-rpov-val="off">📖 全文</span>
  <span class="rp-ov-opt" data-rpov-val="on">🎨 仅本章</span>
</div>
            <div class="rp-style-sub hidden" id="rpOvBox">
              <div class="rp-style-label">覆盖风格（语气单选 · 质感/元素多选）</div>
              ${writeStyleChipsHtml(rpOv, 'rpov')}
              <div class="rp-apply-row">
                <button type="button" class="btn small primary" data-rpov-apply disabled title="确认本次覆盖风格，重生成时方才生效">✔ 应用</button>
                <span class="rp-apply-status" id="rpOvStatus">⚠️ 待应用</span>
              </div>
            </div>
          </div>
        </div>
        <div class="rp-style disabled" data-rpcmp-box>
          <div class="rp-style-head" data-rpcmp-fold role="button" tabindex="0">
            <span>⚡ 双风格对比生成 <span class="rp-style-arrow">▸</span></span>
            <span class="muted" style="font-size:11px;font-weight:400">需先开启上方本章覆盖</span>
          </div>
          <div class="rp-style-body hidden">
            <p class="rp-cmp-lock-hint">🔒 未开启「仅本章覆盖」时不可用；先在上一区选择「仅本章覆盖」以解锁。</p>
            <p class="muted" style="font-size:12px;margin:4px 0 8px">A 稿 = 本章覆盖风格；B 稿 = 下方所选（留空 = 无风格直白版）。</p>
            <div class="rp-style-label">B 稿对比风格</div>
            ${writeStyleChipsHtml(rpCmpB, 'rpcmp')}
            <div class="rp-apply-row">
              <button type="button" class="btn small primary" data-rpcmp-apply disabled title="确认 B 稿对比风格，再点上方按钮生成两稿">✔ 应用</button>
              <span class="rp-apply-status" id="rpCmpStatus">⚠️ 待应用 B 稿</span>
            </div>
            <button class="btn blue" data-rp-compare>⚡ 生成 A/B 两稿并对比</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-rp-close]').onclick = closeChapterRegenPanelAll;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeChapterRegenPanelAll(); });
  const rpCmpBox = ov.querySelector('[data-rpcmp-box]');
  const refreshRpCmpState = ()=>{
    if(!rpCmpBox) return;
    const locked = !rpOv.on;
    rpCmpBox.classList.toggle('disabled', locked);
    const hint = rpCmpBox.querySelector('.rp-cmp-lock-hint');
    if(hint) hint.style.display = locked ? 'block' : 'none';
    const head = rpCmpBox.querySelector('.rp-style-head .muted');
    if(head) head.textContent = locked ? '需先开启上方本章覆盖' : '两次调用 · 左右对照选稿';
  };
  const foldOv = ov.querySelector('[data-rpov-fold]');
  if(foldOv) foldOv.onclick = ()=>{
    const body = ov.querySelector('.rp-style-body'); if(!body) return;
    const on = body.classList.toggle('hidden');
    const arrow = foldOv.querySelector('.rp-style-arrow'); if(arrow) arrow.textContent = on?'▸':'▾';
  };
  const foldCmp = ov.querySelector('[data-rpcmp-fold]');
  if(foldCmp) foldCmp.onclick = ()=>{
    const body = foldCmp.closest('.rp-style').querySelector('.rp-style-body'); if(!body) return;
    const on = body.classList.toggle('hidden');
    const arrow = foldCmp.querySelector('.rp-style-arrow'); if(arrow) arrow.textContent = on?'▸':'▾';
  };
  ov.querySelectorAll('.rp-style-body').forEach(b=> b.classList.add('hidden'));
  ov.querySelectorAll('.rp-style-arrow').forEach(a=> a.textContent = '▸');
  function refreshRpOvApply(){
    const ap = ov.querySelector('[data-rpov-apply]'); const st = ov.querySelector('#rpOvStatus');
    if(!ap) return;
    ap.disabled = !rpOv.on; ap.classList.toggle('disabled', !rpOv.on);
   if(st){ st.textContent = rpOvApplied ? '✔ 已确认' : (rpOv.on ? '⚠️ 待应用' : '全文，无需应用'); st.classList.toggle('ok', !!rpOvApplied); }
  }
  function refreshRpCmpApply(){
    const ap = ov.querySelector('[data-rpcmp-apply]'); const st = ov.querySelector('#rpCmpStatus');
    if(!ap) return;
    const locked = !rpOv.on;
    ap.disabled = locked; ap.classList.toggle('disabled', locked);
    if(st){ st.textContent = rpCmpBApplied ? '✔ 已确认 B 稿' : (locked ? '需先开启本章覆盖' : '⚠️ 待应用 B 稿'); st.classList.toggle('ok', !!rpCmpBApplied); }
  }
  const rpovApplyBtn = ov.querySelector('[data-rpov-apply]');
  if(rpovApplyBtn) rpovApplyBtn.onclick = ()=>{
    if(!rpOv.on) return;
    rpOvApplied = { on:true, tags: rpOv.tags.slice() };
    refreshRpOvApply();
    toast('本章风格覆盖已应用，重生成时生效（仅本次）');
  };
  const rpcmpApplyBtn = ov.querySelector('[data-rpcmp-apply]');
  if(rpcmpApplyBtn) rpcmpApplyBtn.onclick = ()=>{
    if(!rpOv.on) return;
    rpCmpBApplied = { tags: rpCmpB.tags.slice() };
    refreshRpCmpApply();
    toast('B 稿对比风格已应用，生成 A/B 两稿时生效');
  };
  ov.querySelectorAll('[data-rpov-val]').forEach(el=> el.onclick = ()=>{
  ov.querySelectorAll('[data-rpov-val]').forEach(x=> x.classList.remove('active'));
  el.classList.add('active');
  rpOv.on = el.dataset.rpovVal === 'on';
  rpOvApplied = null;
  const box = ov.querySelector('#rpOvBox'); if(box) box.classList.toggle('hidden', !rpOv.on);
  refreshRpCmpState();
  refreshRpOvApply(); refreshRpCmpApply();
});

  ov.querySelectorAll('[data-rpov-tag]').forEach(b=> b.onclick = ()=>{ toggleWriteTag(rpOv, b.dataset.rpovTag); ov.querySelectorAll('[data-rpov-tag]').forEach(x=> x.classList.toggle('on', rpOv.tags.includes(x.dataset.rpovTag))); rpOvApplied = null; refreshRpOvApply(); });
  ov.querySelectorAll('[data-rpcmp-tag]').forEach(b=> b.onclick = ()=>{ toggleWriteTag(rpCmpB, b.dataset.rpcmpTag); ov.querySelectorAll('[data-rpcmp-tag]').forEach(x=> x.classList.toggle('on', rpCmpB.tags.includes(x.dataset.rpcmpTag))); rpCmpBApplied = null; refreshRpCmpApply(); });
  ov.querySelector('[data-rp-plain]').onclick = ()=>{
    const btn = document.querySelector('[data-regen="'+i+'"]');
    closeChapterRegenPanel();
    pushRegen('plain','');
    const ovr = rpOvApplied ? { styleOverride: { tags: rpOvApplied.tags.slice() } } : {};
    if(rpOv.on && !rpOvApplied) toast('已按全书风格重生成（未点「✔ 应用」的覆盖不生效）');
    genOneChapter(i, btn, ovr);
  };
  ov.querySelector('[data-rp-with]').onclick = ()=>{
    const advice = $('#rpAdvice').value.trim();
    const btn = document.querySelector('[data-regen="'+i+'"]');
    closeChapterRegenPanel();
    pushRegen('advice', advice);
    const ovr = rpOvApplied ? { advice, styleOverride: { tags: rpOvApplied.tags.slice() } } : { advice };
    if(rpOv.on && !rpOvApplied) toast('已按全书风格重生成（未点「✔ 应用」的覆盖不生效）');
    genOneChapter(i, btn, ovr);
  };
  ov.querySelector('[data-rp-compare]').onclick = ()=>{
    if(!rpOvApplied){ toast('请先在「🎨 本章风格覆盖」点「✔ 应用」确认 A 稿风格'); return; }
    if(!rpCmpBApplied){ toast('请先在「⚡ 双风格对比」点「✔ 应用」确认 B 稿风格'); return; }
    const btn = document.querySelector('[data-regen="'+i+'"]');
    const styleA = { tags: rpOvApplied.tags.slice() };
    closeChapterRegenPanel();
    genChapterCompare(i, styleA, { tags: rpCmpBApplied.tags.slice() });
  };
  refreshRpCmpState();
  ov.querySelectorAll('[data-rp-fill]').forEach(el=>{
    el.onclick = ()=>{
      const ta = $('#rpAdvice'); if(ta) ta.value = el.dataset.rpFill;
      el.classList.add('rp-fill-on');
      ta && ta.focus();
    };
  });
  const ta = $('#rpAdvice'); if(ta) ta.focus();
  const aiBtn = ov.querySelector('[data-advice-ai]');
  if(aiBtn) aiBtn.onclick = ()=>{ aiRefineAdvice(i); };
  const advH = ov.querySelector('[data-advadv-hist]');
  if(advH) advH.onclick = ()=> openAdvHistPanel('content');
  ov.addEventListener('click', e=>{
    const t = e.target.closest('[data-advice-ai-pick]'); if(!t) return;
    const j = +t.dataset.adviceAiPick;
    const a = Array.isArray(aiAdviceCand) ? aiAdviceCand[j] : null; if(!a) return;
    const ta2 = $('#rpAdvice'); if(ta2){ ta2.value = a.text || ''; ta2.focus(); }
    ov.querySelectorAll('[data-advice-ai-pick]').forEach((el,k)=> el.classList.toggle('on', k===j));
  });
}
function closeChapterRegenPanel(){ const p=$('#regenPanel'); if(p) p.remove(); }

let aiAdviceCand = null;   // {title,text}[] 候选，模块级；关闭弹窗不保留（closeChapterRegenPanel 会一并清）
function closeChapterRegenPanelAll(){ closeChapterRegenPanel(); aiAdviceCand = null; }
function buildAiRefineCtx(i){
  const o = state.outline || {};
  const chap = state.chapters[i] || {};
  const prev = i>0 ? (state.chapters[i-1]||{}) : null;
  const st = curWriteStyle();
  const chapNames = (Array.isArray(st.tags)?st.tags:[]).map(id=>{ const s=writeStyleById(id); return s&&s.group==='element'?s.name:null; }).filter(Boolean).join('、');
  const g = (o && o.glossary) || {};
  const dictChars = (g.characters||[]).map(c=>{
    const parts=[];
    if(c.identity) parts.push('身份:'+c.identity);
    if(c.age) parts.push('年龄:'+c.age);
    if(c.gender) parts.push('性别:'+c.gender);
    if(c.appearance) parts.push('外貌:'+c.appearance);
    if(c.hobby) parts.push('爱好:'+c.hobby);
    if(c.catchphrase && c.catchphrase !== '无') parts.push('口头禅:'+c.catchphrase);
    if(c.relation) parts.push('关系:'+c.relation);
    if(c.trait) parts.push('性格:'+c.trait);
    return (c.name||'')+(parts.length?'（'+parts.join('；')+'）':'');
  }).join('；');
  const dictPlaces = (g.places||[]).map(p=>`${p.name||''}${p.note?`（${p.note}）`:''}`).join('；');
  const dictProps  = (g.propernouns||[]).map(p=>`${p.name||''}${p.note?`（${p.note}）`:''}`).join('；');
  return {
    书名: (o.title||''), 简介: (o.logline||''),
    本章标题: (chap.title||('第'+(i+1)+'章')),
    本章全文: (chap.content||''),   // 续写/扩写需全文，原样提供
    上一章标题: prev ? (prev.title||('第'+i+'章')) : '',
    上一章全文: (prev && prev.content) ? String(prev.content) : '',   // 上一章全文全量
    下一章标题: (o.chapters[i+1]&&o.chapters[i+1].title)||'',
    万物词典: `人物：${dictChars||'（无）'}\n地点：${dictPlaces||'（无）'}\n专名：${dictProps||'（无）'}`,
    当前写作风格: chapNames || '无'
  };
}
function aiRefineAdvicePrompt(ctx, raw){
  const _raw = String(raw||'').trim();
  return { system:[
    '你是资深网文长篇编辑。用户在建议框里可能写了一段补充要求（续写、扩写、改段落、修正称呼错别字等），也可能留空、只是想听你对本章正文的专业点评。',
    '请审读给出的【本章全文】【万物词典】【上下文】，输出 1–3 条建议（至少 1 条、最多 3 条）；每条 = { title(一句话定位本条侧重), text(完整点评 + 可直接下发给章节生成 AI 的可执行命令) }。',
    '【允许"无建议"】若本章已写得很稳、没有真正值得动的地方，就只返回 1 条：{"title":"无建议","text":"本章整体稳定，暂不建议改动。"}——宁缺毋滥，绝不为了凑满条数硬找问题或胡说八道。',
    '【点评要点】节奏是否拖沓或太赶、对白是否有辨识度与推进力、悬念与留白是否给足、人物言行是否与万物词典中的身份/性格/关系一致（有无OOC）、是否承接上一章结尾、是否为下一章（'+ (ctx.下一章标题||'') +'）留好引子、与万物词典命名/设定是否冲突。',
    '【有补充要求时】先满足用户要求（'+ (_raw? _raw.slice(0,120)+'…' : '（用户未给出方向）') +'）的角度，再在该方向之外综合点评；要求为空时直接审读本章正文点评。',
    '【可执行】text 用对章节 AI 说的祈使句，明确范围与幅度，可行时用换行拆 2–3 个可独立启用的子要点；续写/扩写必须承接本章与上一章结尾、不越界到下一章；不臆造万物词典外的新名。',
    '输出仅一个 JSON 数组（1–3 项），无任何讲解、无 markdown 代码块前后缀。每项结构：{ "title":"一句话说明本条侧重什么", "text":"完整点评+可执行命令" }'
    ].join('\n'),
    user: JSON.stringify({ 上下文: ctx, 用户原始要求: (_raw||'(无)') }, null, 1) };
}
async function aiRefineAdvice(i){
  const ta = $('#rpAdvice'); if(!ta) return;
  const raw = ta.value.trim();   // 可空：无补充要求也能生成点评
  const out = $('[data-advice-ai-out]');
  if(out) out.innerHTML = `<p class="muted" style="margin:6px 0 0">⏳ AI 正审读本章正文并给出优化建议…</p>`;
  const btn = $('[data-advice-ai]'); if(btn){ btn.disabled = true; btn.textContent = '生成中…'; }
  try{
    const ctx = buildAiRefineCtx(i);
    const {system, user} = aiRefineAdvicePrompt(ctx, raw);
    const res = unwrapAIResult(await callDeepSeek(system, user, {temperature:resolveActiveSpec().contentAdviseTemp, topP:0.5, maxTokens:clampMaxTokens('json'), taskKey:'contentAdvice'}));
    const list = parseAiJsonList(res);
    const ls = Array.isArray(list) ? list.filter(x=> x && String(x.text||'').trim()) : [];
    if(!ls.length) throw new Error('AI 未返回有效建议，请重试');
    if(ls.length===1 && /无建议/.test(String(ls[0].title||'')+' '+String(ls[0].text||''))){
      aiAdviceCand = null;
      if(out) out.innerHTML = `<p class="muted" style="margin:6px 0 0">💡 ${esc(String(ls[0].text||'本次无建议，正文暂无需改动。').trim())}</p>`;
      if(btn){ btn.disabled = false; btn.textContent = '✨ 正文优化建议'; }
      return;
    }
    aiAdviceCand = ls.slice(0,3);
    const _ch = state.chapters[i] || {};
    addAdvHist('content', { id: aiHistEntryId(), ts: Date.now(), desc: '正文优化建议 · 第'+(i+1)+'章', list: JSON.parse(JSON.stringify(ls.slice(0,3))) });
    refreshAdvHistBadge('content');
  }catch(e){
    aiAdviceCand = null;
    if(out) out.innerHTML = `<p class="muted" style="color:var(--danger);margin:6px 0 0">⚠️ ${esc((e&&e.message)||'生成失败')}</p>`;
  }
  if(out) out.innerHTML = aiAdviceResultHtml();
  if(btn){ btn.disabled = false; btn.textContent = '✨ 正文优化建议'; }
}
function aiAdviceResultHtml(){
  if(!Array.isArray(aiAdviceCand) || !aiAdviceCand.length) return '';
  return aiAdviceCand.map((a,ai)=>`
    <div class="advice-ai-cand" data-advice-ai-pick="${ai}">
      <div class="advice-ai-head">
        <span class="advice-ai-idx">${'①②③'[ai]||(ai+1)}</span>
        <b>${esc(a.title||('方案'+(ai+1)))}</b>
        <button type="button" class="advice-ai-use">✔ 采用</button>
      </div>
      <p>${esc(a.text||'')}</p>
    </div>`).join('');
}

async function genChapterCompare(i, styleA, styleB){
  const c = state.chapters[i]; if(!c) return;
  const btn = document.querySelector('[data-regen="'+i+'"]');
  chState[i] = 'generating'; state.generating = true; patchChapter(i);
  if(btn) busy(btn,true,'对比生成中…');
  const st = $('#chStatus');
  const setPhase = m => { if(st){ st.className='status'; st.textContent = `第 ${i+1}/${state.chapters.length} 章：${m||''}`; } };
  try{
    const user = buildChapterUser(i, {regenerating:true});
    setPhase('生成 A 稿（当前风格）…');
    const txtA = await writeOneChapterContent(i, user, setPhase, null, styleA);
    setPhase('生成 B 稿（对比风格）…');
    const txtB = await writeOneChapterContent(i, user, setPhase, null, styleB);
    chState[i] = 'done';
    openComparePanel(i, txtA, txtB);
    if(st){ st.className='status ok'; st.textContent = `第 ${i+1} 章双风格对比稿已生成，请在弹窗中选择采用。`; }
    toast('两稿已生成，请选择采用');
  }catch(e){
    chState[i] = 'error'; patchChapter(i);
    if(st){ st.className='status err'; st.textContent = '对比生成失败：'+e.message; }
    toast('对比生成失败：'+e.message);
  }finally{
    state.generating = false;
    if(btn) busy(btn,false);
    patchChapter(i);
  }
}
function openComparePanel(i, a, b){
  closeComparePanel();
  const c = state.chapters[i];
  const title = c && c.title ? c.title : ('第'+(i+1)+'章');
  const ov = document.createElement('div'); ov.id='cmpPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>⚡ 双风格对比 · 第${i+1}章「${esc(cleanChapterTitle(title))}」</b>
        <button class="gs-x" data-cmp-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-div">A 稿 = 当前生效风格；B 稿 = 对比风格。采用后，未采用稿会连同旧正文一起存入版本历史（📚 版本 可回退）。</div>
        <div class="qc-pair">
          <div class="qc-side"><div class="qc-side-t">A 稿 · 当前生效风格（${countWords(a).total} 字）</div><div class="qc-pre cmp-pre">${esc(a)}</div></div>
          <div class="qc-side"><div class="qc-side-t">B 稿 · 对比风格（${countWords(b).total} 字）</div><div class="qc-pre cmp-pre">${esc(b)}</div></div>
        </div>
        <div class="gs-actions" style="margin-top:10px">
          <button class="btn primary" data-cmp-use="a">✔ 采用 A 稿</button>
          <button class="btn primary" data-cmp-use="b">✔ 采用 B 稿</button>
          <button class="btn" data-cmp-close>暂不采用（两稿都存历史）</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('[data-cmp-close]').forEach(b=> b.onclick = closeComparePanel);
  ov.addEventListener('click', e=>{ if(e.target===ov) closeComparePanel(); });
  ov.addEventListener('click', e=>{
    const u = e.target.closest('[data-cmp-use]'); if(!u) return;
    const isA = u.dataset.cmpUse === 'a';
    const pick = isA ? a : b;
    const other = isA ? b : a;
    snapshotChapterVersion(i);                    // 旧正文入历史
    const ch = ensureChapterHistory(i);
    ch.content = pick;
    if(other && String(other).trim()) ch.history.push({ content: other, ts: Date.now() });   // 未采用稿也入历史备查
    if(ch.history.length > 50) ch.history.splice(0, ch.history.length - 50);
    updateFactCardFromChapter(i, pick);
    persist(); closeComparePanel(); renderChapters(); updateWcTotal();
    toast('已采用 '+(isA?'A':'B')+' 稿');
  });
}
function closeComparePanel(){ const p=$('#cmpPanel'); if(p) p.remove(); }

async function genOneChapter(i, btn, opt={}){
  chState[i] = 'generating'; state.generating = true; patchChapter(i);
  if(btn) busy(btn,true,'生成中…');
  const stopParent = btn && btn.closest('.btn-row') ? btn.closest('.btn-row') : null;
  if(stopParent){
    if(!_abortBtn){ _abortBtn = makeStopBtn(); document.body.appendChild(_abortBtn); }
    _abortCtl = new AbortController();
    _abortBtn.style.display = '';
    const readBtn = stopParent.querySelector(`[data-read="${i}"]`);
    if(readBtn && readBtn.nextSibling){
      stopParent.insertBefore(_abortBtn, readBtn.nextSibling);
    } else {
      stopParent.appendChild(_abortBtn);
    }
  }
  const st = $('#chStatus');
  const setPhase = msg => { if(st){ st.className='status'; st.textContent = `第 ${i+1}/${state.chapters.length} 章：${msg||''}`; } };
  setPhase('准备中…');
  if(i > 0){
    try{
      setPhase('核对上一章摘要…');
      await ensureChapterDigests(i - 1);
    }catch(e){ /* 同步失败不阻断生成，既有兜底通道（尾段原文/批尾补算）接管 */ }
  }
  let _fullContent = '';
  try{
    const user = buildChapterUser(i, {regenerating:true, advice:opt.advice, styleOverride: opt.styleOverride});
    const stStream = $('#chStatus');
    let _s = 0;
    const onStream = currentIsDeepSeek() ? (delta => {
      const d = String(delta||'');
      _s += d.length; _fullContent += d;
      if(stStream){ stStream.className='status'; stStream.textContent = `第 ${i+1}/${state.chapters.length} 章：撰写中 · 已生成 ${_s} 字`; }
      const ta = document.querySelector(`textarea[data-ch="${i}"]`);
      if(ta){ ta.value = _fullContent; ta.scrollTop = ta.scrollHeight; }
      patchChapter(i);
    }) : null;
    const txt = await writeOneChapterContent(i, user, setPhase, onStream, opt.styleOverride);   // 各阶段经 setPhase 上报，正文流式实时字数经 onStream；v2.0 支持本章风格覆盖
    snapshotChapterVersion(i);
    state.chapters[i].content = txt;
    updateFactCardFromChapter(i, txt);
    invalidateChapterMemory(i);
    chState[i] = 'done';
    if(!isLong()) state.chapters[i].confirmed = false;
    persist();                       // 不整页 render，仅定点刷新
    patchChapter(i);
    if(st){ st.className='status ok'; st.textContent = `第 ${i+1} 章已生成。`; }
    toast('第'+(i+1)+'章完成');
    generateRollingSummaries().catch(()=>{});
  }catch(e){
    if(e.name==='AbortError'){ if(st) st.textContent = '第'+(i+1)+'章已停止生成'; }
    else { chState[i] = 'error'; patchChapter(i); if(st){ st.className='status err'; st.textContent = '第'+(i+1)+'章生成失败：'+e.message; } toast('第'+(i+1)+'章生成失败：'+e.message); }
  }
  finally{ hideStopBtn(); state.generating = false; if(btn) busy(btn,false); patchChapter(i); autoUpdateSubplots(); autoUpdateTimeAnchors(); }
}

async function genTwoChapters(pairStart){
  for(let k=0;k<2;k++){
    const idx = pairStart + k;
    let _s2 = 0; let _full2 = '';
    const onStream = currentIsDeepSeek() ? (delta => {
      const d = String(delta||'');
      _s2 += d.length; _full2 += d;
      state._chapterPartial[idx] = _full2;
      const ta = document.querySelector(`textarea[data-ch="${idx}"]`);
      if(ta){ ta.value = _full2; ta.scrollTop = ta.scrollHeight; }
      patchChapter(idx);
    }) : null;
    const txt = await writeOneChapterContent(idx, buildChapterUser(idx), null, onStream);
    snapshotChapterVersion(idx);
    state.chapters[idx].content = txt;
    invalidateChapterMemory(idx);
  }
  generateRollingSummaries().catch(()=>{});
}

async function genNChapters(start, n){
  if(n <= 0) return;
  markAIRunning('chapter');
  try{
  for(let k=0; k<n; k++){
    const idx = start + k;
    if(!isLong() && state.chapters[idx] && state.chapters[idx].content && String(state.chapters[idx].content).trim() && state.chapters[idx].confirmed) continue;
    let attempt = 0;
    let txt = '', finishReason = '';
    const resumePartial = (state._chapterPartial && state._chapterPartial[idx]) || '';
    if(resumePartial.length >= 200){
      try{
        txt = await continueTruncatedChapter(idx, '', resumePartial);
        delete state._chapterPartial[idx];
        finishReason = 'stop';
      }catch(e){ /* 续写失败则走正常流程 */ }
    }
    while(attempt < 2){
      attempt++;
      try{
        if(!(resumePartial.length >= 200 && txt && finishReason === 'stop')){
          let _fullN = '', _finishReason = '';
          const onStream = currentIsDeepSeek() ? (delta => {
            const d = String(delta||''); _fullN += d;
            state._chapterPartial[idx] = _fullN;
            const ta = document.querySelector(`textarea[data-ch="${idx}"]`);
            if(ta){ ta.value = _fullN; ta.scrollTop = ta.scrollHeight; }
            patchChapter(idx);
          }) : null;
          const _dyn = dynamicChapterParams(idx);
          if(isLong()){
            const res = await callDeepSeek(longChapterSys(), buildChapterUser(idx), {maxTokens: chapterMaxTokens(), onStream, temperature: _dyn.temperature, topP: _dyn.topP, signal: _abortCtl?.signal, taskKey:'chapter'});
            txt = res.text; finishReason = res.finishReason;
          } else {
            const res = await callDeepSeek(PROMPTS.chapterSys + chapterStyleNote(), buildChapterUser(idx), {maxTokens: chapterMaxTokens(), temperature: _dyn.temperature, topP: _dyn.topP, signal: (_abortCtl && _abortCtl.signal), taskKey:'chapter'});
            txt = res.text; finishReason = res.finishReason;
          }
          if(finishReason === 'length'){
            txt = await continueTruncatedChapter(idx, txt);
            finishReason = 'stop';
          }
        }
        const content = String(txt||'').trim();
        snapshotChapterVersion(idx);
        state.chapters[idx].content = content;
        if(!isLong()) state.chapters[idx].confirmed = false;
        delete state._chapterPartial[idx];   // 正文落库即清流式缓存，避免已完成章残留"可续写"态
        state._chapterRetryFix = '';
        persist();
        updateFactCardFromChapter(idx, content);
        invalidateChapterMemory(idx);
        chState[idx] = 'done';
        patchChapter(idx);
        if(idx > 0){ try{ await ensureChapterDigests(idx - 1); }catch(e){ /* 摘要失败不阻塞，批尾 generateRollingSummaries 再补 */ } }
        break;
      }catch(e){
        if(resumePartial.length >= 200 && attempt === 1 && txt && finishReason === 'stop'){
          txt = ''; finishReason = '';
          continue;
        }
        if(attempt >= 2){
          chState[idx] = 'error';
          patchChapter(idx);
          throw e;
        }
      }
    }
  }
  generateRollingSummaries().catch(()=>{});
  }finally{
    state.aiNetwork.running = (state.aiNetwork.running||[]).filter(k=>k!=='chapter');
    state.aiNetwork.completed = Array.from(new Set([...(state.aiNetwork.completed||[]), 'chapter']));
    persist();
  }
}

async function continueTruncatedChapter(i, firstPart, resumeFrom){
  const full = resumeFrom ? String(resumeFrom||'') : String(firstPart||'');
  const tail = full.slice(-800);
  const user = `【前文末尾（${resumeFrom ? '已生成但尚未落库的草稿尾部' : '被截断'}）】\n${tail}\n\n【续写要求】\n从上文中断处无缝继续，不要重复任何已有内容，不要重新开头。保持与原文一致的叙事节奏、人物称谓和风格。`;
  let secondPartial = '';
  const res = await callDeepSeek(longChapterSys(), user, {maxTokens: clampMaxTokens('continue'), taskKey:'chapter', onStream: (delta)=>{
    secondPartial += delta;
    state._chapterPartial[i] = full + secondPartial;
  }, temperature: dynamicChapterParams(i).temperature, topP: dynamicChapterParams(i).topP, signal: _abortCtl?.signal});
  let second = String(res.text||'').trim();
  const lcp = longestCommonPrefix(tail, second);
  if(lcp.length > 20) second = second.slice(lcp.length).trim();
  return resumeFrom ? (full + '\n' + second) : (firstPart + '\n' + second);
}
async function continueAndFinalizeChapter(i, sourceNote){
  const partial = (state._chapterPartial && state._chapterPartial[i]) || '';
  if(!partial || String(partial).trim().length < 50){ toast('没有可续写的缓存内容'); return; }
  const _w = countWords(String(partial).trim()).total;
  chState[i] = 'generating';
  patchChapter(i);
  toast(`${sourceNote||'续写'}：已缓存 ${_w.toLocaleString()} 字，开始续写…`);
  try{
    const txt = await continueTruncatedChapter(i, '', partial);
    const content = String(txt||'').trim();
    if(!content) throw new Error('续写结果为空');
    delete state._chapterPartial[i];
    snapshotChapterVersion(i);
    state.chapters[i].content = content;
    updateFactCardFromChapter(i, content);
    invalidateChapterMemory(i);
    chState[i] = 'done';
    persist(); patchChapter(i); renderNarrativeEngineMenu();
    toast(`第 ${i+1} 章续写完成（${countWords(content).total.toLocaleString()} 字）`);
    autoUpdateSubplots(); autoUpdateTimeAnchors();
    generateRollingSummaries().catch(()=>{});
  }catch(e){
    if(!(e && e.name === 'AbortError')) toast('续写失败：' + ((e&&e.message)||'未知错误'));
    chState[i] = 'error';
    patchChapter(i); renderNarrativeEngineMenu();
  }
}

function syncGenBatchControls(){
  const mg = $('.multi-gen'); const out = $('#genCountOut'); const many = $('#btnGenMany');
  if(!mg || !out) return;
  const rem = remainingEmptyChapters();
  const done = rem <= 0;
  if(genBatchN < 1) genBatchN = 1;
  if(rem > 0 && genBatchN > rem) genBatchN = rem;
  out.textContent = String(genBatchN);
  mg.querySelectorAll('[data-gen-dec],[data-gen-inc]').forEach(b=>{ b.disabled = done; });
  if(many){ many.disabled = done; many.textContent = done ? '✅ 已全部写完' : '⚡ 批量生成多章'; }
}
function bindGenBatchControls(){
  const mg = $('.multi-gen'); if(!mg) return;
  const dec = mg.querySelector('[data-gen-dec]');
  const inc = mg.querySelector('[data-gen-inc]');
  if(dec) dec.onclick = (e)=>{ e.preventDefault(); genBatchN = Math.max(1, genBatchN - 1); syncGenBatchControls(); };
  if(inc) inc.onclick = (e)=>{ e.preventDefault(); genBatchN = Math.min(Math.max(1, remainingEmptyChapters()), genBatchN + 1); syncGenBatchControls(); };
  const many = $('#btnGenMany');
  if(many) many.onclick = (e)=>{
    e.preventDefault();
    const rem = remainingEmptyChapters();
    if(rem <= 0){ toast('已全部写完'); return; }   // 二次拦截：全写完后不可再触发
    genManyChapters(Math.min(Math.max(1, genBatchN), rem));
  };
  syncGenBatchControls();
}

function bindRangeGen(){
  const s = $('#rgStart'), e = $('#rgEnd'), btn = $('#btnRangeGen'), st = $('#rgStatus');
  if(!s || !e || !btn) return;
  const total = state.chapters.length;
  const clamp = (v, lo, hi)=> Math.max(lo, Math.min(hi, v));
  const validateWarn = ()=>{
    const sv = parseInt(s.value) || 1;
    const ev = parseInt(e.value) || 1;
    if(sv > ev){
      if(st) st.textContent = '⚠️ 起始章不能大于结束章';
      btn.disabled = true;
      return false;
    }
    if(st) st.textContent = '';
    btn.disabled = false;
    return true;
  };
  const validateClamp = ()=>{
    const sv = clamp(parseInt(s.value) || 1, 1, total);
    const ev = clamp(parseInt(e.value) || 1, 1, total);
    s.value = sv; e.value = ev;
    validateWarn();
  };
  s.oninput = validateWarn; e.oninput = validateWarn;   
  s.onblur = validateClamp; e.onblur = validateClamp;
  btn.onclick = async ()=>{
    if(!validate()) return;
    const sv = parseInt(s.value), ev = parseInt(e.value);
    const n = ev - sv + 1;
    {
      const _o = state.outline || {};
      const miss = [];
      (_o.chapters||[]).forEach((c,i)=>{ const p=(_o.chapterPlans||[])[i];
        if(!p || !String(p.beatsText||'').trim()) miss.push(i+1); });
      if(miss.length && !confirm(`第 ${miss.join('、')} 章缺节拍表，这些章将按大纲直接裸写。继续？`)) return;
    }
    btn.disabled = true; btn.textContent = '生成中…';
    try{
      await genNChapters(sv - 1, n);   // 0-based start，genNChapters 内每章 snapshotChapterVersion + 覆盖
      toast(`第 ${sv}~${ev} 章（共 ${n} 章）已生成`);
      if(st) st.textContent = `✅ 第 ${sv}~${ev} 章已生成`;
    }catch(err){
      toast(`第 ${sv}~${ev} 章生成失败：${err.message}`);
      if(st) st.textContent = `❌ 生成失败`;
    }finally{
      btn.disabled = false; btn.textContent = '⚡ 区间生成';
      autoUpdateSubplots(); autoUpdateTimeAnchors();
    }
  };
  validateClamp();
}

async function genManyChapters(count, fromStart){
  {
    const _o = state.outline || {};
    const miss = [];
    (_o.chapters||[]).forEach((c,i)=>{ const p=(_o.chapterPlans||[])[i];
      if(!p || !String(p.beatsText||'').trim()) miss.push(i+1); });
    if(miss.length && !confirm(`第 ${miss.join('、')} 章缺节拍表，这些章将按大纲直接裸写。继续？`)) return;
  }
  const btn = $('#btnGenMany'); if(btn) busy(btn,true,'逐章生成中…');
  const st = $('#chStatus'); if(st){ st.className='status'; st.textContent=''; }
  const genCtl = $('#btnGenAllChapters');
  const stopParent = (btn && btn.parentNode) || (genCtl && genCtl.parentNode);
  if(stopParent) showStopBtn(stopParent);
  const totalCh = (state.chapters||[]).length;
  let start;
  if(fromStart){ start = 0; }
  else {
    const firstEmpty = state.chapters.findIndex(c=> !(c.content && String(c.content).trim()));
    start = firstEmpty < 0 ? 0 : firstEmpty;
  }
  if(totalCh <= 0 || start >= totalCh){ if(st){st.className='status ok'; st.textContent='全部章节已生成。';} busy(btn,false); hideStopBtn(); syncGenBatchControls(); return; }
  const n = Math.max(1, Math.min(count, totalCh - start));
  state.generating = true;
  for(let k=0;k<n;k++){ chState[start+k] = 'generating'; patchChapter(start+k); }
  if(st) st.textContent = `正在生成第 ${start+1}~${start+n} 章（共 ${n} 章）…`;
  try{
    await genNChapters(start, n);
    for(let k=0;k<n;k++){ chState[start+k] = 'done'; patchChapter(start+k); }
    const rem = remainingEmptyChapters();
    if(st){ st.className='status ok'; st.textContent = isLong()
      ? (rem > 0 ? `本批共 ${n} 章已生成，全书还剩 ${rem} 章未写。` : `全部章节已写完（共 ${totalCh} 章）。`)
      : '全部章节已生成，请审阅并标记确认。'; }
    if(rem <= 0 && isLong()) toast(`已全部写完（共 ${totalCh} 章）`);
    if(isLong()){
      const targetPage = Math.floor(start / CH_PAGE_SIZE);
      if(Math.abs(chPage - targetPage) >= 1){ chPage = targetPage; renderChapters(); }
    }
  }catch(e){
    for(let k=0;k<n;k++){ if(chState[start+k] === 'generating'){ chState[start+k]='error'; } patchChapter(start+k); }
    if(st){ st.className='status err'; st.textContent = `第${start+1}~${start+n}章生成失败（${e.message}）。已停止本批，请修复后重试。`; }
    toast(`第${start+1}~${start+n}章生成失败：${e.message}`);
  }finally{
    state.generating = false; hideStopBtn();
    if(btn) busy(btn,false);
    autoUpdateSubplots();
    autoUpdateTimeAnchors();
    if(isLong()) syncGenBatchControls();
  }
}

async function genOneChapterNoUI(i){
  const user = buildChapterUser(i);
  try{
    const txt = isLong()
      ? await writeOneChapterContent(i, user)
      : unwrapAIResult(await callDeepSeek(PROMPTS.chapterSys + chapterStyleNote(), user, {temperature: resolveActiveSpec().chapterTemp, taskKey:'chapter'})).trim();
    state.chapters[i].content = txt;
    persist();
  }catch(e){ /* 继续后续 */ }
}

function pushAssetHist(kind, data){
  if(data == null) return;
  if(!state.hist) state.hist = { characters:[], scenes:[], cover:[], storyboard:[] };
  const arr = state.hist[kind]; if(!Array.isArray(arr)) return;
  arr.unshift({ data: JSON.parse(JSON.stringify(data)), ts: Date.now() });
  if(arr.length > 10) arr.splice(10);
}
function assetHistCount(kind){ return Array.isArray(state.hist && state.hist[kind]) ? state.hist[kind].length : 0; }
function hasAssetHist(kind){ return assetHistCount(kind) > 0; }
const ASSET_LABEL = { characters:'角色定妆', scenes:'场景提示词', cover:'封面提示词', storyboard:'分镜' };
function openAssetHistPanel(kind){
  closeAssetHistPanel();
  const hist = Array.isArray(state.hist && state.hist[kind]) ? state.hist[kind] : [];
  if(!hist.length){ toast('暂无历史版本'); return; }
  const fmtTs = ts=>{ const d=new Date(ts); return (d.getMonth()+1)+'-'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  const rows = hist.map((h,idx)=>{
    const d = h.data;
    let brief = '';
    if(kind==='characters') brief = (Array.isArray(d)?d.map(x=>x&&x.name).filter(Boolean).join('、'):'');
    else if(kind==='scenes') brief = (Array.isArray(d)?d.map(x=>x&&x.name).filter(Boolean).join('、'):'');
    else if(kind==='cover') brief = String(d||'').slice(0,40);
    else if(kind==='storyboard') brief = `${Array.isArray(d)?d.length:0} 镜`;
    const cnt = Array.isArray(d) ? d.length : 1;
    return `<div class="cv-row">
      <div class="cv-meta" style="flex:1;min-width:0"><div class="cv-time">${fmtTs(h.ts)} · ${cnt} 条</div><div class="cv-t" style="font-size:12px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(brief||'')}</div></div>
      <div class="cv-actions" style="display:flex;gap:6px;flex-shrink:0">
        <button type="button" class="btn ghost cv-b" data-ah-prev="${idx}">预览</button>
        <button type="button" class="btn ghost cv-b" data-ah-restore="${idx}">↩ 恢复</button>
      </div>
    </div>`;
  }).join('');
  const ov = document.createElement('div'); ov.id='ahPanel'; ov.className='gs-overlay';
  ov.innerHTML = `
    <div class="gs-modal">
      <div class="gs-modal-head"><b>🕘 ${ASSET_LABEL[kind]} · 历史版本（${hist.length}/10）</b>
        <button class="gs-x" data-ah-close>✕</button></div>
      <div class="cv-body">
        <div class="cv-row cur"><div class="cv-meta"><span class="cv-time">当前版本</span><span class="cv-wc">${kind==='cover' ? (state.coverPrompt?'有':'空') : (Array.isArray(state[kind==='characters'?'characters':(kind==='scenes'?'scenes':'storyboard')])?state[kind==='characters'?'characters':(kind==='scenes'?'scenes':'storyboard')].length:0)+' 条'}</span></div></div>
        <div class="cv-div">重生成前旧版会自动存入这里；恢复会覆盖当前内容（当前版也先存入历史）。</div>
        ${rows}
        <div class="cv-preview hidden" id="ahPreview">
          <div class="cv-prev-head"><b id="ahPrevTitle">版本预览</b><button class="gs-x" data-ah-prev-close>✕</button></div>
          <div class="cv-pre" id="ahReader"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('[data-ah-close]').onclick = closeAssetHistPanel;
  ov.addEventListener('click', e=>{ if(e.target===ov) closeAssetHistPanel(); });
  ov.addEventListener('click', e=>{
    const p = e.target.closest('[data-ah-prev]'); if(!p) return;
    const h = hist[+p.dataset.ahPrev]; if(!h) return;
    const pr=$('#ahPreview'), rd=$('#ahReader'), pt=$('#ahPrevTitle');
    if(pr && rd){
      pt.textContent = '预览 · '+fmtTs(h.ts);
      const d = h.data;
      let txt = '';
      if(kind==='characters') txt = (d||[]).map(x=>`${x.name||''}（${x.role||''}）\n${JSON.stringify(x.profile||{},null,1)}`).join('\n\n');
      else if(kind==='scenes') txt = (d||[]).map(x=>`${x.name||''}（${x.作用||''}）\n${x.description||''}`).join('\n\n');
      else if(kind==='cover') txt = String(d||'');
      else if(kind==='storyboard') txt = (d||[]).map(x=>`镜${x.镜号||''}：${x.画面描述||''}`).join('\n');
      rd.textContent = txt.slice(0,1500) + (txt.length>1500?'\n…':''); 
      pr.classList.remove('hidden');
    }
  });
  ov.querySelector('[data-ah-prev-close]').onclick = ()=>{ const pr=$('#ahPreview'); if(pr) pr.classList.add('hidden'); };
  ov.addEventListener('click', e=>{
    const rb = e.target.closest('[data-ah-restore]'); if(!rb) return;
    const h = hist[+rb.dataset.ahRestore]; if(!h) return;
    if(!window.confirm(`恢复该版${ASSET_LABEL[kind]}将覆盖当前内容（当前版先存入历史）。确定恢复吗？`)) return;
    const curData = kind==='cover' ? (state.coverPrompt||'') : state[kind==='characters'?'characters':(kind==='scenes'?'scenes':'storyboard')];
    pushAssetHist(kind, curData);
    if(kind==='cover') state.coverPrompt = String(h.data||'');
    else state[kind==='characters'?'characters':(kind==='scenes'?'scenes':'storyboard')] = JSON.parse(JSON.stringify(h.data||[]));
    persist(); closeAssetHistPanel(); render();
    toast('已恢复历史版本');
  });
}
function closeAssetHistPanel(){ const p=$('#ahPanel'); if(p) p.remove(); }

async function genCharacters(){
  const btn = $('#btnGenChars'); busy(btn,true,'生成角色中…');
  try{
    if(state.characters && state.characters.length) pushAssetHist('characters', state.characters);
    const txt = unwrapAIResult(await callDeepSeek(PROMPTS.characterSys, '【完整故事】\n'+fullStoryText(), {temperature: resolveActiveSpec().assetsTemp, taskKey:'assets'}));
    state.raw.characters = txt;
    const j = parseJson(txt);
    state.characters = j.characters || [];
    persist(); render();
    toast('角色提示词已生成');
  }catch(e){
    const p = $('#charStatus'); if(p){ p.className='status err'; p.textContent=e.message; }
  }finally{ busy(btn,false); }
}

async function genScenes(){
  const btn = $('#btnGenScenes'); busy(btn,true,'生成场景中…');
  try{
    if(state.scenes && state.scenes.length) pushAssetHist('scenes', state.scenes);
    const txt = unwrapAIResult(await callDeepSeek(PROMPTS.sceneSys, '【完整故事】\n'+fullStoryText(), {temperature: resolveActiveSpec().assetsTemp, taskKey:'assets'}));
    state.raw.scenes = txt;
    const j = parseJson(txt);
    state.scenes = (j.scenes || []).map(s=>{
      const p = String(s.prompt||'');
      const neg = ['no people','no characters','no humans','无人'];
      if(!neg.some(k=>p.toLowerCase().includes(k))){
        s.prompt = p.replace(/\s*$/,'') + '\n（无人物纯环境：no people, no characters, no humans, empty of figures）';
      }
      return s;
    });
    persist(); render();
    toast('场景提示词已生成');
  }catch(e){
    const p = $('#sceneStatus'); if(p){ p.className='status err'; p.textContent=e.message; }
  }finally{ busy(btn,false); }
}

async function genCover(){
  const btn = $('#btnGenCover'); busy(btn,true,'生成封面提示词…');
  const st = $('#coverStatus'); if(st){ st.className='status'; st.textContent=''; }
  const o = state.outline;
  if(!o){ toast('先生成故事大纲'); busy(btn,false); return; }
  const sys = state.coverWithTitle ? PROMPTS.coverSysTitle : PROMPTS.coverSysClean;
  const user = `小说标题：${o.title}\n小说简介：${o.logline}\n章节：${(o.chapters||[]).map(c=>c.title).join(' / ')}\n\n请为这部小说设计封面图的出图提示词。\n模式：${state.coverWithTitle?'包含书名汉字作为封面主体文字':'纯画面、无任何文字、预留书名留白'}`;
  try{
    if(state.coverPrompt) pushAssetHist('cover', state.coverPrompt);
    const txt = unwrapAIResult(await callDeepSeek(sys, user, {temperature: resolveActiveSpec().assetsTemp, taskKey:'assets'}));
    state.coverPrompt = txt.trim();
    persist(); render();
    toast(state.coverWithTitle?'已生成含书名封面提示词':'已生成纯画面封面提示词');
  }catch(e){
    if(st){ st.className='status err'; st.textContent=e.message; }
    else toast('生成失败：'+e.message);
  }finally{ busy(btn,false); }
}

async function genStoryboard(){
  const btn = $('#btnGenBoard'); busy(btn,true,'生成分镜中…');
  const st = $('#boardStatus');
  try{
    const chars = state.characters.map(c=>`${c.name}(${c.role})：定妆特征-${((c.profile&&c.profile.外貌)||'')}，常服-${((c.profile&&c.profile.常服与配色)||'')}`).join('\n');
    const scenes = state.scenes.map(s=>`${s.name}：${s.description||''}`).join('\n');
    const base = `【角色定妆特征】\n${chars||'（未生成角色）'}\n\n【场景】\n${scenes||'（未生成场景）'}`;
    const shots = [];
    const concepts = [];
    const fails = [];
    for(let i=0;i<state.chapters.length;i++){
      if(st){ st.className='status'; st.textContent = `正在为第 ${i+1}/${state.chapters.length} 章生成分镜…`; }
      const ch = state.chapters[i];
      const oc = (state.outline&&state.outline.chapters&&state.outline.chapters[i])||{};
      const content = ch.content||'';
      const user = `【本章】第${i+1}章 ${ch.title||oc.title||''}\n本章正文：\n${content.slice(0,50000)}${content.length>50000?'…':''}\n\n${base}`;
      try{
        const txt = unwrapAIResult(await callDeepSeek(PROMPTS.storyboardSys, user, {temperature: resolveActiveSpec().assetsTemp, taskKey:'assets'}));
        const j = parseJson(txt);
        (j.shots||[]).forEach(s=>{
          s.章节 = i+1;
          if(s.时长==null) s.时长 = 3;
          shots.push(s);
        });
        concepts.push({视觉概念:j.视觉概念||'', 母题:j.母题||''});
      }catch(e){
        fails.push('第'+(i+1)+'章：'+e.message);
        concepts.push({视觉概念:'', 母题:''});
      }
    }
    if(!shots.length) throw new Error('分镜生成失败：' + fails.join('；'));
    if(state.storyboard && state.storyboard.length) pushAssetHist('storyboard', state.storyboard);
    state.boardConcepts = concepts;
    state.storyboard = shots;
    state.raw.storyboard = '';
    persist(); render();
    toast(fails.length ? `分镜已生成（${fails.length} 章失败）` : '分镜已生成（按章节分组）');
  }catch(e){
    const p = $('#boardStatus'); if(p){ p.className='status err'; p.textContent=e.message; }
  }finally{
    busy(btn,false);
    if(st){ st.className='status'; st.textContent=''; }
  }
}

let histOpenId = null;   // 当前展开详情的历史项目 id（折叠态，互不影响）
function fmtHistTime(ts){
  if(!ts) return '';
  const d = new Date(ts), now = new Date();
  const pad = n => String(n).padStart(2,'0');
  if(d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function histProgress(p){
  if(p.chapters && p.chapters.length){
    const done = p.chapters.filter(c=> c.confirmed).length;
    return `${done}/${p.chapters.length} 章`;
  }
  if(p.outline && p.outline.chapters && p.outline.chapters.length) return `大纲 ${p.outline.chapters.length} 章`;
  if(p.characters && p.characters.length) return `${p.characters.length} 角色`;
  if(p.scenes && p.scenes.length) return `${p.scenes.length} 场景`;
  if(p.storyboard && p.storyboard.length) return `${p.storyboard.length} 镜`;
  if(p.idea) return '草稿';
  return `第 ${p.step||1} 步`;
}
function renderHistList(){
  const list = $('#histList'); if(!list) return;
  const items = [...lib.items].sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
  list.innerHTML = items.map(p=>{
    const isCur = p.id === lib.curId;
    const open = histOpenId === p.id;
    const preview = histItemPreview(p);
    return `<div class="hist-item ${isCur?'active':''} ${open?'open':''}" data-hist="${p.id}">
      <div class="hist-head" data-hist-toggle="${p.id}">
        <span class="hist-fold" data-hist-fold="${p.id}">${open?'▾':'▸'}</span>
        <button class="hist-main" data-switch="${p.id}">
          <span class="hist-title">${isCur?'<em class="hist-cur">当前</em>':''}${esc(p.title||'未命名作品')}</span>
          ${p.logline?`<span class="hist-desc">${esc(p.logline)}</span>`:''}
          <span class="hist-meta">${histProgress(p)} · ${fmtHistTime(p.updatedAt)}</span>
        </button>
        <button class="hist-del" data-fypexp="${p.id}" title="导出 .fyp 项目">📤</button>
        <button class="hist-del" data-del="${p.id}" title="删除作品">🗑</button>
      </div>
      <div class="hist-body">${preview}</div>
    </div>`;
  }).join('') || `<div class="hist-empty">还没有作品，点击「＋ 新建小说」开始。</div>`;
  $$('#histList [data-switch]').forEach(b=> b.onclick = ()=> switchProject(b.dataset.switch));
  $$('#histList [data-del]').forEach(b=> b.onclick = (e)=>{ e.stopPropagation(); deleteProject(b.dataset.del); });
  $$('#histList [data-fypexp]').forEach(b=> b.onclick = (e)=>{ e.stopPropagation(); exportProjectFile(b.dataset.fypexp); });
  $$('#histList .hist-head').forEach(h=> h.onclick = (e)=>{
    if(e.target.closest('[data-switch]')) return;   // 点标题=切换项目，不折叠
    if(e.target.closest('[data-del]')) return;
    if(e.target.closest('[data-fypexp]')) return;   // .fyp 导出按钮不触发折叠
    const id = h.dataset.histToggle;
    histOpenId = (histOpenId===id) ? null : id;
    renderHistList();                               // 重新渲染以切折叠态
  });
}
function histItemPreview(p){
  const chapters = (p.chapters||[]).filter(c=> c && c.content && String(c.content).trim());
  const parts = [];
  if(chapters.length){
    parts.push(`<b>正文已生成 ${chapters.length} 章：</b>`);
    const rows = chapters.slice(0, 8).map((c,i)=>`<div class="hist-p-row">第${i+1}章 · ${esc(cleanChapterTitle(c.title)||'')}</div>`).join('');
    parts.push(rows);
    if(chapters.length>8) parts.push(`<div class="muted">… 其余 ${chapters.length-8} 章</div>`);
  }
  const outline = p.outline && p.outline.chapters;
  if(outline && outline.length){
    parts.push(`<b>大纲（${outline.length} 章）：</b>`);
    parts.push(`<div class="hist-p-row muted">${esc(outline.map(c=>c.title).slice(0,6).join(' / '))}${outline.length>6?' …':''}</div>`);
  }
  if(p.characters && p.characters.length){
    parts.push(`<div class="hist-p-row muted">角色：${esc(p.characters.map(c=>c.name).slice(0,6).join('、'))}</div>`);
  }
  if(p.scenes && p.scenes.length){
    parts.push(`<div class="hist-p-row muted">场景：${esc(p.scenes.map(s=>s.name).slice(0,6).join('、'))}</div>`);
  }
  if(!parts.length) parts.push('<div class="muted">（暂无内容，仅记录了构想与进度）</div>');
  return parts.join('');
}
function openHistPanel(){ renderHistList(); $('#histPanel').classList.remove('hidden'); }
function closeHistPanel(){ $('#histPanel').classList.add('hidden'); }
function switchProject(id){
  if(id === lib.curId){ closeHistPanel(); return; }
  persist(); // 先保存当前项目
  lib.curId = id;
  const cur = lib.items.find(i=> i.id === id);
  applyProject(cur || {}); // 内容缺失 → 空白，id 仍保持有效
  saveLib(); // 提交 curId 切换
  closeHistPanel();
  render();
  window.scrollTo(0,0);
  toast(`已切换到「${cur ? (cur.title||'未命名作品') : '空白项目'}」`);
}
function newProject(mode){
  if(lib.items.length >= MAX_PROJECTS){
    const oldest = [...lib.items].sort((a,b)=> (a.updatedAt||0) - (b.updatedAt||0))[0];
    if(oldest && !confirm(`历史已达 ${MAX_PROJECTS} 个上限，是否删除最旧的「${oldest.title||'未命名作品'}」以新建？`)){
      return false;
    }
    if(oldest) lib.items = lib.items.filter(i=> i.id !== oldest.id);
  }
  clearState();
  if(mode) state.mode = mode; // 'longnovel' 经典长篇小说
  const snap = projectSnapshot();
  const newId = makeId();
  lib.items.unshift({ ...snap, id: newId, updatedAt: Date.now() });
  lib.curId = newId;
  saveLib();
  closeHistPanel();
  render();
  window.scrollTo(0,0);
  toast(mode==='longnovel' ? '已新建经典长篇小说' : '已新建空白小说');
  return true;
}
function newLongProject(){
  return newProject('longnovel');
}
function deleteProject(id){
  const it = lib.items.find(i=> i.id === id);
  if(!it) return;
  if(!confirm(`确定删除「${it.title||'未命名作品'}」？此操作不可恢复。`)) return;
  const wasCur = id === lib.curId;
  lib.items = lib.items.filter(i=> i.id !== id);
  if(wasCur){
    if(lib.items.length){
      const next = [...lib.items].sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0))[0];
      lib.curId = next.id;
      applyProject(next);
      toast('已删除，已切换到最近作品');
    }else{
      clearState();
      lib.curId = null;
      toast('已删除全部作品');
    }
    closeHistPanel(); render(); window.scrollTo(0,0);
  }
  saveLib();
  renderHistList();
}
function rebindHistPanel(){
  const btn = $('#btnHist');
  if(btn) btn.onclick = (e)=>{
    e.stopPropagation();
    const p = $('#histPanel');
    if(p.classList.contains('hidden')) openHistPanel(); else closeHistPanel();
  };
  const nb = $('#btnNewProject');
  if(nb) nb.onclick = (e)=>{ e.stopPropagation(); newProject(); };
  const nlo = $('#histNewLong');
  if(nlo) nlo.onclick = (e)=>{ e.stopPropagation(); newLongProject(); };
  const imp = $('#btnImportFyp');
  if(imp) imp.onclick = (e)=>{ e.stopPropagation(); const fi = $('#fypImportInput'); if(fi) fi.click(); };
  const fi = $('#fypImportInput');
  if(fi) fi.onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) importProjectFile(f); e.target.value = ''; };
}

function buildFyp(project){
  return {
    format: 'fyp-project',
    version: 1,
    kind: 'complete',
    exportedAt: new Date().toISOString(),
    app: 'storyfactory',
    appVersion: APP_VERSION,   // 导出时的应用版本号，供对方工具识别本项目由哪一版生成
    book: project   // 完整项目快照（与 lib.items[i] 同结构）
  };
}
function parseFyp(text){
  const obj = JSON.parse(text);
  if(!obj || typeof obj !== 'object') throw new Error('文件不是合法 JSON');
  if(obj.format !== 'fyp-project') throw new Error('不是 .fyp 项目文件（format 字段不匹配）');
  if(!obj.book || typeof obj.book !== 'object') throw new Error('.fyp 缺少 book 字段');
  return obj.book;
}
function exportProjectFile(id){
  const p = lib.items.find(i=> i.id === id);
  if(!p){ toast('未找到该作品'); return; }
  const fyp = buildFyp(p);
  const title = String(p.title || 'story').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 40);
  const blob = new Blob([JSON.stringify(fyp, null, 2)], { type:'application/octet-stream' });
  downloadBlob(`${title}.fyp`, blob);
  toast('已导出 .fyp 项目文件');
}
function importProjectFile(file){
  if(!file) return;
  const big = file.size > 5 * 1024 * 1024;
  toast(big ? '文件较大，解析中…' : '正在导入项目…');
  const r = new FileReader();
  r.onload = function(){
    try{
      const book = parseFyp(String(r.result));
      const newId = makeId();
      const item = Object.assign({}, book, { id: newId, updatedAt: Date.now() });
      if(!item.title) item.title = (item.outline && item.outline.title) || '导入的作品';
      lib.items.unshift(item);
      if(lib.items.length > MAX_PROJECTS){
        const others = lib.items.filter(i=> i.id !== lib.curId && i.id !== newId);
        others.sort((a,b)=> (a.updatedAt||0) - (b.updatedAt||0));
        const victim = others[0];
        if(victim){ lib.items = lib.items.filter(i=> i.id !== victim.id); }
      }
      lib.curId = newId;
      applyProject(item);
      saveLib(); // 经 IDB 落盘（fire-and-forget）
      closeHistPanel();
      render();
      window.scrollTo(0,0);
      toast(`已导入「${item.title}」并打开`);
    }catch(err){
      toast('导入失败：' + (err && err.message ? err.message : '文件格式错误'));
    }
  };
  r.onerror = function(){ toast('读取文件失败'); };
  r.readAsText(file);
}

function wsColorToolbarHtml(){
  const undoN = wsUndoLog().length, rmB = wsRemovedBuiltin().length;
  return `<div class="ws-cs-toolbar">
    <button type="button" class="cs-tool" data-cs-undo ${undoN?'':'disabled'} title="撤销上一步删除">↩ 撤销</button>
    <button type="button" class="cs-tool" data-cs-restore ${rmB?'':'disabled'} title="仅恢复项目自带的 11 套内置配色（不影响你自建的配色）">↺ 恢复全部</button>
    <span class="ws-cs-spacer"></span>
    <button type="button" class="cs-tool cs-tool-new" data-cs-new title="新建一套配色">＋ 新建配色</button>
  </div>`;
}
function wsColorGridHtml(){
  const cur = wsColorSchemeId();
  const customIds = wsCustomColors().map(s=>s.id);
  return wsColorSchemesList().map(s=>{
    const isCustom = customIds.includes(s.id);
    return `<div class="ws-cs-item${cur===s.id?' active':''}" data-cs="${s.id}" title="点击应用「${esc(s.name)}」">
      <div class="ws-cs-top">
        <span class="ws-cs-name">${esc(s.name)}${isCustom?'<i class="ws-cs-tag">我的</i>':''}</span>
        ${s.id==='none'?'':`<button type="button" class="ws-cs-del" data-cs-del="${s.id}" title="删除此配色">✕</button>`}
      </div>
      <div class="ws-cs-bars">
        ${(s.c&&s.c.length)? s.c.map(c=>`<i style="background:${c}"></i>`).join('') : `<i class="ws-cs-none">无</i>`}
      </div>
    </div>`;
  }).join('');
}
function wsColorNewFormHtml(){
  return `<div id="wsCsForm" class="ws-cs-form hidden">
    <div class="ws-cs-form-row"><label>名称</label><input id="csName" class="cs-inp" type="text" maxlength="12" placeholder="例如：晚霞粉蓝"></div>
    <div class="ws-cs-form-row"><label>章节 · 风格色</label><input id="csC0" class="cs-color" type="color" value="#3fc6a0"></div>
    <div class="ws-cs-form-ops">
      <button type="button" class="btn" data-cs-cancel>取消</button>
      <button type="button" class="btn primary" data-cs-confirm>确认新建</button>
    </div>
  </div>`;
}
function renderWsColorPanel(){
  const box = $('#wsColorBody'); if(!box) return;
  box.innerHTML = wsColorToolbarHtml() + `<div class="ws-cs-grid">${wsColorGridHtml()}</div>` + wsColorNewFormHtml();
}
function openWsColorPanel(){ const p=$('#wsColorPanel'); if(!p) return; renderWsColorPanel(); p.classList.remove('hidden'); }
function closeWsColorPanel(){ const p=$('#wsColorPanel'); if(p) p.classList.add('hidden'); }
function wsColorRepaint(){ rebuildCustomColorCss(); renderWsColorPanel(); render(); }
function wsColorSelect(id){
  const c=getCfg(); c.styleCustom = c.styleCustom||{};
  c.styleCustom.colorScheme = id; saveCfg(c);
  wsColorRepaint(); toast('已切换写作风格配色：'+wsSchemeName(id));
}
function wsColorDelete(id){
  if(id==='none') return;
  const c=getCfg(); const cs=wsColorCfgOf(c);
  const active=(c.styleCustom||{}).colorScheme;
  const bi=WS_COLOR_SCHEMES.find(x=>x.id===id);
  if(bi){
    if(cs.removedBuiltin.includes(id)) return;
    cs.removedBuiltin.push(id); cs.undo.push({type:'builtin',id:id});
  } else {
    const s=cs.custom.find(x=>x.id===id); if(!s) return;
    cs.custom=cs.custom.filter(x=>x.id!==id);
    cs.removedCustom=cs.removedCustom.concat([s]); cs.undo.push({type:'custom',id:id});
  }
  if(active===id) c.styleCustom.colorScheme='none';
  saveCfg(c); wsColorRepaint();
  toast('已删除配色：'+wsSchemeName(id)+(active===id?'（当前配色已回退默认）':''));
}
function wsColorUndo(){
  const c=getCfg(); const cs=wsColorCfgOf(c); const last=cs.undo.pop(); if(!last) return;
  let label=last.id;
  if(last.type==='builtin'){ cs.removedBuiltin=cs.removedBuiltin.filter(x=>x!==last.id); }
  else { const s=cs.removedCustom.find(x=>x.id===last.id); if(s){ cs.custom=cs.custom.concat([s]); cs.removedCustom=cs.removedCustom.filter(x=>x.id!==last.id); label=s.name; } }
  saveCfg(c); wsColorRepaint(); toast('已撤销删除：'+label);
}
function wsColorRestoreAll(){
  const c=getCfg(); const cs=wsColorCfgOf(c);
  cs.removedBuiltin=[];
  cs.undo = cs.undo.filter(u=>u.type!=='builtin');   // 内置已全部恢复，仅清除其对应的撤销记录；保留自建配色的删除与撤销记录
  saveCfg(c); wsColorRepaint(); toast('已恢复全部内置配色（自建配色不受影响）');
}
function wsColorCreate(){
  const name=((($('#csName')||{}).value)||'').trim();
  const c0=(($('#csC0')||{}).value)||'#3fc6a0';
  if(!name){ toast('请先填写配色名称'); return; }
  const c=getCfg(); const cs=wsColorCfgOf(c);
  cs.custom=cs.custom.concat([{id:'cu_'+(Date.now()), name:name, c:[c0]}]);
  saveCfg(c); rebuildCustomColorCss();
  const f=$('#wsCsForm'); if(f) f.classList.add('hidden');
  wsColorRepaint(); toast('已新建配色：'+name);
}
function rebindWsColorPanel(){
  const btn = $('#btnWsColor');
  if(btn) btn.onclick = (e)=>{ e.stopPropagation(); const p=$('#wsColorPanel'); if(p.classList.contains('hidden')) openWsColorPanel(); else closeWsColorPanel(); };
  const body = $('#wsColorBody');
  if(body) body.onclick = (e)=>{
    const del = e.target.closest('[data-cs-del]'); if(del){ e.stopPropagation(); wsColorDelete(del.dataset.csDel); return; }
    const item = e.target.closest('.ws-cs-item[data-cs]'); if(item){ e.stopPropagation(); if(!item.classList.contains('active')) wsColorSelect(item.dataset.cs); return; }
    if(e.target.closest('[data-cs-new]')){ e.stopPropagation(); const f=$('#wsCsForm'); if(f) f.classList.toggle('hidden'); return; }
    if(e.target.closest('[data-cs-undo]')){ e.stopPropagation(); wsColorUndo(); return; }
    if(e.target.closest('[data-cs-restore]')){ e.stopPropagation(); wsColorRestoreAll(); return; }
    if(e.target.closest('[data-cs-confirm]')){ e.stopPropagation(); wsColorCreate(); return; }
    if(e.target.closest('[data-cs-cancel]')){ e.stopPropagation(); const f=$('#wsCsForm'); if(f) f.classList.add('hidden'); return; }
  };
  rebuildCustomColorCss();   // 刷新后自定义配色仍能正确上色
}
function openThemePanel(){
  const p = $('#themePanel'); if(!p) return;
  const cur = (document.documentElement.getAttribute('data-theme')) || 'dark';
  $$('.theme-btns .theme').forEach(b=> b.classList.toggle('active', b.dataset.theme===cur));
  p.classList.remove('hidden');
}
function closeThemePanel(){ const p=$('#themePanel'); if(p) p.classList.add('hidden'); }

function openNarrativeEngine(){
  const p = $('#narrativeEnginePanel'); if(!p) return;
  renderNarrativeEngineMenu();
  p.classList.remove('hidden');
}
function closeNarrativeEngine(){ const p=$('#narrativeEnginePanel'); if(p) p.classList.add('hidden'); }

function openNeModal(title, bodyHtml, actionsHtml){
  const m=$('#neModal'); if(!m) return;
  $('#neModalTitle').textContent = title || '叙事引擎';
  $('#neModalBody').innerHTML = bodyHtml || '';
  const acts=$('#neModalActions');
  if(actionsHtml){ acts.innerHTML = actionsHtml; acts.classList.remove('hidden'); }
  else { acts.innerHTML=''; acts.classList.add('hidden'); }
  m.classList.remove('hidden');
}
function closeNeModal(){ const m=$('#neModal'); if(m) m.classList.add('hidden'); }

function renderNarrativeEngineMenu(){
  const box=$('#nePanelBody'); if(!box) return;
  const partialN = Object.keys(state._chapterPartial||{}).length;
  box.innerHTML = `
    <div class="ne-menu-hint">AI 叙事中间件总入口，点击打开对应面板</div>
    <button class="ne-menu-item" data-ne-panel="resume"><span class="ne-ico">▶️</span><span class="ne-lbl">流式续写状态</span>${partialN?`<span class="ne-badge">${partialN}</span>`:''}</button>
    <button class="ne-menu-item" data-ne-panel="facts"><span class="ne-ico">📎</span><span class="ne-lbl">事实与一致性看板</span></button>
    <button class="ne-menu-item" data-ne-panel="resumesum"><span class="ne-ico">📜</span><span class="ne-lbl">滚动摘要</span></button>
    <button class="ne-menu-item" data-ne-panel="check"><span class="ne-ico">🩺</span><span class="ne-lbl">一致性自检</span></button>
    <button class="ne-menu-item" data-ne-panel="iron"><span class="ne-ico">📌</span><span class="ne-lbl">叙事铁律（写作总纲）</span>${state._narrIron!==false?'<span class="ne-badge ok">ON</span>':'<span class="ne-badge">OFF</span>'}</button>
    <button class="ne-menu-item" data-ne-panel="banlist"><span class="ne-ico">🚫</span><span class="ne-lbl">禁则清单</span>${stateBanEnabled()?'<span class="ne-badge ok">ON</span>':'<span class="ne-badge">OFF</span>'}</button>
    <!-- v238/反馈①：消息看板入口移入「叙事」面板菜单（第 9 项），带历史消息条数角标；顶栏不加按钮 -->
    <button class="ne-menu-item" data-ne-panel="toastboard"><span class="ne-ico">📋</span><span class="ne-lbl">消息看板</span>${(()=>{const n=toastLogGet().length; return n?`<span class="ne-badge info">${n}</span>`:'';})()}</button>
  `;
}

function rebindNarrativeEngine(){
  const btn=$('#btnNarrativeEngine');
  if(btn) btn.onclick = (e)=>{ e.stopPropagation(); const p=$('#narrativeEnginePanel'); if(p && p.classList.contains('hidden')) openNarrativeEngine(); else closeNarrativeEngine(); };
  const p=$('#narrativeEnginePanel');
  if(p) p.onclick = (e)=>{
    const item=e.target.closest('[data-ne-panel]'); if(!item) return;
    const panel=item.dataset.nePanel;
    if(panel==='resume') renderResumePanel();
    else if(panel==='iron') renderIronPanel();
    else if(panel==='banlist') renderBanListPanel();
    else if(panel==='facts') openFactCardModal();
    else if(panel==='resumesum') openRollingSummaryModal();
    else if(panel==='check') openConsistencyCheck();
    else if(panel==='toastboard') openToastBoard();
    closeNarrativeEngine();
  };
  const m=$('#neModal');
  if(m) m.onclick = (e)=>{
    if(e.target.closest('[data-ne-close]')){ closeNeModal(); return; }
    const resume=e.target.closest('[data-ne-resume]'); if(resume){ const i=+resume.dataset.neResume; closeNeModal(); continueAndFinalizeChapter(i, '从中断处继续'); return; }
    const discard=e.target.closest('[data-ne-discard]'); if(discard){ const i=+discard.dataset.neDiscard; delete state._chapterPartial[i]; toast('已丢弃第 '+(i+1)+' 章缓存'); renderResumePanel(); renderNarrativeEngineMenu(); return; }
    if(handleBanListAction(e)) return;
  };
  document.addEventListener('click', (e)=>{
    const p=$('#narrativeEnginePanel');
    if(p && !p.classList.contains('hidden') && !p.contains(e.target) && !e.target.closest('#btnNarrativeEngine')) closeNarrativeEngine();
  });
}

function renderResumePanel(){
  const partials = state._chapterPartial || {};
  const keys = Object.keys(partials).filter(k=> String(partials[k]||'').trim().length>=50);
  if(!keys.length){ openNeModal('流式续写状态', '<div class="empty">暂无中断缓存，所有章节均未处于生成中或中断状态。</div>'); return; }
  const rows = keys.map(k=>{
    const i=+k; const c=state.chapters[i]; const w=countWords(partials[k]||'').total;
    return `<div class="card"><div class="kv"><span class="k">第 ${i+1} 章</span><span class="v">${esc(c && c.title ? c.title : '未命名')}</span></div><div class="kv"><span class="k">已缓存</span><span class="v">${w.toLocaleString()} 字</span></div><div class="btn-row"><button class="btn primary" data-ne-resume="${i}">从中断处继续</button><button class="btn ghost" data-ne-discard="${i}">丢弃缓存</button></div></div>`;
  }).join('');
  openNeModal('流式续写状态', `<div class="ne-body">${rows}<p class="hint">「从中断处继续」会把已缓存文本作为锚点，让 AI 无缝续写，避免从零重跑。</p></div>`);
}


function handleBanListAction(e){
  const m=$('#neModal'); if(!m || m.style.display==='none' && m.classList&&m.classList.contains('hidden')) return false;
  if(!m.contains(e.target)) return false;
  const en=e.target.closest('[data-bl-enabled]'); if(en){ /* 保存时统一读回，此处仅占位避免误关面板 */ return false; }
  const add=e.target.closest('[data-bl-rule-add]'); if(add){
    const b=banListRaw();
    const cur=normalizeBanList(b)||{enabled:true,chars:[],names:[],phrases:[],rules:[],scopeAi:[]};
    cur.rules.push({ text:'', ai:['chapter'] });
    state.banList=cur; renderBanListPanel(); return true;
  }
  const del=e.target.closest('[data-bl-rule-del]'); if(del){
    const i=+del.dataset.blRuleDel; const cur=normalizeBanList(state.banList)||{enabled:true,chars:[],names:[],phrases:[],rules:[],scopeAi:[]};
    (cur.rules||[]).splice(i,1); state.banList=cur; renderBanListPanel(); return true;
  }
  const save=e.target.closest('[data-bl-save]'); if(save){
    const cur=normalizeBanList(state.banList)||{enabled:true,chars:[],names:[],phrases:[],rules:[],scopeAi:BANLIST_DEFAULT.scopeAi.slice()};
    const gv=el=>m.querySelector(el); const val=el=>{const x=gv(el); return x?x.value.trim():'';};
    cur.enabled = !!(m.querySelector('[data-bl-enabled]')&&m.querySelector('[data-bl-enabled]').checked);
    cur.chars = val('[data-bl-chars]').split(/[,，]/).map(s=>s.trim()).filter(Boolean);
    cur.names = val('[data-bl-names]').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean);
    cur.phrases = val('[data-bl-phrases]').split(/[,，]/).map(s=>s.trim()).filter(Boolean);
    m.querySelectorAll('[data-bl-rule-text]').forEach(t=>{ const i=+t.dataset.blRuleText; const aiSel=m.querySelector('[data-bl-rule-ai="'+i+'"]'); const ai=aiSel?aiSel.value.split(',') : []; if(cur.rules[i]){ cur.rules[i].text=t.value.trim(); cur.rules[i].ai=ai; } });
    cur.rules=cur.rules.filter(r=>r&&r.text);
    const scope=[];
    if(m.querySelector('[data-bl-scope="chapter"]')&&m.querySelector('[data-bl-scope="chapter"]').checked) scope.push('chapter');
    if(m.querySelector('[data-bl-scope="planner"]')&&m.querySelector('[data-bl-scope="planner"]').checked) scope.push('planner');
    if(m.querySelector('[data-bl-scope="outline"]')&&m.querySelector('[data-bl-scope="outline"]').checked) scope.push('outline');
    if(m.querySelector('[data-bl-scope="title"]')&&m.querySelector('[data-bl-scope="title"]').checked) scope.push('title');
    cur.scopeAi = scope.length?scope:BANLIST_DEFAULT.scopeAi.slice();
    state.banList=cur; persist(); renderNarrativeEngineMenu();
    toast('禁则清单已保存'); return true;
  }
  const reset=e.target.closest('[data-bl-reset]'); if(reset){
    state.banList=null; persist(); renderNarrativeEngineMenu();
    toast('已恢复默认禁则清单'); return true;
  }
  return false;
}
function renderIronPanel(){
  const ironOn = state._narrIron !== false;
  const langOn = state.langLayer !== false;
  const html = `
    <div class="ne-body ne-bl-body">
      <div class="ne-bl-enable">
        <label class="mini-check"><input type="checkbox" data-narr-iron2 ${ironOn?'checked':''}> <b>叙事铁律总开关（默认开，仅长篇生效）</b></label>
        <div class="bl-note muted">统一注入三大写作要求：硬约束（禁止/必须）为铁律不可逾越，软约束尽力而为、随题材微调。</div>
      </div>
      <div class="ne-bl-enable" style="margin-top:8px">
        <label class="mini-check"><input type="checkbox" data-lang-layer2 ${langOn?'checked':''}> <b>语言分层自动调节（默认开，仅长篇生效，不注入规划师）</b></label>
        <div class="bl-note muted">书面语造氛围、口语推剧情；随题材自动定语言底色。属叙事纪律（非文风词条）：不随写作风格预设迁移，仅作用于章节正文。</div>
      </div>
      <div style="margin-top:12px">
        <div style="font-weight:700;margin-bottom:4px">硬约束（铁律）</div>
        <div style="white-space:pre-wrap;font-size:12px;line-height:1.7;color:#333">${esc(NARRATIVE_IRON_HARD)}</div>
        <div style="font-weight:700;margin:10px 0 4px">软约束（引导）</div>
        <div style="white-space:pre-wrap;font-size:12px;line-height:1.7;color:#333">${esc(NARRATIVE_IRON_SOFT)}</div>
      </div>
    </div>`;
  openNeModal('叙事铁律 · 写作总纲', html, '<button class="btn ghost" data-ne-close>关闭</button>');
  const it=$('[data-narr-iron2]'); if(it) it.onchange = ()=>{ state._narrIron=it.checked; persist(); renderIronPanel(); };
  const lt=$('[data-lang-layer2]'); if(lt) lt.onchange = ()=>{ state.langLayer=lt.checked; persist(); renderIronPanel(); };
}

function renderBanListPanel(){
  const b = banListRaw();
  const enabled = stateBanEnabled();
  const chars = banListChars().map(esc).join(', ');
  const names = banListNames().map(esc).join(', ');
  const bRaw = banListRaw();
  const phrases = (Array.isArray(bRaw.phrases)?bRaw.phrases:[]).map(esc).join(', ');
  const rules = (Array.isArray(bRaw.rules)?bRaw.rules:[]).map((r,i)=>`
    <div class="ne-bl-rule">
      <label>生效 AI：<select data-bl-rule-ai="${i}">
        ${['chapter','planner','outline','title'].map(r2=>`<option value="${r2}" ${(Array.isArray(r.ai)&&r.ai.indexOf(r2)>=0)?'selected':''}>${r2==='chapter'?'正文':r2==='planner'?'规划师':r2==='outline'?'大纲':'标题'}</option>`).join('')}
      </select></label>
      <textarea data-bl-rule-text="${i}" rows="2">${esc(r.text||'')}</textarea>
      <button class="btn small ghost" data-bl-rule-del="${i}">删除</button>
    </div>`).join('');
  const aiScope = banListAiScopeLabels();
  const html = `
    <div class="ne-body ne-bl-body">
      <div class="ne-bl-enable">
        <label class="mini-check"><input type="checkbox" data-bl-enabled ${enabled?'checked':''}> <b>总开关：启用「禁则清单」对四个写作 AI 的注入</b></label>
      </div>
      <div class="bl-note muted">清单为「最高优先」约束，但不得超越输出格式红线（禁标题/json/markdown）与人名/专名一致性红线。</div>
      <label class="kv"><span class="k">禁用字</span>
        <input data-bl-chars value="${chars}" placeholder="逗号分隔，如：晚,砚,秋,檐"/>
      </label>
      <label class="kv"><span class="k">禁用姓名</span>
        <textarea data-bl-names rows="3">${names}</textarea>
      </label>
      <label class="kv"><span class="k">禁用短语/模板词（仅正文）</span>
        <input data-bl-phrases value="${phrases}" placeholder="逗号分隔，如：倏然,眸光"/>
      </label>
      <div class="ne-bl-rules-head">附加规则 <button class="btn small" data-bl-rule-add>＋ 新增规则</button></div>
      ${rules || '<div class="muted">暂无附加规则。</div>'}
      <div class="ne-bl-scope-head"><b>生效范围（按 AI）</b></div>
      <div class="ne-bl-scope">
        <label class="mini-check"><input type="checkbox" data-bl-scope="chapter" ${aiScope.chapter?'checked':''}> 正文</label>
        <label class="mini-check"><input type="checkbox" data-bl-scope="planner" ${aiScope.planner?'checked':''}> 规划师</label>
        <label class="mini-check"><input type="checkbox" data-bl-scope="outline" ${aiScope.outline?'checked':''}> 大纲</label>
        <label class="mini-check"><input type="checkbox" data-bl-scope="title" ${aiScope.title?'checked':''}> 标题</label>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-bl-save>保存</button>
        <button class="btn ghost" data-bl-reset>恢复默认</button>
      </div>
    </div>`;
  openNeModal('禁则清单', html);
}
function banListAiScopeLabels(){
  const b=banListRaw(); const sc=Array.isArray(b.scopeAi)?b.scopeAi:(BANLIST_DEFAULT.scopeAi||[]);
  return { chapter: sc.indexOf('chapter')>=0, planner: sc.indexOf('planner')>=0, outline: sc.indexOf('outline')>=0, title: sc.indexOf('title')>=0 };
}

function renderTitleCandidates(candidates, onSelect){
  if(!Array.isArray(candidates) || candidates.length<2){ onSelect && onSelect(0); return; }
  const cards=candidates.map((cand,i)=>`
    <div class="ne-candidate">
      <div class="ne-cand-head">方案 ${String.fromCharCode(65+i)}</div>
      <div class="ne-cand-meta">数量契约：${cand.valid?'✓':'✗'} · 相邻重名：${(cand.dupRate||0).toFixed(2)} · 专名命中：${(cand.glossRate||0).toFixed(2)}</div>
      <div class="ne-cand-list">${esc((cand.titles||[]).join('\n'))}</div>
      <div class="ne-cand-actions"><button class="btn primary" data-ne-title-select="${i}">应用方案 ${String.fromCharCode(65+i)}</button></div>
    </div>
  `).join('');
  openNeModal('标题候选方案', `<div class="ne-candidates">${cards}</div><p class="hint">选择一套方案后，章节标题将立即更新。</p>`);
  setTimeout(()=>{
    const m=$('#neModal');
    m.querySelectorAll('[data-ne-title-select]').forEach(b=>{
      b.onclick=()=>{ closeNeModal(); onSelect && onSelect(+b.dataset.neTitleSelect); };
    });
  },0);
}

let editCfg = null;        // 弹窗编辑中的工作副本（打开时从 getCfg 深拷贝）
let selGroupId = null;     // 当前「组详情」区选中的组

function openSettings(){
  editCfg = JSON.parse(JSON.stringify(getCfg()));
  selGroupId = editCfg.active ? editCfg.active.groupId : (editCfg.groups[0] && editCfg.groups[0].id);
  $('#settingsModal').classList.remove('hidden');
  echoTemps();
  const st = $('#cfgStatus'); if(st){ st.className='status'; st.textContent=''; }
  renderGroupsList(); renderGroupDetail(); renderActiveSelects(); updateCfgBadge();
}
function closeSettings(){ $('#settingsModal').classList.add('hidden'); }

function echoTemps(){
  const c = editCfg || getCfg();
  $('#cfgTemp').value = (c.temperature==null ? '' : c.temperature);
}

function saveTemps(){
  const rd = (id, def)=>{ const v=parseFloat($(id) && $(id).value); return isNaN(v)?def:v; };
  editCfg.temperature = rd('#cfgTemp', 0.7);
  const live = getCfg();
  const TM_FIELDS = ['ideaTemp','principalTemp','teacherTemp','dictmasterTemp','dictEnrichTemp','assetsTemp','titleTemp','chapterTemp','qcTemp','stripTemp','subplotTemp','rollingTemp','contentAdviseTemp','aiRecipeTemp'];
  TM_FIELDS.forEach(f=>{ if(live && typeof live[f]==='number') editCfg[f]=live[f]; });
}

function _curSpec(){
  const cfg = (editCfg && editCfg.groups) ? editCfg : getCfg();
  const act = cfg.active || {};
  const g = cfg.groups.find(x=>x.id===act.groupId) || cfg.groups[0];
  const m = g && (g.models.find(x=>x.name===act.model) || g.models[0]);
  const k = g && (g.keys.find(x=>x.id===act.keyId) || g.keys[0]);
  return { group: g?g.label:'', key: k?k.label:'', model: m?m.name:'', flash: !!(m && m.kind==='flash') };
}
function shortModel(name){
  if(!name) return '';
  if(name.indexOf('deepseek-v4-')===0) return name.replace('deepseek-v4-','');
  const parts=name.split('-');
  return parts.length>1 ? parts.slice(-1)[0] : name;
}
function updateCfgBadge(){
  const b=$('#cfgBadge'); if(!b) return;
  const s=_curSpec();
  b.textContent = (s.group?'':'AI') + s.group + ' · ' + (shortModel(s.model)||'未选') + (s.flash?' ⚡':'');
  if(b.title != null) b.title='当前模型：'+s.group+' · '+s.key+' · '+s.model+'（点击切换）';
  updateTmBadge();
}

const TM_GROUPS = [
  { title:'🧠 前置 · 构想（项目起点）', keys:[
    ['idea','故事构想 / 优化构想','生成与优化故事点子、多方向方案比选']
  ]},
  { title:'🏛️ 学校统筹与设定架构（核心大脑，建议主力模型）', keys:[
    ['principal','👑 校长总控','长篇小说治学总舵手：统领全量材料，产出全校守则、组级框架与章节标题'],
    ['teacher','🎓 老师备课','任课教师分段教案：逐章备好推进骨架、情境推进与微拍融合'],
    ['dictmaster','📖 词典达人','全局设定架构师：AI 生成万物词典（人物十维+人物关系表+地名关联表+专名关联表+世界观规则）'],
    ['dictEnrich','🗂 词典充实','设定细化工坊：为正文补充人物感官特征、地名场景禁忌与氛围路人龙套']
  ]},
  { title:'✍️ 正文重创作（费用大头，建议主力模型）', keys:[
    ['chapter','正文生成','全书正文质量与费用大头；所选模型须支持流式（stream）']
  ]},
  { title:'🔧 每章/每批 · 轻维护（高频小请求，建议 flash 省钱）', keys:[
    ['strip','本章梗概（速读）','每章生成后都会调用'],
    ['subplot','副线追踪','小 JSON 追踪任务'],
    ['glossary','词典提取','JSON 严谨任务；换弱模型解析失败率会升高（有校验兜底，不阻断）'],
    ['rolling','滚动摘要','长篇记忆层，每批正文后调用']
  ]},
  { title:'💡 写作补充与资产', keys:[
    ['contentAdvice','章节内容 AI 建议','JSON 任务'],
    ['assets','封面/人物/场景/分镜','提示词类产出'],
    ['recipe','AI 配方助手','候选配方需判断力；写风配方卡']
  ]}
];

const TM_TEMP = {
  idea:['ideaTemp',0.5],
  principal:['principalTemp',0.4],
  teacher:['teacherTemp',0.4],
  dictmaster:['dictmasterTemp',0.4],
  dictEnrich:['dictEnrichTemp',0.4],
  chapter:['chapterTemp',0.5],
  strip:['stripTemp',1.0],
  subplot:['subplotTemp',0.25],
  glossary:['qcTemp',0.2],
  rolling:['rollingTemp',0.3],
  contentAdvice:['contentAdviseTemp',0.6],
  assets:['assetsTemp',0.7],
  recipe:['aiRecipeTemp',0.9]
};
let editTM = null;          // 面板暂存：保存前绝不落盘（对齐设置弹窗 editCfg 模式）
let editTemps = {};
let _tmEscHandler = null;   // ESC 关闭挂钩（现有 modal 无全局 ESC，本面板自持）
function tmCustomCount(tm){ return TM_KEYS.filter(k=> tm && tm[k]).length; }
function updateTmBadge(){
  const n = tmCustomCount(getCfg().taskModels);
  const el = $('#tmBadge'); if(el) el.textContent = n ? ('已自定义 '+n+' 项') : '全部跟随全局';
  const b = $('#cfgBadge'); if(b) b.classList.toggle('tm-on', n>0);
}
function tmResolvePreview(triple){
  if(!triple) return '跟随全局';
  const cfg = getCfg();
  const g = cfg.groups.find(x=>x.id===triple.groupId);
  if(!g) return '⚠️ 服务组不存在（保存后仍会回落全局）';
  const k = (g.keys||[]).find(x=>x.id===triple.keyId) || (g.keys||[])[0];
  const m = (g.models||[]).find(x=>x.name===triple.model) || (g.models||[])[0];
  return '实际:' + (g.label||'') + ' · ' + (k?(k.label||'账号'):'⚠️ 无账号') + ' · ' + (m?m.name:'⚠️ 无模型');
}
function openTaskModelPanel(){
  editTM = JSON.parse(JSON.stringify(getCfg().taskModels || {}));
  editTemps = {};
  const g0 = getCfg();
  Object.keys(TM_TEMP).forEach(k=>{ const f=TM_TEMP[k][0]; if(f && !(f in editTemps)) editTemps[f]=(g0[f]==null?TM_TEMP[k][1]:g0[f]); });
  $('#taskModelModal').classList.remove('hidden');
  const st=$('#tmStatus'); if(st){ st.className='status'; st.textContent=''; }
  renderTaskModelPanel();
  _tmEscHandler = (e)=>{ if(e.key==='Escape') requestCloseTaskModelPanel(); };
  document.addEventListener('keydown', _tmEscHandler);
}
function closeTaskModelPanel(){
  $('#taskModelModal').classList.add('hidden');
  if(_tmEscHandler){ document.removeEventListener('keydown', _tmEscHandler); _tmEscHandler=null; }
  editTM = null; editTemps = {};
}
function requestCloseTaskModelPanel(){
  if(editTM && JSON.stringify(editTM) !== JSON.stringify(getCfg().taskModels || {})){
    if(!window.confirm('分任务模型有未保存的更改，放弃并关闭？')) return;
  }
  closeTaskModelPanel();
}
function refreshTmResetBtn(){
  const btn=$('#btnTmReset'); if(!btn) return;
  const n = tmCustomCount(editTM||{});
  btn.classList.toggle('hidden', n===0);
  btn.textContent = '全部恢复跟随全局（'+n+' 项自定义）';
}
function renderTaskModelPanel(){
  const body = $('#tmBody'); if(!body) return;
  const cfg = getCfg();
  const cur = cfg.active || {};
  const curGroup = cfg.groups.find(g=>g.id===cur.groupId) || cfg.groups[0] || {};
  const curKey = (curGroup.keys||[]).find(k=>k.id===cur.keyId) || (curGroup.keys||[])[0];
  const curModel = (curGroup.models||[]).find(m=>m.name===cur.model) || (curGroup.models||[])[0];
  const optHtml = (arr, val, ph)=> arr.length
    ? arr.map(x=>`<option value="${esc(String(x.v))}" ${String(x.v)===String(val)?'selected':''}>${esc(x.t)}</option>`).join('')
    : `<option value="">${esc(ph)}</option>`;
  const row = (key, name, note)=>{
    const tm = editTM[key] || '';
    const gid = tm ? tm.groupId : '';
    const grp = cfg.groups.find(g=>g.id===gid);
    const kid = tm ? tm.keyId : '';
    const mid = tm ? tm.model : '';
    const tf = TM_TEMP[key];
    const tval = tf ? (editTemps[tf[0]]==null ? tf[1] : editTemps[tf[0]]) : '';
    return `<div class="tm-row${tm?' tm-custom':''}" data-tm-row="${key}">
      <div class="tm-head"><span class="tm-name">${esc(name)}</span><span class="tm-note">${esc(note||'')}</span>
        ${tf?`<input type="number" inputmode="decimal" step="0.05" min="0" max="2" class="tm-temp" data-tm-temp="${key}" value="${tval}" placeholder="温度 ${tf[1]}" title="${esc(name)} 的 AI 温度（留空并保存＝恢复建议值）">`:'<span class="tm-temp-void"></span>'}
      </div>
      <div class="tm-sels">
        <select data-tm-sel="group" data-tm-key="${key}">
          <option value="">跟随全局</option>
          ${cfg.groups.map(g=>`<option value="${esc(g.id)}" ${gid===g.id?'selected':''}>${esc(g.label)}</option>`).join('')}
        </select>
        <select data-tm-sel="key" data-tm-key="${key}" ${grp?'':'disabled'}>${optHtml((grp?(grp.keys||[]):[]).map(k=>({v:k.id,t:k.label||'账号'})), kid, '（该组无账号）')}</select>
        <select data-tm-sel="model" data-tm-key="${key}" ${grp?'':'disabled'}>${optHtml((grp?(grp.models||[]):[]).map(m=>({v:m.name,t:m.name})), mid, '（该组无模型）')}</select>
      </div>
      <div class="tm-preview${tm?'':' tm-follow'}">${esc(tmResolvePreview(tm||null))}</div>
    </div>`;
  };
  body.innerHTML = `
    <div class="cv-div">可按任务独立指定模型与 AI 温度，灵活平衡质量与效率。留空温度表示跟随建议值。</div>
    <div class="set-block">
      <div class="set-block-head"><span>◆ 全局默认（未单独设置的任务都用它）</span></div>
      <div class="tm-preview">${esc((curGroup.label||'AI') + ' · ' + (curKey?(curKey.label||'账号'):'⚠️ 无账号') + ' · ' + (curModel?curModel.name:'⚠️ 无模型'))}（只读；去上方「AI 模型配置」修改）</div>
    </div>
    ${TM_GROUPS.map(gr=>`<div class="set-block"><div class="set-block-head"><span>${esc(gr.title)}</span></div>${gr.keys.map(k=>row(k[0],k[1],k[2])).join('')}</div>`).join('')}`;
  $$('#tmBody [data-tm-sel]').forEach(sel=>{
    sel.onchange = ()=>{
      const key = sel.dataset.tmKey, level = sel.dataset.tmSel;
      const cfgNow = getCfg();
      const tm = editTM[key] || '';
      if(level==='group'){
        if(!sel.value){ editTM[key]=''; }
        else{
          const grp = cfgNow.groups.find(g=>g.id===sel.value);
          editTM[key] = grp ? { groupId:grp.id, keyId:((grp.keys||[])[0]||{}).id||'', model:((grp.models||[])[0]||{}).name||'' } : '';
        }
      }else if(tm){
        if(level==='key') tm.keyId = sel.value;
        if(level==='model') tm.model = sel.value;
      }
      renderTaskModelPanel();
      refreshTmResetBtn();
    };
  });
  $$('#tmBody [data-tm-temp]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const tf = TM_TEMP[inp.dataset.tmTemp]; if(!tf) return;
      const v = parseFloat(inp.value);
      editTemps[tf[0]] = (inp.value==='' || isNaN(v)) ? tf[1] : v;
      renderTaskModelPanel();
      refreshTmResetBtn();
    });
  });
  refreshTmResetBtn();
}
function saveTaskModels(){
  const cfg = getCfg();
  const clean = {};
  TM_KEYS.forEach(k=>{
    const v = editTM && editTM[k];
    const ok = v && typeof v==='object' && v.groupId && v.keyId && v.model && cfg.groups.some(g=>g.id===v.groupId);
    clean[k] = ok ? { groupId:v.groupId, keyId:v.keyId, model:v.model } : '';
  });
  const c = getCfg(); c.taskModels = clean;
  Object.keys(TM_TEMP).forEach(k=>{ const f=TM_TEMP[k][0]; if(f && editTemps && (f in editTemps)) c[f]=editTemps[f]; });
  saveCfg(c);
  const n = tmCustomCount(clean);
  const nT = Object.keys(TM_TEMP).filter(k=>{ const f=TM_TEMP[k][0]; return f && editTemps && editTemps[f]!=null; }).length;
  closeTaskModelPanel();
  updateCfgBadge();
  toast(n ? ('分任务模型已保存：'+n+' 项自定义，其余跟随全局') : '分任务模型已保存：全部跟随全局')+(nT?('；已同步 '+nT+' 项任务温度'):'');
}

function renderGroupsList(){
  const el=$('#groupsList'); if(!el) return;
  el.innerHTML='';
  if(!editCfg.groups.length){ el.innerHTML='<div class="muted">暂无服务，点上方「＋ 新增组」添加。</div>'; return; }
  editCfg.groups.forEach(g=>{
    if(!selGroupId) selGroupId=g.id;
    const d=document.createElement('div');
    d.className='group-item' + (g.id===selGroupId ? ' active' : '');
    d.innerHTML = `<span class="gi-label">${esc(g.label)}</span><span class="gi-meta">${g.keys.length} 账号 · ${g.models.length} 模型</span>`;
    d.onclick = ()=>{ selGroupId=g.id; renderGroupsList(); renderGroupDetail(); };
    el.appendChild(d);
  });
}

function _dg(){ return editCfg.groups.find(x=>x.id===selGroupId) || editCfg.groups[0]; }
function renderGroupDetail(){
  const el=$('#groupDetail'); if(!el) return;
  const g=_dg();
  if(!g){ el.innerHTML='<div class="muted">选择左侧一个服务，或点上方「＋ 新增组」添加。</div>'; return; }
  selGroupId=g.id;
  el.innerHTML = `
    <div class="set-block-head">
      <span>${esc(g.label)} · 详情</span>
      <span class="gd-acts">
        <button class="btn small ghost" data-act="addkey" type="button">＋ 账号</button>
        <button class="btn small ghost" data-act="addmodel" type="button">＋ 模型</button>
        ${g.id!=='deepseek' ? '<button class="btn small ghost del" data-act="delgroup" type="button">删组</button>' : ''}
      </span>
    </div>
    <label class="field"><span>接口地址（OpenAI 兼容协议）</span>
      <input class="g-base" type="text" value="${esc(g.baseUrl)}" placeholder="https://api.deepseek.com">
    </label>
    <label class="mini-check g-kib" title="部分 Cloudflare 中转不读 Authorization 头，要求把 Key 放进请求体 api_key 字段。开启后请求将不再携带 Bearer 头。">
      <input type="checkbox" class="g-kib-cb" ${g.keyInBody?'checked':''}> API Key 放请求体（api_key）传递，规避 Bearer 头
    </label>
    <div class="gd-title">账号（API Key 仅存本机，多账号=多卡分流）</div>
    ${g.keys.length ? g.keys.map((k,i)=>`
      <div class="key-row">
        <input class="k-lab" data-idx="${i}" type="text" value="${esc(k.label)}" placeholder="备注">
        <input class="k-key" data-idx="${i}" type="password" value="${esc(k.key)}" placeholder="sk-..." autocomplete="off">
        <button class="btn small ghost k-eye" data-key-eye="${i}" type="button" title="显示/隐藏 Key">👁</button>
        <button class="btn small ghost k-copy" data-key-copy="${i}" type="button" title="复制 Key">📋</button>
        <button class="btn small ghost del" data-act="delkey" data-id="${k.id}" type="button">删</button>
      </div>`).join('') : '<div class="muted">该组还没有账号，点「＋ 账号」粘贴 API Key。</div>'}
    <div class="gd-title">模型清单</div>
    ${g.models.length ? g.models.map(m=>`
      <div class="model-row">
        <span class="m-name">${esc(m.name)}</span>
        ${m.kind==='flash' ? '<span class="pill tag-warn">最快/最便宜</span>' : ''}
        <button class="btn small ghost del" data-act="delmodel" data-name="${esc(m.name)}" type="button">删</button>
      </div>`).join('') : '<div class="muted">请点「＋ 模型」添加模型名。</div>'}
  `;
  el.onclick = onDetail;
  el.querySelectorAll('.k-lab').forEach(inp=> inp.onchange=()=>{ const gg=_dg(); gg.keys[+inp.dataset.idx].label = inp.value || ('账号'+(+inp.dataset.idx+1)); });
  el.querySelectorAll('.k-key').forEach(inp=> { inp.onchange=()=>{ const gg=_dg(); gg.keys[+inp.dataset.idx].key = inp.value.trim(); updateCfgBadge(); }; });
  el.querySelectorAll('[data-key-eye]').forEach(btn=>{
    btn.onclick = ()=>{
      const inp = el.querySelector('.k-key[data-idx="'+btn.dataset.keyEye+'"]');
      if(!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.textContent = show ? '🙈' : '👁';
      btn.title = show ? '隐藏 Key' : '显示 Key';
    };
  });
  el.querySelectorAll('[data-key-copy]').forEach(btn=>{
    btn.onclick = ()=>{
      const inp = el.querySelector('.k-key[data-idx="'+btn.dataset.keyCopy+'"]');
      if(!inp || !inp.value.trim()){ toast('该账号暂无 Key'); return; }
      copyText(inp.value.trim());
    };
  });
  const base = el.querySelector('.g-base'); if(base) base.onchange=(ev)=>{ const gg=_dg(); gg.baseUrl = ev.target.value.trim(); };
  const kib = el.querySelector('.g-kib-cb'); if(kib) kib.onchange=(ev)=>{ const gg=_dg(); gg.keyInBody = ev.target.checked; };
}
function onDetail(ev){
  const b = ev.target && ev.target.closest('[data-act]'); if(!b) return;
  const act = b.dataset.act, g = _dg(); if(!g) return;
  if(act==='addkey'){
    const v=prompt('粘贴该账号的 API Key（sk-...）：');
    if(v==null) return;
    if(!v.trim()){ toast('Key 为空，未添加'); return; }
    g.keys.push({ id: uid('k'), label:'账号'+(g.keys.length+1), key:v.trim() });
  } else if(act==='addmodel'){
    const n=prompt('模型名（如 deepseek-v4-flash 或第三方模型名）：');
    if(n==null) return;
    if(!n.trim()){ toast('模型名为空，未添加'); return; }
    g.models.push({ name:n.trim(), label:n.trim(), kind:'' });
  } else if(act==='delkey'){
    g.keys = g.keys.filter(x=>x.id!==b.dataset.id);
  } else if(act==='delmodel'){
    g.models = g.models.filter(x=>x.name!==b.dataset.name);
  } else if(act==='delgroup'){
    editCfg.groups = editCfg.groups.filter(x=>x.id!==g.id);
    selGroupId = null;
  }
  refreshAfter();
}
function refreshAfter(){ renderGroupsList(); renderGroupDetail(); renderActiveSelects(); updateCfgBadge(); }

function addGroup(){
  const label=prompt('新服务名称（如：Kimi / 智谱 / 我的中转）：');
  if(label==null) return;
  if(!label.trim()){ toast('名称为空，未添加'); return; }
  const base=prompt('接口地址（OpenAI 兼容，如 https://api.deepseek.com）：','');
  const g={ id:uid('g'), kind:'openai', label:label.trim(), baseUrl:(base||'').trim(), keys:[], models:defaultModels(), keyInBody:false };
  editCfg.groups.push(g); selGroupId=g.id; refreshAfter();
}

function renderActiveSelects(){
  const selG=$('#c_selGroup'), selK=$('#c_selKey'), selM=$('#c_selModel');
  if(!selG || !editCfg) return;
  const act = editCfg.active || {};
  selG.innerHTML = editCfg.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');
  selG.value = editCfg.groups.some(g=>g.id===act.groupId) ? act.groupId : (editCfg.groups[0]?editCfg.groups[0].id:'');
  const g = editCfg.groups.find(x=>x.id===selG.value) || editCfg.groups[0];
  const keys = g?g.keys:[];
  selK.innerHTML = keys.map(k=>`<option value="${esc(k.id)}">${esc(k.label)}${k.key?'':'（未填）'}</option>`).join('');
  selK.value = keys.some(k=>k.id===act.keyId) ? act.keyId : (keys[0]?keys[0].id:'');
  const models = g?g.models:[];
  selM.innerHTML = models.map(m=>`<option value="${esc(m.name)}">${esc(m.label)}${m.kind==='flash'?' ⚡':''}</option>`).join('');
  selM.value = models.some(m=>m.name===act.model) ? act.model : (models[0]?models[0].name:'');
}

function saveSettings(){
  if(!editCfg){ return; }
  saveTemps();
  const selG=$('#c_selGroup'), selK=$('#c_selKey'), selM=$('#c_selModel');
  if(selG){
    const gId=selG.value || (editCfg.groups[0] && editCfg.groups[0].id);
    editCfg.active = { groupId:gId, keyId:(selK&&selK.value)||null, model:(selM&&selM.value)||'' };
  }
  saveCfg(editCfg);
  const st=$('#cfgStatus'); if(st){ st.className='status ok'; st.textContent='已保存到本机浏览器。'; }
  toast('配置已保存');
  updateCfgBadge();
}
async function testConn(){
  const st = $('#cfgStatus'); if(st){ st.className='status'; st.textContent='测试中…'; }
  saveSettings();
  try{
    const r = unwrapAIResult(await callDeepSeek('你是测试助手，只回复「ok」。','你好'));
    if(st){ st.className='status ok'; st.textContent='连接成功：'+r.slice(0,20); }
  }catch(e){
    if(st){
      st.className='status err';
      let msg = e.message;
      if(/insufficient balance/i.test(msg)) msg += '（账户余额不足，请到对应控制台充值，不是 Key 填错）';
      else if(/not found.*model/i.test(msg)) msg += '（模型名不存在，请检查当前所选模型）';
      st.textContent='连接失败：'+msg;
    }
  }
}

function showBootLoading(show){
  const el = $('#bootLoading'); if(!el) return;
  el.classList.toggle('hidden', !show);
}
async function init(){
  showBootLoading(true);
  try{ await loadState(); }catch(e){ /* 兜底：保持空白 state，不卡死 */ }
  loadGlib();
  const c = getCfg();
  applyTheme(c.theme || 'dark');
  $('#btnSettings').onclick = openSettings;
  const btnLog = $('#btnAiLog');
  if(btnLog) btnLog.onclick = (e)=>{ e.stopPropagation(); openAiLogPanel(); };
  rebindHistPanel();
  rebindWsColorPanel();
  const btnTheme = $('#btnTheme');
  if(btnTheme) btnTheme.onclick = (e)=>{ e.stopPropagation(); const p=$('#themePanel'); if(p.classList.contains('hidden')) openThemePanel(); else closeThemePanel(); };
  initThemeSoundPanel();
  rebindNarrativeEngine();
  const btnTS = $('#btnTempSave');
  if(btnTS) btnTS.onclick = (e)=>{
    e.stopPropagation();
    if(!editCfg) editCfg = JSON.parse(JSON.stringify(getCfg()));
    saveTemps();
    saveCfg(editCfg);
    updateCfgBadge();
    toast('温度已保存');
  };
  document.addEventListener('click', (e)=>{
    const t = $('#themePanel'); if(t && !t.classList.contains('hidden') && !t.contains(e.target) && !e.target.closest('#btnTheme')) closeThemePanel();
    const h = $('#histPanel'); if(h && !h.classList.contains('hidden') && !h.contains(e.target) && !e.target.closest('#btnHist')) closeHistPanel();
    const col = $('#wsColorPanel'); if(col && !col.classList.contains('hidden') && !col.contains(e.target) && !e.target.closest('#btnWsColor')) closeWsColorPanel();
  });
  $$('[data-close]').forEach(b=> b.onclick = closeSettings);
  $('#btnCfgSave').onclick = ()=>{ saveSettings(); closeSettings(); };
  $('#btnCfgTest').onclick = testConn;
  $('#btnTaskModels').onclick = openTaskModelPanel;
  $('#btnTmSave').onclick = saveTaskModels;
  $('#btnTmReset').onclick = ()=>{
    if(!window.confirm('确定清除全部分任务设置，全部恢复跟随全局？')) return;
    TM_KEYS.forEach(k=>{ editTM[k]=''; });
    renderTaskModelPanel();
  };
  $$('#taskModelModal [data-tm-close]').forEach(el=> el.onclick = requestCloseTaskModelPanel);
  const btnAddG = $('#btnAddGroup'); if(btnAddG) btnAddG.onclick = addGroup;
  const selG=$('#c_selGroup'), selK=$('#c_selKey'), selM=$('#c_selModel');
  if(selG) selG.onchange = ()=>{ if(editCfg){ editCfg.active.groupId = selG.value; renderActiveSelects(); updateCfgBadge(); } };
  if(selK) selK.onchange = ()=>{ if(editCfg){ editCfg.active.keyId = selK.value; updateCfgBadge(); } };
  if(selM) selM.onchange = ()=>{ if(editCfg){ editCfg.active.model = selM.value; updateCfgBadge(); } };
  const cfgBadge=$('#cfgBadge'); if(cfgBadge) cfgBadge.onclick = openSettings;
  updateCfgBadge();
  $$('.theme-btns .theme').forEach(b=> b.onclick = ()=>{ applyTheme(b.dataset.theme); closeThemePanel(); });
  const mtn = $('#mechaTopNav');
  if(mtn){
    $$('.cap', mtn).forEach(c=> c.onclick = ()=>{
      if(c.dataset.export){ currentStep = 5; }
      else { currentStep = +c.dataset.step; }
      render(); window.scrollTo(0,0);
    });
  }
  $$('.tab').forEach(t=> t.onclick = ()=>{ if(!guardSwitchStep()) return; currentStep = +t.dataset.step; render(); window.scrollTo(0,0); });
  showBootLoading(false);
  render();
}
document.addEventListener('DOMContentLoaded', init);
(function brandVersion(){ const b = document.getElementById('verBadge'); if(b) b.textContent = ' v'+APP_VERSION; })();
