/** Static repository expressions only, never user input. SQLite casts truncate;
 * PostgreSQL casts round. Correct either result without optional SQLite math functions. */
export const floorIntegerSql = (expression) => `(CAST(${expression} AS INTEGER)
  - CASE WHEN CAST(${expression} AS INTEGER) > (${expression}) THEN 1 ELSE 0 END)`;
