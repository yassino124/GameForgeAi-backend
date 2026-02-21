/**
 * One-time migration: Set status='active' for existing users without status field.
 * Run: npx ts-node scripts/migrate-user-status.ts
 * Or connect to MongoDB and run:
 *   db.users.updateMany(
 *     { $or: [{ status: { $exists: false } }, { status: null }] },
 *     { $set: { status: 'active' } }
 *   )
 */
