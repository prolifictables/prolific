// One-off patch: explicitly set customerDisplay.branchName = "Port Harcourt"
// in the Setting document so even if the POS main window still has an older
// stale broadcast cache, the next poller interval (30s) will sync it to
// every popup window. We also set the tagline, wifi, hours, promo title
// truncations can stay user-edited. Just set branchName override explicitly.
const MONG = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prolific_dev';
const mongoose = require('mongoose');

const BRANCH_ID = '6a814d299717fc01eabb6000';
const RESTAURANT_ID = '6a814d299717fc01eabb5ffc';

(async () => {
  await mongoose.connect(MONG);
  const Setting = mongoose.connection.collection('settings');

  const result = await Setting.updateOne(
    {
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      key: 'branch.settings',
      scope: 'BRANCH',
    },
    {
      $set: {
        'value.customerDisplay.branchName': 'Port Harcourt',
        updatedAt: new Date(),
      },
    },
  );

  const after = await Setting.findOne({
    restaurantId: RESTAURANT_ID,
    branchId: BRANCH_ID,
    key: 'branch.settings',
    scope: 'BRANCH',
  });

  console.log('[patch-setting-branchname] update matched=%d modified=%d',
    result.matchedCount, result.modifiedCount);
  console.log('[patch-setting-branchname] value.customerDisplay.branchName AFTER = %j',
    after?.value?.customerDisplay?.branchName);

  await mongoose.disconnect();
  console.log('[patch-setting-branchname] done');
})().catch((e) => {
  console.error('[patch-setting-branchname] FAILED:', e.message);
  process.exit(1);
});
