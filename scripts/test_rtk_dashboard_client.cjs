// Functional DOM/timer contract check; not browser rendering evidence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const template=fs.readFileSync(path.join(__dirname,'../templates/reports/rtk-efficiency.template.html'),'utf8');
const code=[...template.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
function fixture(count=2){return {collected_at:'2026-10-08T07:00:00Z',collection_date_kst:'2026-10-08',summary:{total_commands:count,total_input:100,total_output:60,total_saved:40,avg_savings_pct:40},daily:[{date:'2026-10-08',commands:count,input_tokens:100,output_tokens:60,saved_tokens:40,savings_pct:40}],probe:{checked_at:'2026-10-08T05:25:00Z',raw_bytes:84,filtered_bytes:66,raw_exit:0,filtered_exit:0,required_evidence_preserved:true,recorded_invocation_delta:1},arithmetic_difference:0,live:{enabled:true}};}
function app(live=true){
 const elements=new Map(),timers=new Map(),docEvents={},windowEvents={};let timerID=0,calls=0,response=fixture(3),failure=false,pending=null;
 for(const [,id] of template.matchAll(/\bid="([^"]+)"/g))elements.set(id,{textContent:'',innerHTML:'',style:{},value:id==='sort'?'desc':'all',clientWidth:700,hidden:id==='live-toggle',events:{},addEventListener(name,fn){this.events[name]=fn;},querySelectorAll(){return [];}});
 const initial=fixture();initial.live.enabled=live;elements.get('rtk-report-data').textContent=JSON.stringify(initial);
 const doc={hidden:false,getElementById:id=>{assert.ok(elements.has(id),id);return elements.get(id);},querySelectorAll:()=>[],addEventListener:(name,fn)=>docEvents[name]=fn};
 const context=vm.createContext({document:doc,window:{innerWidth:1000,addEventListener:(name,fn)=>windowEvents[name]=fn},location:{hostname:live?'127.0.0.1':'',protocol:live?'http:':'file:'},Intl,Date,Number,Math,JSON,AbortController,
  setTimeout:(fn,delay)=>{const id=++timerID;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
  fetch:async(url,options)=>{calls++;assert.equal(url,'/api/rtk');assert.equal(options.cache,'no-store');if(pending)await pending;if(failure)throw Error('offline');return {ok:true,json:async()=>response};}});
 vm.runInContext(code,context);
 return {elements,timers,doc,docEvents,windowEvents,get calls(){return calls;},set response(value){response=value;},set failure(value){failure=value;},set pending(value){pending=value;},
  async tick(){const item=[...timers].find(([,t])=>t.delay<=30000);assert.ok(item,'scheduled poll');timers.delete(item[0]);await item[1].fn();},context};
}
(async()=>{
 const staticView=app(false);assert.equal(staticView.timers.size,0);assert.equal(staticView.elements.get('live-state').textContent,'저장 스냅샷');
 const a=app();const probe=a.elements.get('probe-date').textContent;
 await a.tick();assert.equal(a.calls,1);assert.match(a.elements.get('metrics').innerHTML,/>3</);assert.equal(a.elements.get('probe-date').textContent,probe);
 const previous=a.elements.get('collected').textContent,table=a.elements.get('daily-table').innerHTML;
 a.failure=true;await a.tick();assert.match(a.elements.get('live-state').textContent,/연결 오류/);assert.equal(a.elements.get('collected').textContent,previous);assert.equal(a.elements.get('daily-table').innerHTML,table);
 a.doc.hidden=true;a.docEvents.visibilitychange();assert.equal(a.timers.size,0);assert.match(a.elements.get('live-state').textContent,/탭 숨김/);
 a.doc.hidden=false;a.failure=false;a.docEvents.visibilitychange();await a.tick();assert.equal(a.calls,3);
 a.elements.get('live-toggle').events.click();assert.equal(a.timers.size,0);assert.match(a.elements.get('live-state').textContent,/일시정지/);
 a.elements.get('live-toggle').events.click();await a.tick();assert.equal(a.calls,4);
 a.response={...fixture(),summary:{total_commands:null}};await a.tick();assert.match(a.elements.get('live-state').textContent,/연결 오류/);assert.equal(a.elements.get('daily-table').innerHTML,table);
 // A blocked request cannot overlap when another event tries to poll.
 let release;a.response=fixture(4);a.pending=new Promise(resolve=>release=resolve);const underway=a.tick();await Promise.resolve();
 const calls=a.calls;await vm.runInContext('pollLive()',a.context);assert.equal(a.calls,calls);release();await underway;
 assert.match(a.elements.get('metrics').innerHTML,/>4</);assert.equal(a.elements.get('probe-date').textContent,probe);
 assert.match(a.elements.get('trend').innerHTML,/막대 차트/);a.windowEvents.pagehide();assert.equal(a.timers.size,0);
 console.log('PASS: static/live, refresh, retained probe, error, visibility, pause, validation, no overlap');
})().catch(error=>{console.error(error);process.exitCode=1;});
