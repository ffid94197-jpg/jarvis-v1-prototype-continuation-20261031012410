import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {
 isPublicMcpAddress,checkEndpoint,pinnedPublicHttpsPost
} from '../../src/lib/agent/adoption/mcp.mjs';
import {redactUntrustedToolData} from '../../src/lib/agent/adoption/redact.mjs';

// Offline transport fixtures: mocked DNS and HTTPS socket creation. No network,
// remote MCP, real Windows, model or API keys.
let checks=0;
function test(yes,label){assert.ok(yes,label);checks++;console.log('PASS',label);}
const publicIps=['8.8.8.8','1.1.1.1','2606:4700:4700::1111'];
const deniedIps=['127.0.0.1','10.1.0.1','172.16.0.1','192.168.0.1',
 '100.64.0.1','169.254.0.5','198.18.1.2','203.0.113.9',
 '192.0.2.50','0.0.0.0','224.0.0.1','255.255.255.255',
 '::1','fc00::1','fe80::1','2001:db8::1','::ffff:127.0.0.1'];
for(const ip of publicIps)test(isPublicMcpAddress(ip),'public IP '+ip);
for(const ip of deniedIps)test(!isPublicMcpAddress(ip),'private/reserved IP '+ip);

const raw={
 apiKey:'sensitive-a',access_token:'sensitive-b',
 nested:{authorization:'Bearer sensitive-c',safe:'ok'},
 headers:{cookie:'sensitive-d',Accept:'application/json'},
 output:'password=secret-value Bearer verysecret',
};
const redacted=redactUntrustedToolData(raw);
test(redacted.apiKey==='[redacted]','camelCase apiKey redacted');
test(redacted.access_token==='[redacted]','snake_case access token redacted');
test(redacted.nested.authorization==='[redacted]','nested auth redacted');
test(redacted.headers.Accept==='[redacted]','all header values redacted');
test(redacted.nested.safe==='ok','nonsensitive structured values remain');
test(!JSON.stringify(redacted).includes('sensitive'),'credential values absent from output');

const originalDns=dns.lookup;
const originalReq=https.request;
let requests=0;
let observed={};
try{
 dns.lookup=async()=>[{address:'8.8.8.8',family:4}];
 https.request=(url,opts,onResponse)=>{
  requests++;
  const request=new EventEmitter();
  request.end=(payload)=>{
   observed={hostname:url.hostname,servername:opts.servername,headers:opts.headers,payload};
   opts.lookup('public.example',{family:0},(error,address,family)=>{
    if(error){request.emit('error',error);return;}
    observed={...observed,address,family};
    const res=new PassThrough();
    res.statusCode=200;res.headers={'content-type':'application/json'};
    onResponse(res);
    process.nextTick(()=>res.end('{"jsonrpc":"2.0","id":1,"result":{}}'));
   });
  };
  request.destroy=error=>request.emit('error',error);
  return request;
 };
 const u=await checkEndpoint('https://public.example/mcp');
 const response=await pinnedPublicHttpsPost(u,{'content-type':'application/json'},'{"id":1}');
 const chunks=[];for await(const chunk of response.body)chunks.push(chunk);
 test(response.status===200 && Buffer.concat(chunks).toString('utf8').includes('jsonrpc'),
  'HTTPS request receives bounded JSON-RPC stream through pinned socket');
 test(observed.address==='8.8.8.8'&&observed.hostname==='public.example'&&
      observed.servername==='public.example'&&observed.family===4,
      'TLS hostname/SNI preserved while socket resolves to validated address');
 const before=requests;
 dns.lookup=async()=>[{address:'127.0.0.1',family:4}];
 await assert.rejects(pinnedPublicHttpsPost(u,{},'{}'),/restricted IP/);
 test(requests===before,'DNS rebinding to loopback blocks before socket creation');
 dns.lookup=async()=>[
  {address:'8.8.8.8',family:4},
  {address:'10.0.0.1',family:4}
 ];
 await assert.rejects(pinnedPublicHttpsPost(u,{},'{}'),/restricted IP/);
 test(requests===before,'mixed public/private DNS replies are denied');
}finally{
 dns.lookup=originalDns;
 https.request=originalReq;
}
console.log(JSON.stringify({passed:checks,offlineMock:true,liveRemoteMcp:false}));
