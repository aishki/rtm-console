// Makes a random password for each RTM database role, and the SCRAM-SHA-256 hash PostgreSQL stores
// for it, so a password can be set with ALTER ROLE without the plain text ever reaching pgAdmin, its
// query history or the server's logs. Used in step 3 of the pgAdmin setup (backend guide, Section 4).
//
//   npm run db:role-passwords                 both roles: rtm_migrator and rtm_app
//   npm run db:role-passwords -- rtm_app      only the roles named
//
// Run it in a terminal of your own, never through an AI assistant or anything that records the
// output: the passwords are printed once. Save them in a password manager, paste only the
// ALTER ROLE lines into pgAdmin, then close the terminal.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const ITERATIONS = 4096; // PostgreSQL's default scram_iterations

function scramHash(password) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const hmac = (key, text) => createHmac("sha256", key).update(text).digest();
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${ITERATIONS}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const roles = process.argv.length > 2 ? process.argv.slice(2) : ["rtm_migrator", "rtm_app"];
for (const role of roles) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    console.error(`Not a plain role name: ${role}`);
    process.exit(1);
  }
}

const sql = [];
console.log("\nPASSWORDS (save each in your password manager now; never paste them into pgAdmin, a chat or a file):\n");
for (const role of roles) {
  const password = randomBytes(30).toString("base64url"); // 40 characters
  console.log(`  ${role.padEnd(13)} ${password}`);
  sql.push(`ALTER ROLE ${role} PASSWORD '${scramHash(password)}';`);
}
console.log("\nSQL FOR PGADMIN (hashes only):\n");
console.log(sql.join("\n") + "\n");
