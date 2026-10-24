import { NextResponse } from "next/server";
import { bearerToken, getAuthenticatedUser } from "@/lib/subscription-server";
export const runtime="nodejs";
const plans={weekly:150,"15days":250,monthly:450} as const;
export async function POST(request:Request){
 const token=bearerToken(request);if(!token)return NextResponse.json({error:"Mag-login muna para mag-submit ng payment."},{status:401});
 const user=await getAuthenticatedUser(token);if(!user)return NextResponse.json({error:"Nag-expire ang session. Mag-login ulit."},{status:401});
 let body:{plan?:string;referenceNumber?:string;proofUrl?:string;notes?:string};try{body=await request.json();}catch{return NextResponse.json({error:"Invalid request."},{status:400});}
 const plan=body.plan as keyof typeof plans;if(!(plan in plans))return NextResponse.json({error:"Pumili ng valid subscription plan."},{status:400});
 const referenceNumber=typeof body.referenceNumber==="string"?body.referenceNumber.trim().slice(0,120):"";
 const proofUrl=typeof body.proofUrl==="string"?body.proofUrl.trim().slice(0,1000):"";const notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
 if(referenceNumber.length<3)return NextResponse.json({error:"Ilagay ang payment reference number."},{status:400});if(proofUrl&&!/^https:\\/\\//i.test(proofUrl))return NextResponse.json({error:"Ang proof link ay dapat HTTPS URL."},{status:400});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(!url||!key)return NextResponse.json({error:"Payment service is not configured."},{status:503});
 const response=await fetch(url+"/rest/v1/seo_payment_requests",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+token,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({user_id:user.id,plan_code:plan,amount_php:plans[plan],reference_number:referenceNumber,proof_url:proofUrl||null,notes:notes||null}),cache:"no-store"});
 if(!response.ok)return NextResponse.json({error:"Hindi na-submit ang payment request. Suriin kung may pending request o mag-login ulit."},{status:response.status===401?401:400});const result=await response.json();return NextResponse.json({ok:true,request:Array.isArray(result)?result[0]:result},{status:201,headers:{"Cache-Control":"no-store"}});
}
