import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { analyzeHtml } from "@/lib/audit";
export const runtime = "nodejs";
export const maxDuration = 15;
function isPrivateIPv4(ip:string):boolean {
 const p=ip.split(".").map(Number); if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
 const [a,b]=p; return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19));
}
function isPrivateIPv6(ip:string):boolean { const s=ip.toLowerCase().split("%")[0]; return s==="::"||s==="::1"||s.startsWith("fc")||s.startsWith("fd")||/^fe[89ab]/.test(s)||s.startsWith("ff")||s.startsWith("::ffff:")&&isPrivateIPv4(s.slice(7)); }
async function validatePublicUrl(raw:string):Promise<URL>{
 let url:URL;try{url=new URL(raw)}catch{throw new Error("Enter a valid full URL, such as https://example.com.");}
 if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP and HTTPS URLs are supported.");
 if(url.username||url.password)throw new Error("URLs containing usernames or passwords are not allowed.");
 if(!url.hostname||url.hostname==="localhost"||url.hostname.endsWith(".localhost")||url.hostname.endsWith(".local")||url.hostname.endsWith(".internal"))throw new Error("Only publicly accessible websites are supported.");
 const hostname=url.hostname.replace(/^\[|\]$/g,"");const version=isIP(hostname);
 if(version===4&&isPrivateIPv4(hostname))throw new Error("Private or reserved IP addresses are not allowed.");
 if(version===6&&isPrivateIPv6(hostname))throw new Error("Private or reserved IP addresses are not allowed.");
 if(!version){let addresses;try{addresses=await lookup(hostname,{all:true,verbatim:true})}catch{throw new Error("The website hostname could not be resolved.");}if(!addresses.length||addresses.some(a=>a.family===4?isPrivateIPv4(a.address):isPrivateIPv6(a.address)))throw new Error("This hostname does not resolve exclusively to public IP addresses.");}
 url.hash="";return url;
}
export async function POST(request:Request){
 try{
  const body=await request.json();if(typeof body.url!=="string"||body.url.length>2048)return NextResponse.json({error:"Enter a URL under 2,048 characters."},{status:400});
  const url=await validatePublicUrl(body.url.trim());const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);let response:Response;
  try{response=await fetch(url,{method:"GET",redirect:"manual",signal:controller.signal,headers:{"User-Agent":"KanakoSEOAutoPilot/1.0 (+initial-html-audit)","Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"},cache:"no-store"})}finally{clearTimeout(timeout)}
  if(response.status>=300&&response.status<400)return NextResponse.json({error:"This page redirects. Enter the final destination URL directly; redirects are not followed for safety."},{status:422});
  if(!response.ok)return NextResponse.json({error:`The website returned HTTP ${response.status}.`},{status:422});
  const type=response.headers.get("content-type")||"";if(!type.toLowerCase().includes("text/html")&&!type.toLowerCase().includes("application/xhtml+xml"))return NextResponse.json({error:"The URL did not return an HTML page."},{status:422});
  const reader=response.body?.getReader();if(!reader)return NextResponse.json({error:"The page returned no readable content."},{status:422});
  const chunks:Uint8Array[]=[];let total=0;try{while(total<1000000){const {done,value}=await reader.read();if(done)break;const part=value.subarray(0,1000000-total);chunks.push(part);total+=part.length;if(part.length<value.length)break;}}finally{await reader.cancel().catch(()=>undefined)}
  const html=new TextDecoder().decode(Buffer.concat(chunks));const result=analyzeHtml(html);
  return NextResponse.json({...result,url:body.url.trim(),finalUrl:url.toString(),status:response.status,fetchedAt:new Date().toISOString()},{headers:{"Cache-Control":"no-store"}});
 }catch(error){const message=error instanceof Error?error.message:"The audit could not be completed.";const safe=message.includes("aborted")?"The website took too long to respond. Try again later.":message;return NextResponse.json({error:safe},{status:400});}
}
