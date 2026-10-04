import { describe, expect, it } from 'vitest';
import { fileStamp } from '@/export/download';

describe('fileStamp', () => {
  it('is a local YYYY-MM-DD-HHMMSS timestamp', () => {
    // Built from local date components, so the result does not depend on the
    // runner's timezone.
    expect(fileStamp(new Date(2026, 9, 4, 15, 32, 10))).toBe('2026-10-04-153210');
    expect(fileStamp(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01-000000');
  });

  it('contains only characters a filename allows', () => {
    expect(fileStamp()).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });
});
