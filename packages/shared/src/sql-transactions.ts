import type { LocalDatabase, SqlExecutor } from './local-database';

/** Reader and writer must already be opened and keyed. Expo's built-in exclusive
 * transaction helper opens an unkeyed connection and cannot be used with this vault. */
export function transactionalDatabase(reader: SqlExecutor, writer: SqlExecutor): LocalDatabase {
  return {
    execAsync: reader.execAsync.bind(reader),
    runAsync: reader.runAsync.bind(reader),
    getFirstAsync: reader.getFirstAsync.bind(reader),
    getAllAsync: reader.getAllAsync.bind(reader),
    async withExclusiveTransactionAsync(task) {
      await writer.execAsync('BEGIN IMMEDIATE');
      try {
        await task(writer);
        await writer.execAsync('COMMIT');
      } catch (error) {
        try {
          await writer.execAsync('ROLLBACK');
        } catch {
          /* Preserve original failure. */
        }
        throw error;
      }
    },
  };
}
