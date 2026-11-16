/**
 * The same rules on a 5x5 board, four in a row to win. Nothing but the starting position differs, which is
 * the claim rules.ts makes ("gomoku is two numbers"); a new game keeps the size, so it stays 5x5.
 *
 *     app_mcp.ts --dir <this directory> --rules <this directory>/rules_5x5.ts
 */
export * from "./rules.ts";
import { newGame } from "./rules.ts";

export const initial = newGame(5, 4);
