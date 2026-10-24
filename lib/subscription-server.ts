import { NextResponse } from "next/server";
const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export async function getAuthenticatedUser(token: string) {
 const url=supabaseUrl(), key=supabaseKey(); if(!url||!key||!token)return null;
 const response=await fetch(url+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+token},cache:"no-store"});
 if(!response.ok)return null; return await response.json() as {id:string;email?:string};
}
export async function callSupabaseRpc<T>(name:string,token:string,args:Record<string,unknown>={}):Promise<T>{
 const url=supabaseUrl(),key=supabaseKey();if(!url||!key)throw new Error("Subscription service is not configured.");
 const response=await fetch(url+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:key,Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(args),cache:"no-store"});
 const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(payload&&typeof payload.message==="string"?payload.message:"Subscription request failed.");return payload as T;
}
export function bearerToken(request:Request):string|null{const match=(request.headers.get("authorization")??"").match(/^Bearer\\s+(.+)$/i);return match?.[1]??null;}
export function serviceUnavailable(){return NextResponse.json({error:"Subscription service is temporarily unavailable."},{status:503,headers:{"Cache-Control":"no-store"}});}
