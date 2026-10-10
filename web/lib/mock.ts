/**
 * Last-resort demo data. Used only when both the API and /fixtures/*.json
 * are unavailable. Shapes match CONTRACT.md / shared/schema.py exactly.
 */
import type {
  CardStatus,
  EvalResults,
  Park,
  ProcessedAlert,
  TrailCard,
  WorkflowRun,
} from "./types";

const MODEL = "llama-3.2-1b-trailtruth-lora";

export const MOCK_ALERTS: ProcessedAlert[] = [
  {
    id: "6822FAF9-9E8D-4F41-A8B3-760473B7381A",
    park_code: "chch",
    park_name: "Chickamauga & Chattanooga National Military Park",
    title: "Use Caution When Hiking Bluff Trail on Lookout Mountain",
    description:
      "A territorial barred owl may be present along the Bluff Trail between the Ochs Gateway and the Sunset Rock junction. Hikers have reported the owl swooping at people, especially near dusk. Hike in groups, wear a hat, and do not linger in the area.",
    url: "https://www.nps.gov/chch/planyourvisit/conditions.htm",
    nps_category: "Caution",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "wildlife",
      severity: 2,
      trails_affected: ["Bluff Trail"],
      is_closed: false,
      decision: "caution",
      reason: "Territorial barred owl on Bluff Trail section; stay alert near dusk.",
    },
    model: MODEL,
    latency_ms: 212,
  },
  {
    id: "A5793882-6117-4E05-B175-A9FD505FE6FC",
    park_code: "chch",
    park_name: "Chickamauga & Chattanooga National Military Park",
    title: "Construction Begins on East Brotherton Road in Chickamauga Battlefield",
    description:
      "Road rehabilitation on East Brotherton Road begins October 6. Expect single-lane traffic with flaggers between 8 a.m. and 4 p.m. on weekdays. Trailheads remain open; allow extra time.",
    url: "https://www.nps.gov/chch/planyourvisit/conditions.htm",
    nps_category: "Information",
    last_indexed: "2026-10-08",
    verdict: {
      hazard_type: "construction",
      severity: 1,
      trails_affected: [],
      is_closed: false,
      decision: "go",
      reason: "Weekday single-lane road work; trailheads open, allow extra time.",
    },
    model: MODEL,
    latency_ms: 198,
  },
  {
    id: "E6380F1D-EB3A-44EC-B206-6A65019B38D5",
    park_code: "havo",
    park_name: "Hawaiʻi Volcanoes National Park",
    title:
      "Halemaʻumaʻu Trail and Part of Byron Ledge Trail Closed Due to Safety Risks",
    description:
      "Due to continued inflation and increased seismicity at the summit of Kīlauea, Halemaʻumaʻu Trail and the section of Byron Ledge Trail between Kīlauea Iki and Devastation Trail are closed until further notice. Ground cracking and rockfall have been observed.",
    url: "https://www.nps.gov/havo/planyourvisit/conditions.htm",
    nps_category: "Park Closure",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "geologic",
      severity: 3,
      trails_affected: ["Halemaʻumaʻu Trail", "Byron Ledge Trail"],
      is_closed: true,
      decision: "no_go",
      reason: "Summit inflation and seismicity; both trails closed until further notice.",
    },
    model: MODEL,
    latency_ms: 236,
  },
  {
    id: "031E225F-49AB-4264-9DD6-4402E620DC1B",
    park_code: "havo",
    park_name: "Hawaiʻi Volcanoes National Park",
    title: "Protect Yourself from Volcanic Tephra",
    description:
      "During eruptive episodes, winds may carry tephra (Pele's hair and volcanic glass) to overlooks downwind of the vent. Wear eye protection and avoid lingering at Keanakākoʻi overlook when fountaining is active.",
    url: "https://www.nps.gov/havo/planyourvisit/conditions.htm",
    nps_category: "Caution",
    last_indexed: "2026-10-07",
    verdict: {
      hazard_type: "air_quality",
      severity: 2,
      trails_affected: ["Keanakākoʻi overlook"],
      is_closed: false,
      decision: "caution",
      reason: "Wind-blown volcanic glass at downwind overlooks; wear eye protection.",
    },
    model: MODEL,
    latency_ms: 221,
  },
  {
    id: "B1D2C3E4-0001-4A11-9F00-YOSE00000001",
    park_code: "yose",
    park_name: "Yosemite National Park",
    title: "Mist Trail Closed Above Vernal Fall Footbridge for Rockfall Mitigation",
    description:
      "The Mist Trail is closed between the Vernal Fall footbridge and the top of Vernal Fall Monday through Thursday while crews scale loose rock. Use the John Muir Trail as a detour. The trail is open Friday through Sunday.",
    url: "https://www.nps.gov/yose/planyourvisit/conditions.htm",
    nps_category: "Park Closure",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "geologic",
      severity: 3,
      trails_affected: ["Mist Trail"],
      is_closed: true,
      decision: "no_go",
      reason: "Mist Trail closed Mon–Thu above footbridge; detour via John Muir Trail.",
    },
    model: MODEL,
    latency_ms: 244,
  },
  {
    id: "B1D2C3E4-0002-4A11-9F00-YOSE00000002",
    park_code: "yose",
    park_name: "Yosemite National Park",
    title: "Bears Are Active — Store Food Properly",
    description:
      "Black bears are feeding heavily before winter. Store all food and scented items in bear-resistant lockers at trailheads and campgrounds, and never leave food unattended at picnic areas.",
    url: "https://www.nps.gov/yose/planyourvisit/conditions.htm",
    nps_category: "Caution",
    last_indexed: "2026-10-06",
    verdict: {
      hazard_type: "wildlife",
      severity: 2,
      trails_affected: [],
      is_closed: false,
      decision: "caution",
      reason: "Pre-winter bear activity; use lockers for all food and scented items.",
    },
    model: MODEL,
    latency_ms: 205,
  },
  {
    id: "C7A1B2D3-0001-4C22-8E00-GRCA00000001",
    park_code: "grca",
    park_name: "Grand Canyon National Park",
    title: "Extreme Heat Warning Below the Rim",
    description:
      "Inner-canyon temperatures are forecast to exceed 100°F at Phantom Ranch this week. Avoid hiking between 10 a.m. and 4 p.m., carry at least a gallon of water per person, and do not attempt rim-to-river-to-rim in one day.",
    url: "https://www.nps.gov/grca/planyourvisit/conditions.htm",
    nps_category: "Danger",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "weather",
      severity: 3,
      trails_affected: ["Bright Angel Trail", "South Kaibab Trail"],
      is_closed: false,
      decision: "no_go",
      reason: "100°F+ below rim; no rim-to-river day hikes, avoid midday.",
    },
    model: MODEL,
    latency_ms: 251,
  },
  {
    id: "C7A1B2D3-0002-4C22-8E00-GRCA00000002",
    park_code: "grca",
    park_name: "Grand Canyon National Park",
    title: "Transcanyon Water Pipeline Break — No Water at Havasupai Gardens",
    description:
      "Due to a break in the Transcanyon Waterline, potable water is unavailable at Havasupai Gardens and the 3-Mile Resthouse. Carry all water you need or a means to treat creek water.",
    url: "https://www.nps.gov/grca/planyourvisit/conditions.htm",
    nps_category: "Caution",
    last_indexed: "2026-10-08",
    verdict: {
      hazard_type: "water",
      severity: 2,
      trails_affected: ["Bright Angel Trail"],
      is_closed: false,
      decision: "caution",
      reason: "No potable water at Havasupai Gardens or 3-Mile Resthouse; carry all water.",
    },
    model: MODEL,
    latency_ms: 229,
  },
  {
    id: "D4E5F6A7-0001-4D33-9A00-OLYM00000001",
    park_code: "olym",
    park_name: "Olympic National Park",
    title: "Hurricane Ridge Road Open Friday–Sunday Only",
    description:
      "Hurricane Ridge Road is open to vehicles Friday through Sunday, 9 a.m. to 4 p.m., weather permitting. Hikers may access trails from the Heart O' the Hills entrance on other days.",
    url: "https://www.nps.gov/olym/planyourvisit/conditions.htm",
    nps_category: "Information",
    last_indexed: "2026-10-05",
    verdict: {
      hazard_type: "road",
      severity: 1,
      trails_affected: [],
      is_closed: false,
      decision: "go",
      reason: "Road open Fri–Sun daytime; trails reachable from Heart O' the Hills.",
    },
    model: MODEL,
    latency_ms: 190,
  },
  {
    id: "E8F9A0B1-0001-4E44-8B00-ZION00000001",
    park_code: "zion",
    park_name: "Zion National Park",
    title: "The Narrows Closed — Flow Above 150 CFS",
    description:
      "The Virgin River is flowing above 150 cubic feet per second following recent storms. The Narrows is closed to all hiking from the Temple of Sinawava until flow drops and stays below the threshold.",
    url: "https://www.nps.gov/zion/planyourvisit/conditions.htm",
    nps_category: "Park Closure",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "water",
      severity: 3,
      trails_affected: ["The Narrows"],
      is_closed: true,
      decision: "no_go",
      reason: "Virgin River above 150 CFS; Narrows closed from Temple of Sinawava.",
    },
    model: MODEL,
    latency_ms: 233,
  },
  {
    id: "E8F9A0B1-0002-4E44-8B00-ZION00000002",
    park_code: "zion",
    park_name: "Zion National Park",
    title: "Angels Landing Permits Required",
    description:
      "A permit is required to hike to Angels Landing beyond Scout Lookout. Permits are issued via seasonal and day-before lotteries. Scout Lookout remains open without a permit.",
    url: "https://www.nps.gov/zion/planyourvisit/conditions.htm",
    nps_category: "Information",
    last_indexed: "2026-10-01",
    verdict: {
      hazard_type: "other",
      severity: 1,
      trails_affected: ["Angels Landing"],
      is_closed: false,
      decision: "go",
      reason: "Permit needed past Scout Lookout; Scout Lookout open without one.",
    },
    model: MODEL,
    latency_ms: 187,
  },
  {
    id: "F1A2B3C4-0001-4F55-9C00-YELL00000001",
    park_code: "yell",
    park_name: "Yellowstone National Park",
    title: "Stay Away From Bull Elk",
    description:
      "The elk rut is underway. Bull elk are aggressive and unpredictable. Stay at least 25 yards away, and use your car as a blind in Mammoth Hot Springs.",
    url: "https://www.nps.gov/yell/planyourvisit/conditions.htm",
    nps_category: "Caution",
    last_indexed: "2026-10-09",
    verdict: {
      hazard_type: "wildlife",
      severity: 2,
      trails_affected: [],
      is_closed: false,
      decision: "caution",
      reason: "Elk rut; keep 25 yards from bulls, especially at Mammoth.",
    },
    model: MODEL,
    latency_ms: 208,
  },
  {
    id: "F1A2B3C4-0002-4F55-9C00-YELL00000002",
    park_code: "yell",
    park_name: "Yellowstone National Park",
    title: "Biscuit Basin Boardwalk Closed",
    description:
      "Biscuit Basin, including the boardwalk and parking area, remains closed following the hydrothermal explosion. The Mystic Falls Trail is accessible only from the Old Faithful area.",
    url: "https://www.nps.gov/yell/planyourvisit/conditions.htm",
    nps_category: "Park Closure",
    last_indexed: "2026-10-04",
    verdict: {
      hazard_type: "geologic",
      severity: 3,
      trails_affected: ["Biscuit Basin"],
      is_closed: true,
      decision: "no_go",
      reason: "Biscuit Basin closed after hydrothermal explosion; Mystic Falls via Old Faithful.",
    },
    model: MODEL,
    latency_ms: 240,
  },
];

function worst(code: string): Park["worst_decision"] {
  const ds = MOCK_ALERTS.filter((a) => a.park_code === code).map((a) => a.verdict.decision);
  if (ds.includes("no_go")) return "no_go";
  if (ds.includes("caution")) return "caution";
  return ds.length ? "go" : null;
}

const PARK_META: [string, string, string][] = [
  ["chch", "Chickamauga & Chattanooga National Military Park", "GA,TN"],
  ["havo", "Hawaiʻi Volcanoes National Park", "HI"],
  ["yose", "Yosemite National Park", "CA"],
  ["grca", "Grand Canyon National Park", "AZ"],
  ["olym", "Olympic National Park", "WA"],
  ["zion", "Zion National Park", "UT"],
  ["yell", "Yellowstone National Park", "WY,MT,ID"],
  ["acad", "Acadia National Park", "ME"],
];

export const MOCK_PARKS: Park[] = PARK_META.map(([park_code, park_name, states]) => ({
  park_code,
  park_name,
  states,
  alert_count: MOCK_ALERTS.filter((a) => a.park_code === park_code).length,
  worst_decision: worst(park_code),
}));

export const MOCK_CARD: TrailCard = {
  id: "card_2026-10-11_chch-havo",
  generated_at: "2026-10-10T14:02:11Z",
  week_of: "2026-10-11",
  overall: "caution",
  workflow_id: "trailcard-2026-10-11-chch-havo-7f3e",
  model: MODEL,
  parks: [
    {
      park_code: "havo",
      park_name: "Hawaiʻi Volcanoes National Park",
      decision: "caution",
      headline: "Go — but skip Halemaʻumaʻu Trail",
      closed_trails: ["Halemaʻumaʻu Trail", "Byron Ledge Trail (Kīlauea Iki section)"],
      watch_for: ["Wind-blown volcanic glass at downwind overlooks", "Ground cracking near the summit"],
      alert_ids: ["E6380F1D-EB3A-44EC-B206-6A65019B38D5", "031E225F-49AB-4264-9DD6-4402E620DC1B"],
    },
    {
      park_code: "chch",
      park_name: "Chickamauga & Chattanooga National Military Park",
      decision: "caution",
      headline: "Go with care — owl on Bluff Trail",
      closed_trails: [],
      watch_for: ["Territorial barred owl on Bluff Trail near dusk", "Weekday flaggers on East Brotherton Road"],
      alert_ids: ["6822FAF9-9E8D-4F41-A8B3-760473B7381A", "A5793882-6117-4E05-B175-A9FD505FE6FC"],
    },
  ],
};

export const MOCK_RUNS: WorkflowRun[] = [
  {
    workflow_id: "trailcard-2026-10-11-chch-havo-7f3e",
    status: "completed",
    parks: ["chch", "havo"],
    started_at: "2026-10-10T14:01:58Z",
    ended_at: "2026-10-10T14:02:11Z",
    card_id: MOCK_CARD.id,
    retries: 1,
    steps: [
      { name: "fetch_alerts:chch", status: "completed", attempt: 1, started_at: "2026-10-10T14:01:58Z", ended_at: "2026-10-10T14:01:59Z" },
      {
        name: "fetch_alerts:havo",
        status: "completed",
        attempt: 2,
        started_at: "2026-10-10T14:01:59Z",
        ended_at: "2026-10-10T14:02:02Z",
        error: "attempt 1: NPS API HTTP 503 Service Unavailable (retried after 1s backoff)",
      },
      { name: "classify_alerts", status: "completed", attempt: 1, started_at: "2026-10-10T14:02:02Z", ended_at: "2026-10-10T14:02:09Z" },
      { name: "compose_card", status: "completed", attempt: 1, started_at: "2026-10-10T14:02:09Z", ended_at: "2026-10-10T14:02:10Z" },
      { name: "publish_card", status: "completed", attempt: 1, started_at: "2026-10-10T14:02:10Z", ended_at: "2026-10-10T14:02:11Z" },
    ],
  },
  {
    workflow_id: "trailcard-2026-10-10-zion-yose-c3d4",
    status: "completed",
    parks: ["zion", "yose"],
    started_at: "2026-10-10T04:21:31Z",
    ended_at: "2026-10-10T04:21:46Z",
    retries: 0,
    steps: [
      { name: "fetch_alerts:zion", status: "completed", attempt: 1, started_at: "2026-10-10T04:21:31Z", ended_at: "2026-10-10T04:21:31Z" },
      { name: "fetch_alerts:yose", status: "completed", attempt: 1, started_at: "2026-10-10T04:21:31Z", ended_at: "2026-10-10T04:21:32Z" },
      {
        name: "classify_alerts",
        status: "completed",
        attempt: 1,
        started_at: "2026-10-10T04:21:32Z",
        ended_at: "2026-10-10T04:21:46Z",
        error: "worker process killed mid-step; workflow resumed on restarted worker from event history",
      },
      { name: "compose_card", status: "completed", attempt: 1, started_at: "2026-10-10T04:21:46Z", ended_at: "2026-10-10T04:21:46Z" },
      { name: "publish_card", status: "completed", attempt: 1, started_at: "2026-10-10T04:21:46Z", ended_at: "2026-10-10T04:21:46Z" },
    ],
  },
];

export const MOCK_CARD_STATUS: CardStatus = {
  status: "completed",
  card: MOCK_CARD,
  steps: MOCK_RUNS[0].steps,
  workflow_id: MOCK_CARD.workflow_id,
};

export const MOCK_EVAL: EvalResults = {
  test_size: 120,
  generated_at: "2026-10-10T12:00:00Z",
  pending: true,
  models: [
    { name: "teacher (Qwen3-235B)", role: "teacher", json_valid: 0.99, decision_acc: 0.88, closure_f1: 0.9, hazard_acc: 0.81, p50_latency_ms: 1800, cost_per_1k_alerts_usd: 0.9 },
    { name: "Llama-3.2-1B base", role: "base", json_valid: 0.55, decision_acc: 0.41, closure_f1: 0.38, hazard_acc: 0.3, p50_latency_ms: 240, cost_per_1k_alerts_usd: 0.02 },
    { name: "Llama-3.2-1B + TrailTruth LoRA", role: "lora", json_valid: 0.98, decision_acc: 0.8, closure_f1: 0.84, hazard_acc: 0.72, p50_latency_ms: 250, cost_per_1k_alerts_usd: 0.02 },
    { name: "heuristic-keywords-v1", role: "heuristic", json_valid: 1, decision_acc: 0.5, closure_f1: 0.6, hazard_acc: 0.5, p50_latency_ms: 1, cost_per_1k_alerts_usd: 0 },
  ],
  confusion: {
    lora: { labels: ["go", "caution", "no_go"], matrix: [[50, 6, 2], [5, 20, 4], [1, 4, 28]] },
  },
  training: {
    steps: 300,
    epochs: 3,
    lora_rank: 32,
    loss_curve: [
      [0, 2.45], [20, 1.88], [40, 1.45], [60, 1.14], [80, 0.91], [100, 0.74], [120, 0.61], [140, 0.52],
      [160, 0.45], [180, 0.4], [200, 0.36], [220, 0.33], [240, 0.31], [260, 0.29], [280, 0.28], [300, 0.27],
    ],
  },
  examples: [
    {
      title: "Use Caution When Hiking Bluff Trail on Lookout Mountain",
      base_output: "Sure! Here is the JSON: {hazard: owl, decision: maybe}",
      lora_output:
        '{"hazard_type":"wildlife","severity":2,"trails_affected":["Bluff Trail"],"is_closed":false,"decision":"caution","reason":"Territorial barred owl on Bluff Trail section; stay alert."}',
      expected_decision: "caution",
    },
  ],
};
