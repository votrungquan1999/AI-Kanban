/** Link to the board home (also closes the add-task dialog). */
export function boardHref(): string {
  return "/";
}

/** Link that opens the add-task dialog via URL state. */
export function newTaskHref(): string {
  return "/?new=task";
}
