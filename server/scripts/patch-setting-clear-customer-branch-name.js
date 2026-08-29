// One-off patch: if the user saved a custom branchName into
// Setting.value.customerDisplay.branchName (BRANCH-scoped key=branch.settings),
// it overrides the real Branch name. Clear that key so the display falls back
// to the actual Branch.name (which we renamed to Port Harcourt in the prior
// patch). Also clear tagline, wifi, openingHours if they were set to anything
// that looks like placeholder overrides — only clear the explicitly PH-related
// key to be safe: branchName.
const MONG = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prolific_dev';
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

const BRANCH_ID = '6a814d299717fc01eabb6000';
const RESTAURANT_ID = '6a814d299717fc01eabb5ffc';

(async () => {
  await mongoose.connect(MONG);
  const Setting = mongoose.connection.collection('settings');

  const existing = await Setting.findOne({
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    key: 'branch.settings',
    scope: 'BRANCH',
  });

  if (!existing) {
    console.log('[patch-setting] no Setting doc with key=branch.settings found — nothing to clear');
    await mongoose.disconnect();
    return;
  }

  const cd = existing.value?.customerDisplay;
  console.log('[patch-setting] BEFORE setting.value.customerDisplay=%j', cd);

  // Only unset the customerDisplay.branchName key — fall through to the
  // real Branch name from Mongo. Preserve custom promos/specials/tagline/wifi/hours
  // the user intentionally edited.
  if (cd && Object.prototype.hasOwnProperty.call(cd, 'branchName')) {
    const result = await Setting.updateOne(
      { _id: existing._id },
      {
        $unset: { 'value.customerDisplay.branchName': '' },
        $set: { updatedAt: new Date() },
      },
    );
    console.log('[patch-setting] unset customerDisplay.branchName (matched=%d modified=%d)',
      result.matchedCount, result.modifiedCount);
  } else {
    console.log('[patch-setting] customerDisplay.branchName was not saved — no change needed');
  }

  const after = await Setting.findOne({ _id: existing._id });
  console.log('[patch-setting] AFTER setting.value.customerDisplay=%j', after?.value?.customerDisplay);

  await mongoose.disconnect();
  console.log('[patch-setting] done');
})().catch((e) => {
  console.error('[patch-setting] FAILED:', e.message);
  process.exit(1);
});
