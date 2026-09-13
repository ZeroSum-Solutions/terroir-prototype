"use client";

import { useEffect } from "react";
import { RouteDataError } from "@/components/route-data-state";

export default function HomeError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <RouteDataError
      title="Home couldn't be loaded"
      description="The latest cellar summary could not be loaded. Your cellar has not been changed."
      onRetry={unstable_retry}
    />
  );
}
