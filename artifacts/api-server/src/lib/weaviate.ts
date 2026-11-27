import weaviate, { type WeaviateClient } from "weaviate-client";

/**
 * Weaviate vector store for document passages (v3 client, gRPC transport).
 * One collection with native multi-tenancy: each case is its own tenant, so a
 * search can only ever see the passages of the case it is scoped to.
 * Vectors are produced inside Weaviate Cloud (text2vec-weaviate), so no extra embedding key is needed.
 */
const COLLECTION = "FintraceDocumentChunk";

export type ChunkInput = {
  documentId: number;
  documentName: string;
  category: string;
  pageNumber: number;
  chunkIndex: number;
  method: "text" | "vision" | "mixed";
  content: string;
};

export type ChunkHit = ChunkInput & { score: number | null };

export function weaviateConfigured(): boolean {
  return !!(process.env.WEAVIATE_URL && process.env.WEAVIATE_API_KEY);
}

const tenantOf = (caseId: number) => `case_${caseId}`;

let clientPromise: Promise<WeaviateClient> | null = null;
let schemaReady: Promise<void> | null = null;
const knownTenants = new Set<string>();

function getClient(): Promise<WeaviateClient> {
  if (!clientPromise) {
    clientPromise = weaviate
      // The client wants a bare host; accept URLs pasted with a scheme or trailing slash.
      .connectToWeaviateCloud(process.env.WEAVIATE_URL!.trim().replace(/^https?:\/\//, "").replace(/\/+$/, ""), {
        authCredentials: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY!),
        timeout: { init: 30, query: 60, insert: 180 },
      })
      .catch((err) => {
        clientPromise = null;
        throw err;
      });
  }
  return clientPromise;
}

async function ensureSchema(client: WeaviateClient): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      if (await client.collections.exists(COLLECTION)) return;
      await client.collections.create({
        name: COLLECTION,
        properties: [
          { name: "content", dataType: "text" },
          { name: "documentName", dataType: "text" },
          { name: "category", dataType: "text", skipVectorization: true },
          { name: "documentId", dataType: "int" },
          { name: "pageNumber", dataType: "int" },
          { name: "chunkIndex", dataType: "int" },
          { name: "method", dataType: "text", skipVectorization: true },
        ],
        vectorizers: weaviate.configure.vectors.text2VecWeaviate({ sourceProperties: ["content", "documentName"] }),
        multiTenancy: weaviate.configure.multiTenancy({ autoTenantActivation: true }),
      });
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

async function caseCollection(caseId: number) {
  const client = await getClient();
  await ensureSchema(client);
  const base = client.collections.use(COLLECTION);
  const tenant = tenantOf(caseId);
  if (!knownTenants.has(tenant)) {
    if (!(await base.tenants.getByName(tenant))) await base.tenants.create([{ name: tenant }]);
    knownTenants.add(tenant);
  }
  return base.withTenant(tenant);
}

export async function deleteDocumentChunks(caseId: number, documentId: number): Promise<void> {
  const col = await caseCollection(caseId);
  await col.data.deleteMany(col.filter.byProperty("documentId").equal(documentId));
}

/** Replaces every stored passage of a document with the given chunks. */
export async function replaceDocumentChunks(caseId: number, documentId: number, chunks: ChunkInput[]): Promise<void> {
  const col = await caseCollection(caseId);
  await col.data.deleteMany(col.filter.byProperty("documentId").equal(documentId));
  const BATCH = 100;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const res = await col.data.insertMany(chunks.slice(i, i + BATCH).map((c) => ({ ...c })));
    if (res.hasErrors) {
      const first = Object.values(res.errors)[0];
      throw new Error(`Weaviate rejected ${Object.keys(res.errors).length} passage(s): ${first?.message ?? "unknown error"}`);
    }
  }
}

/** Every stored passage of one case, ordered by document, page and chunk. */
export async function listCaseChunks(caseId: number): Promise<ChunkInput[]> {
  const col = await caseCollection(caseId);
  const all: ChunkInput[] = [];
  for await (const o of col.iterator()) all.push(o.properties as unknown as ChunkInput);
  return all.sort((a, b) => a.documentId - b.documentId || a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);
}

/** Hybrid (keyword + semantic) search scoped to one case's tenant. */
export async function searchCaseChunks(caseId: number, query: string, limit = 8): Promise<ChunkHit[]> {
  const col = await caseCollection(caseId);
  const res = await col.query.hybrid(query, { limit, alpha: 0.6, returnMetadata: ["score"] });
  return res.objects.map((o) => {
    const p = o.properties as unknown as ChunkInput;
    return { ...p, score: o.metadata?.score ?? null };
  });
}
