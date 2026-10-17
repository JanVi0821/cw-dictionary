import "server-only";

import * as Sentry from "@sentry/nextjs";
import { getRequestExecutionContext } from "vinext/shims/request-context";

function redact(value: string, secrets: string[]) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
}

export async function captureError(
  error: unknown,
  context: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    redact?: string[];
  } = {},
) {
  const secrets = (context.redact ?? []).filter(Boolean);
  const exception = error instanceof Error ? error : new Error(String(error));
  exception.message = redact(exception.message, secrets);
  if (exception.stack) exception.stack = redact(exception.stack, secrets);

  console.error(exception);
  try {
    Sentry.captureException(exception, {
      tags: context.tags,
      extra: context.extra,
    });
    const flush = Sentry.flush(2000).catch((reportError) => {
      console.error(reportError);
    });
    getRequestExecutionContext()?.waitUntil(flush);
  } catch (reportError) {
    console.error(reportError);
  }
}
