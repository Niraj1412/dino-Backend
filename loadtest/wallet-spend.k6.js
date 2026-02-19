import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const USER_ID = __ENV.USER_ID;
const ASSET_CODE = __ENV.ASSET_CODE || "GOLD_COINS";

if (!USER_ID) {
  throw new Error("USER_ID env var is required");
}

export const options = {
  scenarios: {
    spend_burst: {
      executor: "constant-arrival-rate",
      duration: "30s",
      rate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 300
    }
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<500"]
  }
};

const buildPayload = () =>
  JSON.stringify({
    userId: USER_ID,
    assetCode: ASSET_CODE,
    amount: "1"
  });

export default function () {
  const idempotencyKey = `k6-${__VU}-${__ITER}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const response = http.post(`${BASE_URL}/wallet/spend`, buildPayload(), {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    timeout: "5s"
  });

  check(response, {
    "status is 200 or 409": (r) => r.status === 200 || r.status === 409
  });

  sleep(0.05);
}