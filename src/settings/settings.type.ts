/**
 * The board-wide settings document — a singleton stored under a fixed
 * `_id` of `"board"`. Holds the default Blocked-column auto-move countdown
 * (in milliseconds) applied when a card is blocked without an explicit
 * per-card interval.
 */
export interface SettingsDocument {
  _id: string;
  defaultBlockIntervalMs: number;
}
