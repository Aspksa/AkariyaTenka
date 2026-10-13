export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

const secretName = /^[A-Z0-9_]{1,64}$/u;

export class EnvironmentSecretStore implements SecretStore {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly prefix = "AKARIYA_SECRET_"
  ) {}

  async get(key: string): Promise<string | null> {
    if (!secretName.test(key)) throw new Error("Invalid secret key");
    return this.env[this.prefix + key] ?? null;
  }

  async set(_key: string, _value: string): Promise<void> {
    throw new Error("EnvironmentSecretStore is read-only");
  }

  async delete(_key: string): Promise<void> {
    throw new Error("EnvironmentSecretStore is read-only");
  }
}

const secretKey = /(secret|token|password|api[-_]?key|authorization|credential)/iu;

function redact(value: unknown, knownSecrets: readonly string[]): unknown {
  if (typeof value === "string") {
    let output = value;
    for (const secret of knownSecrets) output = output.split(secret).join("[REDACTED]");
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, knownSecrets));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = secretKey.test(key) ? "[REDACTED]" : redact(item, knownSecrets);
  }
  return output;
}

export function redactSecrets(value: unknown): unknown {
  return redact(value, []);
}

export function createSecretRedactor(env: NodeJS.ProcessEnv = process.env): (value: unknown) => unknown {
  const knownSecrets = Object.entries(env)
    .filter(([key, value]) => secretKey.test(key) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
  return (value: unknown) => redact(value, knownSecrets);
}
