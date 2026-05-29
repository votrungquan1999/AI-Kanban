"use client";

interface AddTaskFormProps {
  formAction: (formData: FormData) => void;
  error?: string;
  pending: boolean;
  cancelHref: string;
}

/**
 * Presentational add-task form: a title field, an optional error, and
 * cancel/submit controls. All behavior is supplied via props.
 * @param formAction - The action dispatcher bound by the dialog.
 * @param error - Validation error to display, if any.
 * @param pending - Whether a submission is in flight.
 * @param cancelHref - Where the cancel link navigates (closes the dialog).
 */
export function AddTaskForm({
  formAction,
  error,
  pending,
  cancelHref,
}: AddTaskFormProps) {
  return (
    <div
      role="dialog"
      aria-label="Add task"
      className="fixed inset-0 flex items-center justify-center bg-black/30 p-4"
    >
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-white p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-gray-900">New task</h2>

        <label className="flex flex-col gap-1 text-sm text-gray-700">
          Title
          <input
            name="title"
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <a href={cancelHref} className="px-3 py-1 text-sm text-gray-600">
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-gray-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            Add task
          </button>
        </div>
      </form>
    </div>
  );
}
