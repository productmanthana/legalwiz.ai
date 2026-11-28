import app from "./app";
import { logger } from "./lib/logger";
import { seedLegalLibrary } from "./lib/demo";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Make sure the starter legal library exists; only missing entries are added.
  seedLegalLibrary().catch((e) => logger.error({ err: e }, "Seeding legal library failed"));
});
