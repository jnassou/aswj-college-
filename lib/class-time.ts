export const DEFAULT_CLASS_START_TIME = '18:30';
export const DEFAULT_CLASS_END_TIME = '20:30';

type ParsedTime = {
  hours: number;
  minutes: number;
};

function parseClassTime(value: string): ParsedTime | null {
  const text = value.trim();
  const twentyFourHour = text.match(
    /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/
  );

  if (twentyFourHour) {
    return {
      hours: Number(twentyFourHour[1]),
      minutes: Number(twentyFourHour[2]),
    };
  }

  const twelveHour = text.match(
    /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([ap])\.?m\.?$/i
  );

  if (!twelveHour) return null;

  const meridiem = twelveHour[3].toLowerCase();
  const displayHour = Number(twelveHour[1]);
  return {
    hours: displayHour % 12 + (meridiem === 'p' ? 12 : 0),
    minutes: Number(twelveHour[2] ?? 0),
  };
}

function timeValue({ hours, minutes }: ParsedTime) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function normalizeClassTime(
  value: FormDataEntryValue | string | null | undefined,
  label = 'Time'
) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const parsed = parseClassTime(text);
  if (!parsed) {
    throw new Error(`${label} must be a valid time, for example 6:30 pm.`);
  }

  return timeValue(parsed);
}

export function classTimeMinutes(value: string) {
  const parsed = parseClassTime(value);
  if (!parsed) throw new Error('Invalid class time.');
  return parsed.hours * 60 + parsed.minutes;
}

export function formatClassTime(value: string | null | undefined) {
  if (!value) return '';
  const parsed = parseClassTime(value);
  if (!parsed) return String(value);

  const displayHour = parsed.hours % 12 || 12;
  const suffix = parsed.hours >= 12 ? 'pm' : 'am';
  return `${displayHour}:${String(parsed.minutes).padStart(2, '0')} ${suffix}`;
}

export const CLASS_TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const minutesSinceMidnight = index * 15;
  const value = timeValue({
    hours: Math.floor(minutesSinceMidnight / 60),
    minutes: minutesSinceMidnight % 60,
  });
  return { value, label: formatClassTime(value) };
});
