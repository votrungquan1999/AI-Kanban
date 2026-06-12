"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** One offered block duration: a human label and its millisecond value. */
interface DurationPreset {
  label: string;
  ms: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Fallback block default (2h) when the board default has not been threaded in. */
export const DEFAULT_BLOCK_INTERVAL_MS = 2 * HOUR_MS;

/** Fixed block-duration presets offered when blocking a card or setting the board default. */
export const DURATION_PRESETS: DurationPreset[] = [
  { label: "30m", ms: 30 * MINUTE_MS },
  { label: "1h", ms: HOUR_MS },
  { label: "2h", ms: 2 * HOUR_MS },
  { label: "4h", ms: 4 * HOUR_MS },
  { label: "8h", ms: 8 * HOUR_MS },
  { label: "1d", ms: 24 * HOUR_MS },
];

/**
 * Inline duration chooser + Block button. The Select is pre-set to the board
 * default and the user may override it for this card; clicking Block sends the
 * chosen interval to `blockAction`.
 * @param cardId - The card to block.
 * @param defaultIntervalMs - The board default, used as the initial selection.
 * @param blockAction - Called with the chosen interval (ms) when Block is clicked.
 */
export function BlockDurationPicker({
  cardId,
  defaultIntervalMs,
  blockAction,
}: {
  cardId: string;
  defaultIntervalMs: number;
  blockAction: (cardId: string, intervalMs: number) => void;
}) {
  const [intervalMs, setIntervalMs] = useState(defaultIntervalMs);

  function handleValueChange(next: number | null) {
    if (next !== null) {
      setIntervalMs(next);
    }
  }

  return (
    <div className="grid grid-flow-col items-center justify-start gap-1">
      <Select value={intervalMs} onValueChange={handleValueChange}>
        <SelectTrigger size="sm" aria-label="Block duration">
          <SelectValue>
            {(value) =>
              DURATION_PRESETS.find((preset) => preset.ms === value)?.label ??
              ""
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
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => blockAction(cardId, intervalMs)}
      >
        Block
      </Button>
    </div>
  );
}
