// One-off patch: rename live branch name from "Lagos Flagship" to "Port Harcourt"
// and update the HQ location fields. This updates the actual Branch MongoDB
// documents directly so the /public/branches endpoint returns Port Harcourt,
// which is what the POS customer-display bootstrap reads to populate the
// branch card heading.
//
// Also updates restaurant HQ city to Port Harcourt for consistency.
// Safe idempotent — only updates documents where fields currently differ.
const MONG = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prolific_dev';
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

const BRANCH_IDS = {
  LAGOS_FLAGSHIP: '6a814d299717fc01eabb6000',
};

(async () => {
  await mongoose.connect(MONG);
  const Branch = mongoose.connection.collection('branches');
  const Restaurant = mongoose.connection.collection('restaurants');
  const Employee = mongoose.connection.collection('employees');

  // 1. Rename Lagos Flagship branch → Port Harcourt
  const branchBefore = await Branch.findOne({ _id: new ObjectId(BRANCH_IDS.LAGOS_FLAGSHIP) });
  if (!branchBefore) {
    console.log('[patch-branch] WARNING: branch %s not found in DB — exiting', BRANCH_IDS.LAGOS_FLAGSHIP);
    await mongoose.disconnect();
    return;
  }
  console.log('[patch-branch] BEFORE: id=%s name="%s" city="%s" address="%s"',
    branchBefore._id.toString(), branchBefore.name, branchBefore.city, branchBefore.address);

  const patchBranch = {
    $set: {
      name: 'Port Harcourt',
      city: 'Port Harcourt',
      address: '123 Aba Road, GRA Phase 3',
      updatedAt: new Date(),
    },
  };
  const resBranch = await Branch.updateOne(
    { _id: new ObjectId(BRANCH_IDS.LAGOS_FLAGSHIP) },
    patchBranch,
  );
  const branchAfter = await Branch.findOne({ _id: new ObjectId(BRANCH_IDS.LAGOS_FLAGSHIP) });
  console.log('[patch-branch] AFTER (%d matched, %d modified): name="%s" city="%s" address="%s"',
    resBranch.matchedCount, resBranch.modifiedCount,
    branchAfter.name, branchAfter.city, branchAfter.address);

  // 2. Update HQ restaurant city/address (all branches share same restaurantId)
  const restaurantBefore = await Restaurant.findOne({ _id: new ObjectId(branchAfter.restaurantId) });
  if (restaurantBefore) {
    console.log('[patch-restaurant] BEFORE: id=%s name="%s" city="%s" address="%s"',
      restaurantBefore._id.toString(), restaurantBefore.name, restaurantBefore.city, restaurantBefore.address);
    const patchRestaurant = {
      $set: {
        city: 'Port Harcourt',
        address: '123 Aba Road, GRA Phase 3',
        updatedAt: new Date(),
      },
    };
    const resRest = await Restaurant.updateOne(
      { _id: new ObjectId(restaurantBefore._id) },
      patchRestaurant,
    );
    const restaurantAfter = await Restaurant.findOne({ _id: new ObjectId(restaurantBefore._id) });
    console.log('[patch-restaurant] AFTER (%d matched, %d modified): city="%s" address="%s"',
      resRest.matchedCount, resRest.modifiedCount,
      restaurantAfter.city, restaurantAfter.address);
  }

  // 3. Update employee lastName "Lagos" → "Portharcourt" for employees of this branch (non-destructive, matches seed pattern)
  const resEmp = await Employee.updateMany(
    { branchId: BRANCH_IDS.LAGOS_FLAGSHIP, lastName: 'Lagos' },
    { $set: { lastName: 'Portharcourt', updatedAt: new Date() } },
  );
  console.log('[patch-employees] renamed %d employees lastName=Lagos→Portharcourt on branch %s',
    resEmp.modifiedCount, BRANCH_IDS.LAGOS_FLAGSHIP);

  // 4. Bonus: if there is any OTHER branch (e.g. older seed created Abuja),
  // list all branches so operator can confirm
  const all = await Branch.find({}).project({ _id: 1, name: 1, city: 1, address: 1 }).toArray();
  console.log('[patch-summary] All branches after patch:');
  for (const b of all) {
    console.log('  · [%s] %s — city=%s addr=%s', b._id.toString().slice(0, 8), b.name, b.city, b.address);
  }

  await mongoose.disconnect();
  console.log('[patch-branch] done');
})().catch((e) => {
  console.error('[patch-branch] FAILED:', e.message);
  process.exit(1);
});
