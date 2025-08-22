import { describe, it, expect } from 'vitest';
import { scru128, Scru128Id } from 'scru128';

// Extract the pure functions from store/index.ts for testing
function getFirstLine(content: string): string {
  return content.split('\n')[0].substring(0, 80);
}

function scru128ToTimestamp(id: string): string {
  try {
    const parsed = Scru128Id.fromString(id);
    return new Date(parsed.timestamp).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function scru128ToHumanTime(id: string): string {
  try {
    const parsed = Scru128Id.fromString(id);
    const date = new Date(parsed.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}:${minute}`;
  } catch {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}:${minute}`;
  }
}

describe('Store Utils', () => {
  describe('getFirstLine', () => {
    it('should extract the first line from content', () => {
      const content = 'First line\nSecond line\nThird line';
      expect(getFirstLine(content)).toBe('First line');
    });

    it('should handle single line content', () => {
      const content = 'Only one line';
      expect(getFirstLine(content)).toBe('Only one line');
    });

    it('should truncate long lines to 80 characters', () => {
      const longLine = 'a'.repeat(100);
      const content = `${longLine}\nSecond line`;
      expect(getFirstLine(content)).toBe('a'.repeat(80));
    });

    it('should handle empty content', () => {
      expect(getFirstLine('')).toBe('');
    });

    it('should handle markdown headers', () => {
      const content = '## A Test Header\n\nsome content';
      expect(getFirstLine(content)).toBe('## A Test Header');
    });
  });

  describe('scru128ToTimestamp', () => {
    it('should extract timestamp from valid SCRU128 ID', () => {
      const scru128Id = scru128();
      const id = scru128Id.toString();
      const timestamp = scru128ToTimestamp(id);

      // Should be valid ISO string
      expect(() => new Date(timestamp)).not.toThrow();
      expect(timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      // Should match the original timestamp (within a small margin for test execution time)
      const extractedTime = new Date(timestamp).getTime();
      const originalTime = scru128Id.timestamp;
      expect(Math.abs(extractedTime - originalTime)).toBeLessThan(1000); // within 1 second
    });

    it('should return current time for invalid ID', () => {
      const before = Date.now();
      const timestamp = scru128ToTimestamp('invalid-id');
      const after = Date.now();

      const extractedTime = new Date(timestamp).getTime();
      expect(extractedTime).toBeGreaterThanOrEqual(before);
      expect(extractedTime).toBeLessThanOrEqual(after);
    });
  });

  describe('scru128ToHumanTime', () => {
    it('should return properly formatted human time from valid SCRU128 ID', () => {
      const scru128Id = scru128();
      const id = scru128Id.toString();
      const humanTime = scru128ToHumanTime(id);

      // Should match YYYY-MM-DD-HH:MM format
      expect(humanTime).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$/);

      // Should represent the same time as the original
      const originalDate = new Date(scru128Id.timestamp);
      const expectedHuman =
        originalDate.getFullYear() +
        '-' +
        String(originalDate.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(originalDate.getDate()).padStart(2, '0') +
        '-' +
        String(originalDate.getHours()).padStart(2, '0') +
        ':' +
        String(originalDate.getMinutes()).padStart(2, '0');

      expect(humanTime).toBe(expectedHuman);
    });

    it('should return current time format for invalid ID', () => {
      const humanTime = scru128ToHumanTime('invalid-id');
      expect(humanTime).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$/);
    });

    it('should be sortable by generation time', () => {
      const id1 = scru128().toString();
      // Small delay to ensure different timestamp
      const delay = () => new Promise(resolve => setTimeout(resolve, 1));

      return delay().then(() => {
        const id2 = scru128().toString();
        const time1 = scru128ToHumanTime(id1);
        const time2 = scru128ToHumanTime(id2);

        expect(time1 <= time2).toBe(true);
      });
    });
  });
});
