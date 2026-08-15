'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  getEmailDeliveryDetails,
  processEmailQueueNow,
  retryEmailDelivery,
  type EmailDeliveryDetail,
} from './actions';

export type EmailDeliveryRow = {
  id: string;
  studentName: string;
  event: string;
  className: string;
  queuedAt: string;
  status: string;
  attemptCount: number;
  retryAllowed: boolean;
};

const FILTERS = ['attention', 'queued', 'processing', 'sent', 'failed'] as const;
type DeliveryFilter = (typeof FILTERS)[number];
type DeliveryStatusGroup = Exclude<DeliveryFilter, 'attention'>;

function statusGroup(value: string): DeliveryStatusGroup {
  const status = value.trim().toLowerCase();
  if (['processing', 'sending', 'delivery_delayed'].includes(status)) return 'processing';
  if (['sent', 'accepted', 'delivered', 'provider_accepted', 'submitted'].includes(status)) {
    return 'sent';
  }
  if (['failed', 'permanent_failed', 'bounced', 'complained', 'suppressed', 'blocked'].includes(status)) {
    return 'failed';
  }
  return 'queued';
}

function needsAttention(value: string) {
  return statusGroup(value) === 'failed'
    || value.trim().toLowerCase() === 'delivery_delayed';
}

function label(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function eventLabel(value: string) {
  return value.includes('_') ? label(value) : value;
}

function statusTone(value: string) {
  switch (statusGroup(value)) {
    case 'sent': return 'green';
    case 'failed': return 'red';
    case 'processing': return 'blue';
    default: return 'amber';
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function EmailDeliveryClient({
  rows,
  providerStatus,
}: {
  rows: EmailDeliveryRow[];
  providerStatus: 'disabled' | 'not_configured' | 'ready';
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<DeliveryFilter>('attention');
  const [selected, setSelected] = useState<EmailDeliveryRow | null>(null);
  const [detail, setDetail] = useState<EmailDeliveryDetail | null>(null);
  const [pendingKey, setPendingKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const regionRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const retryingRef = useRef(false);
  retryingRef.current = pendingKey.startsWith('retry:');

  const counts = useMemo(() => {
    const result: Record<DeliveryFilter, number> = {
      attention: 0,
      queued: 0,
      processing: 0,
      sent: 0,
      failed: 0,
    };
    for (const row of rows) {
      const group = statusGroup(row.status);
      result[group] += 1;
      if (needsAttention(row.status)) result.attention += 1;
    }
    return result;
  }, [rows]);

  const visible = useMemo(() => rows.filter((row) => {
    const group = statusGroup(row.status);
    return filter === 'attention' ? needsAttention(row.status) : group === filter;
  }), [filter, rows]);

  const openDetails = (row: EmailDeliveryRow, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setSelected(row);
    setDetail(null);
    setError('');
    setMessage(null);
    setPendingKey(`detail:${row.id}`);
    startTransition(async () => {
      try {
        setDetail(await getEmailDeliveryDetails(row.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Email delivery details could not be loaded.');
      } finally {
        setPendingKey('');
      }
    });
  };

  const closeDetails = () => {
    if (pendingKey.startsWith('retry:')) return;
    setSelected(null);
    setDetail(null);
    setError('');
    setPendingKey('');
  };

  useEffect(() => {
    if (!selected) return;

    const trigger = detailTriggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (retryingRef.current) return;
        event.preventDefault();
        setSelected(null);
        setDetail(null);
        setError('');
        setPendingKey('');
        return;
      }

      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!modalRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (trigger?.isConnected && !trigger.disabled) {
        trigger.focus();
      } else {
        regionRef.current?.focus();
      }
    };
  }, [selected]);

  const retry = () => {
    if (!selected || !detail || !detail.retryAllowed) return;
    setError('');
    setMessage(null);
    setPendingKey(`retry:${selected.id}`);
    startTransition(async () => {
      try {
        await retryEmailDelivery(selected.id);
        setSelected(null);
        setDetail(null);
        setMessage({
          tone: 'success',
          text: 'The failed email was queued for retry. Use Process queue to send ready emails now.',
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The email could not be queued for retry.');
      } finally {
        setPendingKey('');
      }
    });
  };

  const processQueue = () => {
    if (providerStatus !== 'ready') return;
    setError('');
    setMessage(null);
    setPendingKey('process');
    startTransition(async () => {
      try {
        const result = await processEmailQueueNow();
        if (result.status === 'disabled') {
          setMessage({
            tone: 'warning',
            text: 'Email delivery is switched off. Queued emails remain saved and were not sent.',
          });
        } else if (result.status === 'not_configured') {
          setMessage({
            tone: 'warning',
            text: 'The server email provider is not configured. Queued emails remain saved and were not sent.',
          });
        } else if (result.claimed === 0) {
          setMessage({ tone: 'success', text: 'No queued emails were ready to process.' });
        } else {
          setMessage({
            tone: result.failed > 0 ? 'warning' : 'success',
            text: `${result.submitted} email${result.submitted === 1 ? '' : 's'} submitted; ${result.retryScheduled} scheduled for retry; ${result.failed} failed.`,
          });
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The email queue could not be processed.');
      } finally {
        setPendingKey('');
      }
    });
  };

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label="Email delivery monitoring"
      aria-busy={pending}
      tabIndex={-1}
    >
      <div aria-hidden={selected ? true : undefined} inert={selected ? true : undefined}>
        {error && !selected && <div className="notice" role="alert">{error}</div>}
        {message && !selected && (
          <div className={`portal-alert ${message.tone}`} role="status" style={{ marginBottom: 16 }}>
            <strong>{message.tone === 'success' ? 'Email queue updated' : 'Email setup attention'}</strong>
            <span>{message.text}</span>
          </div>
        )}

        <section className="card" style={{ marginBottom: 16 }}>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>Email queue</h2>
            {providerStatus === 'ready' ? (
              <div className="small">The server-side email provider is ready.</div>
            ) : providerStatus === 'disabled' ? (
              <div className="small" id="email-provider-status">
                Email delivery is switched off. Queued deliveries remain safely saved.
              </div>
            ) : (
              <div className="small" id="email-provider-status">
                The server-side email provider setup is incomplete. Queued deliveries remain safely saved.
              </div>
            )}
          </div>
          <div className="actions" style={{ alignItems: 'center' }}>
            <span className={`badge ${providerStatus === 'ready' ? 'green' : providerStatus === 'disabled' ? 'amber' : 'red'}`}>
              {providerStatus === 'ready' ? 'Provider ready' : providerStatus === 'disabled' ? 'Delivery disabled' : 'Setup required'}
            </span>
            <button
              className="btn btn-primary"
              type="button"
              disabled={pending || providerStatus !== 'ready'}
              aria-describedby={providerStatus === 'ready' ? undefined : 'email-provider-status'}
              onClick={processQueue}
            >
              {pendingKey === 'process' ? 'Processing…' : 'Process queue'}
            </button>
          </div>
        </div>
        </section>

        <div className="filters" role="group" aria-label="Email delivery filters">
        {FILTERS.map((item) => (
          <button
            key={item}
            className={`filter ${filter === item ? 'active' : ''}`}
            type="button"
            disabled={pending}
            aria-pressed={filter === item}
            onClick={() => setFilter(item)}
          >
            {label(item)} ({counts[item]})
          </button>
        ))}
        </div>

        <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Event</th>
              <th>Class</th>
              <th>Queued</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="portal-empty">
                    <strong>{rows.length === 0 ? 'No email deliveries yet' : 'No deliveries in this view'}</strong>
                    <span>
                      {rows.length === 0
                        ? 'Application and enrolment emails will appear after they are queued. If emails are expected, check the server provider setup.'
                        : 'Choose another status filter to review the remaining deliveries.'}
                    </span>
                  </div>
                </td>
              </tr>
            ) : visible.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.studentName}</strong></td>
                <td>{eventLabel(row.event)}</td>
                <td>{row.className || '—'}</td>
                <td>{formatDateTime(row.queuedAt)}</td>
                <td><span className={`badge ${statusTone(row.status)}`}>{label(row.status)}</span></td>
                <td>{row.attemptCount}</td>
                <td>
                  <button
                    className="btn btn-outline"
                    type="button"
                    disabled={pending}
                    aria-label={`Review ${eventLabel(row.event)} email for ${row.studentName}`}
                    onClick={(event) => openDetails(row, event.currentTarget)}
                  >
                    {pendingKey === `detail:${row.id}` ? 'Loading…' : 'Review'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={closeDetails}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-delivery-title"
            ref={modalRef}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: 'min(680px,100%)', maxHeight: '92vh', overflow: 'auto' }}
          >
            <h3 id="email-delivery-title">{eventLabel(selected.event)}</h3>
            <p className="subtitle">{selected.studentName} · {selected.className || 'No class'}</p>

            {error && <div className="notice" role="alert" style={{ marginTop: 16 }}>{error}</div>}
            {!detail && !error && (
              <div className="card" style={{ marginTop: 18 }}>Loading protected delivery details…</div>
            )}

            {detail && (
              <div className="portal-grid" style={{ marginTop: 18 }}>
                <div className="card">
                  <div className="small">Delivery</div>
                  <p><strong>Recipient</strong><br/>{detail.recipientEmail}</p>
                  <p><strong>Status</strong><br/><span className={`badge ${statusTone(detail.status)}`}>{label(detail.status)}</span></p>
                  <p><strong>Attempts</strong><br/>{detail.attemptCount}</p>
                  <p><strong>Queued</strong><br/>{formatDateTime(detail.queuedAt)}</p>
                </div>
                <div className="card">
                  <div className="small">Provider activity</div>
                  <p><strong>Last attempt</strong><br/>{formatDateTime(detail.lastAttemptAt)}</p>
                  <p><strong>Next attempt</strong><br/>{formatDateTime(detail.nextAttemptAt)}</p>
                  <p><strong>Sent</strong><br/>{formatDateTime(detail.sentAt)}</p>
                  <p style={{ overflowWrap: 'anywhere' }}><strong>Provider ID</strong><br/>{detail.providerMessageId || '—'}</p>
                </div>
                {detail.lastError && (
                  <div className="card" style={{ gridColumn: '1 / -1' }}>
                    <div className="small">Sanitised delivery error</div>
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.lastError}</p>
                  </div>
                )}
              </div>
            )}

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button
                ref={closeButtonRef}
                className="btn btn-outline"
                type="button"
                disabled={pendingKey.startsWith('retry:')}
                onClick={closeDetails}
              >
                Close
              </button>
              {detail?.retryAllowed && (
                <button className="btn btn-primary" type="button" disabled={pending} onClick={retry}>
                  {pendingKey === `retry:${selected.id}` ? 'Queueing…' : 'Queue retry'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
