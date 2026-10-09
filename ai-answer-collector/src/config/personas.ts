// The two shopper personas. Consumer AI apps take no system prompt, so the
// persona is a short first-person preamble placed before the question; every
// engine gets the identical prompt text.

export type PersonaId = "value_seeker" | "feature_enthusiast";

export type Persona = { id: PersonaId; label: string; preamble: string };

export const PERSONAS: Persona[] = [
  {
    id: "value_seeker",
    label: "Value Seeker",
    preamble: "I'm shopping carefully and want the best value for my money. I compare prices and deals, and I don't want to pay for features I won't use.",
  },
  {
    id: "feature_enthusiast",
    label: "Feature Enthusiast",
    preamble: "I love the latest technology and want the best performance and features available. I'm happy to pay more for features that make a real difference.",
  },
];
