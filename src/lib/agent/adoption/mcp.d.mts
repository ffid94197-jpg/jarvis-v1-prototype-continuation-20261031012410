export function checkEndpoint(url:string):Promise<URL>;
export function mcpOperation(owner:string,id:string,serverName:string,operation:string,name?:string,args?:Record<string,unknown>):Promise<any>;
