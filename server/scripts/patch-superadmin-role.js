// One-off patch: assign SUPER_ADMIN role employee records to the
// existing superadmin user at every seeded branch. Needed because
// earlier seeds only created ADMIN role employees for that user.
//
// Safe idempotent — skips inserts when SUPER_ADMIN employee for
// userId+branchId already exists.
const MONG = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prolific_dev';
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(MONG);
  const User = mongoose.connection.collection('users');
  const Branch = mongoose.connection.collection('branches');
  const Emp = mongoose.connection.collection('employees');

  const su = await User.findOne({ email: 'superadmin@prolific.ai' });
  if (!su) {
    console.log('no superadmin user found — skipping');
    await mongoose.disconnect();
    return;
  }
  console.log('[patch] superadmin userId=%s email=%s', su._id.toString(), su.email);

  const branches = await Branch.find({}).toArray();
  for (const b of branches) {
    const exists = await Emp.findOne({
      userId: su._id,
      branchId: b._id,
      role: 'SUPER_ADMIN',
    });
    if (exists) {
      console.log('[patch] skip %s: SUPER_ADMIN emp exists (%s)', b.name, exists.employeeNumber);
      continue;
    }
    const branchPrefix = b._id.toString().slice(0, 5);
    const rec = {
      userId: su._id,
      restaurantId: b.restaurantId,
      branchId: b._id,
      role: 'SUPER_ADMIN',
      employeeNumber: `EMP-${branchPrefix}-SADM`,
      positionTitle: 'Super Admin',
      assignedZoneIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
    };
    const r = await Emp.insertOne(rec);
    console.log('[patch] inserted SUPER_ADMIN at %s -> id=%s', b.name, r.insertedId.toString());
  }

  const countAdmin = await Emp.countDocuments({ userId: su._id, role: 'ADMIN' });
  const countSuper = await Emp.countDocuments({ userId: su._id, role: 'SUPER_ADMIN' });
  console.log('[patch] superadmin role counts — ADMIN=%d SUPER_ADMIN=%d', countAdmin, countSuper);

  await mongoose.disconnect();
  console.log('[patch] done');
})().catch((e) => {
  console.error('[patch] FAILED:', e.message);
  process.exit(1);
});
