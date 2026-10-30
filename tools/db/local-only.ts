import { dbEnv, localOnly } from "./env";

// Run before db:rollback: undoing a migration is refused unless APP_ENV is development or test.
localOnly(dbEnv(), "db:rollback");
