import ApplicationsClient from './ApplicationsClient';
import { getApplications } from '../../../lib/live-data';

export default async function ApplicationsPage(){
  const rows = await getApplications();
  return <><div className="topbar"><div><h1>Applications</h1><p className="subtitle">Process registrations and manage the waiting list.</p></div></div><ApplicationsClient initialRows={rows}/></>;
}
