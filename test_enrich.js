
function parseDictEnrichText(txt){
  const res = { characters:[], places:[], propernouns:[], walkons:[] };
  if(!txt) return res;
  
  let cleaned = String(txt).trim()
    .replace(/^$/i, '')
    .trim();

  // JSON Fallback
  if(cleaned.startsWith('{') || cleaned.startsWith('[')){
    try {
      const j = JSON.parse(cleaned);
      const addChar = c => {
        if(c && c.name){
          res.characters.push({
            name: String(c.name).trim(),
            tier: (c.tier === 'main' || c.tier === '主要人物' || c.tier === '主要') ? 'main' : 'support',
            identity: c.identity || c.身份 || '',
            age: c.age || c.年龄 || '',
            gender: c.gender || c.性别 || '',
            appearance: c.appearance || c.外貌 || '',
            hobby: c.hobby || c.爱好 || '',
            relation: c.relation || c.关系 || '',
            trait: c.trait || c.性格 || '',
            catchphrase: c.catchphrase || c.口头禅 || ''
          });
        }
      };
      (j.characters || j.人物 || []).forEach(addChar);
      (j.places || j.地名 || []).forEach(p => { if(p && p.name) res.places.push({ name: String(p.name).trim(), type: p.type || p.类型 || '地名', note: p.note || p.说明 || '' }); });
      (j.propernouns || j.专名 || []).forEach(x => { if(x && x.name) res.propernouns.push({ name: String(x.name).trim(), note: x.note || x.说明 || '' }); });
      (j.walkons || j.路人 || j.龙套 || []).forEach(w => { if(w && w.name) res.walkons.push({ name: String(w.name).trim(), note: w.note || w.说明 || '', _auto:true, tier:'walkon' }); });
      if(res.characters.length || res.places.length || res.propernouns.length || res.walkons.length) return res;
    } catch(e){}
  }

  const parsePairs = detail => {
    const m = {};
    String(detail||'').split(/[；;，,
]/).forEach(seg=>{
      const s = String(seg||'').trim();
      if(!s) return;
      const kv = s.match(/^[ 	*#-]*([一-龥A-Za-z0-9/_\-\—]{1,16})[：:]\s*(.+)$/);
      if(!kv || !kv[1] || !String(kv[2]||'').trim()) return;
      m[kv[1].trim()] = kv[2].trim();
    });
    return m;
  };

  const lines = cleaned.split('
');
  for(const raw of lines){
    let ln = String(raw||'').trim();
    if(!ln) continue;
    // Strip markdown prefixes like #, -, *, 1., >
    ln = ln.replace(/^[ 	]*[#*>\d.\-—•]+[ 	.]*/, '').trim();
    if(!ln) continue;
    if(ln.startsWith('【') && ln.endsWith('】') && /新增|分类|类别|人物|地名|专名|路人|设定/.test(ln)) continue;

    // Split on any vertical bar: fullwidth ｜, halfwidth |, box drawing │, etc.
    let seg = ln.split(/[｜|│┆丨]/).map(s=>String(s||'').trim()).filter(Boolean);
    if(seg.length < 2){
      // Check if line formatted as: 主要人物：李逍遥 身份：...
      const m_cat = ln.match(/^(主要人物|次要配角|重要角色|配角|地名|专名|路人|龙套|闲人)[：:\s]+([^：:\s|｜]+)[：:\s]*(.*)$/);
      if(m_cat){
        seg = [m_cat[1], m_cat[2], m_cat[3]];
      } else {
        continue;
      }
    }

    let cat = seg[0].replace(/^[【\[\(（]?新增?/, '').replace(/[】\]\)）]?$/, '').trim();
    let name = seg[1].replace(/[*_`'"「」]/g, '').trim();
    if(!name) continue;
    const detail = seg.slice(2).join('；').trim();

    if(/路人|龙套|闲人/.test(cat)){
      res.walkons.push({ name, note: detail, _auto:true, tier:'walkon' });
      continue;
    }
    if(/人物|角色|主角|配角/.test(cat)){
      const tier = /主要人物|主角|重要角色/.test(cat) ? 'main' : 'support';
      const m = parsePairs(detail);
      const appParts = [
        m['外貌'] || m['外貌特征'] || m['外貌感官特征'] || m['感官特征'] || m['长相'] || '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ?  : ''
      ].filter(Boolean);
      const app = appParts.join(' ').trim();
      res.characters.push({
        name,
        tier,
        identity: m['身份'] || m['身份定位'] || m['简介'] || m['定位'] || '',
        age:      m['岁数'] || m['年龄'] || m['岁'] || '',
        gender:   m['性别'] || '',
        appearance: app || m['外貌'] || '',
        hobby:    m['爱好'] || '',
        relation: m['关系'] || m['人际关系'] || '',
        trait:    m['性格'] || m['性格要点'] || m['性格特征'] || m['核心动机'] || '',
        catchphrase: m['口头禅'] || m['口癖'] || m['台词'] || m['习惯'] || ''
      });
      continue;
    }
    if(/地名|地点|地方|场景/.test(cat)){
      const m = parsePairs(detail);
      const noteParts = [
        m['说明'] || m['备注'] || detail,
        (m['氛围特征'] || m['感官氛围特征'] || m['氛围']) ?  : '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ?  : ''
      ].filter(Boolean);
      res.places.push({ name, type: m['类型'] || m['类别'] || '地名', note: noteParts.join('；') });
      continue;
    }
    if(/专名|术语|名词|物件|势力|组织|功法|宝器|道具|法宝/.test(cat)){
      const m = parsePairs(detail);
      const noteParts = [
        m['说明'] || m['备注'] || detail,
        (m['功能特效'] || m['功能'] || m['特效']) ?  : '',
        (m['使用禁忌'] || m['使用禁忌/限制'] || m['禁忌'] || m['限制']) ?  : '',
        (m['描写标签'] || m['正文描写标签'] || m['标签']) ?  : ''
      ].filter(Boolean);
      res.propernouns.push({ name, note: noteParts.join('；') });
      continue;
    }
  }
  return res;
}

const sample = ;

const res = parseDictEnrichText(sample);
console.log('Parsed Characters:', res.characters.length);
console.log('Parsed Places:', res.places.length);
console.log('Parsed Propernouns:', res.propernouns.length);
console.log('Parsed Walkons:', res.walkons.length);
console.log(JSON.stringify(res, null, 2));
