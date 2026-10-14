export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function body<T>(req: Request): Promise<T | null> { try { return (await req.json()) as T; } catch { return null; } }
