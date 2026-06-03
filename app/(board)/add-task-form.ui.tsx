"use client";

import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AddTaskFormProps {
  formAction: (formData: FormData) => void;
  error?: string;
  pending: boolean;
}

/** The fixed P0–P3 priority levels (P0 = lowest, the default for a new card). */
const PRIORITY_LEVELS = [0, 1, 2, 3] as const;

/**
 * Presentational add-task form (rendered inside the dialog): a title field,
 * an optional error, and cancel/submit controls. Behavior comes via props.
 * @param formAction - The action dispatcher bound by the dialog.
 * @param error - Validation error to display, if any.
 * @param pending - Whether a submission is in flight.
 */
export function AddTaskForm({ formAction, error, pending }: AddTaskFormProps) {
  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" />
      </div>

      <div className="grid gap-1.5">
        <Label>Priority</Label>
        <Select name="priority" defaultValue="0">
          <SelectTrigger aria-label="Priority" className="w-full">
            <SelectValue>{(value) => `P${value}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)}>
                P{level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid grid-flow-col justify-end gap-2">
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          Add task
        </Button>
      </div>
    </form>
  );
}
