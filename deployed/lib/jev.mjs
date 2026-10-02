// Direct TypeSafe API client. POST https://api.typesafe.ai/v1/systemone
//
// PORTABILITY NOTE: TypeSafe is the Jev model provider used by the author.
// The `credential` default ('custom.typesafe') is the author's connector
// name — point it at your own credential or rewrite the auth header logic
// for whichever LLM API you use. The question battery in questions.json is
// provider-agnostic; only this transport is TypeSafe-specific.
// with the connector surrogate as the Bearer token.
import { getSurrogate } from './surrogate.mjs';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const ALLOWED_HOSTS = ['api.typesafe.ai'];
const MODEL = 'jev-latest'; // resolves to the current flagship (jev-1.13.x)

function checkHost(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) throw new Error(`refusing credentialed request to ${host}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function evaluate(state, questions, { credential = 'custom.typesafe', maxRetries = 4 } = {}) {
  checkHost(ENDPOINT);
  const token = await getSurrogate(credential);
  const body = JSON.stringify({ model: MODEL, state, questions });

  let attempt = 0;
  for (;;) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    });
    if (res.status === 429 || res.status === 529) {
      if (attempt >= maxRetries) throw new Error(`TypeSafe rate limited after ${maxRetries} retries`);
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      attempt++;
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`TypeSafe HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json(); // { model, answers, usage: { input_tokens, output_tokens } }
  }
}
