export function browserPort(value = process.env.MERMAID_BROWSER_PORT) {
  if (value === undefined) return 4173;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error('MERMAID_BROWSER_PORT must be an integer from 1 to 65535');
  }
  return Number(value);
}
