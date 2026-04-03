export function normalizeAuditAddress(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.split('::')[0]!.trim().toLowerCase();
}

export function isApproverMatch(approver: string, address: string) {
  if (!approver) return false;
  const normalizedAddress = normalizeAuditAddress(address);
  const matchEntry = (entry: string) => normalizeAuditAddress(entry) === normalizedAddress;
  try {
    const parsed = JSON.parse(approver);
    if (Array.isArray(parsed)) {
      return parsed.some((entry) => typeof entry === 'string' && matchEntry(entry));
    }
    if (parsed && typeof parsed === 'object') {
      const list = Array.isArray((parsed as any).approvers) ? (parsed as any).approvers : [];
      return list.some((entry: unknown) => typeof entry === 'string' && matchEntry(entry));
    }
  } catch {
    // ignore parse errors
  }
  const candidates = approver.split(',').map((item) => item.trim()).filter(Boolean);
  if (candidates.length > 1) {
    return candidates.some((entry) => matchEntry(entry));
  }
  return matchEntry(approver);
}
