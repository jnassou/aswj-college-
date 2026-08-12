export const dashboardMetrics = [
  ['Pending applications', '18', ''],
  ['Waiting list', '11', ''],
  ['2 consecutive absences', '9', 'metric-warning'],
  ['3+ absences — review', '6', 'metric-danger'],
  ['Suspended enrolments', '4', 'metric-danger'],
  ['Active students', '184', ''],
] as const;

export const reviewStudents = [
  { id:'ASWJ-0241', name:'Ahmed Hassan', className:'Men’s Arabic — Level 1', missed:3, lastAttended:'22 Jul 2026', attendance:'67%', status:'Review required' },
  { id:'ASWJ-0188', name:'Omar Khaled', className:'Quran — Level 2', missed:4, lastAttended:'15 Jul 2026', attendance:'58%', status:'Review required' },
  { id:'ASWJ-0314', name:'Yusuf Ali', className:'Arabic — Beginners', missed:3, lastAttended:'22 Jul 2026', attendance:'73%', status:'Review required' },
  { id:'ASWJ-0299', name:'Ibrahim Musa', className:'Quran — Level 1', missed:3, lastAttended:'22 Jul 2026', attendance:'70%', status:'Review required' },
];

export const applications = [
  { id:'APP-1048', name:'Bilal Ahmad', className:'Men’s Arabic — Level 1', submitted:'12 Aug 2026', status:'Pending' },
  { id:'APP-1047', name:'Hamza Noor', className:'Quran — Level 1', submitted:'12 Aug 2026', status:'Pending' },
  { id:'APP-1046', name:'Mustafa Ali', className:'Arabic — Beginners', submitted:'11 Aug 2026', status:'Waitlisted' },
  { id:'APP-1045', name:'Adam Saleh', className:'Men’s Arabic — Level 1', submitted:'11 Aug 2026', status:'Accepted' },
];

export const students = [
  { id:'ASWJ-0241', name:'Ahmed Hassan', mobile:'04•• ••• 241', classes:1, status:'Active', attendance:'67%' },
  { id:'ASWJ-0188', name:'Omar Khaled', mobile:'04•• ••• 188', classes:2, status:'Active', attendance:'58%' },
  { id:'ASWJ-0207', name:'Mohamed Hasan', mobile:'04•• ••• 207', classes:1, status:'Suspended', attendance:'61%' },
  { id:'ASWJ-0314', name:'Yusuf Ali', mobile:'04•• ••• 314', classes:1, status:'Active', attendance:'73%' },
];
