export const EXIT_CODE = {
  ok: 0,
  notFound: 1,
  invalidInput: 2,
  conflict: 3,
  deliveryFailed: 4,
  notFit: 5,
  internalError: 6,
} as const;

export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export class NagError extends Error {
  code: ExitCode;

  constructor(code: ExitCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type Envelope = {
  tool: "nag";
  version: string;
  command: string;
  ok: boolean;
  code: ExitCode;
  status: "success" | "failure";
  reason: string | null;
  message: string;
  data: unknown;
};

export function buildEnvelope(
  version: string,
  command: string,
  code: ExitCode,
  message: string,
  data: unknown = null,
): Envelope {
  let status: Envelope["status"] = "success";
  let reason: string | null = null;
  if (code !== EXIT_CODE.ok) {
    status = "failure";
    reason = message;
  }
  return {
    tool: "nag",
    version,
    command,
    ok: code === EXIT_CODE.ok,
    code,
    status,
    reason,
    message,
    data,
  };
}
