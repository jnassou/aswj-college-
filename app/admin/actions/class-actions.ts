'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../../lib/supabase/server';
import { classTimeMinutes, normalizeClassTime } from '../../../lib/class-time';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

function optionalInt(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPayload(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const capacity = Number.parseInt(String(formData.get('capacity') ?? ''), 10);
  const absenceThreshold = Number.parseInt(String(formData.get('absence_threshold') ?? '3'), 10);
  const dayOfWeek = optionalInt(formData.get('day_of_week'));
  const startTime = normalizeClassTime(formData.get('start_time'), 'Start time');
  const endTime = normalizeClassTime(formData.get('end_time'), 'End time');

  if (!name) throw new Error('Class name is required.');
  if (!Number.isFinite(capacity) || capacity < 1) throw new Error('Capacity must be at least 1.');
  if (!Number.isFinite(absenceThreshold) || absenceThreshold < 1) {
    throw new Error('Absence threshold must be at least 1.');
  }
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new Error('Choose both a start time and an end time.');
  }
  if (
    startTime &&
    endTime &&
    classTimeMinutes(endTime) <= classTimeMinutes(startTime)
  ) {
    throw new Error('End time must be after start time.');
  }

  return {
    name,
    term: optionalText(formData.get('term')),
    teacher_id: optionalText(formData.get('teacher_id')),
    location: optionalText(formData.get('location')),
    capacity,
    absence_threshold: absenceThreshold,
    registration_enabled: formData.get('registration_enabled') === 'on',
    registration_opens_at: optionalText(formData.get('registration_opens_at')),
    registration_closes_at: optionalText(formData.get('registration_closes_at')),
    starts_on: optionalText(formData.get('starts_on')),
    ends_on: optionalText(formData.get('ends_on')),
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
  };
}

export async function createClass(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const payload = { ...readPayload(formData), active: true };

  const { data, error } = await supabase
    .from('classes')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'class',
    entity_id: data.id,
    action: 'class_created',
    new_values: payload,
  });

  revalidatePath('/admin/classes');
}

export async function updateClass(classId: string, formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const payload = readPayload(formData);

  const { data: existing, error: readError } = await supabase
    .from('classes')
    .select('*')
    .eq('id', classId)
    .single();

  if (readError || !existing) throw new Error('Class not found.');

  const { error } = await supabase
    .from('classes')
    .update(payload)
    .eq('id', classId);

  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'class',
    entity_id: classId,
    action: 'class_updated',
    old_values: existing,
    new_values: payload,
  });

  revalidatePath('/admin/classes');
}

export async function setClassActive(classId: string, active: boolean) {
  const { supabase, user } = await requireAdmin();

  const { data: existing, error: readError } = await supabase
    .from('classes')
    .select('id, name, active')
    .eq('id', classId)
    .single();

  if (readError || !existing) throw new Error('Class not found.');

  const { error } = await supabase
    .from('classes')
    .update({ active })
    .eq('id', classId);

  if (error) throw error;

  await supabase.from('audit_log').insert({
    actor_id: user.id,
    entity_type: 'class',
    entity_id: classId,
    action: active ? 'class_reactivated' : 'class_archived',
    old_values: { active: existing.active },
    new_values: { active },
  });

  revalidatePath('/admin/classes');
}
