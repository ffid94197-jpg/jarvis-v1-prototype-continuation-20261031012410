"use strict";
const fs=require("node:fs");
const file="prompt-export/first-32-recorded-sampled-prompts.txt";
const text=fs.readFileSync(file,"utf8");
const regex=/==== SAMPLE (\d+) \| SOURCE ROW (\d+) \| SHA256 ([a-f0-9]{64}) ====\r?\n([\s\S]*?)\r?\n==== END SAMPLE \1 ====/g;
const found=[...text.matchAll(regex)].map(m=>({draw:Number(m[1]),row:Number(m[2]),sha:m[3],prompt:m[4].trim()}));
if(found.length!==32)throw Error("Exactly 32 verified samples required: "+found.length);
function score(p){
 const s=p.toLowerCase();
 const groups=[
  [/\b(?:autonomously|autonomous|automate|agent|assistant|system)\b/g,3],
  [/\b(?:build|implement|develop|deploy|create|run|execute|control|manage|operate|test|verify|debug|fix|install|research|researcher|browser|tool|file|code|program|task)\b/g,5],
  [/\b(?:step|phase|workflow|pipeline|end.to.end|multi.step|complete|complex|entire|from scratch|plan|project)\b/g,4],
  [/\b(?:without human|without supervision|until|continuously|recurring|independently|multiple|many|all|each)\b/g,5],
  [/\b(?:api|network|internet|github|terminal|windows|computer|web|database|python|javascript|browser|minecraft)\b/g,3],
  [/\b(?:constraints|requirements|security|accuracy|correct|consistency|evaluation|quality|edge cases|risk)\b/g,2]
 ];
 let n=0;
 for(const [re,weight] of groups)n+=Math.min(6,[...s.matchAll(re)].length)*weight;
 n+=Math.min(45,Math.floor(p.length/200));
 return n;
}
const ranked=found.map(x=>({...x,score:score(x.prompt)})).sort((a,b)=>b.score-a.score);
console.log("FIRST32_SAMPLES "+found.length);
for(const x of ranked.slice(0,12)){
 console.log("RANK sample="+x.draw+" row="+x.row+" score="+x.score+" sha="+x.sha);
 console.log("PROMPT_START "+x.prompt.slice(0,1600).replace(/\s+/g," "));
 console.log("PROMPT_END");
}
console.log("ALL32_SUMMARY");
for(const x of found)console.log("SAMPLE "+x.draw+" row="+x.row+" score="+score(x.prompt)+" chars="+x.prompt.length+" intro="+JSON.stringify(x.prompt.slice(0,180).replace(/\s+/g," ")));
