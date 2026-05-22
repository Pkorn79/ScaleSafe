export function isSafeOrFilterSearchInput(value: string, maxLength = 80): boolean {
  return value.length <= maxLength && /^[A-Za-z0-9 @._+#:-]*$/.test(value);
}

export function cleanPostgrestLikeTerm(value: string): string {
  return value.replace(/[%_,]/g, ' ').trim();
}
