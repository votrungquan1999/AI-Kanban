/** Link to the board home (also closes the add-task dialog). */
export function boardHref(): string {
  return "/";
}

/** Link that opens the add-task dialog via URL state. */
export function newTaskHref(): string {
  return "/?new=task";
}

/** Link that opens a card's detail sheet via URL state. */
export function cardDetailHref(cardId: string): string {
  return `/?card=${cardId}`;
}
