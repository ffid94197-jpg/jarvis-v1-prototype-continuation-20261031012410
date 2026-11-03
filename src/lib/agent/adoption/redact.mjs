// Copyright (c) 2026 OpenHands contributors.
// MIT licensed native JARVIS adaptation of
// OpenHands/software-agent-sdk/openhands-sdk/openhands/sdk/utils/redact.py
// Upstream blob 40bea01d5c08cf6b4bd0108c2ddb941891a6a7c1
// This module REDACTS untrusted connector receipts, not an execution permission.
// Detect common snake_case, dash-case and camelCase secret-bearing keys.
// Do not blanket-redact arbitrary words containing "key" (e.g. monkey).
const secret = ['AUTHORIZATION','COOKIE','CREDENTIAL','APIKEY','PASSWORD',
  'SECRET','SESSION','TOKEN','PRIVATEKEY','ACCESSKEY','REFRESHTOKEN',
  'CLIENTSECRET','PASSPHRASE'];
const deep = new Set(['environment','env','headers']);
function keyIsSecret(k){
 const s=String(k).toUpperCase().replace(/[^A-Z0-9]/g,'');
 return secret.some(p=>s.includes(p)) ||
   ['KEY','APIKEY','PRIVATEKEY','ACCESSKEY'].includes(s);
}
function redactAll(value,depth=0){
 if(depth>12)return '[redacted]';
 if(Array.isArray(value))return value.slice(0,200).map(v=>redactAll(v,depth+1));
 if(value&&typeof value==='object')
   return Object.fromEntries(Object.entries(value).slice(0,200).map(([k,v])=>[k,redactAll(v,depth+1)]));
 return '[redacted]';
}
function redactText(value){
 return value
  .replace(/(Authorization\s*:\s*)[^\r\n]+/gi,'$1[redacted]')
  .replace(/(Bearer\s+)[a-z0-9._~+/-]{6,}/gi,'$1[redacted]')
  .replace(/((?:api[_-]?key|access[_-]?token|password|secret|client[_-]?secret|session[_-]?id|refresh[_-]?token)\s*[:=]\s*)[^\s,;}]+/gi,'$1[redacted]');
}
export function redactUntrustedToolData(value,depth=0) {
 if(depth>12)return '[redacted]';
 if(typeof value==='string'){
  const s=value.slice(0,20000);
  if(s.trim().startsWith('{')||s.trim().startsWith('[')){
    try{return JSON.stringify(redactUntrustedToolData(JSON.parse(s),depth+1));}catch{}
  }
  return redactText(s);
 }
 if(Array.isArray(value))return value.slice(0,200).map(v=>redactUntrustedToolData(v,depth+1));
 if(value&&typeof value==='object'){
  return Object.fromEntries(Object.entries(value).slice(0,200).map(([k,v])=>
   [k,deep.has(k.toLowerCase())?redactAll(v,depth+1):
     keyIsSecret(k)?'[redacted]':redactUntrustedToolData(v,depth+1)]));
 }
 return value;
}
