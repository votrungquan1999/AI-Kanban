"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  ToastClose,
  ToastDescription,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToast,
} from "@/components/ui/toast";

/**
 * Renders the live toast queue into a portal. Mount exactly once, inside
 * `<ToastProvider/>` (see app/layout.tsx). Each toast shows its title,
 * optional description, and a close button.
 */
function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastPrimitive.Portal>
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastRoot key={toast.id} toast={toast}>
            <ToastTitle />
            <ToastDescription />
            <ToastClose />
          </ToastRoot>
        ))}
      </ToastViewport>
    </ToastPrimitive.Portal>
  );
}

export { Toaster };
