import type { SupabaseClient } from '@supabase/supabase-js';

export type PortalClass = {
  id: string;
  name: string;
  term: string | null;
  location: string | null;
  absenceThreshold: number;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
};

export type PortalApplication = {
  id: string;
  status: string;
  waitlistPosition: number | null;
  submittedAt: string;
  reviewedAt: string | null;
  classInfo: PortalClass;
};

export type PortalAttendanceRecord = {
  sessionId: string;
  sessionDate: string;
  status: string;
  checkedInAt: string | null;
};

export type PortalEnrolment = {
  id: string;
  status: string;
  enrolledAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  classInfo: PortalClass;
  consecutiveAbsences: number;
  absenceThreshold: number;
  reviewState: string;
  totalSessions: number;
  attendedSessions: number;
  lateSessions: number;
  excusedAbsences: number;
  unexcusedAbsences: number;
  attendanceRate: number | null;
  recentAttendance: PortalAttendanceRecord[];
};

export type PortalNotification = {
  id: string;
  templateKey: string;
  createdAt: string;
  readAt: string | null;
  enrolmentId: string | null;
  applicationId: string | null;
  className: string | null;
  classTerm: string | null;
  waitlistPosition: number | null;
};

export type StudentPortalData = {
  profile: { firstName: string; lastName: string } | null;
  applications: PortalApplication[];
  enrolments: PortalEnrolment[];
  notifications: PortalNotification[];
  unreadNotificationCount: number;
  qrToken: string | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function classInfo(value: any): PortalClass {
  const row = one<any>(value) ?? {};
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Class'),
    term: row.term ?? null,
    location: row.location ?? null,
    absenceThreshold: Number(row.absence_threshold ?? 3),
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined
      ? null
      : Number(row.day_of_week),
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
  };
}

function sydneyDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function throwIfError(error: { message: string } | null, label: string) {
  if (error) throw new Error(`${label} could not be loaded: ${error.message}`);
}

export async function loadStudentPortalData(
  supabase: SupabaseClient,
  studentId: string
): Promise<StudentPortalData> {
  const [
    profileResult,
    applicationResult,
    enrolmentResult,
    notificationResult,
    unreadNotificationResult,
    qrResult,
  ] = await Promise.all([
      supabase
        .from('profiles')
        .select('first_name,last_name')
        .eq('id', studentId)
        .maybeSingle(),
      supabase
        .from('applications')
        .select(`
          id,
          status,
          waitlist_position,
          submitted_at,
          reviewed_at,
          classes!applications_class_id_fkey(
            id,name,term,location,absence_threshold,day_of_week,start_time,end_time
          )
        `)
        .eq('student_id', studentId)
        .order('submitted_at', { ascending: false }),
      supabase
        .from('enrolments')
        .select(`
          id,
          status,
          enrolled_at,
          suspended_at,
          suspension_reason,
          classes!enrolments_class_id_fkey(
            id,name,term,location,absence_threshold,day_of_week,start_time,end_time
          )
        `)
        .eq('student_id', studentId)
        .order('enrolled_at', { ascending: false }),
      supabase
        .from('notifications')
        .select(`
          id,
          enrolment_id,
          application_id,
          template_key,
          created_at,
          read_at,
          enrolments!notifications_enrolment_id_fkey(
            classes!enrolments_class_id_fkey(name,term)
          ),
          applications!notifications_application_id_fkey(
            status,
            waitlist_position,
            classes!applications_class_id_fkey(name,term)
          )
        `)
        .eq('student_id', studentId)
        .eq('channel', 'portal')
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .eq('channel', 'portal')
        .is('read_at', null),
      supabase
        .from('student_qr_tokens')
        .select('token')
        .eq('student_id', studentId)
        .eq('active', true)
        .maybeSingle(),
    ]);

  throwIfError(profileResult.error, 'Your profile');
  throwIfError(applicationResult.error, 'Applications');
  throwIfError(enrolmentResult.error, 'Enrolments');
  throwIfError(notificationResult.error, 'Notifications');
  throwIfError(unreadNotificationResult.error, 'Unread notifications');
  throwIfError(qrResult.error, 'Your QR identity');

  const rawApplications: any[] = applicationResult.data ?? [];
  const rawEnrolments: any[] = enrolmentResult.data ?? [];
  const enrolmentIds = rawEnrolments.map((row) => String(row.id));
  const classIds = [...new Set(
    rawEnrolments.map((row) => classInfo(row.classes).id).filter(Boolean)
  )];

  let rawAttendance: any[] = [];
  let rawSessions: any[] = [];
  let rawStreaks: any[] = [];

  if (enrolmentIds.length) {
    const [attendanceResult, sessionResult, streakResult] = await Promise.all([
      supabase
        .from('attendance')
        .select('id,enrolment_id,session_id,status,checked_in_at')
        .in('enrolment_id', enrolmentIds),
      supabase
        .from('class_sessions')
        .select('id,class_id,session_date,cancelled')
        .in('class_id', classIds)
        .lte('session_date', sydneyDateKey(new Date()))
        .order('session_date', { ascending: false }),
      supabase
        .from('student_attendance_streaks')
        .select('enrolment_id,consecutive_absences,absence_threshold,review_state')
        .eq('student_id', studentId),
    ]);

    throwIfError(attendanceResult.error, 'Attendance records');
    throwIfError(sessionResult.error, 'Class sessions');
    throwIfError(streakResult.error, 'Attendance standing');
    rawAttendance = attendanceResult.data ?? [];
    rawSessions = sessionResult.data ?? [];
    rawStreaks = streakResult.data ?? [];
  }

  const attendanceByEnrolmentSession = new Map(
    rawAttendance.map((row) => [`${row.enrolment_id}:${row.session_id}`, row])
  );
  const streakByEnrolment = new Map(
    rawStreaks.map((row) => [String(row.enrolment_id), row])
  );

  const applications: PortalApplication[] = rawApplications.map((row) => ({
    id: String(row.id),
    status: String(row.status),
    waitlistPosition: row.waitlist_position === null
      ? null
      : Number(row.waitlist_position),
    submittedAt: String(row.submitted_at),
    reviewedAt: row.reviewed_at ?? null,
    classInfo: classInfo(row.classes),
  }));

  const enrolments: PortalEnrolment[] = rawEnrolments.map((row) => {
    const info = classInfo(row.classes);
    const enrolledOn = sydneyDateKey(row.enrolled_at);
    const records = rawSessions
      .flatMap((session): PortalAttendanceRecord[] => {
        if (
          String(session.class_id) !== info.id ||
          String(session.session_date) < enrolledOn
        ) {
          return [];
        }

        const attendance = attendanceByEnrolmentSession.get(`${row.id}:${session.id}`);
        if (!attendance) return [];

        return [{
          sessionId: String(session.id),
          sessionDate: String(session.session_date),
          status: session.cancelled ? 'cancelled' : String(attendance.status),
          checkedInAt: attendance.checked_in_at ?? null,
        }];
      });

    const completed = records.filter((record) =>
      !['cancelled', 'not_recorded'].includes(record.status)
    );
    const attended = completed.filter((record) =>
      ['present', 'late'].includes(record.status)
    ).length;
    const late = completed.filter((record) => record.status === 'late').length;
    const excused = completed.filter((record) => record.status === 'absent_excused').length;
    const unexcused = completed.filter((record) => record.status === 'absent_unexcused').length;
    const streak = streakByEnrolment.get(String(row.id));
    const threshold = Number(streak?.absence_threshold ?? info.absenceThreshold);
    const consecutiveAbsences = Number(streak?.consecutive_absences ?? 0);
    const reviewState = row.status === 'suspended'
      ? 'suspended'
      : String(streak?.review_state ?? 'ok');

    return {
      id: String(row.id),
      status: String(row.status),
      enrolledAt: String(row.enrolled_at),
      suspendedAt: row.suspended_at ?? null,
      suspensionReason: row.suspension_reason ?? null,
      classInfo: info,
      consecutiveAbsences,
      absenceThreshold: threshold,
      reviewState,
      totalSessions: completed.length,
      attendedSessions: attended,
      lateSessions: late,
      excusedAbsences: excused,
      unexcusedAbsences: unexcused,
      attendanceRate: completed.length
        ? Math.round((attended / completed.length) * 100)
        : null,
      recentAttendance: records.slice(0, 6),
    };
  });

  const enrolmentMap = new Map(enrolments.map((row) => [row.id, row]));
  const notifications: PortalNotification[] = (notificationResult.data ?? []).map((row: any) => {
    const linkedEnrolment = one<any>(row.enrolments);
    const linkedApplication = one<any>(row.applications);
    const enrolmentClass = one<any>(linkedEnrolment?.classes);
    const applicationClass = one<any>(linkedApplication?.classes);
    const fallback = row.enrolment_id
      ? enrolmentMap.get(String(row.enrolment_id))?.classInfo
      : null;

    return {
      id: String(row.id),
      templateKey: String(row.template_key),
      createdAt: String(row.created_at),
      readAt: row.read_at ?? null,
      enrolmentId: row.enrolment_id ?? null,
      applicationId: row.application_id ?? null,
      className: enrolmentClass?.name ?? applicationClass?.name ?? fallback?.name ?? null,
      classTerm: enrolmentClass?.term ?? applicationClass?.term ?? fallback?.term ?? null,
      waitlistPosition: linkedApplication?.waitlist_position === null ||
        linkedApplication?.waitlist_position === undefined
        ? null
        : Number(linkedApplication.waitlist_position),
    };
  });

  const profile = profileResult.data
    ? {
        firstName: String(profileResult.data.first_name ?? ''),
        lastName: String(profileResult.data.last_name ?? ''),
      }
    : null;

  return {
    profile,
    applications,
    enrolments,
    notifications,
    unreadNotificationCount: unreadNotificationResult.count ?? 0,
    qrToken: qrResult.data?.token ?? null,
  };
}
