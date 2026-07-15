// LUXIGA card runtime config.
// The card posts work requests to `${LX_API}/lead` and fires beacons to `${LX_API}/event`.
// To route work requests straight into the CRM, point this at the CRM Worker base:
//   window.LX_API = "https://luxiga.co/api";   // -> /api/lead (CRM intake) + /api/event (accepted, not stored)
// (Alternatively point at infrastructure/card-worker for per-event analytics.)
// While empty, the work-request form falls back to mailto and no events are sent.
// See docs/CRM.md for the deploy order.
window.LX_API = "";
