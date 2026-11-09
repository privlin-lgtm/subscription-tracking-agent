/**
 * Small iCalendar (RFC 5545) reader for tests: unfolds lines, splits each `NAME[;PARAMS]:VALUE`
 * content line, unescapes TEXT values and groups VEVENT blocks. It is strict on purpose, so a
 * malformed file fails the test instead of being read leniently.
 */
export type ParsedIcs = {
  properties: Record<string, string>;
  events: Array<Record<string, string>>;
};

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

export function parseIcs(text: string): ParsedIcs {
  if (!text.endsWith("\r\n")) {
    throw new Error("ICS must end with CRLF");
  }
  const unfolded = text.replace(/\r\n[ \t]/g, "");
  const lines = unfolded.split("\r\n").slice(0, -1);
  if (lines.some((line) => /[\r\n]/.test(line))) {
    throw new Error("ICS contains a bare CR or LF");
  }
  if (lines[0] !== "BEGIN:VCALENDAR" || lines[lines.length - 1] !== "END:VCALENDAR") {
    throw new Error("ICS must be wrapped in VCALENDAR");
  }

  const properties: Record<string, string> = {};
  const events: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;

  for (const line of lines.slice(1, -1)) {
    const colon = line.indexOf(":");
    if (colon < 1) {
      throw new Error(`Malformed content line: ${line}`);
    }
    const name = line.slice(0, colon);
    const value = unescapeText(line.slice(colon + 1));
    if (name === "BEGIN") {
      if (value !== "VEVENT" || current) {
        throw new Error(`Unexpected BEGIN:${value}`);
      }
      current = {};
    } else if (name === "END") {
      if (value !== "VEVENT" || !current) {
        throw new Error(`Unexpected END:${value}`);
      }
      for (const required of ["UID", "DTSTAMP", "DTSTART;VALUE=DATE"]) {
        if (!current[required]) {
          throw new Error(`VEVENT is missing ${required}`);
        }
      }
      events.push(current);
      current = null;
    } else {
      const target: Record<string, string> = current ?? properties;
      if (name in target) {
        throw new Error(`Duplicate property ${name}`);
      }
      target[name] = value;
    }
  }
  if (current) {
    throw new Error("Unterminated VEVENT");
  }
  if (properties.VERSION !== "2.0" || !properties.PRODID) {
    throw new Error("VCALENDAR needs VERSION:2.0 and PRODID");
  }
  return { properties, events };
}
