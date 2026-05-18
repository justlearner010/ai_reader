export function cleanText(raw: string): string {
  let text = raw;

  // 1. Remove control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 2. Remove standalone page numbers (lines that are only digits, optionally surrounded by whitespace/punctuation)
  text = text.replace(/^\s*\d+\s*$/gm, "");

  // 3. Remove page markers like "--- 第 1 页 ---"
  text = text.replace(/---\s*第\s*\d+\s*页\s*---/g, "");

  // 4. Merge broken lines: if a line does NOT end with sentence-ending punctuation
  //    and the next line is not empty, join them
  const lines = text.split("\n");
  const merged: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
    if (
      line &&
      nextLine &&
      nextLine.trim() &&
      !/[。！？：；」』"'\n]$/.test(line.trim()) &&
      !/^[「『""]/.test(nextLine.trim())
    ) {
      merged.push(line.trim() + " ");
    } else {
      merged.push(line);
    }
  }
  text = merged.join("\n");

  // 5. Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, "\n\n");

  // 6. Trim leading/trailing whitespace per line
  text = text
    .split("\n")
    .map((l) => l.trim())
    .join("\n");

  // 7. Remove lines that are only whitespace/punctuation (no CJK or alpha chars)
  text = text
    .split("\n")
    .filter((l) => /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z0-9]/.test(l))
    .join("\n");

  return text.trim();
}