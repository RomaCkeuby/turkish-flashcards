import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writePublicDeck } from "./publicDeck.ts";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = process.argv[2] ? resolve(process.argv[2]) : resolve(moduleDirectory, "../update-packages/current");
const outputDirectory = process.argv[3] ? resolve(process.argv[3]) : resolve(moduleDirectory, "../../web/public/decks");
const manifest = writePublicDeck(sourceDirectory, outputDirectory);
console.log(`Public deck: ${manifest.recordCount} entries, ${manifest.file}, version ${manifest.version}`);
