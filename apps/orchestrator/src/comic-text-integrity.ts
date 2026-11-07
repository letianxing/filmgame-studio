/** Reject destructive shell encoding before any provider operation. */
export function assertTextIntegrity(value: unknown, location = 'shot'): void {
  if (typeof value === 'string') {
    if (value.includes('\uFFFD') || /\?{3,}/.test(value))
      throw new Error(`Corrupted authoring text at ${location}; restore UTF-8 before generation`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertTextIntegrity(item, `${location}[${index}]`));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertTextIntegrity(item, `${location}.${key}`);
  }
}
