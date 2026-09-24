import {
  LosslessJson,
  LosslessNumber,
  TOAST_BODY_LIMIT_BYTES,
  ToastContractError,
} from "./contracts";

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_NUMBER_LENGTH = 128;

type ParseLimits = Readonly<{
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
  maxNumberLength?: number;
}>;

export function parseLosslessJson(
  bytes: Uint8Array,
  limits: ParseLimits = {},
): LosslessJson {
  const maxBytes = limits.maxBytes ?? TOAST_BODY_LIMIT_BYTES;
  if (bytes.byteLength > maxBytes) {
    throw new ToastContractError("body_too_large", `body exceeds ${maxBytes} bytes`);
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ToastContractError("invalid_utf8", "body is not strict UTF-8");
  }

  let index = 0;
  let nodes = 0;
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  const maxNumberLength = limits.maxNumberLength ?? DEFAULT_MAX_NUMBER_LENGTH;

  const fail = (message: string): never => {
    throw new ToastContractError("invalid_json", `${message} at offset ${index}`);
  };
  const countNode = () => {
    nodes += 1;
    if (nodes > maxNodes) fail(`JSON exceeds ${maxNodes} values`);
  };
  const whitespace = () => {
    while (index < source.length && /[\t\n\r ]/.test(source[index])) index += 1;
  };
  const string = (): string => {
    const start = index;
    index += 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index)) as string;
        } catch {
          return fail("invalid JSON string");
        }
      }
      if (char === "\\") {
        index += 2;
      } else {
        if (char.charCodeAt(0) < 0x20) fail("unescaped control character");
        index += 1;
      }
    }
    return fail("unterminated JSON string");
  };
  const number = (): LosslessNumber => {
    const match = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!match) return fail("invalid JSON number");
    if (match[0].length > maxNumberLength) {
      throw new ToastContractError(
        "number_too_long",
        `number exceeds ${maxNumberLength} characters`,
      );
    }
    index += match[0].length;
    return new LosslessNumber(match[0]);
  };
  const value = (depth: number): LosslessJson => {
    if (depth > maxDepth) {
      throw new ToastContractError("json_too_deep", `JSON exceeds depth ${maxDepth}`);
    }
    whitespace();
    countNode();
    const char = source[index];
    if (char === '"') return string();
    if (char === "-") return number();
    if (char !== undefined && /\d/.test(char)) return number();
    if (source.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (source.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (source.startsWith("null", index)) {
      index += 4;
      return null;
    }
    if (char === "[") {
      index += 1;
      const result: LosslessJson[] = [];
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return result;
        }
        if (source[index] !== ",") fail("expected array comma");
        index += 1;
      }
    }
    if (char === "{") {
      index += 1;
      const result = Object.create(null) as { [key: string]: LosslessJson };
      const keys = new Set<string>();
      whitespace();
      if (source[index] === "}") {
        index += 1;
        return result;
      }
      while (true) {
        whitespace();
        if (source[index] !== '"') fail("expected object key");
        const key = string();
        if (keys.has(key)) {
          throw new ToastContractError("duplicate_json_key", `duplicate key: ${key}`);
        }
        keys.add(key);
        whitespace();
        if (source[index] !== ":") fail("expected object colon");
        index += 1;
        result[key] = value(depth + 1);
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return result;
        }
        if (source[index] !== ",") fail("expected object comma");
        index += 1;
      }
    }
    return fail("unexpected JSON token");
  };

  const parsed = value(0);
  whitespace();
  if (index !== source.length) fail("trailing JSON data");
  return parsed;
}
