export type AiAvailability = 'disabled' | 'available';

export type AiProvider = {
  readonly id: string;
  answer(input: { question: string; queryPlan: unknown }): Promise<{ text: string }>;
};

export type AiRuntime = {
  availability: AiAvailability;
  provider?: AiProvider;
};

export const disabledAi: AiRuntime = { availability: 'disabled' };
