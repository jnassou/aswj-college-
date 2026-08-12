'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';

function text(v: FormDataEntryValue | null) {
  return String(v ?? '').trim();
}

export async function updateStudentProfile(studentId: string, formData: FormData) {
  const { supabase, user } = await requireAdmin();

  const payload = {
    first_name: text(formData.get('first_name')),
    last_name: text(formData.get('last_name')),
    mobile: text(formData.get('mobile')) || null,
    date_of_birth: text(formData.get('date_of_birth')) || null,
    emergency_contact_name: text(formData.get('emergency_contact_name')) || null,
    emergency_contact_mobile: text(formData.get('emergency_contact_mobile')) || null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.first_name || !payload.last_name) {
    throw new Error('First name and last name are required.');
  }

  const { data: oldProfile, error: readError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', studentId)
    .single();

  if (readError || !oldProfile) throw new Error('Student profile not found.');

  const { error } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', studentId);

  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'student',
    entity_id: studentId,
    action: 'student_profile_updated',
    old_values: oldProfile,
    new_values: payload,
  });

  revalidatePath('/admin/students');
}
