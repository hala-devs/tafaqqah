"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { syncTimezoneAction } from "@/app/(shell)/account/actions";

/**
 * Aligns the learner's stored timezone with their device so that "today", the week and the month
 * (streak and goals) change at their own midnight. Renders nothing; runs at most once per mismatch.
 */
export function TimezoneSync({ stored }: { stored: string }) {
  const router = useRouter();
  useEffect(() => {
    let detected: string | undefined;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!detected || detected === stored) return;
    const key = `tafaqqah-tz-sync:${detected}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: still try once per mount */
    }
    void syncTimezoneAction(detected).then(() => router.refresh());
  }, [stored, router]);
  return null;
}
