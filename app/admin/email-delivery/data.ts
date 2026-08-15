export function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function combinedDeliveryStatus(row: Record<string, unknown>) {
  const dispatchStatus = optionalText(
    row.dispatch_status ?? row.delivery_status ?? row.status
  );
  const providerStatus = optionalText(row.provider_status);

  // Once the provider reports an event it is more specific than the local
  // submitted state. This includes delayed and terminal failure outcomes.
  if (providerStatus) return providerStatus;

  return dispatchStatus ?? providerStatus ?? 'queued';
}

export function sanitizedDeliveryError(row: Record<string, unknown>) {
  const combined = optionalText(row.last_error);
  if (combined) return combined;

  const code = optionalText(row.last_error_code);
  const message = optionalText(row.last_error_message);
  if (code && message) return `${code}: ${message}`;
  return message ?? code;
}
