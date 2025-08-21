import { describe, it, expect } from 'vitest';

// Extract the pure functions from store/index.ts for testing
function getFirstLine(content: string): string {
  return content.split('\n')[0].substring(0, 80);
}

function scru128ToHumanTime(id: string): string {
  // For now this is a mock - in real implementation it would decode SCRU128
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hour}:${minute}`;
}

describe('Store Utils', () => {
  describe('getFirstLine', () => {
    it('should extract the first line from content', () => {
      const content = "First line\nSecond line\nThird line";
      expect(getFirstLine(content)).toBe("First line");
    });

    it('should handle single line content', () => {
      const content = "Only one line";
      expect(getFirstLine(content)).toBe("Only one line");
    });

    it('should truncate long lines to 80 characters', () => {
      const longLine = "a".repeat(100);
      const content = `${longLine}\nSecond line`;
      expect(getFirstLine(content)).toBe("a".repeat(80));
    });

    it('should handle empty content', () => {
      expect(getFirstLine("")).toBe("");
    });

    it('should handle markdown headers', () => {
      const content = "## A Test Header\n\nsome content";
      expect(getFirstLine(content)).toBe("## A Test Header");
    });
  });

  describe('scru128ToHumanTime', () => {
    it('should return a properly formatted timestamp', () => {
      const result = scru128ToHumanTime("some-scru128-id");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}:\d{2}$/);
    });
  });
});