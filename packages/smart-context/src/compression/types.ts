export interface CompressorStats {
  turnsProcessed: number;
  totalSaved: number;
  ratio: number;
  haikuCalls: number;
  haikuCacheHits: number;
  storedItems: number;
}
