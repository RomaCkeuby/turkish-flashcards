import { closeDatabase, getStats, openDatabase } from "./database.ts";

const database = openDatabase();
const stats = getStats(database);

console.log(`База заполнена: ${stats.entries} слов, ${stats.cards} карточек.`);
closeDatabase(database);
