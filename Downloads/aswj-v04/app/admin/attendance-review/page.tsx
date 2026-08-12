import ReviewClient from './ReviewClient';
import { getAttendanceReviews } from '../../../lib/live-data';

export default async function AttendanceReviewPage(){
  const rows = await getAttendanceReviews();
  return <><div className="topbar"><div><h1>Attendance Review</h1><p className="subtitle">Three consecutive missed classes and suspension workflow.</p></div></div><ReviewClient initialStudents={rows}/></>;
}
