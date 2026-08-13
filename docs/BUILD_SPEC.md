# ASWJ College App — Build Specification v0.1

## Products
- ASWJ College Admin
- ASWJ College Student Portal

## Core workflows
1. Registration/application submission
2. Pending application review
3. Accept / decline / waitlist
4. Capacity and waitlist management
5. Class enrolment
6. Student QR identity and class check-in
7. Present / late / excused absence / unexcused absence
8. Two-consecutive-absence warning
9. Three-consecutive-unexcused-absence admin review
10. Suspend enrolment / correct attendance / excuse absence / keep enrolled
11. Vacancy creation and waitlist offer
12. Reinstatement
13. Notifications and audit logging

## Suspension rule
- Default threshold: 3 consecutive unexcused class absences.
- Rule is configurable per class.
- Excused absences do not trigger suspension.
- Cancelled sessions do not count.
- Suspension is per enrolment, not necessarily the whole student account.
- System flags; authorised admin decides.
- A suspension may release one class place and trigger a waitlist offer workflow.

## Registration source
The authenticated ASWJ Student Portal form is the primary registration source and writes into the normal pending-application workflow. Microsoft Forms remains a legacy operational fallback only.

If the fallback is deliberately enabled, the Power Automate flow is:
1. When a new response is submitted
2. Get response details
3. Transform the response into the ASWJ application payload
4. POST to an authenticated ingestion endpoint in the ASWJ application
5. Store Microsoft response ID for deduplication/audit

Microsoft 365 may also be used for Outlook notifications and staff workflow integration where useful, but it is not the registration interface or system-of-record database for the core application.

## Permissions
### Teacher
- View assigned classes
- Scan/check in students
- Record and correct attendance (subject to policy)
- Add class/student attendance notes
- See attendance warnings

### Admin
- Process applications
- Manage waitlists
- Manage students/classes
- Suspend/reinstate enrolments
- Override attendance
- Run reports

### Super Admin
- Manage staff roles
- Configure global/class policies
- View full audit logs
- System configuration

### Student
- Register/apply
- View application status
- View class enrolments
- View QR identity
- View attendance and warnings
- Receive notifications
- Accept a waitlist offer

## Next implementation slice
- Authentication and role model
- Application queue
- Student/class CRUD
- Attendance session model
- Correct consecutive-absence calculation
- Suspension review dashboard
