"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION_PRESETS } from "./block-duration-picker.ui";

/**
 * Board settings dialog (header trigger). Lets the operator change the board's
 * DEFAULT block duration; the Select is pre-filled with the current default and
 * Save persists the chosen value via the injected action.
 * @param defaultIntervalMs - The current board default (ms), pre-filled.
 * @param updateAction - Persists the new default block interval (ms).
 */
export function BoardSettingsDialog({
  defaultIntervalMs,
  updateAction,
}: {
  defaultIntervalMs: number;
  updateAction: (intervalMs: number) => Promise<void>;
}) {
  const [intervalMs, setIntervalMs] = useState(defaultIntervalMs);

  function handleValueChange(next: number | null) {
    if (next !== null) {
      setIntervalMs(next);
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" aria-label="Board settings" />}
      >
        Settings
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Default block duration
          </span>
          <Select value={intervalMs} onValueChange={handleValueChange}>
            <SelectTrigger
              aria-label="Default block duration"
              className="w-full"
            >
              <SelectValue>
                {(value) =>
                  DURATION_PRESETS.find((preset) => preset.ms === value)
                    ?.label ?? ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DURATION_PRESETS.map((preset) => (
                <SelectItem key={preset.ms} value={preset.ms}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogClose
          render={<Button onClick={() => void updateAction(intervalMs)} />}
        >
          Save
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
