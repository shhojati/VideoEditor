// Owner commands, run inside the api container:
//   docker compose exec api node src/cli.ts make-admin you@example.com
//   docker compose exec api node src/cli.ts remove-admin you@example.com
// The account must already exist (register in the editor first).
import { normalizeEmail } from './auth.ts';
import { openDb } from './db.ts';

const [cmd, emailArg] = process.argv.slice(2);
const db = openDb(process.env.DB_PATH ?? '/data/app.db');

if ((cmd === 'make-admin' || cmd === 'remove-admin') && emailArg) {
  const email = normalizeEmail(emailArg);
  const { changes } = db.prepare('UPDATE users SET is_admin = ? WHERE email = ?').run(cmd === 'make-admin' ? 1 : 0, email);
  if (!changes) {
    console.error(`No account with email ${email}. Register it in the editor first.`);
    process.exit(1);
  }
  console.log(`${email}: ${cmd === 'make-admin' ? 'now an admin' : 'no longer an admin'}`);
} else {
  console.error('Usage: node src/cli.ts make-admin|remove-admin <email>');
  process.exit(2);
}
