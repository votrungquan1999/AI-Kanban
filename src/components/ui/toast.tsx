"use client";

import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Provider that owns the toast queue. Wrap the app so any client component can
 * call `useToast().add(...)` and the mounted `<Toaster />` can render the queue.
 */
function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

/**
 * Access the toast manager (`add`, `close`, `update`, `promise`, `toasts`).
 * @returns The Base-UI toast manager bound to the nearest provider.
 */
function useToast() {
  return ToastPrimitive.useToastManager();
}

/**
 * Fixed viewport that anchors toasts to the bottom of the screen (phone-first).
 */
function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "fixed inset-x-0 bottom-0 z-[100] mx-auto flex w-full max-w-sm flex-col gap-2 p-4 outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A single toast surface (title + description + close), animated from the bottom.
 */
function ToastRoot({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "grid grid-cols-[1fr_auto] items-start gap-x-3 rounded-xl bg-popover p-3 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 data-starting-style:translate-y-2 data-starting-style:opacity-0 data-ending-style:translate-y-2 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Toast heading; renders the toast's `title` when no children are provided.
 */
function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("col-start-1 font-medium leading-tight", className)}
      {...props}
    />
  );
}

/**
 * Toast body; renders the toast's `description` when no children are provided.
 */
function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("col-start-1 text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Dismiss button for a toast.
 */
function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close"
      className={cn(
        "col-start-2 row-start-1 text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitive.Close>
  );
}

export {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
  useToast,
};
