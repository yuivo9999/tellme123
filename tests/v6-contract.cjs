const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../assets/core/story-contract.js'),'utf8');
const sandbox={window:{},console,Date,String,Number,Object,Array,Set,Math,JSON};vm.createContext(sandbox);vm.runInContext(src,sandbox);const c=sandbox.window.TellMeStoryContract;
assert(c&&c.version===1);assert.equal(c.spanDays('第1日·清晨','第5日·傍晚'),5);
let r=c.validateChapterContract({planned:{from:'第1日·清晨',to:'第5日·傍晚'},observed:{time:'第2日·晚上'},card:{beats:'① 第1日启动\n② 当日继续'}});
assert.equal(r.status,'FAIL');assert(r.issues.some(x=>x.code==='TIME_COVERAGE_INSUFFICIENT'));assert(r.issues.some(x=>x.code==='TIME_SKELETON_INSUFFICIENT'));
r=c.validateChapterContract({planned:{from:'第1日·清晨',to:'第5日·傍晚'},observed:{time:'第5日·傍晚'},card:{beats:'① 第1日启动\n② 第3日推进\n③ 第5日收束'}});assert.equal(r.status,'PASS');
console.log('v6 story contract tests: PASS');
