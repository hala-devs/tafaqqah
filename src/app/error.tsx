"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the digest is logged client-side; details stay in server logs.
    if (error.digest) console.error("[tafaqqah] error digest:", error.digest);
  }, [error]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-title text-ink">تعذّر عرض هذه الصفحة الآن</h1>
      <p className="mt-2 max-w-md text-muted">حدث خلل مؤقت. لم يُفقد شيء من تقدّمك. حاول مرة أخرى بعد لحظات.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset} icon={<RotateCcw className="size-4" aria-hidden />}>
          حاول مرة أخرى
        </Button>
        <ButtonLink href="/dashboard" variant="secondary">
          العودة إلى الرئيسية
        </ButtonLink>
      </div>
    </main>
  );
}
