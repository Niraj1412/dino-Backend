import { createHash } from "crypto";

const stableStringify = (input: unknown): string => {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`);

  return `{${entries.join(",")}}`;
};

export const buildRequestFingerprint = (
  method: string,
  path: string,
  body: unknown
): string => {
  const material = `${method.toUpperCase()}|${path}|${stableStringify(body)}`;

  return createHash("sha256").update(material).digest("hex");
};