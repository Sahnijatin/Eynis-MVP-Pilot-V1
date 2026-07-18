// Per-vertical value model (#167) — what "value" means for each industry, so a
// pilot can produce a defensible attributed-value number in the unit that matters
// to that vertical (rupees for hospitality, downtime-avoided for manufacturing,
// resolution-time-saved for IT). Kept self-contained in the attribution module
// rather than the industry pack so attribution owns its own config.

export type ValueType = "revenue" | "downtime_avoided" | "time_saved";

export interface ValueModel {
  /** The vertical's headline attribution metric shown as the primary number. */
  headlineType: ValueType;
  headlineLabel: string;
  /** valueType credited when a service request is resolved. */
  srValueType: Extract<ValueType, "downtime_avoided" | "time_saved">;
  /** Minutes of value credited per resolved request (operational time returned). */
  minutesPerResolved: number;
}

const VALUE_MODELS: Record<string, ValueModel> = {
  // Hospitality's headline is revenue (from accepted upsell offers); resolving a
  // guest request still returns some staff time.
  hospitality: { headlineType: "revenue", headlineLabel: "Revenue uplift", srValueType: "time_saved", minutesPerResolved: 8 },
  manufacturing: { headlineType: "downtime_avoided", headlineLabel: "Downtime avoided", srValueType: "downtime_avoided", minutesPerResolved: 45 },
  it_services: { headlineType: "time_saved", headlineLabel: "Resolution time saved", srValueType: "time_saved", minutesPerResolved: 25 },
};

const GENERIC_VALUE_MODEL: ValueModel = {
  headlineType: "time_saved", headlineLabel: "Time saved", srValueType: "time_saved", minutesPerResolved: 15,
};

export function getValueModel(industry: string | null | undefined): ValueModel {
  return (industry && Object.prototype.hasOwnProperty.call(VALUE_MODELS, industry) && VALUE_MODELS[industry]) || GENERIC_VALUE_MODEL;
}

/** Human-readable unit for a value type. */
export function unitFor(valueType: ValueType): "INR" | "minutes" {
  return valueType === "revenue" ? "INR" : "minutes";
}

export const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  revenue: "Revenue uplift",
  downtime_avoided: "Downtime avoided",
  time_saved: "Time saved",
};
