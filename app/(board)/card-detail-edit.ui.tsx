"use client";

import type { Card } from "@/cards/card.type";
import { Button } from "@/components/ui/button";
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
import { useCardEditActions } from "./card-detail.state";

/** The editable core fields of a card (every field optional — a partial patch). */
export interface EditPatch {
  title?: string;
  description?: string;
  priority?: number;
}

/** Patches a card's editable core fields; injected from the server. */
export type EditAction = (cardId: string, patch: EditPatch) => Promise<void>;

/** The fixed P0–P3 priority levels (P0 = lowest). */
const PRIORITY_LEVELS = [0, 1, 2, 3] as const;

/**
 * Inline edit form for a card's title / description / priority, shown in the
 * detail sheet. Submitting (a React form action, so it runs in a transition the
 * optimistic reflect can hook into) calls the injected edit action with the full
 * field set and leaves edit mode. Cancel discards without calling the action.
 * @param card - The card being edited (seeds the field defaults).
 * @param editAction - Server action that persists the patch (optimistic-wrapped
 *   by the parent).
 */
export function CardEditForm({
  card,
  editAction,
}: {
  card: Card;
  editAction: EditAction;
}) {
  const { cancelEdit } = useCardEditActions();

  /**
   * Collects the field values and persists them via the edit action. Run as a
   * form action so React wraps it in a transition.
   * @param data - The submitted form data.
   */
  async function handleAction(data: FormData) {
    await editAction(card.id, {
      title: String(data.get("title")),
      description: String(data.get("description")),
      priority: Number(data.get("priority")),
    });
    cancelEdit();
  }

  return (
    <form action={handleAction} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" name="title" defaultValue={card.title} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="edit-description">Description</Label>
        <Textarea
          id="edit-description"
          name="description"
          defaultValue={card.description ?? ""}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Priority</Label>
        <Select name="priority" defaultValue={String(card.priority)}>
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

      <div className="grid grid-flow-col justify-end gap-2">
        <Button type="button" variant="outline" onClick={cancelEdit}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
