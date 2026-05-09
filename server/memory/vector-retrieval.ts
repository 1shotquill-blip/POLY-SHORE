export interface HistoricalEventEmbedding {
  eventId: string;
  summary: string;
  embedding: number[];
  anomalyType: string;
  marketMaker?: string;
  resolutionPattern?: string;
  outcome: "causal" | "coincidental" | "unknown";
  pnlUsd?: number;
}

export interface SimilarHistoricalEvent extends HistoricalEventEmbedding {
  similarity: number;
}

export interface VectorMemoryStore {
  searchByEmbedding(
    embedding: number[],
    options?: { topK?: number; anomalyType?: string }
  ): Promise<SimilarHistoricalEvent[]>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export class InMemoryVectorMemoryStore implements VectorMemoryStore {
  constructor(private readonly events: HistoricalEventEmbedding[]) {}

  async searchByEmbedding(
    embedding: number[],
    options: { topK?: number; anomalyType?: string } = {}
  ): Promise<SimilarHistoricalEvent[]> {
    const topK = options.topK ?? 5;
    return this.events
      .filter(
        event =>
          !options.anomalyType || event.anomalyType === options.anomalyType
      )
      .map(event => ({
        ...event,
        similarity: cosineSimilarity(embedding, event.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

export function buildStructuralEmbedding(input: {
  anomalyScore: number;
  probabilityGap: number;
  liquidity: number;
  volume24h: number;
  spread: number;
  hoursToExpiry: number;
}): number[] {
  return [
    input.anomalyScore,
    input.probabilityGap,
    Math.log10(Math.max(1, input.liquidity)) / 6,
    Math.log10(Math.max(1, input.volume24h)) / 7,
    input.spread,
    Math.min(1, input.hoursToExpiry / 720),
  ];
}
