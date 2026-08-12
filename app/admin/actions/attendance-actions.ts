'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';
const refresh=()=>{revalidatePath('/admin');revalidatePath('/admin/attendance-review');revalidatePath('/admin/students');revalidatePath('/student')};
export async function suspendEnrolment(enrolmentId:string,reason:string,note:string,notifyStudent=true){
 const {supabase,user}=await requireAdmin();const now=new Date().toISOString();const {data:e,error:r}=await supabase.from('enrolments').select('id,student_id,status').eq('id',enrolmentId).single();if(r||!e)throw new Error('Enrolment not found.');if(e.status!=='enrolled')throw new Error('Only an enrolled student can be suspended.');
 const {error}=await supabase.from('enrolments').update({status:'suspended',suspended_at:now,suspension_reason:reason,suspended_by:user.id}).eq('id',enrolmentId);if(error)throw error;await supabase.from('suspension_reviews').update({status:'suspended',reviewed_by:user.id,reviewed_at:now,review_note:note||null}).eq('enrolment_id',enrolmentId).eq('status','open');if(notifyStudent)await supabase.from('notifications').insert({student_id:e.student_id,enrolment_id:enrolmentId,channel:'portal',template_key:'enrolment_suspended',status:'queued'});refresh();
}
export async function resolveAttendanceReview(enrolmentId:string,resolution:'excused'|'kept_enrolled',note?:string){
 const {supabase,user}=await requireAdmin();const now=new Date().toISOString();
 if(resolution==='excused'){
  const {data:records,error}=await supabase.from('attendance').select('id,class_sessions!attendance_session_id_fkey(session_date)').eq('enrolment_id',enrolmentId).eq('status','absent_unexcused');if(error)throw error;const latest:any=(records??[]).sort((a:any,b:any)=>String(b.class_sessions?.session_date??'').localeCompare(String(a.class_sessions?.session_date??'')))[0];if(!latest)throw new Error('No unexcused absence was found to excuse.');const {error:u}=await supabase.from('attendance').update({status:'absent_excused',note:note||'Excused by administrator',recorded_by:user.id,updated_at:now}).eq('id',latest.id);if(u)throw u;
 }else{const {error}=await supabase.from('suspension_reviews').update({status:'kept_enrolled',reviewed_by:user.id,reviewed_at:now,review_note:note||null}).eq('enrolment_id',enrolmentId).eq('status','open');if(error)throw error;}
 refresh();
}
export async function reinstateEnrolment(enrolmentId:string,note?:string){const {supabase,user}=await requireAdmin();const {error}=await supabase.from('enrolments').update({status:'enrolled',reinstated_at:new Date().toISOString(),reinstated_by:user.id}).eq('id',enrolmentId);if(error)throw error;refresh();}
