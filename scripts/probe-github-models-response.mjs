const token=process.env.GITHUB_TOKEN;
if(!token)throw Error("Missing GITHUB_TOKEN");
const queries=[
 ["github-mini","https://models.github.ai/inference/chat/completions","openai/gpt-4.1-mini"],
 ["github-full","https://models.github.ai/inference/chat/completions","openai/gpt-4.1"],
 ["github-no-prefix","https://models.github.ai/inference/chat/completions","gpt-4.1-mini"],
 ["azure-legacy","https://models.inference.ai.azure.com/chat/completions","gpt-4.1-mini"]
];
for(const [name,url,model] of queries){
 try{
  const r=await fetch(url,{method:"POST",redirect:"manual",
   headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json",
    "Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},
   body:JSON.stringify({model,messages:[{role:"user",content:"Say only READY"}],max_tokens:32,stream:false}),
   signal:AbortSignal.timeout(25000)});
  const body=await r.text();
  let parsed;try{parsed=JSON.parse(body);}catch{}
  const content=parsed?.choices?.[0]?.message?.content;
  const summary={
   name,status:r.status,type:r.headers.get("content-type"),length:body.length,
   json:!!parsed,keys:parsed&&typeof parsed==="object"?Object.keys(parsed).slice(0,10):[],
   choices:Array.isArray(parsed?.choices)?parsed.choices.length:0,
   answerType:typeof content,answerLength:typeof content==="string"?content.length:0,
   locationHeaderPresent:!!r.headers.get("location")
  };
  console.log("MODEL_DIAG "+JSON.stringify(summary));
 }catch(e){console.log("MODEL_DIAG "+JSON.stringify({name,errorName:e?.name||"unknown"}))}
}
