'use strict';
const assert=require('node:assert/strict');
const {MineAiMcp,localUrl,parseRpc}=require('./mine_ai_mcp_transport.cjs');
let passed=0;
function check(label,fn){fn();passed++;console.log('PASS',label);}
async function main(){
  check('only approved loopback endpoint',()=>{
    for(const url of ['http://10.1.1.1:25575/mcp','https://127.0.0.1:25575/mcp','http://127.0.0.1:25576/mcp','http://127.0.0.1:25575/mcp?x=1'])assert.throws(()=>localUrl(url));
    assert.equal(localUrl(),'http://127.0.0.1:25575/mcp');
  });
  check('SSE correlates response IDs',()=>{
    const s='data: {"jsonrpc":"2.0","id":9,"result":{"bad":true}}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"good":true}}\n\n';
    assert.deepEqual(parseRpc(s,'text/event-stream',2),{good:true});
    assert.throws(()=>parseRpc(s,'text/event-stream',6));
  });
  let calls=[];let seq=0;
  const tools=['view_status','wait_for_action','cancel_foreground_action','collect_block'];
  const fetchImpl=async (_url,options)=>{
    const req=JSON.parse(options.body);calls.push(req);let result;
    if(req.method==='initialize')result={serverInfo:{name:'Mine AI MCP'}};
    if(req.method==='tools/list')result={tools:tools.map(name=>({name}))};
    if(req.method==='tools/call'){
      const name=req.params.name;
      if(name==='view_status')result={structuredContent:{response:{format:'json',data:{dimension:'minecraft:overworld',position:{x:1,y:2,z:3}}}}};
      if(name==='collect_block')result={structuredContent:{response:{format:'json',data:{state:'accepted',actionId:'action-1'}}}};
      if(name==='wait_for_action')result={structuredContent:{response:{format:'json',data:{state:seq++? 'settled':'pending',actionId:'action-1',output:{result:'success',inventoryAfter:1}}}}};
      if(name==='cancel_foreground_action')result={structuredContent:{response:{format:'json',data:{requested:true}}}};
    }
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({jsonrpc:'2.0',id:req.id,result})};
  };
  const c=new MineAiMcp({fetchImpl});await c.connect();
  assert.equal((await c.observe()).position.x,1);passed++;console.log('PASS status reads real tool response');
  const outcome=await c.action('collect_block',{block:'oak_log'});
  assert.equal(outcome.state,'settled');passed++;console.log('PASS accepted→pending→settled action tracking');
  assert.equal(calls.find(x=>x.params?.name==='collect_block').params.arguments.response_format,'json');
  assert.ok(calls.find(x=>x.params?.name==='collect_block').params.arguments.submission_id);
  await assert.rejects(()=>c.call('unknown'));passed++;console.log('PASS unadvertised tools rejected');
  await assert.rejects(()=>c.action('view_status'));passed++;console.log('PASS observation is not a foreground action');
  const pending=await new MineAiMcp({fetchImpl:async(_url,o)=>{
    const req=JSON.parse(o.body);const result=req.method==='initialize'?{serverInfo:{name:'Mine AI MCP'}}:req.method==='tools/list'?{tools:tools.map(name=>({name}))}:{structuredContent:{response:{format:'json',data:{state:'accepted',actionId:'a'}}}};
    return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({jsonrpc:'2.0',id:req.id,result})};
  }});
  await pending.connect();const state=await pending.action('collect_block',{}, {maxWaitMs:0});
  assert.equal(state.state,'pending');passed++;console.log('PASS timeout does not fabricate success or cancellation');
  console.log('MINE_AI_MCP_BRIDGE',passed,'PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
