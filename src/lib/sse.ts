/**
 * Parse one Server-Sent-Events block ("event: <name>\ndata: <json>") into { event, data }.
 * Pure and dependency-free (safe on server or client). Returns null when the block has no
 * data payload or the data isn't valid JSON. Shared by the KYC and UBO SSE readers.
 */
export function parseSse(block: string): { event: string; data: unknown } | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
