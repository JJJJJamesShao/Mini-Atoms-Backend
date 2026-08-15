/**
 * owner 手动升付费的唯一通道（无 HTTP 管理面）：
 *   npm run user:promote -- <email>
 * 把指定用户 role 置为 paid（不限量）；降回 free 用 --demote。
 */
import { closeDb } from '../src/config/database.js';
import { findUserByEmail, setUserRole } from '../src/services/users.js';

async function main() {
  const email = process.argv[2]?.toLowerCase();
  const demote = process.argv.includes('--demote');
  if (!email) {
    console.error('用法: npm run user:promote -- <email> [--demote]');
    process.exit(1);
  }
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`用户不存在: ${email}`);
    process.exit(1);
  }
  const role = demote ? 'free' : 'paid';
  await setUserRole(user.id, role);
  console.log(`✅ ${email} 已设置为 ${role}`);
  await closeDb();
}

main().catch((err) => {
  console.error('操作失败:', err);
  process.exit(1);
});
