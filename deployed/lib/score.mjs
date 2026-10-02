// Composite scorer: Jev answers + state facts → one "needs the owner's eyes now"
// number. Vendor pattern (docs: composite scoring): normalize each dimension
// to 0–1, weight in code. No vetoes in the label-only phase — the BULLSHIT
// pile IS the safety net, so everything is just signal.
//
// Convention: positive = "show me". Contributions are logged per email so a
// surprising decision can be traced to the question that moved it.
import config from '../config.json' with { type: 'json' };

const { weights, topic_values, sender_values, tier_values, threshold } = config;

function confScaled(answer) {
  // Choice/Score carry confidence; Nouls don't — take them at face value.
  return answer?.confidence ?? 1;
}

export function composite(state, answers) {
  const parts = [];
  const add = (key, weight, value) => {
    const contribution = weight * value;
    parts.push({ key, weight, value: round3(value), contribution: round3(contribution) });
    return contribution;
  };

  let score = 0;
  const a = answers ?? {};

  if (a.urgency) score += add('urgency', weights.urgency, (a.urgency.score / 4) * confScaled(a.urgency));
  if (a.topic) score += add('topic', weights.topic, (topic_values[a.topic.choice] ?? 0) * confScaled(a.topic));
  if (a.sender_type) score += add('sender_type', weights.sender, (sender_values[a.sender_type.choice] ?? 0) * confScaled(a.sender_type));
  if (a.is_scam) score += add('is_scam', weights.is_scam, a.is_scam.noul); // weight is negative
  if (a.is_stale) score += add('is_stale', weights.is_stale, a.is_stale.noul); // weight is negative
  if (a.announces_event) score += add('announces_event', weights.announces_event, a.announces_event.noul);
  if (a.is_compound) score += add('is_compound', weights.is_compound, a.is_compound.noul);

  const tier = state.address_tier ?? 'other';
  score += add('address_tier', weights.address_tier, tier_values[tier] ?? 0);

  const threadN = Math.min(state.email?.messages_in_thread ?? 1, 3) / 3;
  score += add('thread', weights.thread, threadN);

  return { score: round3(score), show: score >= threshold, threshold, contributions: parts };
}

function round3(n) { return Math.round(n * 1000) / 1000; }
