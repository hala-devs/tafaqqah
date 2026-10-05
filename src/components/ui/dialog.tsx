"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
};

/** Accessible modal built on the native <dialog> element (focus trap + Escape for free). */
export function Dialog({ open, onClose, title, description, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-text shadow-lift backdrop:bg-ink-dark/35 backdrop:backdrop-blur-[2px] open:animate-fade-up"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-card font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="إغلاق"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {description ? (
          <p id={descId} className="mt-2 text-small text-muted">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {actions ? <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </dialog>
  );
}
