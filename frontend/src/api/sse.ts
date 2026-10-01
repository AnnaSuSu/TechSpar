/** Decode JSON data frames; parsing errors and consumer errors must stay visible. */
export async function consumeSSE<T>(
  res: Response,
  decode: (value: unknown) => T,
  onEvent: (event: T) => boolean | void,
): Promise<void> {
  if (!res.body) throw new Error('Missing event stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  let exhausted = false;

  const line = (value: string): boolean => {
    if (value === '') {
      if (!data.length) return false;
      const payload = data.join('\n');
      data = [];
      let parsed: unknown;
      try { parsed = JSON.parse(payload); }
      catch { throw new Error('Invalid event stream JSON'); }
      return onEvent(decode(parsed)) === true;
    }
    if (value.startsWith(':')) return false;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    if (field === 'data') {
      const rest = colon < 0 ? '' : value.slice(colon + 1);
      data.push(rest.startsWith(' ') ? rest.slice(1) : rest);
    }
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      exhausted = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      while (true) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0 || (!done && buffer[end] === '\r' && end === buffer.length - 1)) break;
        const current = buffer.slice(0, end);
        const delimiter = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1;
        buffer = buffer.slice(end + delimiter);
        if (line(current)) return;
      }
      if (done) throw new Error(buffer || data.length ? 'Incomplete event stream frame' : 'Event stream ended before completion');
    }
  } finally {
    try { if (!exhausted) await reader.cancel().catch(() => {}); }
    finally { reader.releaseLock(); }
  }
}
