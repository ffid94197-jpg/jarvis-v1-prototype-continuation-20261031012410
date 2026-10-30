export class AdoptionError extends Error {status:number;constructor(message:string,status?:number)}
export const ROOT:string;
export function githubSpec(raw:string):{owner:string;repo:string;ref:string|null;subPath:string;source:string};
export function inspect(repoRoot:string,selected?:string):Promise<any>;
export function stageFromDirectory(owner:string,sourceDir:string,source:string,selected?:string):Promise<any>;
export function stageGitHub(owner:string,url:string):Promise<any>;
export function stageRemote(owner:string,endpoint:string,name?:string):Promise<any>;
export function list(owner:string):Promise<any[]>;
export function get(owner:string,id:string):Promise<any>;
export function update(owner:string,id:string,action:string):Promise<any>;
export function activateSkill(owner:string,id:string,skillName:string):Promise<any>;
