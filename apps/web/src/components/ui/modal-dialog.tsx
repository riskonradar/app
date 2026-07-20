"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";

type ModalDialogProps = {
  ariaDescribedBy?: string;
  ariaLabelledBy: string;
  children: ReactNode;
  className?: string;
  closeLabel: string;
  onClose: () => void;
};

/**
 * Native modal dialog wrapper. `showModal` supplies focus containment and makes
 * the rest of the document inert; the fallback keeps component tests and older
 * embedded browsers usable without weakening the production interaction.
 */
export function ModalDialog({
  ariaDescribedBy,
  ariaLabelledBy,
  children,
  className = "",
  closeLabel,
  onClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (!dialog) return;

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    const focusTarget =
      dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
      dialog.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    focusTarget?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      returnFocusRef.current?.focus();
    };
  }, []);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const isInside =
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom;
    if (!isInside) onClose();
  }

  function containKeyboardFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      className={`source-dialog modal-dialog ${className}`.trim()}
      aria-describedby={ariaDescribedBy}
      aria-labelledby={ariaLabelledBy}
      onKeyDown={containKeyboardFocus}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
    >
      <button
        className="dialog-close"
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      {children}
    </dialog>
  );
}
