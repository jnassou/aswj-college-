'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '../../lib/supabase/server';

async function markRead(notificationId: string | null) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Authentication required.');

  const { error } = await supabase.rpc('mark_portal_notifications_read', {
    p_notification_id: notificationId,
  });
  if (error) throw error;

  revalidatePath('/student');
}

export async function markPortalNotificationRead(
  notificationId: string,
  _formData: FormData
) {
  await markRead(notificationId);
}

export async function markAllPortalNotificationsRead(_formData: FormData) {
  await markRead(null);
}
