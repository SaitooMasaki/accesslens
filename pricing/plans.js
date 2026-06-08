// 料金プラン定義。最初から3段階(Free/Pro/Agency)を定義し、後出し課金感を出さない。
// Phase2限定機能(scheduledScans/emailDigest/cloudSync)は最初から定義され、
// UIでは "Coming soon" として可視化される。

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: '¥0',
    comingSoon: false,
    features: {
      scanPerDay: 5,
      clients: 1,
      pdfExport: false,
      whiteLabel: false,
      scheduledScans: false,
      emailDigest: false,
      cloudSync: false
    }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: '¥2,980/mo',
    comingSoon: false,
    features: {
      scanPerDay: Infinity,
      clients: Infinity,
      pdfExport: true,
      whiteLabel: true,
      scheduledScans: false,
      emailDigest: false,
      cloudSync: false
    }
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    price: '¥7,480/mo',
    comingSoon: true,
    features: {
      scanPerDay: Infinity,
      clients: Infinity,
      pdfExport: true,
      whiteLabel: true,
      scheduledScans: true,
      emailDigest: true,
      cloudSync: true
    }
  }
};

// Phase2機能一覧（"Coming soon" バッジ表示の判定に使う）
const PHASE2_FEATURES = ['scheduledScans', 'emailDigest', 'cloudSync'];

function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

function checkFeature(planId, featureName) {
  const plan = getPlan(planId);
  return Boolean(plan.features[featureName]);
}

function isPhase2Feature(featureName) {
  return PHASE2_FEATURES.includes(featureName);
}

function getScanLimit(planId) {
  return getPlan(planId).features.scanPerDay;
}

function getClientLimit(planId) {
  return getPlan(planId).features.clients;
}

export { PLANS, PHASE2_FEATURES, getPlan, checkFeature, isPhase2Feature, getScanLimit, getClientLimit };
