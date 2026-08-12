'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

function todaySydney(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
export async function ensureTodaySession(classId:string){
 const {supabase}=await requireAdmin(); const today=todaySydney();
 const {data:existing,error:r}=await supabase.from('class_sessions').select('id,class_id,session_date,cancelled').eq('class_id',classId).eq('session_date',today).maybeSingle(); if(r)throw r;if(existing)return existing;
 const {data:c,error:ce}=await supabase.from('classes').select('id,active').eq('id',classId).single();if(ce||!c)throw new Error('Class not found.');if(!c.active)throw new Error('This class is archived.');
 const {data,error}=await supabase.from('class_sessions').insert({class_id:classId,session_date:today,cancelled:false}).select('id,class_id,session_date,cancelled').single();if(error)throw error;return data;
}
export async function checkInByQr(classId:string,token:string){
 const {supabase,user}=await requireAdmin();const cleaned=token.trim().replace(/^aswj:/i,'');if(!cleaned)throw new Error('No QR token was supplied.');const session=await ensureTodaySession(classId);if(session.cancelled)throw new Error('Today’s class session is cancelled.');
 const {data:q,error:qe}=await supabase.from('student_qr_tokens').select('student_id').eq('token',cleaned).eq('active',true).maybeSingle();if(qe)throw qe;if(!q)throw new Error('This QR code is not valid or has been revoked.');
 const {data:e,error:ee}=await supabase.from('enrolments').select('id,status,profiles!enrolments_student_id_fkey(first_name,last_name)').eq('student_id',q.student_id).eq('class_id',classId).maybeSingle();if(ee)throw ee;if(!e)throw new Error('This student is not enrolled in the selected class.');if(e.status==='suspended')throw new Error('This student is currently suspended from this class.');if(e.status!=='enrolled')throw new Error('This enrolment is not active.');
 const now=new Date().toISOString();const {error}=await supabase.from('attendance').upsert({enrolment_id:e.id,session_id:session.id,status:'present',checked_in_at:now,checkin_method:'qr',recorded_by:user.id,updated_at:now},{onConflict:'enrolment_id,session_id'});if(error)throw error;
 revalidatePath('/admin/check-in');revalidatePath('/admin/attendance-review');revalidatePath('/admin/students');revalidatePath('/student');const p:any=e.profiles;return{name:`${p?.first_name??''} ${p?.last_name??''}`.trim()||'Student'};
}
export async function setManualAttendance(enrolmentId:string,classId:string,status:'present'|'late'|'absent'|'excused'|'absent_unexcused'|'absent_excused'){
 const {supabase,user}=await requireAdmin();const session=await ensureTodaySession(classId);const now=new Date().toISOString();const dbStatus=status==='absent'?'absent_unexcused':status==='excused'?'absent_excused':status;const {error}=await supabase.from('attendance').upsert({enrolment_id:enrolmentId,session_id:session.id,status:dbStatus,checked_in_at:['present','late'].includes(dbStatus)?now:null,checkin_method:'manual',recorded_by:user.id,updated_at:now},{onConflict:'enrolment_id,session_id'});if(error)throw error;
 revalidatePath('/admin/check-in');revalidatePath('/admin/attendance-review');revalidatePath('/admin/students');revalidatePath('/student');
}
export async function closeTodayRoll(classId:string){
 const {supabase,user}=await requireAdmin();const session=await ensureTodaySession(classId);if(session.cancelled)throw new Error('This session is cancelled.');const {data:ens,error:ee}=await supabase.from('enrolments').select('id').eq('class_id',classId).eq('status','enrolled');if(ee)throw ee;
 const ids=(ens??[]).map((e:any)=>e.id);const {data:existing,error:xe}=ids.length?await supabase.from('attendance').select('enrolment_id').eq('session_id',session.id).in('enrolment_id',ids):{data:[],error:null};if(xe)throw xe;const marked=new Set((existing??[]).map((a:any)=>a.enrolment_id));const missing=ids.filter((id:string)=>!marked.has(id));
 if(missing.length){const {error}=await supabase.from('attendance').insert(missing.map((id:string)=>({enrolment_id:id,session_id:session.id,status:'absent_unexcused',checkin_method:'roll_close',recorded_by:user.id})));if(error)throw error;}
 revalidatePath('/admin/check-in');revalidatePath('/admin/attendance-review');revalidatePath('/admin/students');revalidatePath('/admin');return{markedAbsent:missing.length};
}
