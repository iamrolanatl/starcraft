"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/safe";
import ErrorScreen from "@/components/ErrorScreen";
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error, "route"); }, [error]);
  return <ErrorScreen code="500" detail={error?.digest ? `ref ${error.digest}` : undefined} onRetry={reset} />;
}
