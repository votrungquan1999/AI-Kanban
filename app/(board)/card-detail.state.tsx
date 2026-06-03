"use client";

import { createReducerContext } from "@/lib/create-reducer-context";

/** Whether the detail sheet is showing its inline edit form. */
interface CardEditState {
  isEditing: boolean;
}

/** Toggles between the read-only view and the inline edit form. */
type CardEditAction = { type: "START_EDIT" } | { type: "CANCEL_EDIT" };

/**
 * Reduces edit-mode transitions for the card detail sheet.
 * @param state - The current edit-mode state.
 * @param action - The transition to apply.
 */
function cardEditReducer(
  state: CardEditState,
  action: CardEditAction,
): CardEditState {
  switch (action.type) {
    case "START_EDIT":
      return { isEditing: true };
    case "CANCEL_EDIT":
      return { isEditing: false };
    default:
      return state;
  }
}

const [Provider, useCardEditRawState, useCardEditDispatch] =
  createReducerContext(cardEditReducer, { isEditing: false });

/** Whether the sheet is currently in edit mode. */
export function useCardEditMode(): boolean {
  return useCardEditRawState().isEditing;
}

/** Semantic actions for entering and leaving the sheet's edit mode. */
export function useCardEditActions() {
  const dispatch = useCardEditDispatch();
  return {
    startEdit: () => dispatch({ type: "START_EDIT" }),
    cancelEdit: () => dispatch({ type: "CANCEL_EDIT" }),
  };
}

export { Provider as CardEditProvider };
