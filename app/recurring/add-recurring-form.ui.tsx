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
import { Textarea } from "@/components/ui/textarea";
import { ScheduleKind } from "./add-recurring.type";

interface AddRecurringFormProps {
  formAction: (formData: FormData) => void;
  error?: string;
  pending: boolean;
}

/** Human labels for each schedule preset, keyed by the form's select value. */
const SCHEDULE_LABELS: Record<string, string> = {
  [ScheduleKind.Hourly]: "Hourly",
  [ScheduleKind.Daily]: "Daily",
  [ScheduleKind.Weekly]: "Weekly",
  [ScheduleKind.Custom]: "Custom",
};

/**
 * Presentational add-recurring form (rendered inside the dialog): title,
 * instruction, a schedule preset selector, a numeric custom-interval input, an
 * optional error, and cancel/submit controls. Behavior comes via props; the
 * preset → everyHours mapping is done server-side in the action.
 * @param formAction - The action dispatcher bound by the dialog.
 * @param error - Validation error to display, if any.
 * @param pending - Whether a submission is in flight.
 */
export function AddRecurringForm({
  formAction,
  error,
  pending,
}: AddRecurringFormProps) {
  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="instruction">Instruction</Label>
        <Textarea id="instruction" name="instruction" />
      </div>

      <div className="grid gap-1.5">
        <Label>Schedule</Label>
        <Select name="scheduleKind" defaultValue={ScheduleKind.Daily}>
          <SelectTrigger aria-label="Schedule" className="w-full">
            <SelectValue>
              {(value) => SCHEDULE_LABELS[String(value)]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ScheduleKind.Hourly}>Hourly</SelectItem>
            <SelectItem value={ScheduleKind.Daily}>Daily</SelectItem>
            <SelectItem value={ScheduleKind.Weekly}>Weekly</SelectItem>
            <SelectItem value={ScheduleKind.Custom}>Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="everyHours">Every N hours (custom)</Label>
        <Input id="everyHours" name="everyHours" type="number" min="1" />
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
          Add recurring task
        </Button>
      </div>
    </form>
  );
}
