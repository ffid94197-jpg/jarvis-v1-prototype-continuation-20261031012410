import { NextRequest } from 'next/server';
import { requireActiveSession } from '@/lib/agent/auth/session';
import { mutationOriginError } from '@/lib/agent/auth/origin';
import { list,update,stageGitHub,stageRemote,activateSkill,AdoptionError } from '@/lib/agent/adoption/registry.mjs';
import { mcpOperation } from '@/lib/agent/adoption/mcp.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
function err(e:unknown){const x=e as {status?:number;message?:string};return Response.json({error:x?.message||'Integration operation failed'},{status:x?.status||502});}
async function gate(req:NextRequest,mutation:boolean){const auth=await requireActiveSession(req);if(!auth.ok)return {ok:false as const,response:auth.response};if(auth.ctx.role!=='OWNER')return {ok:false as const,response:Response.json({error:'Owner role required'},{status:403})};if(mutation){const origin=mutationOriginError(req.headers);if(origin)return {ok:false as const,response:Response.json({error:origin},{status:403})};}return {ok:true as const,id:auth.ctx.principalId};}
export async function GET(req:NextRequest){const g=await gate(req,false);if(!g.ok)return g.response;try{return Response.json({integrations:await list(g.id)},{headers:{'Cache-Control':'no-store'}});}catch(e){return err(e);}}
export async function POST(req:NextRequest){const g=await gate(req,true);if(!g.ok)return g.response;try{
 const raw=await req.text();if(raw.length>13000)throw new AdoptionError('Request too large');let b;try{b=JSON.parse(raw);}catch{return Response.json({error:'Invalid JSON'},{status:400});}if(!b||typeof b!=='object'||Array.isArray(b))return Response.json({error:'Invalid request object'},{status:400});
 if(b.action==='stage_github')return Response.json(await stageGitHub(g.id,b.url));
 if(b.action==='stage_remote')return Response.json(await stageRemote(g.id,b.url,b.name));
 if(['approve','disable','remove'].includes(b.action))return Response.json(await update(g.id,b.id,b.action));
 if(b.action==='activate_skill')return Response.json(await activateSkill(g.id,b.id,b.name));
 if(b.action==='mcp_list')return Response.json(await mcpOperation(g.id,b.id,b.server||'',b.operation||'list_tools'));
 if(b.action==='mcp_test')return Response.json(await mcpOperation(g.id,b.id,b.server||'','list_tools'));
 return Response.json({error:'Invalid integration action'},{status:400});
 }catch(e){return err(e);}}
